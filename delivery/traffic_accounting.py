"""Fail-closed validation of a copied, quiesced traffic evidence directory."""
import collections
import hashlib
import json
import math
from pathlib import Path
import re


WORKLOAD_OPERATIONS = {"queue", "staff", "history"}


def workload_counts(starts, completions):
    completed = [event for identity, event in completions.items()
                 if starts[identity]["operation"] in WORKLOAD_OPERATIONS]
    errors = sum(event["outcome"] != "http:200" for event in completed)
    return {"completed": len(completed), "errors": errors,
            "errorRatio": errors / len(completed) if completed else None}


def error_ratio_limit(analysis):
    """Read the existing AnalysisTemplate condition; never substitute a local limit."""
    if not isinstance(analysis, dict):
        raise ValueError("An AnalysisTemplate is required")
    spec = analysis.get("spec", analysis)
    metrics = [m for m in spec["metrics"] if m["name"] == "error-rate"]
    if len(metrics) != 1:
        raise ValueError("One configured error-rate metric is required")
    condition = metrics[0]["successCondition"]
    match = re.fullmatch(r"len\(result\)\s*==\s*1\s*&&\s*result\[0\]\s*>=\s*0\s*&&"
                         r"\s*result\[0\]\s*<\s*([0-9.eE+-]+)", condition)
    if not match:
        raise ValueError("Unsupported error-rate condition")
    limit = float(match[1])
    if not math.isfinite(limit) or not 0 < limit <= 1:
        raise ValueError("Invalid configured error-ratio limit")
    return limit


def ratio_decision(workload, route, analysis):
    if route not in {"service", "host"}:
        raise ValueError("Unknown observer route")
    limit = error_ratio_limit(analysis)
    count, errors, ratio = workload.get("completed"), workload.get("errors"), workload.get("errorRatio")
    valid = (type(count) is int and type(errors) is int and count > 0 and 0 <= errors <= count
             and type(ratio) in {int, float} and math.isfinite(ratio) and ratio == errors / count)
    passed = valid and (route == "host" or ratio < limit)
    reason = ("missing or invalid workload ratio" if not valid else
              "host diagnostics retained; candidate health decided separately" if route == "host" else
              "Service error ratio below configured limit" if passed else
              "Service error ratio meets or exceeds configured limit")
    return {"passed": passed, "reason": reason, "route": route, "workload": workload,
            "errorRatioLimit": limit, "thresholdSource": "AnalysisTemplate.metrics[error-rate].successCondition"}


def validate(directory, expected_workers=None):
    if not __debug__:
        raise ValueError("Evidence validation requires Python assertions enabled")
    directory = Path(directory)
    try:
        summary = json.loads((directory / "summary.json").read_text())
        raw = (directory / "requests.ndjson").read_bytes()
        assert isinstance(summary, dict) and isinstance(summary.get("outcomes"), dict)
        assert summary["version"] == 1 and summary["complete"] is True
        assert summary["inFlight"] == 0
        assert hashlib.sha256(raw).hexdigest() == summary["rawSha256"]
        assert raw.endswith(b"\n")
        starts, completions = {}, {}
        for line in raw.splitlines():
            event = json.loads(line)
            assert event["runId"] == summary["runId"]
            identity = event["id"]
            assert type(identity) is int and identity > 0
            if event["event"] == "started":
                assert identity not in starts and identity not in completions
                assert event["operation"] in {"session-bootstrap", "login", "session-refresh", "queue", "staff", "history"}
                assert event["phase"] in {"setup", "baseline", "healthy", "fault", "restore", "main"}
                starts[identity] = event
            else:
                assert event["event"] == "completed"
                assert identity in starts and identity not in completions
                assert event["timeNs"] >= starts[identity]["timeNs"]
                result = event["outcome"]
                assert re.fullmatch(r"http:[1-5][0-9]{2}|connection-error|timeout|network-error|client-error", result)
                completions[identity] = event
        assert starts and starts.keys() == completions.keys()
        assert set(starts) == set(range(1, len(starts) + 1))
        assert type(summary["started"]) is int and type(summary["completed"]) is int
        assert summary["started"] == summary["completed"] == len(starts)
        counts = dict(collections.Counter(x["outcome"] for x in completions.values()))
        assert all(type(n) is int and n > 0 for n in summary["outcomes"].values())
        assert counts == summary["outcomes"]
        # Setup and auth failures cannot be hidden among expected injected 500s.
        for identity, event in starts.items():
            expected = "http:204" if event["operation"] == "login" else "http:200"
            if event["operation"] in {"session-bootstrap", "login", "session-refresh"}:
                assert completions[identity]["outcome"] == expected
            assert completions[identity]["outcome"] not in {"http:401", "client-error"}
        if expected_workers is not None:
            assert type(expected_workers) is int and expected_workers > 0
            assert all(type(x.get("worker")) is int for x in starts.values())
            assert {x["worker"] for x in starts.values()} == set(range(expected_workers))
            for worker in range(expected_workers):
                operations = collections.Counter(x["operation"] for x in starts.values() if x["worker"] == worker)
                assert operations["session-bootstrap"] == operations["login"] == 1
                assert operations["session-refresh"] >= 1
                assert any(operations[x] for x in WORKLOAD_OPERATIONS)
        if "workload" in summary:
            assert summary["workload"] == workload_counts(starts, completions)
        return summary
    except (OSError, ValueError, KeyError, TypeError, AssertionError):
        raise ValueError("Traffic evidence missing, incomplete, inconsistent, or authentication failed") from None


def observer_decision(directory, route, analysis, expected_workers=4):
    """Final traffic decision; integrity and authentication failures cannot be budgeted."""
    try:
        summary = validate(directory, expected_workers)
        raw = (Path(directory) / "requests.ndjson").read_bytes()
        if hashlib.sha256(raw).hexdigest() != summary["rawSha256"]:
            raise ValueError("Evidence changed during validation")
        events = [json.loads(line) for line in raw.splitlines()]
        starts = {e["id"]: e for e in events if e["event"] == "started"}
        ends = {e["id"]: e for e in events if e["event"] == "completed"}
        workload = workload_counts(starts, ends)
        if summary.get("workload") != workload:
            raise ValueError("Final workload counts/ratio are missing or inconsistent")
        decision = ratio_decision(workload, route, analysis)
        return {**decision, "runId": summary["runId"], "outcomes": summary["outcomes"],
                "rawSha256": summary["rawSha256"]}
    except (OSError, ValueError, KeyError, TypeError):
        return {"passed": False, "route": route,
                "reason": "invalid evidence, authentication/setup failure or analysis configuration"}


if __name__ == "__main__":
    import argparse
    import sys
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.directory, expected_workers=args.workers), sort_keys=True))
    except (ValueError, IndexError):
        sys.exit("Traffic evidence gate failed")
