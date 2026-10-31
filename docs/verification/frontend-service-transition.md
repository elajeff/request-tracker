# Frontend Service transition diagnosis

PR #49 remained unmerged at `ba4573986b4ab09ab919246a15afa0a713ad34cb`. Both Applications returned to main `6131d21071a52b3956fbd109b514249f826d4454` after the kind-only observations. K3s and baseline releases were not changed.

## Original failures

On 31 October 2026, Service observer run `3c47cddf-702f-41d0-a9fe-57ecdf0f9cc4` recorded these failures. Times are UTC dispatch times.

| Wire ID suffix | Operation | Time | Outcome |
| --- | --- | --- | --- |
| 218 | History | 05:36:35.867096 | ConnectionRefusedError, errno 111 |
| 219 | History | 05:36:35.877167 | ConnectionRefusedError, errno 111 |
| 220 | Session refresh | 05:36:36.058474 | ConnectionRefusedError, errno 111 |

Each failed during TCP connection establishment in less than one millisecond, before a connection or HTTP response existed. The observer opened a new connection for each request; connection reuse is not supported as an explanation. All 220 requests were accounted for: 213 HTTP 200, four HTTP 204 and three connection errors. The session-refresh failure left the final summary unsuccessful. No failed request was retried.

Historical pod events, EndpointSlice transitions and packet destinations were unavailable, so the original refusals cannot be assigned to individual pods. The later browser `ERR_EMPTY_RESPONSE`, at approximately 05:36:40.688–05:36:41.513, followed the rollback patch at 05:36:36.322 and is a separate failed observation.

## Bounded reproduction

Four authenticated Service workers and one independent host worker observed a temporary kind source transition to the release branch, followed by restoration to main. Pod, Deployment, ReplicaSet, EndpointSlice and event watches ran continuously, alongside timestamped nginx logs. Watch times below are client receipt times, not exact network-programming times.

| UTC time | Observation |
| --- | --- |
| 09:19:29.931 | Release-branch source patch completed |
| 09:19:31 | New frontend pod created and scheduled |
| 09:19:33 | New nginx container started |
| 09:19:38.659 | EndpointSlice showed both old and new endpoints ready |
| 09:19:38.723 | Old endpoint became terminating and not ready; new endpoint remained ready |
| 09:19:38.738 | Old nginx received SIGQUIT and stopped accepting connections |
| 09:19:39.069–09:19:39.677 | Eight Service TCP connection refusals |
| 09:19:40.073 | Old endpoint disappeared from the observed EndpointSlice |
| 09:20:39.591 | Original main source restored |
| 09:20:43.221 | Application verified Healthy/Synced on the previous frontend |

The new nginx accepted successful requests before, between and after the refusals. No zero-ready-endpoint interval or frontend restart was observed. None of the eight refused wire IDs appeared in either frontend access log; adjacent successful wire IDs appeared in the new pod's log. Each refusal occurred after old nginx shutdown began and before its endpoint disappeared. This supports a termination/Service-propagation race involving a retired listener. Exact destination and kube-proxy update times were not captured, so the network mechanism and attribution of the original three failures remain uncertain. Readiness preceding nginx startup and observer connection reuse are not supported by this reproduction.

| Stream | Requests | HTTP 200 | HTTP 204 | Connection errors |
| --- | ---: | ---: | ---: | ---: |
| Kind Service | 1,992 | 1,980 | 4 | 8 |
| Kind host diagnostic | 197 | 194 | 1 | 2 |

The Service errors comprised five queue and three history reads. The host stream recorded a history `RemoteDisconnected`, then a session-refresh connection refusal. Its pod-bound port-forward reported refusal inside the terminating pod's network namespace and exited with code 1. It was not restarted or replaced. Its final summary remained unsuccessful. Independent recounts matched every start/completion, outcome count and raw hash for both streams; this does not turn an unsuccessful summary into passing evidence. Traffic was quiesced before restoration; lifecycle watches continued through restoration.

These results do not pass frontend staging acceptance.

A separate setup check stopped before any source change because the private runner expected four host workers instead of one. Its 52 requests completed with 44 HTTP 200 and eight HTTP 204; eight disposable sessions were removed. The corrected reproduction used fresh workers and sessions. No traffic request was retried.

## Local mitigation and limits

The delivery frontend has one replica and default RollingUpdate settings, effectively one surge replica and zero unavailable replicas. Readiness probes GET `/` every five seconds; liveness probes run every ten seconds. Before correction it had no preStop hook, a default 30-second termination grace period and nginx's SIGQUIT stop signal. Graceful nginx shutdown alone does not keep its listener open while Service routes converge.

The local chart correction adds a five-second preStop delay only to the delivery frontend, retaining nginx's listener before SIGQUIT. Five seconds matches the existing backend propagation delay and provides margin over the observed 1.335 seconds between SIGQUIT and EndpointSlice removal. This is an empirical local mitigation, not a bound on Service propagation. The existing 30-second grace period leaves 25 seconds after the hook. Images, probes, replica counts, baseline templates and backend settings are unchanged.

Rendering tests check the delivery hook and unchanged baseline lifecycle. An opt-in packaged nginx test checks that root requests succeed while the hook runs and that SIGQUIT exits cleanly. Run it with `FRONTEND_LIFECYCLE_IMAGE` set to a locally available frontend image:

```sh
python -m unittest discover -s delivery -p test_frontend_lifecycle.py
```

The mitigation has not been deployed or verified through a corrected Kubernetes transition. Another bounded kind-only staging check is appropriate after review; existing request limits, session gates and failure accounting remain unchanged. No zero-downtime guarantee follows from this diagnosis. Earlier authentication latency remains unresolved; see [filtering verification limits](filtering-release.md).

## Preservation

All pre-existing requests, accounts, staff, history and Flyway rows matched. Secret/settings fingerprints, Services, storage, retained preview resources and Application source/policy specifications matched. Backend pod identities and restart counts were unchanged. Only the kind delivery frontend pod was replaced as expected; five new diagnostic sessions were removed. Baseline revisions remained kind 8 and k3s 5. All four frontends returned to `react-dashboard-fc9e818ac52b-20261030-072600`; all backends retained `server-filtering-retry-023024facc6b-20261030-231441`. No temporary resources remained.
