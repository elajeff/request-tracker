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


WORKER_COUNT = 4
REQUEST_TIMEOUT_SECONDS = 3  # Socket limit for each request; failures are counted, never retried.
REQUEST_INTERVAL_SECONDS = 0.2
DRAIN_TIMEOUT_SECONDS = 12  # Bounds shutdown across all workers, not each worker separately.
EXERCISE_TIMEOUT_SECONDS = 900  # Fail if the exercise reaches its overall traffic bound.
BASELINE_SECONDS = 120


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
        self.workload_completed = 0
        self.workload_errors = 0
        self.final = None
        self.failed = False
        self.context = threading.local()
        self.ready_workers = set()
        self.failure = None
        self.baseline = None

    def atomic_json(self, name, value):
        temporary = self.directory / (name + ".tmp")
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(value, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(self.directory / name)

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
                       "phase": phase, "worker": getattr(self.context, "worker", None),
                       "timeNs": time.time_ns()})
        self.context.identity = identity
        value = None
        self.context.transport = {}
        try:
            status, value = send()
            result = "http:" + str(status)
        except urllib.error.HTTPError as error:
            result = "http:" + str(error.code)
            error.close()
        except (OSError, TimeoutError, http.client.HTTPException) as error:
            result = outcome(error)
            reason = error.reason if isinstance(error, urllib.error.URLError) else error
            self.context.transport.update(exceptionType=type(reason).__name__, errno=getattr(reason, "errno", None))
        except Exception:
            # Never serialize exception messages: they can contain credentials/URLs.
            result = "client-error"
        with self.lock:
            self.completed += 1
            self.counts[result] += 1
            self.emit({"event": "completed", "id": identity, "outcome": result,
                       "timeNs": time.time_ns(), "transport": self.context.transport})
            expected = "http:204" if operation == "login" else "http:200"
            if operation in {"queue", "staff", "history"}:
                self.workload_completed += 1
                self.workload_errors += result != "http:200"
            worker = getattr(self.context, "worker", None)
            strict = (operation in {"session-bootstrap", "login", "session-refresh"}
                      or phase == "setup" or (worker is not None and worker not in self.ready_workers)
                      or result in {"http:401", "client-error"})
            if result != expected and strict and self.failure is None:
                self.failure = {"runId": self.run_id, "id": identity, "outcome": result}
                self.atomic_json("traffic-failure.json", self.failure)
                self.stop.set()
        return result, value

    def worker_ready(self, worker_id):
        with self.lock:
            self.ready_workers.add(worker_id)
            if self.ready_workers != set(range(WORKER_COUNT)) or self.failure or (self.directory / "ready.json").exists():
                return
            self.raw.flush()
            os.fsync(self.raw.fileno())
            raw = (self.directory / "requests.ndjson").read_bytes()
            # Frozen readiness checkpoint: later requests cannot invalidate its hash.
            with (self.directory / "ready.ndjson").open("xb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            self.atomic_json("ready.json", {"version": 1, "runId": self.run_id,
                "readyAtNs": time.time_ns(), "workers": sorted(self.ready_workers),
                "started": self.started, "completed": self.completed,
                "inFlight": self.started - self.completed,
                "rawSha256": hashlib.sha256(raw).hexdigest()})

    def quiesce(self):
        # Admission and stop share a lock: no request can start after this returns.
        with self.lock:
            self.stop.set()

    def finalize(self, workers, timeout=DRAIN_TIMEOUT_SECONDS):
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
                          "workload": {"completed": self.workload_completed, "errors": self.workload_errors,
                                       "errorRatio": self.workload_errors / self.workload_completed
                                       if self.workload_completed else None},
                          "rawSha256": hashlib.sha256((self.directory / "requests.ndjson").read_bytes()).hexdigest()}
            if self.baseline is not None:
                self.final["baseline"] = dict(self.baseline)
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


class DiagnosticConnection(http.client.HTTPConnection):
    def __init__(self, trace, *args, **kwargs):
        self.trace = trace
        super().__init__(*args, **kwargs)

    def connect(self):
        self.trace["connectBeginNs"] = time.time_ns()
        super().connect()
        self.trace["connectedNs"] = time.time_ns()
        self.trace["socketErrorAfterConnect"] = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)

    def send(self, data):
        self.trace.setdefault("sendBeginNs", time.time_ns())
        super().send(data)
        self.trace["lastSendNs"] = time.time_ns()

    def getresponse(self):
        self.trace["responseWaitBeginNs"] = time.time_ns()
        try:
            response = super().getresponse()
            self.trace["headersNs"] = time.time_ns()
            return response
        except Exception:
            self.trace["socketPresentOnFailure"] = self.sock is not None
            if self.sock is not None:
                try:
                    self.trace["socketErrorOnFailure"] = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                except OSError:
                    pass  # Socket diagnostics must not replace the original failure.
            raise


class DiagnosticHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, accounting):
        super().__init__()
        self.accounting = accounting

    def http_open(self, request):
        return self.do_open(lambda *args, **kwargs:
            DiagnosticConnection(self.accounting.context.transport, *args, **kwargs), request)


def worker(accounting, base, username, password, request_id, worker_id=0, baseline=False):
    accounting.context.worker = worker_id
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), DiagnosticHTTPHandler(accounting),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(operation, path, data=None, headers=None, parse=False):
        def send():
            request = urllib.request.Request(base + path, data=data,
                headers={"Connection": "close",
                         "X-Request-ID": accounting.run_id + "-" + str(accounting.context.identity),
                         "User-Agent": "V6Exercise/" + accounting.run_id + "-" + str(accounting.context.identity),
                         **(headers or {})})
            with client.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                body = response.read()
                return response.status, json.loads(body) if parse else None
        phase_file = accounting.directory / "phase"
        phase = phase_file.read_text().strip() if phase_file.exists() else ("baseline" if baseline else
            "healthy" if worker_id in accounting.ready_workers else "setup")
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
            accounting.quiesce()
            return
        paths = [("queue", "/api/requests?limit=5"), ("staff", "/api/staff?limit=5"),
                 ("history", "/api/requests/" + request_id + "/history?limit=5")]
        if baseline:
            paths[1] = ("session-refresh", "/api/session")
        index = 0
        while not accounting.stop.is_set():
            started = time.monotonic()
            operation, path = paths[index % len(paths)]
            status, value = call(operation, path, parse=operation == "session-refresh")
            if operation == "session-refresh" and status == "http:200" and (not value.get("user") or not value.get("csrfToken")):
                accounting.failed = True
                accounting.quiesce()
                return
            if operation == "queue" and status == "http:200":
                accounting.worker_ready(worker_id)
            # No retry/re-login: authentication loss stops this worker and fails the gate.
            if status == "http:401":
                return
            index += 1
            accounting.stop.wait(max(0, REQUEST_INTERVAL_SECONDS - (time.monotonic() - started)))
    except Quiesced:
        pass
    except Exception:
        accounting.failed = True
        accounting.quiesce()


def install_shutdown_handlers(accounting):
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, lambda *_: accounting.stop.set())


def run():
    accounting = Accounting(os.environ.get("TRAFFIC_EVIDENCE_DIR", "/evidence"))
    install_shutdown_handlers(accounting)
    baseline = os.environ.get("TRAFFIC_BASELINE_SECONDS")
    if baseline is not None:
        if baseline != str(BASELINE_SECONDS) or os.environ.get("TRAFFIC_ROUTE") not in {"host", "cluster"}:
            raise ValueError("Baseline requires 120 seconds and a known route")
        attempt = str(uuid.UUID(os.environ["TRAFFIC_ATTEMPT_ID"]))
        base = os.environ.get("TRAFFIC_BASE_URL", "")
        parsed = urllib.parse.urlsplit(base)
        if (parsed.scheme != "http" or parsed.username or parsed.password or parsed.query
                or parsed.fragment or parsed.path not in {"", "/"} or not parsed.hostname):
            raise ValueError("Invalid baseline frontend address")
        accounting.baseline = {"attemptId": attempt, "route": os.environ["TRAFFIC_ROUTE"],
            "context": "kind-request-tracker", "requestedSeconds": BASELINE_SECONDS,
            "baseUrl": base, "startedAtNs": time.time_ns()}
    workers = [threading.Thread(target=worker, args=(accounting,
        os.environ.get("TRAFFIC_BASE_URL", "http://request-tracker-delivery-frontend:80"),
        os.environ["TRAFFIC_USERNAME"], os.environ["TRAFFIC_PASSWORD"],
        os.environ["TRAFFIC_REQUEST_ID"], worker_id, baseline is not None), daemon=True) for worker_id in range(WORKER_COUNT)]
    for thread in workers:
        thread.start()
    deadline = time.monotonic() + (BASELINE_SECONDS if baseline is not None else EXERCISE_TIMEOUT_SECONDS)
    while not accounting.stop.wait(0.1):
        if (accounting.directory / "quiesce").exists() or time.monotonic() >= deadline:
            if time.monotonic() >= deadline and baseline is None:
                accounting.failed = True
            accounting.quiesce()
        if not any(thread.is_alive() for thread in workers):
            accounting.quiesce()
    if accounting.baseline is not None:
        accounting.baseline["endedAtNs"] = time.time_ns()
    accounting.finalize(workers)
    # Explicit quiesce does not exit/restart the container. Capture files BEFORE prune.
    while True:
        time.sleep(1)


if __name__ == "__main__":
    run()
