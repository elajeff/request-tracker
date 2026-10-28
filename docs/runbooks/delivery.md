# Local GitOps and progressive delivery

## Ownership and scope

Use context `kind-request-tracker`, namespace `request-tracker`. The Helm release `request-tracker` remains the schema-compatible fallback. Its database StatefulSet, PVC, Secret, configuration, ServiceAccount, and application resources are not adopted by Argo CD. Both application stacks share the existing database; this is not a separate test database.

Argo CD Core v3.5.6 manages only the chart's `delivery.enabled` mode, with resource names prefixed `request-tracker-delivery`. The AppProject excludes Secrets, PVCs, StatefulSets, and cluster resources. Argo Rollouts v1.10.1 owns backend ReplicaSets and the stable/canary Service hash selectors. Argo CD ignores only that hash selector field. Do not run `helm upgrade` with delivery mode enabled: Helm owns the baseline, Argo CD owns delivery desired state, and Rollouts owns rollout progression.

The ordinary chart mode remains unchanged. The delivery frontend routes to the delivery backend. Four replicas implement approximate pod-weighted 25% → 50% → 100% exposure through a ClusterIP Service, with a separate stable Service for availability checks. These are replica-based proportions, not precise request-routing guarantees. Replica-weighted canaries do not support traffic-router scale-down delays. No ingress or service mesh is installed.

One in-cluster Prometheus scrapes each backend pod every five seconds and labels metrics with its Rollout hash. Analysis uses the fully qualified Service address because the Rollouts controller runs in another namespace. Existing Compose Prometheus is independent. Analysis requires at least 0.5 candidate requests/second, less than 5% 5xx, and mean response time below one second, for three measurements at 15-second intervals after warmup. Missing vectors/traffic and NaN cannot pass. These are exercise gates, not measured production SLOs.

The optional read-only traffic deployment makes about ten requests/second against queue, staff, and saved-request history endpoints with new HTTP connections. Prometheus and Argo administrative endpoints are ClusterIP/internal only; use localhost port-forwards. Prometheus data is ephemeral (two-hour retention), so save exercise evidence outside Git.

## Bootstrap and release preparation

The host has 12 logical CPUs and about 15 GiB available to kind. `delivery/bootstrap.ps1` installs pinned upstream Core/Rollouts bundles and sizes controllers; ApplicationSet is disabled because this exercise does not use it. No Argo CD API server, dashboard, SSO, or infrastructure monitoring stack is required.

1. Complete the release/restore checks in [local recovery](local-recovery.md). Never roll back below schema V5 with an old application image.
2. Build/load the immutable application tags referenced by `delivery/values-kind.yaml` into the existing cluster. Local kind loading is a development mechanism, not a registry publication workflow.
3. Run `helm lint helm/request-tracker -f delivery/values-kind.yaml`, render both chart modes, and server-dry-run the delivery resources after installing the CRDs. Inspect resource names: none may overlap baseline resources.
4. Publish the reviewed `delivery/argocd-rollouts` branch, then apply `delivery/application.yaml` with context `kind-request-tracker`. Argo CD must fetch that branch from the actual origin; local files are not GitOps evidence.
5. Wait for Application Synced/Healthy and Rollout Healthy. Use `python delivery/observe.py --expect healthy --output target/delivery-initial.json`. Inspect actual Prometheus targets and HTTP metrics before starting a candidate.

## Exercise sequence

Prepare reviewed Git commits for baseline with traffic enabled, healthy candidate, faulty candidate, and the healthy candidate restored with traffic disabled. Advance the same published branch in order, waiting for verification between stages. The healthy candidate reuses the tested release artifact under a new immutable tag; no product feature is added by this exercise.

