import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import Mock, patch

from exercise_orchestration import evaluate_observers, observation_checkpoint
from traffic_accounting import error_ratio_limit, observer_decision, ratio_decision, validate

spec = importlib.util.spec_from_file_location("policy_traffic", Path(__file__).resolve().parents[1] /
    "helm/request-tracker/files/traffic.py")
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)


def analysis_template():
    chart = (Path(__file__).resolve().parents[1] / "helm/request-tracker/templates/delivery.yaml").read_text()
    condition = re.search(r"- name: error-rate\n.*?successCondition: ([^\n]+)", chart, re.S)[1]
    return {"metrics": [{"name": "error-rate", "successCondition": condition}]}


class ObservationPolicyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.analysis = analysis_template()
        self.health = dict.fromkeys(["rolloutHealthy", "stableAvailable", "candidateMetricsPassed",
                                     "fourCandidatesReady"], True)

    def stream(self, name, errors=(), total=100, workers=4, auth_error=None):
        directory = self.root / name
        a = traffic.Accounting(directory)
        self.addCleanup(a.raw.close)
        for worker in range(workers):
            a.context.worker = worker
            for operation in ["session-bootstrap", "login", "session-refresh", "queue"]:
                code = 204 if operation == "login" else 200
                a.request(operation, lambda code=code: (code, None), "setup")
            a.worker_ready(worker)
        a.context.worker = 0
        if auth_error:
            a.request("session-refresh", Mock(side_effect=auth_error), "healthy")
        else:
            for _ in range(max(0, total - workers - len(errors))):
                a.request("queue", lambda: (200, None), "healthy")
            for error in errors:
                if isinstance(error, Exception):
                    a.request("history", Mock(side_effect=error), "healthy")
                else:
                    a.request("history", lambda error=error: (error, None), "healthy")
        with contextlib.redirect_stdout(io.StringIO()):
            a.finalize([])
        return directory, a

    def test_one_service_timeout_is_recorded_below_configured_ratio(self):
        directory, a = self.stream("service", [TimeoutError()])
        decision = observer_decision(directory, "service", self.analysis)
        self.assertTrue(decision["passed"])
        self.assertEqual(decision["outcomes"]["timeout"], 1)
        self.assertEqual(decision["workload"], {"completed": 100, "errors": 1, "errorRatio": .01})
        self.assertEqual(validate(directory)["workload"], decision["workload"])
        self.assertFalse((directory / "traffic-failure.json").exists())
        self.assertIsNone(a.failure)
        self.assertLess(decision["workload"]["errorRatio"], error_ratio_limit(self.analysis))

    def test_equal_and_above_limit_fail_and_custom_condition_is_used(self):
        limit = error_ratio_limit(self.analysis)
        for ratio in [limit, min(1, limit + .01)]:
            count = 10000
            stats = {"completed": count, "errors": round(ratio * count), "errorRatio": round(ratio * count) / count}
            self.assertFalse(ratio_decision(stats, "service", self.analysis)["passed"])
        alternate = copy.deepcopy(self.analysis)
        alternate["metrics"][0]["successCondition"] = "len(result) == 1 && result[0] >= 0 && result[0] < 0.01"
        self.assertFalse(ratio_decision({"completed": 100, "errors": 1, "errorRatio": .01}, "service", alternate)["passed"])

    def test_missing_nan_inconsistent_and_zero_ratios_fail(self):
        for stats in [{"completed": 0, "errors": 0, "errorRatio": None},
                      {"completed": 10, "errors": 1},
                      {"completed": 10, "errors": 1, "errorRatio": float("nan")},
                      {"completed": 10, "errors": 1, "errorRatio": float("inf")},
                      {"completed": 10, "errors": 1, "errorRatio": 0}]:
            with self.subTest(stats=stats):
                self.assertFalse(ratio_decision(stats, "service", self.analysis)["passed"])
        for analysis in [None, {"metrics": []}, {"metrics": [{"name": "error-rate", "successCondition": "result[0] < NaN"}]}]:
            with self.assertRaises(ValueError):
                error_ratio_limit(analysis)

    def test_authentication_failure_always_stops_even_host_diagnostics(self):
        for route in ["service", "host"]:
            directory, a = self.stream(route, auth_error=TimeoutError())
            self.assertTrue(a.stop.is_set())
            self.assertTrue((directory / "traffic-failure.json").exists())
            self.assertFalse(observer_decision(directory, route, self.analysis)["passed"])

    def test_missing_worker_or_readiness_never_passes(self):
        service, _ = self.stream("service", workers=3)
        host, _ = self.stream("host")
        self.assertFalse(evaluate_observers(service, host, self.analysis, self.health)["passed"])
        (host / "ready.json").unlink()
        self.assertFalse(evaluate_observers(host, service, self.analysis, self.health)["passed"])

    def test_count_hash_ratio_and_ready_tampering_fail(self):
        service, _ = self.stream("service")
        host, _ = self.stream("host")
        path = service / "summary.json"
        original = json.loads(path.read_text())
        for patch in [{"completed": 99}, {"rawSha256": "0" * 64},
                      {"workload": {"completed": 100, "errors": 0, "errorRatio": float("nan")}}]:
            path.write_text(json.dumps({**original, **patch}))
            self.assertFalse(evaluate_observers(service, host, self.analysis, self.health)["passed"])
        path.write_text(json.dumps(original))
        (service / "ready.ndjson").write_bytes(b"{}\n")
        self.assertFalse(evaluate_observers(service, host, self.analysis, self.health)["passed"])

    def test_new_policy_rejects_missing_final_workload_ratio(self):
        directory, _ = self.stream("missing-ratio")
        path = directory / "summary.json"
        summary = json.loads(path.read_text())
        for remove in ["workload", "errorRatio"]:
            changed = copy.deepcopy(summary)
            if remove == "workload":
                del changed[remove]
            else:
                del changed["workload"][remove]
            path.write_text(json.dumps(changed))
            self.assertFalse(observer_decision(directory, "service", self.analysis)["passed"])

    def test_host_only_failure_is_retained_without_deciding_candidate_health(self):
        service, _ = self.stream("service")
        host, _ = self.stream("host", [ConnectionResetError()] * 10)
        decision = evaluate_observers(service, host, self.analysis, self.health)
        self.assertTrue(decision["passed"])
        self.assertEqual(decision["observers"]["host"]["outcomes"]["connection-error"], 10)
        self.assertEqual(decision["observers"]["host"]["workload"]["errorRatio"], .1)
        self.assertIn("diagnostics", decision["observers"]["host"]["reason"])

    def test_correlated_service_and_candidate_failures_cannot_be_waived(self):
        service, _ = self.stream("service", [500] * 10)
        host, _ = self.stream("host", [TimeoutError()])
        health = {**self.health, "candidateMetricsPassed": False}
        decision = evaluate_observers(service, host, self.analysis, health)
        self.assertFalse(decision["passed"])
        self.assertTrue(any("Service error ratio" in reason for reason in decision["reasons"]))
        self.assertTrue(any("candidateMetricsPassed" in reason for reason in decision["reasons"]))

    def test_every_health_gate_is_mandatory_even_with_clean_traffic(self):
        service, _ = self.stream("service")
        host, _ = self.stream("host")
        for name in self.health:
            self.assertFalse(evaluate_observers(service, host, self.analysis, {**self.health, name: False})["passed"])
        self.assertFalse(evaluate_observers(service, host, self.analysis, {})["passed"])
        self.assertFalse(evaluate_observers(service, service, self.analysis, self.health)["passed"])

    def test_timeout_is_sent_once_and_live_checkpoint_is_only_provisional(self):
        directory = self.root / "live"
        a = traffic.Accounting(directory)
        self.addCleanup(a.raw.close)
        a.ready_workers = set(range(4))
        a.context.worker = 0
        a.request("queue", lambda: (200, None), "healthy")
        send = Mock(side_effect=TimeoutError("private"))
        a.request("history", send, "healthy")
        send.assert_called_once_with()
        checkpoint = observation_checkpoint((directory / "requests.ndjson").read_bytes(), "host", self.analysis)
        self.assertTrue(checkpoint["passed"])
        self.assertTrue(checkpoint["provisional"])
        self.assertEqual(checkpoint["workload"]["errors"], 1)
        self.assertFalse(observer_decision(directory, "host", self.analysis)["passed"], "No final summary")
        self.assertNotIn("private", (directory / "requests.ndjson").read_text())

    def test_missing_csrf_on_scheduled_refresh_stops_without_reauthentication(self):
        class Response:
            def __init__(self, status, body=None):
                self.status, self.body = status, body
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self):
                return json.dumps(self.body).encode()
        valid = {"user": {"role": "SUPPORT"}, "csrfHeaderName": "X-CSRF-TOKEN", "csrfToken": "synthetic-token"}
        client = Mock()
        client.open.side_effect = [Response(200, valid), Response(204), Response(200, valid),
                                   Response(200, {}), Response(200, {"user": {"role": "SUPPORT"}})]
        a = traffic.Accounting(self.root / "csrf")
        self.addCleanup(a.raw.close)
        with patch.object(traffic.urllib.request, "build_opener", return_value=client), \
                patch.object(traffic, "REQUEST_INTERVAL_SECONDS", 0):
            traffic.worker(a, "http://localhost", "synthetic-user", "synthetic-password", "request", 0, True)
        self.assertTrue(a.stop.is_set())
        self.assertTrue(a.failed)
        self.assertEqual(client.open.call_count, 5)
        self.assertTrue(all(call.kwargs["timeout"] == 3 for call in client.open.call_args_list))

    def test_setup_failure_is_not_an_aggregate_allowance(self):
        a = traffic.Accounting(self.root / "setup")
        self.addCleanup(a.raw.close)
        a.context.worker = 0
        send = Mock(side_effect=TimeoutError())
        a.request("queue", send, "setup")
        send.assert_called_once_with()
        self.assertTrue(a.stop.is_set())
        self.assertIsNotNone(a.failure)
        a.worker_ready(0)
        self.assertFalse((a.directory / "ready.json").exists())


if __name__ == "__main__":
    unittest.main()
