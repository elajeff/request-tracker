import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import uuid

import exercise_orchestration as gates

spec = importlib.util.spec_from_file_location("traffic", Path(__file__).resolve().parents[1] /
    "helm/request-tracker/files/traffic.py")
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)


class Clock:
    def __init__(self):
        self.seconds = 0

    def now(self):
        return self.seconds

    def sleep(self, seconds):
        self.seconds += seconds


class OrchestrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.attempt = str(uuid.uuid4())
        self.end_ns = 1_800_000_000_000_000_000
        self.now_ns = self.end_ns + 1_000_000_000
        self.ip = "10.96.117.105"
        from test_observation_policy import analysis_template
        self.analysis = analysis_template()
        for route in ["host", "cluster"]:
            self.baseline(route)

    def baseline(self, route):
        directory = self.root / route
        directory.mkdir()
        run_id = str(uuid.uuid4())
        rows = []
        counts = {}
        identity = 0
        begin_ns = self.end_ns - 120_000_000_000
        for worker in range(4):
            for operation in ["session-bootstrap", "login", "session-refresh", "queue", "history"]:
                identity += 1
                # Include a late read from each worker, not merely old startup requests.
                t = begin_ns + identity * 1_000_000 if operation != "history" else self.end_ns - 100_000_000
                result = "http:204" if operation == "login" else "http:200"
                rows.extend([{"event": "started", "runId": run_id, "id": identity, "worker": worker,
                              "operation": operation, "phase": "baseline", "timeNs": t},
                             {"event": "completed", "runId": run_id, "id": identity,
                              "outcome": result, "timeNs": t + 1_000_000}])
                counts[result] = counts.get(result, 0) + 1
        raw = b"".join((json.dumps(row) + "\n").encode() for row in rows)
        (directory / "requests.ndjson").write_bytes(raw)
        summary = {"version": 1, "runId": run_id, "complete": True, "started": identity,
                   "completed": identity, "inFlight": 0, "outcomes": counts,
                   "workload": {"completed": 8, "errors": 0, "errorRatio": 0},
                   "rawSha256": hashlib.sha256(raw).hexdigest(), "baseline": {
                       "attemptId": self.attempt, "route": route, "context": "kind-request-tracker",
                       "baseUrl": "http://127.0.0.1:54321" if route == "host" else "http://" + self.ip + ":80",
                       "requestedSeconds": 120, "startedAtNs": begin_ns, "endedAtNs": self.end_ns}}
        (directory / "summary.json").write_text(json.dumps(summary))
        (directory / "ready.ndjson").write_bytes(raw)
        (directory / "ready.json").write_text(json.dumps({"version": 1, "runId": run_id,
            "workers": [0, 1, 2, 3], "started": identity, "completed": identity, "inFlight": 0,
            "rawSha256": summary["rawSha256"], "readyAtNs": self.end_ns}))

    def certify(self):
        return gates.certify_baselines(self.root, self.attempt, self.ip, self.analysis, now_ns=self.now_ns)

    def test_fresh_baselines_accepted_and_completion_timestamps_recorded(self):
        certificate = self.certify()
        self.assertEqual(certificate["freshnessSeconds"], 60)
        self.assertEqual(set(certificate["routes"]), {"host", "cluster"})
        self.assertLess(certificate["routes"]["host"]["completedAtNs"], self.end_ns)
        self.assertEqual(gates.validate_certificate(self.root, self.attempt, self.now_ns), certificate)

    def test_baseline_policy_uses_service_ratio_and_retains_host_diagnostics(self):
        for route in ["host", "cluster"]:
            directory = self.root / route
            summary = json.loads((directory / "summary.json").read_text())
            raw = (directory / "requests.ndjson").read_bytes()
            for offset in range(100):
                identity = summary["started"] + 1
                outcome = "timeout" if offset == 0 else "http:200"
                events = [{"event": "started", "runId": summary["runId"], "id": identity,
                           "worker": 0, "operation": "history", "phase": "baseline", "timeNs": self.end_ns - 10_000_000},
                          {"event": "completed", "runId": summary["runId"], "id": identity,
                           "outcome": outcome, "timeNs": self.end_ns - 1_000_000}]
                raw += b"".join((json.dumps(e) + "\n").encode() for e in events)
                summary["started"] += 1
                summary["completed"] += 1
                summary["outcomes"][outcome] = summary["outcomes"].get(outcome, 0) + 1
            summary["rawSha256"] = hashlib.sha256(raw).hexdigest()
            summary["workload"] = {"completed": 108, "errors": 1, "errorRatio": 1 / 108}
            (directory / "requests.ndjson").write_bytes(raw)
            (directory / "summary.json").write_text(json.dumps(summary))
        certificate = self.certify()
        self.assertTrue(certificate["routes"]["cluster"]["decision"]["passed"])
        self.assertEqual(certificate["routes"]["host"]["decision"]["outcomes"]["timeout"], 1)
        changed = json.loads(json.dumps(self.analysis))
        changed["metrics"][0]["successCondition"] = "len(result) == 1 && result[0] >= 0 && result[0] < 0.001"
        with self.assertRaises(gates.GateError):
            gates.validate_certificate(self.root, self.attempt, self.now_ns, changed)

    def test_expiration_during_preflight_prevents_first_push(self):
        self.certify()
        ticks = iter([self.now_ns, self.now_ns + 61_000_000_000])
        push = Mock()
        with self.assertRaises(gates.GateError):
            gates.publish_first("a" * 40, self.root, self.attempt, "b" * 40, preflight=Mock(),
                                clock=lambda: next(ticks), push=push)
        push.assert_not_called()

    def test_publication_delay_expired_certificate_cannot_be_reused(self):
        self.certify()
        preflight, push = Mock(), Mock()
        with self.assertRaises(gates.GateError):
            gates.publish_first("a" * 40, self.root, self.attempt, "b" * 40, preflight=preflight,
                                clock=lambda: self.now_ns + 3600_000_000_000, push=push)
        preflight.assert_not_called()
        push.assert_not_called()

    def test_expiration_during_last_recount_prevents_push(self):
        self.certify()
        ticks = iter([self.now_ns, self.now_ns, self.now_ns + 61_000_000_000])
        push = Mock()
        with self.assertRaises(gates.GateError):
            gates.publish_first("a" * 40, self.root, self.attempt, "b" * 40, preflight=Mock(),
                                clock=lambda: next(ticks), push=push)
        push.assert_not_called()

    def test_fresh_publication_calls_push_once_and_reserves_attempt(self):
        self.certify()
        push, preflight = Mock(), Mock()
        gates.publish_first("a" * 40, self.root, self.attempt, "b" * 40, preflight=preflight,
                            clock=lambda: self.now_ns, push=push)
        push.assert_called_once_with()
        preflight.assert_called_once_with("a" * 40, "b" * 40)
        self.assertEqual(json.loads((self.root / "publication-reserved.json").read_text())["expectedTip"], "b" * 40)
        with self.assertRaises(FileExistsError):
            gates.publish_first("a" * 40, self.root, self.attempt, "b" * 40, preflight=Mock(),
                                clock=lambda: self.now_ns, push=push)
        push.assert_called_once_with()

    def test_missing_or_failed_baseline_rejected(self):
        path = self.root / "cluster" / "summary.json"
        original = path.read_text()
        path.unlink()
        with self.assertRaises(gates.GateError):
            self.certify()
        failed = json.loads(original)
        failed["complete"] = False
        path.write_text(json.dumps(failed))
        with self.assertRaises(gates.GateError):
            self.certify()

    def test_mismatched_attempt_route_or_changed_evidence_rejected(self):
        path = self.root / "cluster" / "summary.json"
        original = path.read_text()
        for patch in [{"attemptId": str(uuid.uuid4())}, {"route": "host"}, {"context": "k3s"},
                      {"baseUrl": "http://wrong-backend:8080"}]:
            modified = json.loads(original)
            modified["baseline"].update(patch)
            path.write_text(json.dumps(modified))
            with self.assertRaises(gates.GateError):
                self.certify()
        path.write_text(original)
        self.certify()
        path.write_text(original + "\n")  # Semantically identical but different evidence bytes.
        with self.assertRaises(gates.GateError):
            gates.validate_certificate(self.root, self.attempt, self.now_ns)

    def readiness(self):
        directory = self.root / "generator"
        a = traffic.Accounting(directory)
        self.addCleanup(a.raw.close)
        for worker in range(4):
            a.context.worker = worker
            for operation in ["session-bootstrap", "login", "session-refresh", "queue"]:
                code = 204 if operation == "login" else 200
                a.request(operation, lambda code=code: (code, None))
            a.worker_ready(worker)
        marker = json.loads((directory / "ready.json").read_text())
        raw = (directory / "ready.ndjson").read_bytes()
        return a, {"state": "ready", "marker": marker, "raw": raw}

    def test_generator_unavailable_then_ready_without_application_retry(self):
        a, ready = self.readiness()
        before = a.started
        reader = Mock(side_effect=[{"state": "not-ready"}, {"state": "not-ready"}, ready])
        diagnostic = Mock()
        clock = Clock()
        self.assertEqual(gates.wait_for_generator(reader, diagnostic, timeout=2,
            monotonic=clock.now, sleep=clock.sleep), ready)
        self.assertEqual(reader.call_count, 3)
        self.assertEqual(a.started, before)  # Control polling never resubmits HTTP requests.
        diagnostic.assert_not_called()

    def test_generator_never_ready_captures_diagnostics_and_times_out(self):
        reader, diagnostic, clock = Mock(return_value={"state": "not-ready"}), Mock(), Clock()
        with self.assertRaises(gates.GateError):
            gates.wait_for_generator(reader, diagnostic, timeout=1, monotonic=clock.now, sleep=clock.sleep)
        diagnostic.assert_called_once_with()
        self.assertEqual(clock.seconds, 1)

    def test_ready_but_invalid_evidence_fails_without_retry(self):
        a, ready = self.readiness()
        before = a.started
        bad = {**ready, "raw": ready["raw"][:-1]}
        reader, diagnostic = Mock(return_value=bad), Mock()
        with self.assertRaises(gates.GateError):
            gates.wait_for_generator(reader, diagnostic)
        reader.assert_called_once_with()
        diagnostic.assert_called_once_with()
        self.assertEqual(a.started, before)

    def test_traffic_failure_marker_is_not_polled_away(self):
        reader = Mock(side_effect=[{"state": "failed"}, {"state": "ready"}])
        diagnostic = Mock()
        with self.assertRaises(gates.GateError):
            gates.wait_for_generator(reader, diagnostic)
        reader.assert_called_once_with()
        diagnostic.assert_called_once_with()

    def test_readiness_snapshot_remains_valid_but_empty_final_is_rejected(self):
        a, ready = self.readiness()
        a.request("history", lambda: (200, None))
        gates.validate_readiness(ready["marker"], ready["raw"])
        with self.assertRaises(gates.GateError):
            gates.validate_readiness(ready["marker"], b"")
        empty = traffic.Accounting(self.root / "empty")
        self.addCleanup(empty.raw.close)
        with contextlib.redirect_stdout(io.StringIO()):
            empty.finalize([])
        with self.assertRaises(ValueError):
            gates.validate(self.root / "empty")


if __name__ == "__main__":
    unittest.main()
