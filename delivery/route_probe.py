"""Record route probes without retaining response bodies or authentication material."""

from datetime import datetime, timezone
import uuid


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def probe(send, *, route, phase, expected_authentication, expected_status=200):
    record = {
        "requestId": str(uuid.uuid4()),
        "route": route,
        "dispatchedAt": timestamp(),
        "phaseAtDispatch": phase,
        "expectedAuthentication": expected_authentication,
        "expectedStatus": expected_status,
    }
    try:
        record["status"] = send()
    except (OSError, TimeoutError):
        record["status"] = "network-error"
    record["completedAt"] = timestamp()
    record["ok"] = record["status"] == expected_status
    return record


def require_success(records):
    if not records or any(not record["ok"] for record in records):
        raise RuntimeError("Route verification failed; retain all probe records")
