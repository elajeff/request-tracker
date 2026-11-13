import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const project = `rt-e2e-${randomUUID().slice(0, 8)}`;
const results = resolve(directory, '../test-results/browser', `${Date.now()}-${project}`);
mkdirSync(results, { recursive: true });
const composeArgs = ['compose', '--project-name', project, '--file', join(directory, 'compose.yaml')];
const accountPassword = 'browser-tests-password';
const environment = { ...process.env, E2E_RESULTS_DIR: results, E2E_PASSWORD: accountPassword,
  REQUEST_TRACKER_ACCOUNT_PASSWORD: accountPassword,
  E2E_UID: String(process.getuid?.() ?? 1000), E2E_GID: String(process.getgid?.() ?? 1000) };
let activeCommand;
let interrupted = 0;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    interrupted = code;
    activeCommand?.kill('SIGTERM');
  });
}

function compose(args, capture = false) {
  return new Promise((resolveCommand) => {
    let output = '';
    const child = spawn('docker', [...composeArgs, ...args], {
      env: environment, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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
console.log(`Isolated Compose project: ${project}\nResults: ${results}`);
try {
  ({ code } = await compose(['config', '--quiet']));
  if (!code && !interrupted) ({ code } = await compose(['build']));
  if (!code && !interrupted) {
    ({ code } = await compose(['up', '--detach', 'postgres', 'request-tracker', 'frontend']));
  }
  if (!code && !interrupted) {
    for (const [name, role] of [['support', 'SUPPORT'], ['requester', 'REQUESTER'], ['other', 'REQUESTER']]) {
      const result = await compose(['run', '--rm', '--no-deps', '--env', 'REQUEST_TRACKER_ACCOUNT_PASSWORD',
        'request-tracker', '--accounts.action=create', `--accounts.username=e2e-${name}`,
        `--accounts.role=${role}`], true);
      code = result.code;
      if (code) { console.error(result.output); break; }
    }
  }
  if (!code && !interrupted) {
    const result = await compose(['run', '--rm', '--no-deps', 'tests', 'npm', 'test', '--', ...process.argv.slice(2)], true);
    code = result.code;
    console.log(result.output);
  }
} finally {
  code = interrupted || code;
  if (code) {
    const logs = await compose(['logs', '--no-color', '--timestamps', 'request-tracker', 'frontend', 'postgres'], true);
    writeFileSync(join(results, 'stack.log'), logs.output);
  }
  const down = await compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local']);
  code ||= down.code;
}
process.exitCode = code;
