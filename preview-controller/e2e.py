"""Disposable preview-lab acceptance checks; requires an installed controller."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--kubeconfig", required=True)
parser.add_argument("--context", required=True, choices=["k3d-request-tracker-k3s"])
parser.add_argument("--output", required=True)
args = parser.parse_args()
K = ["kubectl", "--kubeconfig", args.kubeconfig, "--context", args.context, "-n", "preview-lab"]
GROUP = "previews.request-tracker.dev"
evidence = []
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)


def run(*command, input=None, check=True):
    result = subprocess.run(K + list(command), input=input, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def get(kind, name):
    data = run("get", kind, name, "--ignore-not-found", "-o", "json").stdout
    return json.loads(data) if data.strip() else None


def wait(check, description, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            record(description)
            return result
        time.sleep(2)
    raise AssertionError(description + " timed out")


def record(description, **details):
    evidence.append({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "check": description, **details})
    output.write_text(json.dumps(evidence, indent=2))
    print(description, flush=True)


def ready(name):
    obj = get("preview", name)
    condition = next(iter(obj.get("status", {}).get("conditions", [])), {}) if obj else {}
    return obj if condition.get("status") == "True" and condition.get("observedGeneration") == obj["metadata"]["generation"] else None


def patch(name, spec):
    run("patch", "preview", name, "--type=merge", "-p", json.dumps({"spec": spec}))


def delete(name):
    run("delete", "preview", name, "--wait=false")
    wait(lambda: get("preview", name) is None, name + " finalized")


def create(name, ttl=3600, retention="Delete"):
    obj = {"apiVersion": GROUP + "/v1", "kind": "PreviewEnvironment", "metadata": {"name": name, "namespace": "preview-lab"},
           "spec": {"backendImage": "request-tracker:k3s-e4a0d80-20261028063718", "frontendImage": "request-tracker-frontend:k3s-e4a0d80-20261028063718", "ttlSeconds": ttl, "storageRetentionPolicy": retention}}
    run("create", "-f", "-", input=json.dumps(obj))
    return get("preview", name)


base = {"apiVersion": GROUP + "/v1", "kind": "PreviewEnvironment", "metadata": {"name": "invalid-check", "namespace": "preview-lab"},
        "spec": {"backendImage": "request-tracker:valid", "frontendImage": "frontend:valid"}}
for change in [{"ttlSeconds": 0}, {"ttlSeconds": 86401}, {"backendImage": "untagged"}, {"storageRetentionPolicy": "Unknown"}]:
    obj = copy.deepcopy(base)
    obj["spec"].update(change)
    assert run("create", "--dry-run=server", "-f", "-", input=json.dumps(obj), check=False).returncode
missing = copy.deepcopy(base)
missing.pop("spec")
assert run("create", "--dry-run=server", "-f", "-", input=json.dumps(missing), check=False).returncode
record("five invalid specifications rejected")

main = wait(lambda: ready("demo"), "initial preview Ready")
prefix = main["status"]["resourcePrefix"]
secret = get("secret", prefix + "-credentials")
secret_digest = hashlib.sha256(json.dumps(secret["data"], sort_keys=True).encode()).hexdigest()
pvc = get("pvc", prefix + "-data")
assert not pvc["metadata"].get("ownerReferences") and not secret["metadata"].get("ownerReferences")
immutable = run("patch", "preview", "demo", "--type=merge", "-p", json.dumps({"spec": {"storageRetentionPolicy": "Delete"}}), check=False)
assert immutable.returncode
record("default retention and immutable policy verified")

# Port-forward targets the preview frontend, preserving the normal nginx/backend route.
forward = subprocess.Popen(K + ["port-forward", "service/" + prefix + "-frontend", "18779:8080", "--address=127.0.0.1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2)
    req = urllib.request.Request("http://127.0.0.1:18779/api/requests", method="POST", data=json.dumps({"title": "Retained preview data", "description": "Disposable lab acceptance"}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as response:
        request_id = json.load(response)["id"]
finally:
    forward.terminate()
    forward.wait(timeout=10)
record("normal frontend route created database record", request=request_id)

generations = {name: get("deployment", prefix + "-" + name)["metadata"]["generation"] for name in ["backend", "frontend", "db"]}
time.sleep(12)
assert generations == {name: get("deployment", prefix + "-" + name)["metadata"]["generation"] for name in generations}
assert hashlib.sha256(json.dumps(get("secret", prefix + "-credentials")["data"], sort_keys=True).encode()).hexdigest() == secret_digest
record("repeated reconciliation leaves workload generations and credentials unchanged")

patch("demo", {"backendImage": "request-tracker:k3s-e4a0d80-20261028063718-good"})
wait(lambda: ready("demo") and get("deployment", prefix + "-backend")["spec"]["template"]["spec"]["containers"][0]["image"].endswith("-good"), "image update Ready")
run("scale", "deployment/" + prefix + "-backend", "--replicas=2")
wait(lambda: get("deployment", prefix + "-backend")["spec"]["replicas"] == 1 and ready("demo"), "replica drift reconciled")
patch("demo", {"backendImage": "request-tracker:deliberately-missing-preview-image"})
wait(lambda: next(iter(get("preview", "demo").get("status", {}).get("conditions", [])), {}).get("reason") in ["ErrImagePull", "ImagePullBackOff"], "bad image produces actionable condition")
patch("demo", {"backendImage": "request-tracker:k3s-e4a0d80-20261028063718-good"})
wait(lambda: ready("demo"), "bad image recovery Ready")
run("rollout", "restart", "deployment/preview-controller")
run("rollout", "status", "deployment/preview-controller", "--timeout=90s")
wait(lambda: ready("demo"), "controller restart resumes reconciliation")

create("expires", ttl=60)
expires = wait(lambda: ready("expires"), "expiry preview Ready")
expiry_prefix = expires["status"]["resourcePrefix"]
pods = json.loads(run("get", "pods", "-l", GROUP + "/owner-uid=" + main["metadata"]["uid"], "-o", "json").stdout)["items"]
frontend = next(p["metadata"]["name"] for p in pods if p["metadata"]["labels"][GROUP + "/component"] == "frontend")
allowed = run("exec", frontend, "--", "wget", "-T", "3", "-qO-", "http://" + prefix + "-backend:8080/actuator/health/liveness")
assert json.loads(allowed.stdout)["status"] == "UP"
denied = run("exec", frontend, "--", "wget", "-T", "3", "-qO-", "http://" + expiry_prefix + "-backend:8080/actuator/health/liveness", check=False)
assert denied.returncode
record("network policy permits own backend and denies another preview")
wait(lambda: get("preview", "expires") is None, "TTL expiry finalized", timeout=150)
assert get("pvc", expiry_prefix + "-data") is None and get("secret", expiry_prefix + "-credentials") is None
record("explicit Delete policy removed disposable expiry storage and credentials")

delete("demo")
assert get("pvc", prefix + "-data")["metadata"]["uid"] == pvc["metadata"]["uid"]
assert get("secret", prefix + "-credentials")["metadata"]["uid"] == secret["metadata"]["uid"]
for component in ["backend", "frontend", "db"]:
    assert get("deployment", prefix + "-" + component) is None and get("service", prefix + "-" + component) is None
record("default deletion retains PVC and credentials and removes workloads", prefix=prefix, request=request_id)

again = create("demo")
again = wait(lambda: ready("demo"), "recreated name Ready with independent resources")
assert again["status"]["resourcePrefix"] != prefix
delete("demo")
assert get("pvc", again["status"]["resourcePrefix"] + "-data") is None

# Pause only the lab controller to place a foreign resource before its first reconcile.
run("scale", "deployment/preview-controller", "--replicas=0")
run("rollout", "status", "deployment/preview-controller", "--timeout=60s")
conflict = create("conflict")
suffix = hashlib.sha256(conflict["metadata"]["uid"].encode()).hexdigest()[:10]
foreign_name = "pe-conflict-" + suffix + "-db"
foreign = {"apiVersion": "v1", "kind": "Service", "metadata": {"name": foreign_name, "namespace": "preview-lab"}, "spec": {"ports": [{"port": 5432}]}}
run("create", "-f", "-", input=json.dumps(foreign))
foreign_uid = get("service", foreign_name)["metadata"]["uid"]
run("scale", "deployment/preview-controller", "--replicas=1")
run("rollout", "status", "deployment/preview-controller", "--timeout=90s")
wait(lambda: next(iter(get("preview", "conflict").get("status", {}).get("conditions", [])), {}).get("reason") == "OwnershipConflict", "foreign naming conflict reported")
delete("conflict")
assert get("service", foreign_name)["metadata"]["uid"] == foreign_uid
run("delete", "service", foreign_name)
record("foreign object neither adopted nor deleted; disposable fixture removed explicitly")

actor = "system:serviceaccount:preview-lab:preview-controller"
for resource, verb, namespace in [("secrets", "get", "request-tracker"), ("deployments", "delete", "request-tracker"), ("customresourcedefinitions", "create", "preview-lab")]:
    assert run("auth", "can-i", verb, resource, "--as=" + actor, "--namespace=" + namespace, check=False).stdout.strip() == "no"
record("RBAC denies existing namespace access and CRD administration")
record("all live lifecycle checks passed; retained database remains available for readback", prefix=prefix, request=request_id)
