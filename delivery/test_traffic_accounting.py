import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import os
import subprocess
import sys
import time
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
import urllib.error
import http.client

from traffic_accounting import validate
from exercise_orchestration import validate_readiness

spec = importlib.util.spec_from_file_location("traffic", Path(__file__).resolve().parents[1] /
    "helm/request-tracker/files/traffic.py")
traffic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traffic)


class AccountingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.a = traffic.Accounting(self.directory)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.a.raw.close)

    def finalize(self, workers=(), timeout=1):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            summary = self.a.finalize(workers, timeout)
        if output.getvalue():
            self.assertEqual(json.loads(output.getvalue())["event"], "final")
        return summary

    def request(self, status=200):
        return self.a.request("queue", lambda: (status, None), "healthy")

    def test_normal_completion_final_flush_and_raw_recount(self):
        self.request()
        self.request(201)
        self.finalize()
        summary = validate(self.directory)
        self.assertEqual(summary["outcomes"], {"http:200": 1, "http:201": 1})
        self.assertEqual(len((self.directory / "requests.ndjson").read_text().splitlines()), 4)
        with self.assertRaises(traffic.Quiesced):
            self.request()
        self.assertEqual(self.finalize(), summary)

    def test_termination_before_old_ten_second_reporting_interval(self):
        self.request(503)
        previous = {name: signal.getsignal(name) for name in (signal.SIGTERM, signal.SIGINT)}
        try:
            traffic.install_shutdown_handlers(self.a)
            signal.raise_signal(signal.SIGTERM)
            self.assertTrue(self.a.stop.is_set())
        finally:
            for name, handler in previous.items():
                signal.signal(name, handler)
        self.assertFalse((self.directory / "summary.json").exists())
        self.finalize()
        self.assertEqual(validate(self.directory)["outcomes"], {"http:503": 1})

    def test_shutdown_waits_for_in_flight_request(self):
        entered, release = threading.Event(), threading.Event()
        def send():
            entered.set()
            release.wait(2)
            return 500, None
        thread = threading.Thread(target=lambda: self.a.request("staff", send, "fault"))
        thread.start()
        self.assertTrue(entered.wait(1))
        self.a.quiesce()
        with self.assertRaises(traffic.Quiesced):
            self.request()
        release.set()
        self.finalize([thread])
        self.assertEqual(validate(self.directory)["outcomes"], {"http:500": 1})

    def test_drain_deadline_incomplete_fails_even_after_late_completion(self):
        entered, release = threading.Event(), threading.Event()
        def send():
            entered.set()
            release.wait(2)
            return 200, None
        thread = threading.Thread(target=lambda: self.a.request("queue", send, "healthy"))
        thread.start()
        self.assertTrue(entered.wait(1))
        try:
            self.assertFalse(self.finalize([thread], timeout=0)["complete"])
            with self.assertRaises(ValueError):
                validate(self.directory)
        finally:
            release.set()
            thread.join(2)
        with self.assertRaises(ValueError):
            validate(self.directory)

    def test_http_and_all_network_failure_categories_no_sensitive_messages(self):
        self.request(403)
        self.request(500)
        errors = [urllib.error.HTTPError("private", 502, "private", {}, None),
                  ConnectionRefusedError("private"), TimeoutError("private"),
                  urllib.error.URLError(ConnectionResetError("private")),
                  urllib.error.URLError(TimeoutError("private")), OSError("private"),
                  http.client.IncompleteRead(b"", 10)]
        for error in errors:
            def send(error=error):
                raise error
            self.a.request("queue", send, "fault")
        self.finalize()
        self.assertEqual(validate(self.directory)["outcomes"], {
            "http:403": 1, "http:500": 1, "http:502": 1,
            "connection-error": 2, "timeout": 2, "network-error": 2})
        self.assertNotIn("private", (self.directory / "requests.ndjson").read_text())

    def test_missing_inconsistent_and_truncated_summaries_fail_closed(self):
        with self.assertRaises(ValueError):
            validate(self.directory)
        self.request()
        self.finalize()
        summary_path = self.directory / "summary.json"
        original = summary_path.read_text()
        for patch in ({"complete": False}, {"inFlight": 1}, {"completed": 9},
                      {"outcomes": {"http:200": 2}}, {"runId": "wrong"}):
            summary = json.loads(original)
            summary.update(patch)
            summary_path.write_text(json.dumps(summary))
            with self.assertRaises(ValueError):
                validate(self.directory)
        summary_path.write_text(original[:10])
        with self.assertRaises(ValueError):
            validate(self.directory)

    def test_raw_tampering_duplicate_and_missing_records_fail(self):
        self.request()
        self.finalize()
        raw_path = self.directory / "requests.ndjson"
        raw = raw_path.read_bytes()
        original = json.loads((self.directory / "summary.json").read_text())
        for changed in (raw + raw, raw.splitlines(keepends=True)[0], raw.rstrip()):
            raw_path.write_bytes(changed)
            summary = {**original, "rawSha256": hashlib.sha256(changed).hexdigest()}
            (self.directory / "summary.json").write_text(json.dumps(summary))
            with self.assertRaises(ValueError):
                validate(self.directory)

    def test_authentication_failure_is_not_allowed_among_injected_failures(self):
        self.a.request("login", lambda: (403, None))
        self.finalize()
        with self.assertRaises(ValueError):
            validate(self.directory)

    def test_restart_cannot_overwrite_existing_evidence(self):
        self.request()
        with self.assertRaises(FileExistsError):
            traffic.Accounting(self.directory)

    def test_process_quiesces_and_retains_capturable_evidence_without_exiting(self):
        class Handler(BaseHTTPRequestHandler):
            wire_ids = []

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.wire_ids.append(self.headers.get("X-Request-ID"))
                if self.path == "/api/session":
                    body = json.dumps({"user": {"role": "SUPPORT"},
                        "csrfHeaderName": "X-CSRF-TOKEN", "csrfToken": "synthetic-token"}).encode()
                else:
                    body = b'{}'
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.wire_ids.append(self.headers.get("X-Request-ID"))
                valid = self.headers.get("X-CSRF-TOKEN") == "synthetic-token"
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                self.send_response(204 if valid else 403)
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        evidence = self.directory / "process"
        env = {**os.environ, "TRAFFIC_BASE_URL": "http://127.0.0.1:" + str(server.server_port),
               "TRAFFIC_USERNAME": "synthetic-user", "TRAFFIC_PASSWORD": "synthetic-password",
               "TRAFFIC_REQUEST_ID": "synthetic-request", "TRAFFIC_EVIDENCE_DIR": str(evidence)}
        process = subprocess.Popen([sys.executable, str(Path(traffic.__file__).resolve())],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 8
            raw_path = evidence / "requests.ndjson"
            while time.monotonic() < deadline:
                if (evidence / "ready.json").exists() and raw_path.exists() and b'"operation": "history"' in raw_path.read_bytes():
                    break
                self.assertIsNone(process.poll())
                time.sleep(0.02)
            else:
                self.fail("Local traffic did not start")
            validate_readiness(json.loads((evidence / "ready.json").read_text()),
                               (evidence / "ready.ndjson").read_bytes())
            (evidence / "quiesce").touch()
            while not (evidence / "summary.json").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            summary = validate(evidence, expected_workers=4)
            self.assertGreater(summary["completed"], 12)
            raw = raw_path.read_bytes()
            time.sleep(0.25)
            self.assertIsNone(process.poll(), "Generator must remain available for capture")
            self.assertEqual(raw, raw_path.read_bytes(), "No new requests after finalization")
            copied = self.directory / "captured"
            copied.mkdir()
            for name in ["requests.ndjson", "summary.json"]:
                (copied / name).write_bytes((evidence / name).read_bytes())
            self.assertEqual(validate(copied), summary)
            self.assertEqual(len(Handler.wire_ids), len(set(Handler.wire_ids)))
            self.assertEqual(set(Handler.wire_ids),
                {summary["runId"] + "-" + str(i) for i in range(1, summary["completed"] + 1)})
            for sensitive in [b"synthetic-password", b"synthetic-token", b"synthetic-user"]:
                self.assertNotIn(sensitive, raw)
        finally:
            process.kill()
            process.communicate(timeout=5)
            server.shutdown()
            server.server_close()
            serving.join(2)


if __name__ == "__main__":
    unittest.main()
