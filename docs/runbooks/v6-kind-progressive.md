# Authenticated backend canary runbook

## Prerequisites

Use an authentication-compatible backend and the V6 database schema on kind. V5 backends bypass current authorization and are not valid candidates or rollback targets. Build immutable stable, healthy and isolated fault images from compatible source. Use a disposable SUPPORT account supplied through protected environment variables and a saved request/history target.

Record application data, account and Flyway rows, settings, Secret fingerprints, storage identities, retained preview resources and the complete Argo Application source/policy before starting. Keep raw evidence in private storage outside Git. The helpers cover local gates, not a portable end-to-end exercise runner. Generator traffic is bounded to 900 seconds (15 minutes); reaching that limit fails the exercise.

## Baselines and generator readiness

1. Run concurrent 120-second host frontend and in-cluster frontend Service baselines with separate sessions, `TRAFFIC_BASELINE_SECONDS=120`, a shared fresh `TRAFFIC_ATTEMPT_ID`, and `TRAFFIC_ROUTE=host` or `cluster`. Include login, session refresh, queue and history requests. Do not retry requests or substitute fallback traffic.
2. Run `python delivery/exercise_orchestration.py certify-baselines <root> <attempt-id> <frontend-service-ip>`. Require complete raw evidence, independent recounts/hashes and no unexpected outcomes.
3. Use `publish-first <commit> <root> <attempt-id> <expected-tip>` through the same script for a reviewed demo sequence. It rechecks evidence and the 60-second freshness fence immediately before one normal push. Expired evidence requires new baselines. Its reservation prevents an automatic repeat after uncertain publication.
4. Run `wait-generator <pod> <uid> <restarts> <output>`. Bounded polling waits up to 30 seconds for the atomic four-worker readiness marker and independently checks its frozen checkpoint. A traffic-failure marker or invalid ready evidence fails immediately; unavailable control evidence cannot pass.

## Promotion, abort and recovery

1. Require candidate-specific Prometheus traffic, error and latency analysis. A nonexistent revision must fail analysis; empty measurements cannot pass.
2. Observe healthy promotion using the calculated empirical budget. Require both owned analyses to pass, Argo Healthy/Synced at the candidate revision, Rollout Healthy, and exactly four desired, ready and available replicas in its owned candidate ReplicaSet. Three candidates plus one stable replica fails.
3. Require the deliberately faulty candidate to trigger automatic abort, then verify four ready stable replicas, ready stable-Service addresses and zero desired/ready fault replicas. Retain every deliberate HTTP 500 and every transport failure.
4. Quiesce the generator, stop new admission and allow the 12-second bounded drain. Capture raw NDJSON and its final summary before pruning. Run `python delivery/traffic_accounting.py <evidence-directory> --workers 4`; missing, incomplete or inconsistent final evidence fails the gate.
5. Restore the intended stable Git state and original main source/policy. Keep a separate observer active through restoration and independently validate its final evidence. Require Healthy/Synced, four ready compatible stable replicas, strict preservation checks and no fault, generator or diagnostic workloads.

On a failed gate, stop progression and restore stable service using the recorded source/policy. Do not advance to a later candidate stage to bypass a failure.

## Timing and limitations

The cached-image local-lab budget is 300 seconds: 75 seconds of pauses, 60 seconds of concurrent analysis spans, 144 seconds for four serialized startups, five seconds for synchronization, six seconds of controller margin, five seconds of probe margin and a five-second closing read. Recalculate it when the strategy or measurements change. It is an empirical observation budget, not a Kubernetes worst-case guarantee. Cap each status read to its remaining allowance and record the final boundary sample.

See [verification results](../verification/canary-release.md) for measurements, unresolved transient latency and earlier failures, and [delivery](delivery.md) for shutdown and diagnostic-route limitations. HTTP metrics alone omit transport failures; these exercises do not establish zero downtime.
