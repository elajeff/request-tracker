# Authentication cutover

The release selects `auth-08e4a87-20261029041407` for `request-tracker` and `request-tracker-frontend`. Both local Linux/amd64 images contain application revision `08e4a87`. Execution results and remaining limitations are recorded below.

## Resource scope

| Setting | kind | k3s |
| --- | --- | --- |
| Context | `kind-request-tracker` | `k3d-request-tracker-k3s` |
| Kubeconfig | Existing default file; explicit context | `target/k3s-practice/kubeconfig.yaml` |
| Namespace | `request-tracker` | `request-tracker` |
| Argo Application | `argocd/request-tracker-delivery` | `argocd/request-tracker-delivery` |
| Source | `main`, `helm/request-tracker`, `delivery/values-kind.yaml` | Same; `postgresql.existingSecret=request-tracker-k3s-db` |
| Helm release | `request-tracker`, revision 3 before cutover | `request-tracker`, revision 1 before cutover |
| Database Secret | `request-tracker-db` | `request-tracker-k3s-db` |
| PostgreSQL | `request-tracker-postgresql`, database `request_tracker` | Same names, separate instance and database |
| PVC | `data-request-tracker-postgresql-0`, class `standard` | Same name, separate PVC, class `local-path` |

In each cluster the baseline route is `request-tracker-frontend:80` → `request-tracker:8080`; delivery is `request-tracker-delivery-frontend:80` → `request-tracker-delivery:8080`. Both backends share only that cluster's database. The stable/canary Services remain diagnostic/controller resources. Helm owns the baseline and database; Argo owns delivery resources; Rollouts owns backend ReplicaSets and hash selectors. Neither Application manages the database, PVC or Secrets.

## Preconditions and maintenance

1. Require successful PR CI, including artifact sanitization, and published, reviewed release values. Inspect current live specifications against the preparation snapshot. Stop on unexpected images, routes, storage, source overrides or active sync operations.
2. Import both exact local images into the existing kind cluster with `kind load docker-image ... --name request-tracker`, and into `request-tracker-k3s` with the installed k3d `image import --cluster request-tracker-k3s`. Verify node image identities. k3d is the local helper; the distribution remains k3s.
3. Save each Application's complete original source/policy and both Helm release manifests/values outside Git. Set only `spec.syncPolicy.automated.enabled=false` before either authentication PR is merged into main. Preserve prune/self-heal settings. This prevents main reconciliation and self-heal from undoing maintenance overrides. Do not stop either controller or pause the Rollout controller.
4. Resolve the reviewed main merge revision after manual integration. Render from that revision and compare it with the reviewed release render. Extra changes require review before proceeding.
5. Work on one cluster at a time. Stop only its application port-forwards; leave the existing host development JVM alone. Add selector `request-tracker.dev/maintenance=authentication` to both frontend Services, recording their original selectors. Existing port-forwards must stop because they can retain a direct pod connection despite Service selector changes. No ingress or public route is introduced.
6. Scale baseline Deployment `request-tracker` to zero. Merge-patch Rollout `request-tracker-delivery` with [authentication-maintenance.json](../../delivery/authentication-maintenance.json). Wait at most 120 seconds for every old backend pod to terminate. All application writers must stop before the final backup.

