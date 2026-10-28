"""Collect live GitOps/rollout evidence; does not change desired state or publish Git."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--expect", choices=["healthy", "abort"], required=True)
parser.add_argument("--require-availability", action="store_true")
parser.add_argument("--timeout", type=int, default=600)
parser.add_argument("--output", required=True)
args = parser.parse_args()
k = ["kubectl", "--context", "kind-request-tracker"]


def obj(namespace, *command):
    return json.loads(subprocess.check_output(k + ["-n", namespace, *command, "-o", "json"], text=True))


def get(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
processes = []
logs = []
samples = []
try:
    for name, port, remote in [("prometheus", 19090, 9090), ("stable", 18100, 8080)]:
        log = output.with_suffix("." + name + ".log").open("w")
        logs.append(log)
        processes.append(subprocess.Popen(k + ["-n", "request-tracker", "port-forward",
            "service/request-tracker-delivery-" + name, f"{port}:{remote}"], stdout=log, stderr=log,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)))
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        rollout = obj("request-tracker", "get", "rollout", "request-tracker-delivery")
        application = obj("argocd", "get", "application", "request-tracker-delivery")
        status = rollout.get("status", {})
        sample = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "phase": status.get("phase"), "stable": status.get("stableRS"),
            "current": status.get("currentPodHash"), "step": status.get("currentStepIndex"),
            "ready": status.get("readyReplicas"), "sync": application.get("status", {}).get("sync", {}),
            "health": application.get("status", {}).get("health", {}),
            "replicaSets": [{"name": r["metadata"]["name"], "image": r["spec"]["template"]["spec"]["containers"][0]["image"],
                "desired": r["spec"].get("replicas", 0), "ready": r.get("status", {}).get("readyReplicas", 0)}
                for r in obj("request-tracker", "get", "replicasets", "-l", "app=request-tracker-delivery,component=backend")["items"]]}
        try:
            query = 'sum by (revision) (rate(http_server_requests_seconds_count{job="request-tracker-delivery",uri!~"/actuator/.*"}[30s]))'
            sample["traffic"] = get("http://127.0.0.1:19090/api/v1/query?" + urllib.parse.urlencode({"query": query}))["data"]["result"]
        except (OSError, ValueError) as error:
            sample["metricsObservationError"] = str(error)
        try:
            sample["stableRequest"] = get("http://127.0.0.1:18100/api/requests/54f35b91-dbfc-4b95-9570-da8c80dd5dea")["id"]
        except (OSError, ValueError) as error:
            sample["observationError"] = str(error)
            if args.require_availability and len(samples) > 0:
                raise RuntimeError("Stable API availability check failed") from error
        samples.append(sample)
        print(json.dumps(sample), flush=True)
        output.write_text(json.dumps(samples, indent=2))
        synced = sample["sync"].get("status") == "Synced"
        if args.expect == "healthy" and synced and sample["health"].get("status") == "Healthy" and sample["phase"] == "Healthy":
            break
        if args.expect == "abort" and sample["phase"] == "Degraded" and status.get("abort"):
            break
        time.sleep(10)
    else:
        raise RuntimeError("Timed out waiting for " + args.expect)
    analyses = obj("request-tracker", "get", "analysisruns")
    output.with_suffix(".analysis.json").write_text(json.dumps(analyses, indent=2))
finally:
    for process in processes:
        process.terminate()
        process.wait(timeout=10)
    for log in logs:
        log.close()
