# Filtering release verification limits

## Session-loss browser coverage

[Main CI run 41119976915](https://github.com/elajeff/request-tracker/actions/runs/41119976915) timed out clicking **Refresh staff** after logout. Its action log recorded a detached button; the screenshot already showed the sign-in form and cleared protected content. Initial queue and debounced staff requests could overlap logout, removing controls while the test tried to click them. The held queue response was never released before the timeout. No trace, video or browser-console timeline was retained; authenticated traces remain disabled because they contain session material.

An unchanged ten-run repetition retained eight passes and two timeouts on the disappearing controls. The synchronized test waits for initial reads, opens the staff controls before logout and captures an HTTP 200 queue response containing the seeded request. One explicit staff refresh then receives HTTP 401. Protected content must disappear before the captured response is released and remain absent after its handler finishes. Exactly two staff reads, including the initial read, exclude an automatic protected-request retry. Ten synchronized repetitions passed with browser retries disabled. No application change or longer action timeout was required.

## Authentication latency

A kind login dispatched at 20:05:14.693 UTC on 30 October 2026 timed out at 20:05:17.703 under the existing three-second limit. The matching nginx wire ID recorded HTTP 204 at 20:05:18.448. It reached the backend and completed after the client deadline. The port-forward log retained the connection without a forwarding error.

The matching interval contained four backend POST completions. One stable pod recorded two completions totaling 5.976 seconds, with a maximum of 3.685 seconds; another stable pod recorded 2.893 seconds and the candidate recorded 1.404 seconds. These timers support slow server-side authentication handling rather than a forwarding-only loss. Backend logs did not carry the wire identity, so the exact request-to-pod mapping remains an inference. Sampled process CPU usage increased and connection-pool pending gauges remained zero. Historical node throttling, request-level database waits and authentication profiles were unavailable. PostgreSQL statement-duration logging was disabled. The underlying delay remains unresolved; no BCrypt, authentication or harness timeout change is supported by this evidence.

A bounded comparison used four workers and eight fresh sessions per worker on each path. The Service observers shared the respective node's network namespace in disposable local containers. Host routes used separate localhost port-forwards and cookie jars. Both clusters used the verified `auth-08e4a87-20261029041407` backend; no rollout was running.

| Path | Login attempts | Login p50, ms | Login p95, ms | Login maximum, ms | Bootstrap maximum, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| kind host frontend | 32 | 204.9 | 1519.0 | 1685.3 | 1714.5 |
| kind frontend Service | 32 | 141.1 | 402.7 | 411.6 | 602.4 |
| k3s host frontend | 32 | 233.3 | 2808.1 | 2988.1 | 1778.4 |
| k3s frontend Service | 32 | 134.9 | 1535.6 | 1995.7 | 75.6 |

Each path completed 192 requests: 128 HTTP 200 and 64 HTTP 204, covering bootstrap, login, session refresh, queue, history and logout. All 768 dispatches had completion records, with zero timeouts, connection errors or other failures. Independent recounts and evidence hashes matched. The three-second request limit, no-retry rule and no-fallback behavior were unchanged. Sessions and temporary local observers were cleaned up; no application fixtures or accounts were added.

Host comparisons preceded Service comparisons, and clients used different operating systems. These samples do not isolate a forwarding penalty or reproduce candidate-startup conditions. The k3s host login maximum was only about 12 ms below the timeout, and queue reads reached 2.923 seconds. Successful samples do not erase the original timeout, establish a latency margin or resolve the earlier failures in [canary verification](canary-release.md).

## Integration observations

The earlier kind history timeout and host-path failures remain failures under the policy used for those attempts. The following independently recounted results retain setup and shutdown traffic; HTTP 204 responses were successful logins.

| Observation | Requests | HTTP 200 | HTTP 204 | Other outcomes |
| --- | ---: | ---: | ---: | --- |
| Pre-merge promotion and restoration | 34,085 | 34,053 | 32 | None |
| Initial integration readiness | 19,072 | 19,055 | 16 | One k3s history network error |
| Four-path transport comparison | 9,322 | 9,306 | 16 | None |
| Readiness window without a merge | 56,382 | 56,350 | 32 | None |
| Integrated candidate observation | 22,175 | 22,142 | 32 | One kind Service history timeout |

Pre-merge verification passed both candidate analyses in each cluster and required four ready candidates: kind promoted in 271.285 seconds and k3s in 269.323 seconds before restoration. This did not establish later integration success. The 56,382-request window ended without a merge and changed no workloads.

The initial k3s network error occurred at 00:20:58.594 UTC on 31 October 2026. Its wire ID had no matching nginx access line. Both concurrent streams shared a host port-forward, so there was no independent Service control and no retained typed exception/socket evidence to establish the precise failure boundary. The later four-path comparison used separate host and Service sessions and retained every wire ID in nginx with zero failures. It did not reproduce or resolve the original error.

During integration, the kind Service history read dispatched at 01:06:32.462 UTC timed out after 3.004 seconds. Its wire ID matched an nginx HTTP 499 response, establishing arrival at the frontend; the underlying delay and backend attribution remain unresolved. The strict observer gate stopped traffic before baseline upgrades. Subsequent first candidate analyses failed: kind measured 0.12 requests/second, zero error ratio and 1.450 seconds mean latency; k3s measured zero throughput and empty error/latency vectors. These post-quiesce measurements are not passing candidate verification. Neither second analysis ran and neither candidate reached four ready replicas.

Both Rollouts automatically aborted and restored four ready old stable replicas. The merged recovery returned desired state to `auth-08e4a87-20261029041407`; both Applications recovered Healthy/Synced. Baseline revisions stayed kind 7 and k3s 4, frontend images stayed unchanged, and strict pre-existing-row/infrastructure comparisons passed. No application fixtures or accounts were added. Temporary observers and sessions were removed; retained resources, including the historical zero-scale k3s ReplicaSet, were preserved.

The [observer policy](../runbooks/v6-kind-progressive.md#observer-decision-policy) now separates strict setup and evidence integrity from aggregate Service errors and host diagnostics. This corrects a mismatch between the former zero-error sustained observer gate and the configured candidate error-ratio limit. It neither removes these failures nor certifies the failed integration. Candidate-specific analyses and runtime health remain separate mandatory gates.

## Release constraints

Backend-release re-verification requires green CI on the integrated test correction and fresh authenticated baselines under the observer policy and unchanged three-second request limit. Start traffic in both delivery environments and validate readiness before integrating an image change into automatically synchronized main. Require candidate-specific nonmissing analyses, the empirical observation budget and four ready candidate replicas as described in the [canary runbook](../runbooks/v6-kind-progressive.md). Baseline upgrades remain conditional on both delivery gates. The latency diagnostics do not resolve the server delay or establish a zero-downtime guarantee.
