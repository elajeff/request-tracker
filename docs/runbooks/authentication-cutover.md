# Authentication cutover

The release selects `auth-08e4a87-20261029041407` for `request-tracker` and `request-tracker-frontend`. Both local Linux/amd64 images contain application revision `08e4a87`; they have not been loaded into either cluster. The following cutover has not been executed.

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

The patch keeps the existing Rollout and Services. Empty canary steps select rolling-update behavior; zero replicas first remove V5 pods. `maxSurge=0`, `maxUnavailable=100%` then permit the maintenance replacement. `progressDeadlineAbort=false` prevents a timeout from automatically restoring the old V5 stable ReplicaSet. No manual abort or V5 rollback is permitted during bootstrap. These fields passed server-side dry run in both clusters; controller behavior during this cutover remains unverified. See the [canary strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/#mimicking-rolling-update) and [Rollout specification](https://argo-rollouts.readthedocs.io/en/stable/features/specification/).

## Backup, restore and V6

1. Record original request/staff/assignment/history digests, Flyway state, Secret/configuration digests, PVC identity and StatefulSet specification. Keep private snapshots outside Git. Use `pg_dump --format=custom --no-owner --no-acl` inside `request-tracker-postgresql-0` with its existing environment. Copy the binary dump with `kubectl cp`, not a Windows text pipeline. Preserve the dump and checksum under the existing external backup directory.
2. Restore into a uniquely named Docker PostgreSQL container on a private disposable network, with fresh credentials and memory-backed PGDATA. Never restore over either working database or use its PVC. Compare restored requests, staff, assignments, history and Flyway with the saved snapshot.
3. Run the new backend image's account CLI against the clone only, creating synthetic account `migration-check` through a random password environment variable. This exercises V6. Require unchanged original rows/assignments/history, null legacy owners/actors, successful V1–V6, and JDBC session tables. Remove only the disposable clone container/network in `finally`, preserving the backup and evidence.
4. After clone verification, generate independent credentials for `lab-support`, `lab-requester`, `lab-other-requester` and `lab-traffic` in each cluster. These are explicit lab account names, not inferred people. Store the local credential bundle with Windows DPAPI encryption outside Git. Create a temporary `request-tracker-auth-provision` Secret through stdin, without password arguments or logging.
5. Use the reviewed non-root provisioning Job with the immutable backend image and existing database Secret references. Supply username, role and initial password through the temporary Secret. The first SUPPORT account command applies V6 through Flyway; subsequent commands provision the remaining accounts. Require each Job to complete within 180 seconds, with `backoffLimit=0`. Existing usernames cause a stop, not a password overwrite. Do not assign legacy ownership during cutover.
6. Keep the SUPPORT traffic account credentials in new Secret `request-tracker-auth-traffic`; remove only the completed temporary provisioning Jobs/Secret. Existing database Secrets remain unchanged. Passwords are stored as BCrypt hashes; Kubernetes Secret encoding is not encryption-at-rest verification.

## In-place startup and acceptance

1. Upgrade only the existing baseline Helm release, using its captured values plus the new image tags and `backend.sessionCookieSecure=false`. `--reset-then-reuse-values` preserves release overrides while adding new chart defaults. Do not use automatic rollback to the previous V5 release. The reviewed renders change only application images and cookie configuration; PostgreSQL resources, image, settings, selectors and storage remain unchanged, so no PostgreSQL restart is intended.
2. Generate a bootstrap merge patch from the final rendered Rollout's `spec`: retain its new pod template and four replicas, but use empty steps, `maxSurge=0`, `maxUnavailable=100%` and `progressDeadlineAbort=false`. Apply it in place after confirming all V5 pods are absent. Wait at most 300 seconds for four ready V6 replicas and the V6 hash to become stable. Do not delete/recreate the Rollout or old zero-replica history.
3. On k3s, remove only the obsolete backend/frontend image Helm parameters from the live Application source, retaining its database Secret parameter. This matches `k3s/application.yaml` and allows Git release values to select the images. The repository, path, main target and value-file list stay unchanged.
4. Verify anonymous liveness/readiness and internal Prometheus scraping. Only health root, liveness, readiness and exposed Prometheus GET routes bypass login; other application-data endpoints remain protected. Check login, CSRF, requester isolation, SUPPORT operations and deactivation through both application routes, including sessions served by different backend replicas. Use disposable acceptance records and preserve all original records.
5. Both routes within one cluster intentionally share its session database and cookie. Use `127.0.0.1` for kind browser URLs and `localhost` for k3s: cookies are host-scoped, not port-scoped. Suggested loopback forwards are kind baseline/delivery `18081/18082` and k3s `28081/28082`. Do not mix hostnames between clusters. Secure cookies remain false only for these local HTTP endpoints; HTTPS deployments require true.
6. After every selected backend is V6, remove the temporary frontend selector guards for operator-owned acceptance forwards. Record timestamped normal-route probes, including every failure and the maintenance interval; do not retry failed requests or substitute diagnostic/fallback availability.

## Traffic and final reconciliation

Create one disposable request/history target with `lab-support`. Run a temporary `request-tracker-auth-traffic` ConfigMap/Deployment derived from the chart's traffic resources, with the new traffic Secret and that request UUID. Keep final Git `delivery.traffic.enabled=false`. Collect 120 seconds of normal-route counts and Prometheus samples; require no unaccounted failures. A standalone AnalysisRun against the ready V6 hash checks traffic presence, 4xx/5xx rate and latency. Missing traffic/metrics cannot pass. This is metric/traffic acceptance, not evidence of progressive promotion or automatic abort with authentication.

Prepared renders and Secret-reference Job/policy/bootstrap/traffic/analysis manifests are under `target/auth-cutover-*`, outside Git. The traffic UUID `00000000-0000-0000-0000-000000000000` and analysis revision `V6_HASH_REQUIRED` are fail-closed preparation sentinels; replace them with the newly created request UUID and observed V6 stable hash before creating those disposable resources. No Secret values are included.

After acceptance, explicitly remove only the newly created traffic Deployment/ConfigMap and AnalysisRun, leaving its account Secret for future exercises. Manually sync the reviewed main revision to restore normal canary steps, surge/unavailability settings and `progressDeadlineAbort=true`. The pod template must remain the already-stable V6 template, avoiding another image rollout. Restore each original automated-sync policy only after verifying that desired state contains the approved V6 images. Require Healthy/Synced, baseline 1/1, delivery 4/4, no V5/fault/traffic pods, V6 Flyway state, original-record preservation, and unchanged database Secrets/settings/PVCs. PostgreSQL and retained preview resources are outside the replacement scope.

## Bounded failures and rollback

Allow at most 15 minutes per cluster after maintenance starts. Stop progression on backup mismatch, migration/provisioning error, readiness timeout, unauthorized data access, missing metrics or unexplained route failures. `finally` cleans up only resources created by this cutover; it must not reopen routes or restore automation to V5 desired state. On failure, retain maintenance and reconciliation holds, preserve the database/backup/evidence, and report the exact stage.

Before the first V6 baseline is verified there is no approved older authentication image. Recovery keeps routes closed and repairs the same V6-compatible release; it does not use V5. After verification, retain this immutable backend/frontend pair as the V6-compatible fallback for later releases. A pre-V6 database restore is a separate disaster-recovery decision with possible loss of subsequent writes, not an automatic application rollback.
