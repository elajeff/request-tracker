"""Fail-closed validation of a copied, quiesced traffic evidence directory."""
import collections
import hashlib
import json
from pathlib import Path
import re


def validate(directory, expected_workers=None):
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
            operations = collections.Counter(x["operation"] for x in starts.values())
            assert expected_workers > 0
            for operation in ["session-bootstrap", "login", "session-refresh"]:
                assert operations[operation] == expected_workers
            assert any(x["operation"] in {"queue", "staff", "history"} for x in starts.values())
        return summary
    except (OSError, ValueError, KeyError, TypeError, AssertionError):
        raise ValueError("Traffic evidence missing, incomplete, inconsistent, or authentication failed") from None


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