The patch keeps the existing Rollout and Services. Empty canary steps select rolling-update behavior; zero replicas first remove V5 pods. `maxSurge=0`, `maxUnavailable=100%` then permit the maintenance replacement. `progressDeadlineAbort=false` prevents a timeout from automatically restoring the old V5 stable ReplicaSet. No manual abort or V5 rollback is permitted during bootstrap. The cutover verified these fields in place without replacing either Rollout. See the [canary strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/#mimicking-rolling-update) and [Rollout specification](https://argo-rollouts.readthedocs.io/en/stable/features/specification/).

## Backup, restore and V6

1. Record original request/staff/assignment/history digests, Flyway state, Secret/configuration digests, PVC identity and StatefulSet specification. Keep private snapshots outside Git. Use `pg_dump --format=custom --no-owner --no-acl` inside `request-tracker-postgresql-0` with its existing environment. Copy the binary dump with `kubectl cp`, not a Windows text pipeline. Preserve the dump and checksum under the existing external backup directory.
2. Restore into a uniquely named Docker PostgreSQL container on a private disposable network, with fresh credentials and memory-backed PGDATA. Never restore over either working database or use its PVC. Compare restored requests, staff, assignments, history and Flyway with the saved snapshot.
3. Run the new backend image's account CLI against the clone only, creating synthetic account `migration-check` through a random password environment variable. This exercises V6. Require unchanged original rows/assignments/history, null legacy owners/actors, successful V1–V6, and JDBC session tables. Remove only the disposable clone container/network in `finally`, preserving the backup and evidence.
4. After clone verification, generate independent credentials for `lab-support`, `lab-requester`, `lab-other-requester` and `lab-traffic` in each cluster. These are explicit lab account names, not inferred people. Store the local credential bundle with Windows DPAPI encryption outside Git. Create a temporary `request-tracker-auth-provision` Secret through stdin, without password arguments or logging.
5. Use the reviewed non-root provisioning Job with the immutable backend image and existing database Secret references. Supply username, role and initial password through the temporary Secret. The first SUPPORT account command applies V6 through Flyway; subsequent commands provision the remaining accounts. Require each Job to complete within 180 seconds, with `backoffLimit=0`. Existing usernames cause a stop, not a password overwrite. Do not assign legacy ownership during cutover.
6. Keep the SUPPORT traffic account credentials in new Secret `request-tracker-auth-traffic`; remove only the completed temporary provisioning Jobs/Secret. Existing database Secrets remain unchanged. Passwords are stored as BCrypt hashes; Kubernetes Secret encoding is not encryption-at-rest verification.

## In-place startup and acceptance

1. Upgrade only the existing baseline Helm release, using its captured values plus the new image tags and `backend.sessionCookieSecure=false`. Use explicit `--server-side=false`: the maintenance selector is managed by `kubectl-patch`, which conflicts with Helm server-side apply. `--reset-then-reuse-values` preserves release overrides while adding new chart defaults. Do not use automatic rollback to the previous V5 release. The reviewed renders change only application images and cookie configuration; PostgreSQL resources, image, settings, selectors and storage remain unchanged, so no PostgreSQL restart is intended.
2. Generate a bootstrap merge patch from the final rendered Rollout's `spec`: retain its new pod template and four replicas, but use empty steps, `maxSurge=0`, `maxUnavailable=100%` and `progressDeadlineAbort=false`. Apply it in place after confirming all V5 pods are absent. Wait at most 300 seconds for four ready V6 replicas and the V6 hash to become stable. Do not delete/recreate the Rollout or old zero-replica history.
3. On k3s, remove only the obsolete backend/frontend image Helm parameters from the live Application source, retaining its database Secret parameter. This matches `k3s/application.yaml` and allows Git release values to select the images. The repository, path, main target and value-file list stay unchanged.
4. Verify anonymous liveness/readiness and internal Prometheus scraping. Only health root, liveness, readiness and exposed Prometheus GET routes bypass login; other application-data endpoints remain protected. Check login, CSRF, requester isolation, SUPPORT operations and deactivation through both application routes, including sessions served by different backend replicas. Use disposable acceptance records and preserve all original records.
5. Both routes within one cluster intentionally share its session database and cookie. Use `127.0.0.1` for kind browser URLs and `localhost` for k3s: cookies are host-scoped, not port-scoped. Suggested loopback forwards are kind baseline/delivery `18081/18082` and k3s `28081/28082`. Do not mix hostnames between clusters. Secure cookies remain false only for these local HTTP endpoints; HTTPS deployments require true.
6. After every selected backend is V6, complete acceptance through operator-owned pod forwards while both frontend selector guards remain closed. Remove the guards only after acceptance passes. Record timestamped normal-route probes, including every failure and the maintenance interval; do not retry failed requests or substitute diagnostic/fallback availability.

## Traffic and final reconciliation

Create one disposable request/history target with `lab-support`. Run a temporary `request-tracker-auth-traffic` ConfigMap/Deployment derived from the chart's traffic resources, with the new traffic Secret and that request UUID. Keep final Git `delivery.traffic.enabled=false`. Collect 120 seconds of normal-route counts and Prometheus samples; require no unaccounted failures. A standalone AnalysisRun against the ready V6 hash checks traffic presence, 4xx/5xx rate and latency. Missing traffic/metrics cannot pass. This is metric/traffic acceptance, not evidence of progressive promotion or automatic abort with authentication.

Prepared renders and Secret-reference Job/policy/bootstrap/traffic/analysis manifests are under `target/auth-cutover-*`, outside Git. The traffic UUID `00000000-0000-0000-0000-000000000000` and analysis revision `V6_HASH_REQUIRED` are fail-closed preparation sentinels; replace them with the newly created request UUID and observed V6 stable hash before creating those disposable resources. No Secret values are included.

After acceptance, explicitly remove only the newly created traffic Deployment/ConfigMap and AnalysisRun, leaving its account Secret for future exercises. Manually sync the reviewed main revision to restore normal canary steps, surge/unavailability settings and `progressDeadlineAbort=true`. The pod template must remain the already-stable V6 template, avoiding another image rollout. Restore each original automated-sync policy only after verifying that desired state contains the approved V6 images. Require Healthy/Synced, baseline 1/1, delivery 4/4, no V5/fault/traffic pods, V6 Flyway state, original-record preservation, and unchanged database Secrets/settings/PVCs. PostgreSQL and retained preview resources are outside the replacement scope.

## Bounded failures and rollback

Allow at most 15 minutes per cluster after maintenance starts. Stop progression on backup mismatch, migration/provisioning error, readiness timeout, unauthorized data access, missing metrics or unexplained route failures. `finally` cleans up only resources created by this cutover; it must not reopen routes or restore automation to V5 desired state. On failure, retain maintenance and reconciliation holds, preserve the database/backup/evidence, and report the exact stage.

Before the first V6 baseline is verified there is no approved older authentication image. Recovery keeps routes closed and repairs the same V6-compatible release; it does not use V5. After verification, retain this immutable backend/frontend pair as the V6-compatible fallback for later releases. A pre-V6 database restore is a separate disaster-recovery decision with possible loss of subsequent writes, not an automatic application rollback.

## Execution evidence: 29 October 2026

The reviewed release tree matches merged main `74f76833fbd683e541b245d480d810ea8bd12b3e`. Immutable backend/frontend tags are `auth-08e4a87-20261029041407`.

Helm `v4.3.1+gc0d08d0` initially failed kind revision 4 because server-side apply conflicted with `kubectl-patch` ownership of the frontend Service selector. The upgrade was partial: baseline Deployments changed before the Service failed. Captured Helm values/manifests and live snapshots identified the actual state. A disposable release reproduced the conflict; an actual `--server-side=false` upgrade preserved its Service UID and maintenance selector. No force-conflicts, ownership takeover or resource replacement was used. The successful baseline upgrade used:

```text
helm --kube-context kind-request-tracker -n request-tracker upgrade request-tracker helm/request-tracker --server-side=false --reset-then-reuse-values --set backend.image.tag=auth-08e4a87-20261029041407 --set frontend.image.tag=auth-08e4a87-20261029041407 --set backend.sessionCookieSecure=false --wait --timeout 180s
```

Evidence is outside Git under `C:/Users/DESKTOP/request-tracker-backups/`:

- `auth-repair-20261029-075800`: failed-release snapshots and disposable selector/ownership verification.
- `authentication-kind-20261029-053946`: final pre-V6 backup, successful isolated restore/V6 rehearsal, and all 177 first-attempt probes (7 HTTP 200, 169 HTTP 502, 1 network failure). The attempt stopped after 90.31 seconds and retained maintenance.
- `authentication-kind-20261029-055859`: successful recovery, authenticated acceptance, cross-replica sessions and analysis. Its 679 probes include 62 HTTP 401, 7 HTTP 502 and 12 network failures during maintenance; all 507 samples after reopening succeeded. Generated traffic recorded 1,095 HTTP 200 responses and no failures. All three analysis metrics passed with three successful measurements each.

Kind maintenance began at 05:39:46.871 UTC; routes reopened at 05:59:53.273 UTC, a 20-minute 6.402-second interval including the stopped attempt and approval hold. Probe coverage is discontinuous between attempts. The recovery execution completed in 182.6 seconds; this is not the total maintenance duration. Helm revision 5 is deployed. The original 7 requests, 3 staff records and 26 history entries remain unchanged; V6 is applied. PostgreSQL restart count and Rollout UID are unchanged.

Acceptance covered both application routes: ownership isolation, role restrictions, CSRF, rejected owner injection, request edits, staff assignment, search/filter pagination, history values/actors, legacy SUPPORT-only access, logout and account deactivation. A shared session was accepted by each of four delivery replicas. Anonymous health and Prometheus access remained functional. Expected 4xx security checks are recorded separately from maintenance probe failures. These are API/session checks, not a new browser acceptance run or authenticated progressive-promotion/abort exercise.

### k3s stopped verification

`authentication-k3s-20261029-060343` contains its independent final backup, exact isolated restore/V6 rehearsal, acceptance and stopped-state verification. Its original 4 requests, 1 staff record and 11 history entries remain unchanged. V1-V6 are applied; PostgreSQL restart count, Rollout UID, existing Secrets/configuration/PVCs and retained preview resources are unchanged. Helm revision 2 is deployed using the same explicit client-side upgrade flags, with `--kubeconfig target/k3s-practice/kubeconfig.yaml --kube-context k3d-request-tracker-k3s`.

Maintenance began at 06:03:45.137 UTC and routes opened after acceptance at 06:08:53.237 UTC (308.100 seconds). All 134 samples after opening succeeded; generated normal-route traffic recorded 1,091 HTTP 200 responses and no failures. All three analysis metrics passed. The complete probe record contains 409 samples: 287 HTTP 200, 91 HTTP 502, 18 network failures and 13 HTTP 401. No sample was retried or removed.

The final gate stopped at 06:11:08.388 UTC after one HTTP 401 was recorded with completion time 06:06:19.568 UTC and phase `authenticated acceptance`. Its phase attribution is ambiguous: the sampler selected its client before dispatch but read the phase after completion. Dispatch time, request identity and expected authentication state were not recorded. Preserve this response as a failure; neither its authentication context nor its phase can be reconstructed conclusively. It must not be retroactively marked successful or definitively assigned to the pre-opening phase. The original 409 samples and all failure counts remain unchanged.

At the stopped checkpoint, the failed gate re-applied both maintenance selectors and left automated synchronization disabled. Both frontend Services had zero ready endpoints. Four V6 delivery replicas remained ready, and the Application source targeted the reviewed main with only the original database Secret parameter retained. Its last sync succeeded at `74f7683`; maintenance creates intentional live drift, so cached Healthy/Synced status does not demonstrate an open application route. Temporary provisioning/traffic resources and the standalone AnalysisRun were removed; the traffic credential Secret and encrypted local account bundle remain. The execution stopped within 444.86 seconds, below its 15-minute bound. No V5 image was restored.

Recovery requires request-dispatch attribution and a distinct post-opening window, followed by bounded authenticated verification before restoring the original automated-sync policy. Do not repeat migrations or create the existing accounts again. The current immutable V6 image pair is the repair/fallback version; V5 images remain incompatible rollback peers.

### Attributed verification window

`delivery/route_probe.py` records a UUID, dispatch/completion timestamps, phase at dispatch, expected authentication state, expected/observed status and outcome. It retains no bodies, credentials, cookies, tokens or exception contents. An authenticated 401 fails without phase filtering. Run its focused tests with `python -m unittest discover -s delivery -p test_route_probe.py -v`; four tests passed, including a request crossing a phase boundary.

Evidence: `authentication-k3s-verification-20261029-062234` under the external backup directory. Private acceptance completed 44 requests through the deployed frontends while both Service guards remained closed. Checks covered valid SUPPORT/REQUESTER sessions, ownership/history isolation, SUPPORT directory/legacy access, requester write restrictions, anonymous denials, probes, Prometheus and cross-route session reuse. Fourteen expected negative checks passed.

All private requests completed and their forwards stopped before opening a distinct Service-forwarded window. From 06:24:11.175 UTC, 30 authenticated queue requests completed over 61.642 seconds: 16 SUPPORT and 14 REQUESTER, all HTTP 200. No request was retried or inherited from the private phase. After automation was restored, six additional frontend/session/API availability checks all returned HTTP 200.

The final preservation gate stopped at 06:25:25.725 UTC: it incorrectly reused a pre-V6 legacy helper on a snapshot containing four already-owned V6 test requests, triggering `Legacy ownership changed`. This does not establish an ownership mutation. The runner was corrected locally to save the V6 baseline and compare complete snapshots directly; that correction has not been rerun. Read-only stopped-state checks confirmed the original pre-cutover records, existing Secrets/settings/PVCs, retained preview resources, PostgreSQL restart count and Rollout UID remain unchanged. Exact comparison of every V6 row against this attempt's initial snapshot was not completed.

Both routes were closed again and automation disabled. There were no unexpected HTTP failures among the 80 recorded requests; the failed preservation gate remains a separate verification failure. Four V6 delivery replicas are ready, the source remains main `74f7683`, and both frontend Services have zero ready endpoints. The attempt stopped in 171.197 seconds. Kind was unchanged; no migration, restore, provisioning or deployment step was repeated. Original evidence and failure counts remain intact. Complete the corrected preservation gate and bounded route finalization before reopening k3s and restoring automation; do not rerun the full cutover.

### Completed k3s finalization

`delivery/preservation.py` compares identity sets and every row field, independently of row order. Owner links, assignment links, historical values/actors, missing fields and unexpected records are compared exactly. Seven focused fixtures passed with `python -m unittest discover -s delivery -p test_preservation.py -v`: unchanged owned/ownerless records pass; ownership changes, missing/extra/duplicate records, altered history and removed fields fail.

Evidence: `authentication-k3s-finalization-20261029-063928`. The previous attempt's initial V6 snapshot was never saved and cannot be reconstructed. This attempt saved its own initial snapshot before login or reopening and matched every application row against the previous attempt's saved stopped-state checkpoint. Existing acceptance additions (4 requests, 1 staff record, 10 history entries and V6) are listed by ID and remain included in strict comparison. No application records were created or changed during finalization.

The same gates passed while closed and after reopening: 8 requests (4 ownerless, 4 owned), 2 staff records, 21 history entries, 4 accounts and 6 Flyway rows. Account roles, enabled flags and credential fingerprints were unchanged. Only `spring_session` and `spring_session_attributes` are expected to change during login/access/expiry; aggregate counts changed from 8 to 10 sessions and 14 to 18 attributes after two authenticated logins. No session identifiers, attributes, cookies or tokens were captured. Disabled/unknown session principals and orphan attributes remained zero.

Routes reopened once at approximately 06:39:48.810 UTC. The distinct window started at 06:39:50.175 UTC after private requests completed: 30 authenticated queue requests over 61.908 seconds, all HTTP 200, without retries or inherited requests. Original automated reconciliation (`prune=true`, `selfHeal=true`) was restored; six final frontend/session/API checks returned HTTP 200. All 44 requests in this attempt met their expected status. Finalization completed at 06:41:06.186 UTC in 98.177 seconds.

Both frontend Services have one ready endpoint and no maintenance selector. Baseline backend/frontends are 1/1, delivery is 4/4, and Argo is Healthy/Synced at `74f76833fbd683e541b245d480d810ea8bd12b3e`, tracking main with the retained database Secret parameter. Existing Secrets/settings/PVCs, retained preview resources, PostgreSQL restart count, Rollout UID and original evidence hashes are unchanged. Helm remains revision 2. No migration, restore, provisioning, workload replacement or kind operation was repeated.

Earlier acceptance evidence is reused. No new authenticated dashboard browser check or authenticated progressive-promotion/automatic-abort exercise was performed; the earlier manual dashboard acceptance remains recorded. The original ambiguous 401 and every earlier failure count remain failures in their original evidence.
