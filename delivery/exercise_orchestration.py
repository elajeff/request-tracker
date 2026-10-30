"""Local V6 publication and control-plane evidence gates. No application retries."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import uuid

from traffic_accounting import validate

FRESHNESS_NS = 60 * 1_000_000_000
REMOTE_BASE = "35143dd26e48801331fcc160b4d5d73cf3a2b1eb"
MAIN = "704354cb5c4f94e580817c28487986cc09de1ffb"
REF = "refs/heads/demo/v6-kind-progressive"
IDENTITY = "elajeff|67196636+elajeff@users.noreply.github.com|elajeff|67196636+elajeff@users.noreply.github.com"
SCOPE = {"helm/request-tracker/files/traffic.py", "delivery/exercise_orchestration.py",
         "delivery/test_exercise_orchestration.py", "delivery/test_traffic_accounting.py"}


class GateError(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise GateError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def decode_records(raw):
    try:
        need(bool(raw) and raw.endswith(b"\n"), "Missing/truncated request evidence")
        starts, ends = {}, {}
        run_id = None
        for line in raw.splitlines():
            item = json.loads(line)
            if run_id is None:
                run_id = item["runId"]
            need(item["runId"] == run_id, "Mixed run IDs")
            identity = item["id"]
            need(type(identity) is int and identity > 0, "Invalid request ID")
            if item["event"] == "started":
                need(identity not in starts and identity not in ends, "Duplicate start")
                starts[identity] = item
            else:
                need(item["event"] == "completed" and identity in starts and identity not in ends,
                     "Missing/duplicate completion")
                need(item["timeNs"] >= starts[identity]["timeNs"], "Request time reversed")
                ends[identity] = item
        need(set(starts) == set(range(1, len(starts) + 1)), "Request ID gap")
        return run_id, starts, ends
    except (KeyError, TypeError, json.JSONDecodeError):
        raise GateError("Corrupt request evidence") from None


def clean_outcomes(starts, ends):
    for identity, item in ends.items():
        expected = "http:204" if starts[identity]["operation"] == "login" else "http:200"
        need(item["outcome"] == expected, "Application traffic failure retained; gate failed")


def baseline_proof(directory, route, attempt_id, service_ip):
    need(__debug__, "Optimized Python cannot enforce the existing accounting validator")
    try:
        summary = validate(directory)
        raw = (Path(directory) / "requests.ndjson").read_bytes()
        summary_bytes = (Path(directory) / "summary.json").read_bytes()
        run_id, starts, ends = decode_records(raw)
        need(starts.keys() == ends.keys(), "Incomplete baseline")
        clean_outcomes(starts, ends)
        baseline = summary["baseline"]
        need(baseline["attemptId"] == str(uuid.UUID(attempt_id)), "Baseline attempt mismatch")
        need(baseline["route"] == route and baseline["context"] == "kind-request-tracker",
             "Baseline route/context mismatch")
        address = urllib.parse.urlsplit(baseline["baseUrl"])
        need(address.scheme == "http" and not address.username and not address.password
             and not address.query and not address.fragment and address.path in {"", "/"}, "Invalid frontend route")
        need(address.hostname in {"127.0.0.1", "localhost"} if route == "host"
             else address.hostname == service_ip and address.port in {None, 80}, "Wrong frontend path")
        began, ended = baseline["startedAtNs"], baseline["endedAtNs"]
        need(baseline["requestedSeconds"] == 120 and type(began) is int and type(ended) is int
             and ended - began >= 120_000_000_000, "Baseline shorter than 120 seconds")
        first = min(x["timeNs"] for x in starts.values())
        completed = max(x["timeNs"] for x in ends.values())
        last_dispatch = max(x["timeNs"] for x in starts.values())
        need(began <= first and last_dispatch <= ended and completed <= ended + 12_000_000_000,
             "Baseline timestamps mismatch")
        need(last_dispatch >= ended - 3_000_000_000 and completed - first >= 115_000_000_000,
             "Baseline did not sustain its complete window")
        for worker in range(4):
            operations = [x["operation"] for x in starts.values() if x.get("worker") == worker]
            need(operations.count("session-bootstrap") == operations.count("login") == 1
                 and all(operation in operations for operation in ["session-refresh", "queue", "history"]),
                 "Missing worker authentication or baseline workload")
        need(all(x.get("worker") in range(4) for x in starts.values()), "Unknown baseline worker")
        return {"route": route, "runId": run_id, "attemptId": baseline["attemptId"],
                "startedAtNs": began, "windowEndedAtNs": ended, "completedAtNs": completed,
                "completedAtUtc": datetime.fromtimestamp(completed / 1e9, timezone.utc).isoformat(),
                "rawSha256": sha(raw), "summarySha256": sha(summary_bytes), "completed": len(ends)}
    except (OSError, KeyError, TypeError, ValueError) as error:
        if isinstance(error, GateError):
            raise
        raise GateError("Missing or invalid baseline evidence") from None


def fresh_pair(root, attempt_id, service_ip, now_ns):
    proof = {route: baseline_proof(Path(root) / route, route, attempt_id, service_ip)
             for route in ["host", "cluster"]}
    need(proof["host"]["runId"] != proof["cluster"]["runId"], "Shared baseline run/session evidence")
    ensure_fresh(proof, now_ns)
    return proof


def ensure_fresh(proof, now_ns):
    for item in proof.values():
        need(0 <= now_ns - item["completedAtNs"] <= FRESHNESS_NS, "Baseline expired or in future")


def certify_baselines(root, attempt_id, service_ip, now_ns=None):
    root = Path(root)
    proof = fresh_pair(root, attempt_id, service_ip, time.time_ns() if now_ns is None else now_ns)
    certificate = {"version": 1, "attemptId": attempt_id, "serviceIP": service_ip,
                   "freshnessSeconds": 60, "routes": proof}
    # Never overwrite a prior attempt's certificate to make old evidence look new.
    with (root / "baseline-certificate.json").open("x", encoding="utf-8") as output:
        json.dump(certificate, output, sort_keys=True)
    return certificate


def validate_certificate(root, attempt_id, now_ns):
    try:
        certificate = json.loads((Path(root) / "baseline-certificate.json").read_text())
        need(certificate["version"] == 1 and certificate["attemptId"] == attempt_id
             and certificate["freshnessSeconds"] == 60, "Baseline certificate mismatch")
        actual = fresh_pair(root, attempt_id, certificate["serviceIP"], now_ns)
        need(actual == certificate["routes"], "Baseline evidence changed after certification")
        return certificate
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        raise GateError("Missing/corrupt baseline certificate") from None


def validate_readiness(marker, raw):
    try:
        need(marker["version"] == 1 and marker["workers"] == [0, 1, 2, 3], "Invalid readiness marker")
        need(sha(raw) == marker["rawSha256"], "Readiness evidence hash mismatch")
        run_id, starts, ends = decode_records(raw)
        need(run_id == marker["runId"], "Readiness run mismatch")
        need(len(starts) == marker["started"] and len(ends) == marker["completed"]
             and len(starts) - len(ends) == marker["inFlight"], "Inconsistent readiness counts")
        need(all(x["timeNs"] <= marker["readyAtNs"] for x in ends.values()), "Readiness time mismatch")
        clean_outcomes(starts, ends)
        for worker in range(4):
            operations = [starts[i]["operation"] for i in ends if starts[i].get("worker") == worker]
            need(operations.count("session-bootstrap") == operations.count("login") == 1
                 and all(operation in operations for operation in ["session-refresh", "queue"]),
                 "Readiness lacks successful authentication/workload")
        return marker
    except (KeyError, TypeError, ValueError):
        raise GateError("Invalid readiness evidence") from None


def wait_for_generator(read_control, capture_diagnostics, timeout=30, poll=.25,
                       monotonic=time.monotonic, sleep=time.sleep):
    """Poll control files only. The reader must never issue/retry an application request."""
    deadline = monotonic() + timeout
    try:
        while monotonic() < deadline:
            status = read_control()
            need(monotonic() < deadline, "Generator readiness deadline elapsed during control read")
            if status["state"] == "failed":
                raise GateError("Generator reported an application traffic failure")
            if status["state"] == "ready":
                validate_readiness(status["marker"], status["raw"])
                return status
            need(status["state"] == "not-ready", "Unknown control response")
            sleep(min(poll, max(0, deadline - monotonic())))
        raise GateError("Generator readiness timeout")
    except Exception:
        capture_diagnostics()
        raise


def git_preflight(commit, expected_tip):
    def git(*args):
        result = subprocess.run(["git", *args], capture_output=True, check=True, timeout=30)
        return result.stdout.decode().strip()
    need(re.fullmatch(r"[a-f0-9]{40}", commit) and re.fullmatch(r"[a-f0-9]{40}", expected_tip), "Full SHAs required")
    need(git("remote", "get-url", "--push", "origin") == "https://github.com/elajeff/request-tracker.git", "Wrong origin")
    refs = dict(reversed(line.split()) for line in git("ls-remote", "--heads", "origin", "main", REF).splitlines())
    need(refs.get(REF) == expected_tip and refs.get("refs/heads/main") == MAIN, "Unexpected remote state")
    need(git("rev-parse", commit + "^") == expected_tip, "Continuation must be one direct-child commit")
    need(git("show", "-s", "--format=%an|%ae|%cn|%ce", commit) == IDENTITY, "Author/committer mismatch")
    files = set(git("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines())
    need(files and files <= (SCOPE if expected_tip == REMOTE_BASE else {"delivery/values-v6-kind.yaml"}), "Unexpected file scope")
    git("diff", "--check", expected_tip, commit)


def publish_first(commit, root, attempt_id, preflight=git_preflight, clock=time.time_ns,
                  push=None):
    """The last operation before a single push is a new freshness/evidence check."""
    root = Path(root)
    validate_certificate(root, attempt_id, clock())
    preflight(commit, REMOTE_BASE)
    with (root / "publication-reserved.json").open("x", encoding="utf-8") as output:
        json.dump({"attemptId": attempt_id, "commit": commit, "expectedTip": REMOTE_BASE}, output)
    # Re-read and recount after all preflight/possible delays; no prompt/yield here.
    certificate = validate_certificate(root, attempt_id, clock())
    if push is None:
        def push():
            result = subprocess.run(["git", "push", "--porcelain", "origin", commit + ":" + REF],
                                    capture_output=True, timeout=60)
            (root / "first-push-output.txt").write_bytes(result.stdout + result.stderr)
            need(result.returncode == 0, "Push failed or uncertain; do not retry")
    # Include time spent rereading/recounting the datasets in the freshness decision.
    launch_ns = clock()
    ensure_fresh(certificate["routes"], launch_ns)
    push()
    (root / "publication-started.json").write_text(json.dumps({"commit": commit,
        "startedAtNs": launch_ns, "completedAtNs": clock()}))


# A control read returns only safe accounting files; never bodies, cookies or Secrets.
CONTROL = """import base64,json,pathlib
p=pathlib.Path('/evidence')
if (p/'traffic-failure.json').exists():
 print(json.dumps({'state':'failed'}))
