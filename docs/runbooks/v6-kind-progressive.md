# Authenticated backend canary runbook

## Prerequisites

Use an authentication-compatible backend and the V6 database schema on kind. V5 backends bypass current authorization and are not valid candidates or rollback targets. Build immutable stable, healthy and isolated fault images from compatible source. Use a disposable SUPPORT account supplied through protected environment variables and a saved request/history target.

Record application data, account and Flyway rows, settings, Secret fingerprints, storage identities, retained preview resources and the complete Argo Application source/policy before starting. Keep raw evidence in private storage outside Git. The helpers cover local gates, not a portable end-to-end exercise runner. Generator traffic is bounded to 900 seconds (15 minutes); reaching that limit fails the exercise.

## Baselines and generator readiness

1. Run concurrent 120-second host frontend and in-cluster frontend Service baselines with separate sessions, `TRAFFIC_BASELINE_SECONDS=120`, a shared fresh `TRAFFIC_ATTEMPT_ID`, and `TRAFFIC_ROUTE=host` or `cluster`. Include login, session refresh, queue and history requests. Do not retry requests or substitute fallback traffic.
2. Save the current `request-tracker-delivery-http` AnalysisTemplate as private JSON with `kubectl -n request-tracker get analysistemplate request-tracker-delivery-http -o json` in the selected context. Run `python delivery/exercise_orchestration.py certify-baselines <root> <attempt-id> <frontend-service-ip> --analysis-template <analysis.json>`. Require successful authentication/setup, complete raw evidence and independent recounts/hashes. Service workload reads must satisfy the observer policy below; host workload outcomes remain diagnostic.
3. Use `publish-first <commit> <root> <attempt-id> <expected-tip> --analysis-template <analysis.json>` through the same script for a reviewed demo sequence. It rechecks evidence and the 60-second freshness fence immediately before one normal push. Expired evidence requires new baselines. Its reservation prevents an automatic repeat after uncertain publication.
4. Run `wait-generator <pod> <uid> <restarts> <output>`. Bounded polling waits up to 30 seconds for the atomic four-worker readiness marker and independently checks its frozen checkpoint. A traffic-failure marker or invalid ready evidence fails immediately; unavailable control evidence cannot pass.

## Observer decision policy

Run independent Service and host workers with separate sessions and wire IDs. Authenticate all four workers and verify their CSRF/session refresh and initial queue reads before transition. A setup or authentication failure on either path stops preparation without a retry. The frozen readiness checkpoint remains strict; an expired baseline cannot be reused. Recheck the captured AnalysisTemplate against the active configuration before publication.

The Service application-read error ratio is unexpected completions divided by all completed sustained queue, staff and history reads. Setup reads are retained separately and excluded; acceptance checks and their expected denials must use separate evidence and cannot be mixed into a release stream. Every timeout, connection/network failure and unexpected HTTP status counts as an error. Session bootstrap, login and refresh are excluded from this denominator and must always succeed; HTTP 401 or a client/harness error is fatal. Read the strict upper bound from the AnalysisTemplate's `error-rate.successCondition`; do not introduce a second threshold or an allowed-error count. Zero traffic, missing/NaN ratios, or a ratio equal to or above the configured limit fails. Accepted ratios retain their individual failures in raw evidence and summaries.

Host port-forward workload streams are diagnostics and do not independently decide candidate health. Retain typed exceptions, dispatch/completion and available connection/socket timings, plus port-forward start/stop times, stdout/stderr and exit state. Investigate correlated Service, nginx/backend, readiness and candidate-metric failures through their authoritative gates. Keep host and Service evidence separate; host success cannot replace missing Service traffic.

During observation, use `observation_checkpoint` on copied raw evidence for provisional stop decisions. It does not authorize progression or replace final draining, recounts and hash validation. The generator's `traffic-failure.json` now means fatal setup/authentication/client failure; sustained application-read errors remain in raw records and `workload.errors`/`workload.errorRatio`, and the controller must evaluate their aggregate rather than watching that marker alone. No request is retried or replaced by fallback traffic.

The final `health.json` must contain measured boolean results for `argoHealthySynced`, `rolloutHealthy`, `stableAvailable`, `candidateMetricsPassed` and `fourCandidatesReady`. Derive them from current status reads, both current owned candidate analyses with nonmissing finite measurements, and `promotion_ready`; do not populate them from observer ratios. All must be true. Readiness loss, unavailable stable service, unhealthy Rollouts or failed analyses stops progression regardless of an acceptable observer ratio. Candidate throughput, error and latency gates and the strict four-ready-candidate budget remain unchanged.

New summaries include workload completion/error counts and their ratio. The final validator independently recomputes those values, validates every worker's authentication and binds its frozen readiness checkpoint to the same run and raw prefix, and requires every start to have a completion. Missing, corrupt, inconsistent or changed evidence fails. Historical evidence remains unchanged; this policy does not retroactively pass a stopped attempt.

## Promotion, abort and recovery

1. Require candidate-specific Prometheus traffic, error and latency analysis. A nonexistent revision must fail analysis; empty measurements cannot pass.
2. Observe healthy promotion using the calculated empirical budget. Require both owned analyses to pass, Argo Healthy/Synced at the candidate revision, Rollout Healthy, and exactly four desired, ready and available replicas in its owned candidate ReplicaSet. Three candidates plus one stable replica fails.
3. Require the deliberately faulty candidate to trigger automatic abort, then verify four ready stable replicas, ready stable-Service addresses and zero desired/ready fault replicas. Retain every deliberate HTTP 500 and every transport failure.
4. Quiesce every stream, stop new admission and allow the 12-second bounded drain. Capture raw NDJSON and final summaries before pruning. Run `python delivery/traffic_accounting.py <evidence-directory> --workers 4` for integrity/authentication validation, then `python delivery/exercise_orchestration.py evaluate-observers <service-directory> <host-directory> --analysis-template <analysis.json> --health <health.json>` for the final release decision. Preserve the JSON output and every individual failure. An intentional fault-stage abort is verification of rejection, not a passing release decision.
5. Restore the intended stable Git state and original main source/policy. Keep a separate observer active through restoration and independently validate its final evidence. Require Healthy/Synced, four ready compatible stable replicas, strict preservation checks and no fault, generator or diagnostic workloads.

On a failed gate, stop progression and restore stable service using the recorded source/policy. Do not advance to a later candidate stage to bypass a failure.

## Timing and limitations

The cached-image local-lab budget is 300 seconds: 75 seconds of pauses, 60 seconds of concurrent analysis spans, 144 seconds for four serialized startups, five seconds for synchronization, six seconds of controller margin, five seconds of probe margin and a five-second closing read. Recalculate it when the strategy or measurements change. It is an empirical observation budget, not a Kubernetes worst-case guarantee. Cap each status read to its remaining allowance and record the final boundary sample.

See [verification results](../verification/canary-release.md) for measurements, unresolved transient latency and earlier failures, and [delivery](delivery.md) for shutdown and diagnostic-route limitations. HTTP metrics alone omit transport failures; these exercises do not establish zero downtime.