- Drift: scale `deployment/request-tracker-delivery-frontend` from one to two replicas. Observe OutOfSync and automatic restoration to one replica, then Synced/Healthy. Do not drift database resources.
- Healthy candidate: publish its commit and run `delivery/observe.py --expect healthy --require-availability --output target/delivery-good.json`. Require successful AnalysisRuns at both exposure stages, observed stable/canary traffic, and final stable hash equal to the candidate hash.
- Missing metrics: create an AnalysisRun using `request-tracker-delivery-http` with revision `nonexistent`. It must fail; zero traffic is not evidence of success.
- Faulty candidate: build only with `docker build -f delivery/fault/Dockerfile -t request-tracker:<unique-fault-tag> .`, then load it into kind. This isolated fixture adds an API-500 filter while leaving probes/metrics alive; it is absent from normal source/image builds. Publish its commit and run `delivery/observe.py --expect abort --require-availability --output target/delivery-bad.json`. Require failed error-rate analysis, automatic abort, a usable stable Service, and candidate scale-down.
- Restore: publish the prepared healthy desired-state commit. Require Synced/Healthy, no fault-image pods, and traffic disabled/pruned. Compare requests, staff, history, and Flyway with the pre-exercise snapshot. Disabling traffic also means a future analysis cannot pass until representative traffic is available again.

An aborted Rollout can still reference the bad desired image until Git is corrected. Do not stop at a manual abort or patch the image behind Argo CD. If Git synchronization is unavailable, pause reconciliation explicitly before emergency changes and later reconcile the reviewed stable Git state. The Helm frontend remains a fallback throughout this isolated delivery exercise.

## Evidence

Verified on 28 October 2026 against the published `delivery/argocd-rollouts` branch:

| Stage | Commit | Observed result |
| --- | --- | --- |
| Repair | `3af44db` | Healthy/Synced; four ready replicas; automated prune/self-heal restored. |
| Drift | `3af44db` | Frontend replicas 1 → 2 → 1; OutOfSync → Synced/Healthy without a manual correction. |
| Promotion | `a6853ef` | Stable/candidate replicas 3/1 → 2/2 → 0/4. Candidate share of `/api/staff` traffic measured 22.1% → 55.3% → 100%. Both Rollout-owned inline AnalysisRuns passed all three metrics, three measurements each. |
| Abort | `ed0d2b4` | Candidate 5xx ratio `[1]` exceeded the 5% gate. AnalysisRun `request-tracker-delivery-5bbd6f86f8-3-2` failed; Rollouts automatically set abort, restored four stable replicas, and scaled the fault ReplicaSet to zero. Routed traffic recorded 185 HTTP 500s. All 93 paired stable/fallback availability samples through abort passed. |
| Restore | `ab79c62` | Healthy/Synced; stable hash `84b7bcf6bc`, four ready replicas, no fault-image pods, traffic deployment pruned, automated prune/self-heal enabled. |

Final delivery backend: `request-tracker:canary-good-20261028015541`. Delivery frontend: `request-tracker-frontend:release-5ffe039-20261028015541`. Helm fallback revision 3 retains the V5-compatible `release-5ffe039-20261028015541` images.

All request, staff, and history rows and Flyway state matched the pre-exercise snapshot: five requests, two staff records, nine history entries, versions 1–5. Database Secret, PVC, StatefulSet specification, and ConfigMap identities/content were unchanged. Both application stacks passed V5 reads and readiness/liveness checks.

The initial `2f1c512` specification failed runtime validation because replica-weighted canaries reject traffic-router delay fields. The initial short Prometheus hostname also failed across namespaces. The repair removed those fields and used fully qualified Service DNS. Live baseline analysis then passed; a nonexistent revision failed with zero traffic and empty metric vectors.

Unresolved: 457 paired availability probes recorded one brief stable-Service endpoint gap during successful promotion, with no Helm fallback failure. Ten subsequent stable probes passed before the fault stage. The traffic generator also recorded connection errors during endpoint changes; HTTP analysis alone does not measure those errors. Investigation results follow below; the original diagnostics are saved in `unresolved-promotion-endpoint-gap.json` alongside the raw observations. This exercise does not establish zero-downtime promotion or production SLOs. Browser acceptance remains unverified.

