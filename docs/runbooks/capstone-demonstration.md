# Capstone demonstration results

## Executed segments

The 28 October 2026 walkthrough used the existing k3s lab, hardened controller image `request-tracker-preview-controller:security-20261028184215`, and a new disposable `capstone-demo` PreviewEnvironment. This is new demonstration evidence, separate from the earlier 24-check E2E run, which was not repeated. No screen recording was captured.

| Segment | Observed result |
| --- | --- |
| Application workflow | Four disposable requests and one staff record; assignment, combined search/staff filtering with pages of 2/1, and assignment history verified. Eleven HTTP calls completed without failure through the preview frontend route. |
| Database outage | Only the disposable preview database was stopped. Readiness failure was observed after 10.08 seconds; sampled liveness remained UP and the backend restart count did not increase. |
| Recovery | Nested `finally` cleanup restored the preview database and lab controller. Backend readiness recovered. Existing application databases were not stopped. |
| Isolated restore | A 9,751-byte custom-format dump restored into a separate PostgreSQL process with ephemeral storage. Requests, assignments, staff, history, and Flyway matched exactly. The temporary restore pod was removed. |
| Expiry/retention | TTL was shortened to 60 seconds measured from original CR creation. Expiry finalized and retained the preview PVC/Secret. After preserving the dump and evidence, only that disposable pair was intentionally removed. |
| Security | Impersonation denied controller access to existing application Secrets and CRD creation. A server-side dry run denied a privileged pod under restricted admission; no unsafe pod was created. |

The lab controller was paused only during the disposable database outage so ordinary drift repair would not immediately undo the outage. Its replica count was restored to one. The two pre-existing retained PVC/Secret pairs preserved their UIDs and content hashes. The existing k3s application dataset matched its before-run snapshot; kind was not modified. Both existing Argo Applications ended Healthy/Synced with their original source configurations.

Controller scripts, timestamped commands/results, stdout/stderr, API record identifiers, backup, snapshots, and security observations are outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\capstone-demo-20261028-185252`. `walkthrough.py` records the executed disposable-resource procedure; `walkthrough.json`, `independent-results.json`, `security-demonstration.json`, and `final-argo.json` contain its observations. Credential values and diagnostic dumps are not committed.

## Executed Git-published release segment

Four sequential non-force pushes advanced `elajeff/request-tracker` ? `refs/heads/demo/security-capstone-delivery` from published ancestor `e4bded1`. Only the four reviewed commits were introduced; no main update or security/capstone publication occurred. Each push followed verification of the preceding gate.

| Commit | Gate observed (UTC, 28 October 2026) | Result |
| --- | --- | --- |
| `19c76ae` | 17:05:06.767Z | Baseline Synced/Healthy, four ready replicas; rendering equivalent to the saved original desired state |
| `c61c346` | 17:09:34.933Z | Healthy candidate promoted; both owned analysis runs succeeded |
| `891b7bc` | 17:11:14.047Z | Fault revision Synced; owned error-rate analysis measured 1.0 and Rollouts automatically aborted |
| `5611dca` | 17:15:58.020Z | Stable revision Synced/Healthy with four ready replicas |

The k3s Application temporarily selected the published branch and `delivery/values-capstone.yaml` with local image parameters removed. Observations captured each exact Git revision. Healthy promotion exposed 3/1 ? 2/2 ? 0/4 stable/candidate replicas; pause samples measured 25.5% and 48.6% candidate traffic. Before the restore push, automatic abort was confirmed settled at four ready stable replicas and zero desired fault replicas. This was an actual rollout under traffic, not a standalone analysis test.

Healthy candidate: `request-tracker:capstone-good-20261028185252`. Fault candidate: `request-tracker:capstone-fault-20261028185252`. These immutable tags reuse the tested healthy and isolated-fault artifacts. Traffic used the ordinary frontend ? Service ? backend route, fresh connections, and queue/staff/saved-history reads. There were no retries or fallback responses.

| Counting window | Requests | Failed requests |
| --- | ---: | ---: |
| Baseline | 162 | 0 |
| Healthy promotion | 2,553 | 0 |
| Fault | 938 | 126 HTTP 500 |
| Git stable restoration | 2,695 | 39 HTTP 500 |
| Original-source restoration | 12 | 0 |
| Total | 6,360 | 165 HTTP 500 |

Windows begin after the preceding gate and include time awaiting publication/reconciliation. All 39 restoration-window failures occurred from 17:11:14.591Z to 17:11:30.832Z, during abort settling and before the first observation of restore commit `5611dca` at 17:12:20.060Z. They remain counted; they are not attributed to the restored healthy image. Separate stable-Service API-proxy diagnostics passed 127/127 and did not replace normal-route requests. No zero-downtime guarantee or production SLO is established.

The monitor's `finally` block restored the captured original k3s Application source after the stable Git stage. Final verification compared both Applications' original sources and reconciliation policies, the k3s Rollout specification, all application/Flyway rows, Secret/configuration digests, StatefulSet settings, storage identities, and retained preview resources. All matched their snapshots. Both Applications were Healthy/Synced at main `e4bded1`; four k3s stable replicas were ready, with no fault or traffic-generator pods. Kind and the default context were unchanged.

Final k3s backend/frontend images are `request-tracker:k3s-e4a0d80-20261028063718-good` and `request-tracker-frontend:k3s-e4a0d80-20261028063718`. Both sources again use `helm/request-tracker`, `delivery/values-kind.yaml`, and main; the original k3s-specific image/Secret parameters were restored exactly. The published demo branch remains available as release evidence, not the active deployment source.

New release evidence is outside Git in the walkthrough directory's `gitops-20261028-190147` subdirectory. It includes original/final Applications, publication commands, four gate records, analysis results, timestamped normal-route requests, ReplicaSet/traffic observations, failure counts, monitor code, and final preservation verification. Earlier kind/k3s release evidence is not substituted for this demonstration. No screen recording was captured.

## Completion criteria

- [x] Execute Git-published promotion/abort and record every failed request, including restoration-window failures.
- [x] Verify original sources, healthy stable replicas, data/resources, and absence of fault/traffic-generator pods.
- [ ] Review and integrate the security/capstone branch and final documentation through the normal manual PR process.
- [ ] Resolve the remaining roadmap scope explicitly before declaring the whole project complete: SLO definition, any unexecuted configuration-error/whole-cluster recovery exercises, certification-style labs, and final release packaging. RKE2, production security assessment, and HA storage were not performed.

Trusted images/administrators, namespace/node deletion risks, retained-data backup responsibilities, and the single-node storage limitations remain as documented in [the security review](security-capstone.md).
