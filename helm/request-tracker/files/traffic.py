"""Bounded authenticated traffic with an explicit, retained quiesce checkpoint."""
import collections
import hashlib
import http.cookiejar
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class Quiesced(Exception):
    pass


def outcome(error):
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(reason, (ConnectionError, socket.gaierror)):
        return "connection-error"
    return "network-error"


class Accounting:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents accidental evidence reuse after a restart.
        self.raw = (self.directory / "requests.ndjson").open("x", encoding="utf-8", newline="\n")
        self.run_id = str(uuid.uuid4())
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.started = 0
        self.completed = 0
        self.counts = collections.Counter()
        self.final = None
        self.failed = False

    def emit(self, event):
        self.raw.write(json.dumps({"runId": self.run_id, **event}, sort_keys=True) + "\n")
        self.raw.flush()

    def request(self, operation, send, phase="setup"):
        with self.lock:
            if self.stop.is_set():
                raise Quiesced()
            self.started += 1
            identity = self.started
            self.emit({"event": "started", "id": identity, "operation": operation,
                       "phase": phase, "timeNs": time.time_ns()})
        value = None
        try:
            status, value = send()
            result = "http:" + str(status)
        except urllib.error.HTTPError as error:
            result = "http:" + str(error.code)
            error.close()
        except (OSError, TimeoutError, http.client.HTTPException) as error:
            result = outcome(error)
        except Exception:
            # Never serialize exception messages: they can contain credentials/URLs.
            result = "client-error"
        with self.lock:
            self.completed += 1
            self.counts[result] += 1
            self.emit({"event": "completed", "id": identity, "outcome": result,
                       "timeNs": time.time_ns()})
        return result, value

    def quiesce(self):
        # Admission and stop share a lock: no request can start after this returns.
        with self.lock:
            self.stop.set()

    def finalize(self, workers, timeout=12):
        self.quiesce()
        deadline = time.monotonic() + timeout
        for worker in workers:
            worker.join(max(0, deadline - time.monotonic()))
        with self.lock:
            if self.final is not None:
                return self.final
            self.raw.flush()
            os.fsync(self.raw.fileno())
            self.final = {"version": 1, "runId": self.run_id,
                          "complete": not self.failed and self.started == self.completed and not any(w.is_alive() for w in workers),
                          "started": self.started, "completed": self.completed,
                          "inFlight": self.started - self.completed,
                          "outcomes": dict(self.counts),
                          "rawSha256": hashlib.sha256((self.directory / "requests.ndjson").read_bytes()).hexdigest()}
            temporary = self.directory / "summary.tmp"
            with temporary.open("w", encoding="utf-8") as output:
                json.dump(self.final, output, sort_keys=True)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.directory / "summary.json")
            print(json.dumps({"event": "final", **self.final}), flush=True)
            return self.final


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def worker(accounting, base, username, password, request_id):
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(operation, path, data=None, headers=None, parse=False):
        def send():
            request = urllib.request.Request(base + path, data=data,
                headers={"Connection": "close", **(headers or {})})
            with client.open(request, timeout=3) as response:
                body = response.read()
                return response.status, json.loads(body) if parse else None
        phase_file = accounting.directory / "phase"
        phase = phase_file.read_text().strip() if phase_file.exists() else "setup"
        if phase not in {"setup", "baseline", "healthy", "fault", "restore", "main"}:
            phase = "unknown"
        return accounting.request(operation, send, phase)

    try:
        status, session = call("session-bootstrap", "/api/session", parse=True)
        if status != "http:200":
            return
        data = urllib.parse.urlencode({"username": username, "password": password}).encode()
        status, _ = call("login", "/api/session/login", data,
            {session["csrfHeaderName"]: session["csrfToken"],
             "Content-Type": "application/x-www-form-urlencoded"})
        if status != "http:204":
            return
        status, session = call("session-refresh", "/api/session", parse=True)
        if status != "http:200" or not session.get("user") or not session.get("csrfToken"):
            accounting.failed = True
            return
        paths = [("queue", "/api/requests?limit=5"), ("staff", "/api/staff?limit=5"),
                 ("history", "/api/requests/" + request_id + "/history?limit=5")]
        index = 0
        while not accounting.stop.is_set():
            started = time.monotonic()
            operation, path = paths[index % len(paths)]
            status, _ = call(operation, path)
            # No retry/re-login: authentication loss stops this worker and fails the gate.
            if status == "http:401":
                return
            index += 1
            accounting.stop.wait(max(0, 0.2 - (time.monotonic() - started)))
    except Quiesced:
        pass
    except Exception:
        accounting.failed = True


def install_shutdown_handlers(accounting):
    # Signals request shutdown; main performs the bounded drain and remains alive.
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, lambda *_: accounting.stop.set())


def run():
    accounting = Accounting(os.environ.get("TRAFFIC_EVIDENCE_DIR", "/evidence"))
    install_shutdown_handlers(accounting)
    workers = [threading.Thread(target=worker, args=(accounting,
        os.environ.get("TRAFFIC_BASE_URL", "http://request-tracker-delivery-frontend:80"),
        os.environ["TRAFFIC_USERNAME"], os.environ["TRAFFIC_PASSWORD"],
        os.environ["TRAFFIC_REQUEST_ID"]), daemon=True) for _ in range(4)]
    for thread in workers:
        thread.start()
    deadline = time.monotonic() + 900
    while not accounting.stop.wait(0.1):
        if (accounting.directory / "quiesce").exists() or time.monotonic() >= deadline:
            if time.monotonic() >= deadline:
                accounting.failed = True
            accounting.quiesce()
        if not any(thread.is_alive() for thread in workers):
            accounting.quiesce()
    accounting.finalize(workers)
    # Explicit quiesce does not exit/restart the container. Capture files BEFORE prune.
    while True:
        time.sleep(1)


if __name__ == "__main__":
    run()