Raw observations and database snapshots are outside Git at `C:\Users\DESKTOP\request-tracker-backups\20261028-015609\delivery-20261028-025205`. On 28 October 2026, `request-tracker-v5-final.dump` was restored into a separate network-isolated PostgreSQL container. Request, staff, assignment, history, and Flyway rows/checksums exactly matched the saved snapshot. The temporary container was removed; the working database and deployment were untouched. Results are saved in `final-v5-restore-verification.json`. The earlier pre-upgrade restore/migration rehearsal is documented in [local recovery](local-recovery.md).

### Endpoint-gap investigation

The bounded 28 October exercise traced Services, EndpointSlices, legacy Endpoints, pod readiness/termination, and ReplicaSet scaling. The normal route was frontend → `request-tracker-delivery` → backend; diagnostic stable-Service and API-proxy probes were counted separately. Every request used a new connection with no retry or fallback.

At 01:14:28.161Z, deletion of an outgoing pod was observed; its JVM exited within that second. Direct connection refusals began at .218Z and frontend 502s at .439Z. The main Service retained at least four ready endpoints throughout. This supports a shutdown/proxy-propagation race, not insufficient ready capacity. Kube-proxy used iptables with a one-second minimum synchronization period. The chart correction adds a five-second `preStop` delay so outgoing JVMs can serve traffic while endpoint/proxy updates propagate.

The hook must exist on outgoing pods. Installation used a separate rolling configuration update without canary steps; measured verification restored the complete strategy and both inline analyses. Failed installation requests remain included:

| Route | Baseline failures/requests | Installation | Corrected promotion | Git-state restoration | Entire exercise |
| --- | --- | --- | --- | --- | --- |
| Normal frontend | 9/2,209 | 6/788 | 0/2,216 | 0/2,327 | 15/7,844 |
| Direct main Service | 4/1,109 | 2/426 | 0/1,118 | 0/1,165 | 6/3,969 |
| Diagnostic stable Service | 11/2,172 | 13/812 | 0/2,216 | 0/2,328 | 24/7,833 |

The corrected promotion ran from 01:19:38.808Z to 01:23:22.549Z; both Rollout-owned analyses succeeded. Separately, the hashed stable Service's ready set briefly emptied at selector handoffs (observed intervals 37–108 ms). The API proxy failed 2/1,586 requests overall, including once during corrected promotion. That control-plane diagnostic limitation remains unresolved; the drain does not make Service selector changes atomic.

Publication review confirmed `/usr/bin/sh` and `/usr/bin/sleep` in the running healthy image, with no existing container lifecycle hooks. Spring Boot 4.1.2 metadata specifies graceful shutdown and a 30-second per-phase timeout; no deployment overrides were present. The chart explicitly allows 40 seconds for termination: five seconds of drain, the 30-second web shutdown budget, and five seconds of margin. This extends the prior 30-second pod default without changing application settings or replacing lifecycle behavior. The extended budget is configuration-validated; the measured promotion above used the prior pod budget. The bounded result does not guarantee interruption-free future promotions or unlimited shutdown time.

Evidence and the exercise runner are outside Git at `C:\Users\DESKTOP\request-tracker-backups\20261028-015609\endpoint-gap-20261028-031355`. Setup, review intervals, and cleanup are retained in full request totals. Application rows, Flyway state, database Secret, PVC, StatefulSet, and ConfigMap were unchanged. Cleanup restored Healthy/Synced Git revision `ab79c62`, four ready replicas, the original reconciliation policy, and the original pod template. The drain was subsequently published at `9f9faa2`. Argo CD reconciled Healthy/Synced with four ready backend replicas, each using the five-second hook and 40-second termination budget; both deployment analyses succeeded. Installation probes recorded five HTTP 502 responses in 1,894 normal-route requests, without retries, while replacing previously undrained pods. Application rows, Flyway state, Secrets, ConfigMaps, PVCs, and StatefulSet matched the pre-deployment snapshot. Publication evidence is outside Git at `C:\Users\DESKTOP\request-tracker-backups\20261028-015609\drain-publication-20261028-053405`. The diagnostic-route limitation remains unresolved. These bounded results do not guarantee zero downtime. Browser acceptance remains unverified.
