# Pre-authentication delivery verification

The results below are historical pre-authentication exercises. The current authenticated V6 successor completed on kind on 30 October 2026; see [Milestone C closeout](canary-release.md) for healthy promotion, automatic abort, all traffic counts, empirical timing limits and final main-based restoration. Its 657 injected HTTP 500s and every earlier timeout/network failure remain recorded. V5 images listed in historical evidence are not current rollback targets.

Recorded on 28 October 2026:

| Stage | Observed result |
| --- | --- |
| Repair | Healthy/Synced; four ready replicas; automated prune/self-heal restored. |
| Drift | Frontend replicas 1 → 2 → 1; OutOfSync → Synced/Healthy without a manual correction. |
| Promotion | Stable/candidate replicas 3/1 → 2/2 → 0/4. Candidate share of `/api/staff` traffic measured 22.1% → 55.3% → 100%. Both Rollout-owned inline AnalysisRuns passed all three metrics, three measurements each. |
| Abort | Candidate 5xx ratio `[1]` exceeded the 5% gate. AnalysisRun `request-tracker-delivery-5bbd6f86f8-3-2` failed; Rollouts automatically set abort, restored four stable replicas, and scaled the fault ReplicaSet to zero. Routed traffic recorded 185 HTTP 500s. All 93 paired stable/fallback availability samples through abort passed. |
| Restore | Healthy/Synced; stable hash `84b7bcf6bc`, four ready replicas, no fault-image pods, traffic deployment pruned, automated prune/self-heal enabled. |

Historical delivery backend: `request-tracker:canary-good-20261028015541`. Delivery frontend: `request-tracker-frontend:release-5ffe039-20261028015541`. Helm fallback revision 3 retained the V5-compatible `release-5ffe039-20261028015541` images.

All request, staff, and history rows and Flyway state matched the pre-exercise snapshot: five requests, two staff records, nine history entries, versions 1–5. Database Secret, PVC, StatefulSet specification, and ConfigMap identities/content were unchanged. Both application stacks passed V5 reads and readiness/liveness checks.

The initial specification failed runtime validation because replica-weighted canaries reject traffic-router delay fields. The initial short Prometheus hostname also failed across namespaces. The repair removed those fields and used fully qualified Service DNS. Live baseline analysis then passed; a nonexistent revision failed with zero traffic and empty metric vectors.

Unresolved: 457 paired availability probes recorded one brief stable-Service endpoint gap during successful promotion, with no Helm fallback failure. Ten subsequent stable probes passed before the fault stage. The traffic generator also recorded connection errors during endpoint changes; HTTP analysis alone does not measure those errors. Investigation results follow below; the original diagnostics are saved in `unresolved-promotion-endpoint-gap.json` alongside the raw observations. This exercise does not establish zero-downtime promotion or production SLOs. Manual dashboard acceptance passed; no automated browser verification was performed.

Raw observations and database snapshots are retained privately outside Git. On 28 October 2026, `request-tracker-v5-final.dump` was restored into a separate network-isolated PostgreSQL container. Request, staff, assignment, history, and Flyway rows/checksums exactly matched the saved snapshot. The temporary container was removed; the working database and deployment were untouched. Results are saved in `final-v5-restore-verification.json`. The earlier pre-upgrade restore/migration rehearsal is documented in [local recovery](../runbooks/local-recovery.md).

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

The running healthy image contains `/usr/bin/sh` and `/usr/bin/sleep`. No container lifecycle hooks existed before the drain correction. Spring Boot 4.1.2 metadata specifies graceful shutdown and a 30-second per-phase timeout; no deployment overrides were present. The chart explicitly allows 40 seconds for termination: five seconds of drain, the 30-second web shutdown budget, and five seconds of margin. This extends the prior 30-second pod default without changing application settings or replacing lifecycle behavior. The extended budget is configuration-validated; the measured promotion above used the prior pod budget. The bounded result does not guarantee interruption-free future promotions or unlimited shutdown time.

Evidence and the exercise runner are retained privately outside Git. Setup, review intervals, and cleanup are retained in full request totals. Application rows, Flyway state, database Secret, PVC, StatefulSet, and ConfigMap were unchanged. Cleanup restored Healthy/Synced, four ready replicas, the original reconciliation policy, and the original pod template. Argo CD reconciled Healthy/Synced with four ready backend replicas, each using the five-second hook and 40-second termination budget; both deployment analyses succeeded. Installation probes recorded five HTTP 502 responses in 1,894 normal-route requests, without retries, while replacing previously undrained pods. Application rows, Flyway state, Secrets, ConfigMaps, PVCs, and StatefulSet matched the pre-deployment snapshot. The diagnostic-route limitation remains unresolved. These bounded results do not guarantee zero downtime. Manual dashboard acceptance passed; no automated browser verification was performed.