elif not (p/'ready.json').exists():
 print(json.dumps({'state':'not-ready'}))
else:
 print(json.dumps({'state':'ready','marker':json.loads((p/'ready.json').read_text()),'raw':base64.b64encode((p/'ready.ndjson').read_bytes()).decode()}))
"""


def wait_kind_generator(pod, uid, restarts, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    kubectl = ["kubectl", "--context", "kind-request-tracker", "-n", "request-tracker"]
    last = {}
    def identity():
        result = subprocess.run(kubectl + ["get", "pod", pod, "-o", "json"], capture_output=True, timeout=10)
        need(result.returncode == 0, "Cannot read bound generator pod")
        item = json.loads(result.stdout)
        states = item.get("status", {}).get("containerStatuses", [])
        last["pod"] = {"name": pod, "uid": item["metadata"]["uid"], "phase": item.get("status", {}).get("phase"),
            "containers": [{k: s.get(k) for k in ["ready", "restartCount", "state", "lastState"]} for s in states]}
        need(item["metadata"]["uid"] == uid, "Generator identity changed")
        if not states:
            need(restarts == 0, "Generator restart history missing")
            return {"waiting": {"reason": "ContainerStatusNotReady"}}
        need(states[0]["restartCount"] == restarts, "Generator restarted")
        return states[0].get("state", {})
    def read():
        state = identity()
        if "waiting" in state:
            need(state["waiting"].get("reason") in {"ContainerCreating", "PodInitializing", "ContainerStatusNotReady"},
                 "Unexpected generator waiting state")
            return {"state": "not-ready"}
        need("running" in state, "Generator is not running")
        result = subprocess.run(kubectl + ["exec", pod, "--", "python", "-c", CONTROL], capture_output=True, timeout=5)
        # Do not turn arbitrary kubectl errors into successful/not-ready evidence.
        text = result.stderr.decode(errors="replace")
        last["controlExit"] = result.returncode
        last["controlStderr"] = "\n".join("[sensitive-labelled diagnostic omitted]" if re.search(
            r"password|cookie|csrf|authorization|bearer|token", line, re.I) else line for line in text.splitlines())
        need(result.returncode == 0, "Generator control read failed")
        value = json.loads(result.stdout)
        if value.get("state") == "ready":
            value["raw"] = base64.b64decode(value["raw"], validate=True)
            (output / "received-ready.ndjson").write_bytes(value["raw"])
            (output / "received-ready.json").write_text(json.dumps(value["marker"], sort_keys=True))
        return value
    def diagnostics():
        (output / "readiness-diagnostics.json").write_text(json.dumps(last, indent=2))
    result = wait_for_generator(read, diagnostics)
    (output / "ready.ndjson").write_bytes(result["raw"])
    (output / "ready.json").write_text(json.dumps(result["marker"], sort_keys=True))
    validate_readiness(json.loads((output / "ready.json").read_text()), (output / "ready.ndjson").read_bytes())
    try:
        identity()
    except Exception:
        diagnostics()
        raise
    return result["marker"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    certify = commands.add_parser("certify-baselines")
    certify.add_argument("root"); certify.add_argument("attempt_id"); certify.add_argument("service_ip")
    publish = commands.add_parser("publish-first")
    publish.add_argument("commit"); publish.add_argument("root"); publish.add_argument("attempt_id")
    ready = commands.add_parser("wait-generator")
    ready.add_argument("pod"); ready.add_argument("uid"); ready.add_argument("restarts", type=int); ready.add_argument("output")
    args = parser.parse_args()
    try:
        if args.command == "certify-baselines":
            print(json.dumps(certify_baselines(args.root, args.attempt_id, args.service_ip), sort_keys=True))
        elif args.command == "publish-first":
            publish_first(args.commit, args.root, args.attempt_id)
        else:
            print(json.dumps(wait_kind_generator(args.pod, args.uid, args.restarts, args.output), sort_keys=True))
    except (GateError, OSError, subprocess.SubprocessError, ValueError):
        raise SystemExit("Orchestration gate failed; stop publication and preserve diagnostics") from None
