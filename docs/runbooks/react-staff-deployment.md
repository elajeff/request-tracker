# React staff frontend deployment verification

Merged main: `704354cb5c4f94e580817c28487986cc09de1ffb` (approved release tree unchanged).
Source frontend revision: `b5b0ad152cbe75ced040c2ae57a2b99601d96609`.
Image on all four frontends: `request-tracker-frontend:react-b5b0ad152cbe75ced040c2ae57a2b99601d96609`.
Local build OCI index: `sha256:85f2b5195a6e48ce580dedf44c7bc6f16af08bdb01dbb15c8a199a623d4739ba`.
Verified runtime configuration digest in both nodes: `sha256:efe2fe8f937d9c96b796846d06a5043da765fd9c1bfbc59adc552ed4b667c7f2`.
Kind's running image reference uses import manifest digest `sha256:05ebf495dee45202170f2b0874bfc58302345507fe28c6594fc5fe4c8f2ecc11`; k3s reports the configuration digest directly. These runtime references identify the imported artifact, not a public registry publication.

| Cluster | Helm revision/status | Argo | Frontends |
| --- | --- | --- | --- |
| kind | 6 / deployed | Healthy/Synced at merged main | baseline 1/1, delivery 1/1 |
| k3s | 3 / deployed | Healthy/Synced at merged main | baseline 1/1, delivery 1/1 |

Argo performed the delivery frontend updates. Both reviewed baseline Helm upgrades used client-side reconciliation and reused existing values. Only the frontend image tag changed. Original Application sources and automated prune/self-heal policies are unchanged. No rollback, backend rollout, migration, account provisioning or authentication cutover occurred.

## Acceptance and failures

Chrome 156.0.8078.48 ran headless through the locked Playwright 1.64.1 package in isolated profiles. Browser checks exercised requester creation/reload/ownership restrictions, SUPPORT access, React staff creation/rename/deactivation/reactivation, assignment retention and unassignment, immutable history values, logout, and session-loss clearing.

The first kind-baseline flow completed functional assertions but the observer gate failed on a staff fetch aborted during intentional session invalidation. That run's 44 observations and failed result are retained privately outside Git. Its failed observation `cafc8b24-1f2d-42bf-9876-109ecff82ee0` remains a recorded network error; Nginx separately logged the staff GET as HTTP 401 at 15:20:31 UTC. The initial observer overwrote response status when recording request failure.

A targeted kind-baseline session-loss check captured both HTTP 401 and `net::ERR_ABORTED`, demonstrating the React unmount/AbortController cleanup sequence. The remaining three full route flows then passed. No deployment or completed staff mutation was repeated. The resumed run contains 143 browser/browser-context API observations, including four explicitly recorded 401-plus-client-abort events during deliberate session loss. Unexpected 401/network failures outside that narrow scenario still fail verification. This is evidence across the original functional run plus a targeted completion and three full resumed flows, not a claim that the original run passed.

Separate HTTP/API verification recorded 90 checks: {'200': 82, '204': 4, '401': 4}. The fresh authenticated four-route window recorded 60 HTTP 200 responses over 62.514 seconds, with no failures or retries. Expected anonymous denials are separate from availability results.

The automatic Argo rollout began before observation. Request coverage is not claimed for that earlier interval or for the baseline rolling transitions; the measured request window followed stable deployment. These results do not establish zero downtime.

## Preservation

All pre-existing requests, staff, history, account roles/enabled flags/credential fingerprints and Flyway rows matched by stable ID and every field. Backend/monitoring/PostgreSQL pod identities, images and restart counts; backend Deployment/Rollout specifications; Services; application/database Secrets; configuration; PVCs; and retained preview resources were unchanged. Helm release metadata advanced as expected. JDBC sessions changed through the planned logins/logouts.

Intentional fixtures remain listed in `browser-fixtures.json`: four new requests, four new staff records and twelve associated history entries across the two clusters; no accounts or migrations were added. Newly created staff are active and requests are unassigned at completion. Earlier synthetic request `317b3e54-2334-43c3-a52b-9383e163ff8f`, history 22 and disabled account `smoke-react-81d6a17f` were pre-existing records and remain unchanged. No fixtures were blindly deleted.

## Limits

- Deployed automated browser acceptance is now completed for the listed workflows. No manual human acceptance or video recording is claimed.
- Live directories remained below 25 records; bulk page-boundary coverage was not repeated on live data. Prior isolated pagination tests remain separate evidence. Staff search still loads the full directory into browser memory.
- At this frontend-only checkpoint V6 progressive promotion/automatic abort remained outstanding. The subsequent [kind-only Milestone C exercise](v6-kind-progressive.md#completed-approved-v6-exercise-milestone-c-closeout) completed it separately; frontend rolling updates and this API window do not establish those results.

Detailed results: `final-verification.json`, `browser-result.json`, `browser-requests.json`, `api-window.json`, before/after snapshots and per-route screenshots. No GitHub writes were performed.
