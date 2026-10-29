import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const project = `rt-e2e-${randomUUID().slice(0, 8)}`;
const results = resolve(directory, '../test-results/browser', `${Date.now()}-${project}`);
mkdirSync(results, { recursive: true });
const composeArgs = ['compose', '--project-name', project, '--file', join(directory, 'compose.yaml'),
  '--env-file', join(directory, 'compose.env')];
const passwords = Object.fromEntries(['SUPPORT', 'REQUESTER', 'OTHER'].map(role => [role, randomUUID()]));
const databasePassword = randomUUID();
const environment = { ...process.env, E2E_RESULTS_DIR: results, E2E_DB_PASSWORD: databasePassword,
  E2E_UID: String(process.getuid?.() ?? 1000), E2E_GID: String(process.getgid?.() ?? 1000),
  ...Object.fromEntries(Object.entries(passwords).map(([role, password]) => [`E2E_${role}_PASSWORD`, password])) };
const redact = text => [databasePassword, ...Object.values(passwords)].reduce(
  (value, password) => value.replaceAll(password, '[redacted]'), text);
let activeCommand;
let interrupted = 0;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    interrupted = code;
    activeCommand?.kill('SIGTERM');
  });
}

function compose(args, capture = false, extraEnvironment = {}) {
  return new Promise((resolveCommand) => {
    let output = '';
    const child = spawn('docker', [...composeArgs, ...args], {
      env: { ...environment, ...extraEnvironment }, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    activeCommand = child;
    if (capture) {
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
    }
    child.once('error', error => {
      console.error(error.message);
      resolveCommand({ code: 1, output });
    });
    child.once('close', code => {
      activeCommand = undefined;
      resolveCommand({ code: code ?? 1, output });
    });
  });
}

let code = 1;
let cleanupCode = 0;
function saveArtifact(name, content) {
  try {
    writeFileSync(join(results, name), redact(content));
  } catch (error) {
    console.error(`Could not save ${name}: ${error.message}`);
    code ||= 1;
  }
}

console.log(`Isolated Compose project: ${project}\nResults: ${results}`);
try {
  ({ code } = await compose(['config', '--quiet']));
  if (!code && !interrupted) ({ code } = await compose(['build']));
  if (!code && !interrupted) {
    ({ code } = await compose(['up', '--detach', 'postgres', 'request-tracker', 'frontend']));
  }
  if (!code && !interrupted) {
    for (const [key, role] of [['SUPPORT', 'SUPPORT'], ['REQUESTER', 'REQUESTER'], ['OTHER', 'REQUESTER']]) {
      const result = await compose(['run', '--rm', '--no-deps', '--env', 'REQUEST_TRACKER_ACCOUNT_PASSWORD',
        'request-tracker', '--accounts.action=create', `--accounts.username=e2e-${key.toLowerCase()}`,
        `--accounts.role=${role}`], true, { REQUEST_TRACKER_ACCOUNT_PASSWORD: passwords[key] });
      code = result.code;
      if (code) { console.error(redact(result.output)); break; }
    }
  }
  if (!code && !interrupted) {
    const result = await compose(['run', '--rm', '--no-deps', 'tests', 'npm', 'test', '--', ...process.argv.slice(2)], true);
    code = result.code;
    console.log(redact(result.output));
  }
} finally {
  code = interrupted || code;
  if (code) {
    const logs = await compose(['logs', '--no-color', '--timestamps', 'request-tracker', 'frontend', 'postgres'], true);
    saveArtifact('stack.log', logs.output);
  }
  ({ code: cleanupCode } = await compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local']));
  code = interrupted || code;
  // Authenticated traces include session cookies; only textual reports and screenshots are retained.
  const sanitize = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) sanitize(path);
      else if (/\.(json|md|log|txt)$/.test(entry.name)) writeFileSync(path, redact(readFileSync(path, 'utf8')));
    }
  };
  let artifactsSafe = false;
  try {
    sanitize(results);
    artifactsSafe = true;
  } catch (error) {
    console.error(`Artifact sanitization failed: ${error.message}`);
    code ||= 1;
  }
  saveArtifact('run.json', JSON.stringify({ project, exitCode: code,
    cleanupExitCode: cleanupCode, artifactsSafe }, null, 2));
  if (artifactsSafe && process.env.GITHUB_OUTPUT) {
    try {
      appendFileSync(process.env.GITHUB_OUTPUT, 'artifacts_safe=true\n');
    } catch (error) {
      console.error(`Could not approve artifact upload: ${error.message}`);
      code ||= 1;
    }
  }
  if (cleanupCode) console.error(`Compose cleanup failed (${cleanupCode}) for ${project}`);
}
process.exitCode = interrupted || code || cleanupCode;
