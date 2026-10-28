# Local recovery checks

Run against a local development deployment, using synthetic data. Keep the same Compose project name and database volume throughout. These exercises interrupt local requests; stop other development work first. Do not use `down -v`, delete a PVC, or recreate a cluster to recover from an application error.

## Docker Compose

Start the application and save a synthetic request through the dashboard or `POST /api/requests`. Record its UUID and retrieve it before and after each exercise.

1. Run `docker compose restart app`. Wait for `GET /actuator/health/readiness` to return HTTP 200 with `status: UP`, then retrieve the saved request. A connection failure while the application starts is expected.
2. Run `docker compose stop postgres`. Check `GET /actuator/health/liveness`: it should remain HTTP 200/UP. Check `GET /actuator/health/readiness`: it should return HTTP 503/DOWN. Database checks can take about 30 seconds while waiting for a connection; with curl use `--max-time 40`.
3. Always restore PostgreSQL, even if a check failed: `docker compose up -d --wait postgres`. Wait for readiness to return 200/UP, then retrieve the same request. The backend should reconnect without a restart.

Use `docker compose ps -a` and `docker compose logs --tail=100 app postgres` to diagnose failures. PostgreSQL connection-validation warnings during the outage are expected. A readiness failure routes traffic away from the service; a database outage should not require restarting an otherwise live application.

## Kubernetes

Use the existing deployment from [the deployment guide](../kind-deployment.md). Record the backend pod UID/restart count, PostgreSQL replicas, PVC UID/volume, database Secret identity/content, and saved request before testing. Forward directly to the backend pod so health checks remain accessible after readiness removes it from Service endpoints. Allow up to 40 seconds per readiness HTTP request: the connection pool can wait about 30 seconds when PostgreSQL is unavailable.

In PowerShell, restore the recorded replica count in `finally` even if an assertion fails:

```powershell
$k = @('--context', 'kind-request-tracker', '-n', 'request-tracker')
$replicas = kubectl @k get statefulset request-tracker-postgresql -o jsonpath='{.spec.replicas}'
if ($LASTEXITCODE -ne 0 -or $replicas -notmatch '^\d+$' -or [int]$replicas -lt 1) { throw 'Record a running database replica count first' }
$backendPod = kubectl @k get pods -l app.kubernetes.io/component=backend -o jsonpath='{.items[0].metadata.name}'
if ($LASTEXITCODE -ne 0 -or -not $backendPod) { throw 'Backend pod lookup failed' }
try {
    kubectl @k scale statefulset/request-tracker-postgresql --replicas=0
    if ($LASTEXITCODE -ne 0) { throw 'Database scale-down failed' }
    kubectl @k wait "pod/$backendPod" --for=condition=Ready=false --timeout=180s
    if ($LASTEXITCODE -ne 0) { throw 'Backend did not become unready' }
    # Through the pod port-forward, assert readiness 503/DOWN and liveness 200/UP.
    # Assert the same backend pod UID and unchanged restart count.
} finally {
    kubectl @k scale statefulset/request-tracker-postgresql "--replicas=$replicas"
    if ($LASTEXITCODE -ne 0) { throw 'Database restoration failed; restore the recorded replicas immediately' }
    kubectl @k rollout status statefulset/request-tracker-postgresql --timeout=180s
    if ($LASTEXITCODE -ne 0) { throw 'Database recovery timed out; inspect the StatefulSet' }
}
```

Wait for readiness 200/UP and the backend pod's Ready condition to recover automatically. Compare the saved request/history, all existing requests, restart count, storage, Secret, and settings with the baseline. Observe actual readiness failure; a fixed outage delay is insufficient.

## Verified results

On 27 October 2026, the Compose exercise passed with Java 21, Spring Boot 4.1.2, and PostgreSQL 17.11. A saved request and its three history entries survived the backend restart. During a stopped-database outage, liveness returned 200/UP and readiness returned 503/DOWN. After PostgreSQL restarted on the same named volume, readiness recovered to 200/UP and the original request and history were unchanged, without another backend restart. No database volumes were removed.

On 28 October 2026, the Windows/Docker Desktop kind exercise passed in context `kind-request-tracker`, namespace `request-tracker`:

- Cause: the checkout was on `feat/prometheus-metrics` (`4f76faa`), and the deployed `request-tracker:local` JAR omitted database readiness. Current main (`48ce555`) already contained `management.endpoint.health.group.readiness.include=readinessState,db`; no duplicate configuration fix was needed.
- Built and loaded `request-tracker:main-48ce555-readiness-20261028011607`; Helm release revision 2 changed only the backend image, reusing existing values. Rollout passed. All 14 backend tests passed against an isolated temporary PostgreSQL database; Helm lint/render comparison passed. The regression test controls the database health contributor to test group membership; the outage exercise separately verifies real database failure.
- Saved request `54f35b91-dbfc-4b95-9570-da8c80dd5dea` and both existing request records survived the upgrade unchanged. Its history contained zero entries after migration.
- Scaled PostgreSQL from one replica to zero. Observed readiness 503/DOWN and backend Ready=false within 32.5 seconds, with liveness 200/UP and restart count 0. This is an observation time, not a required outage duration.
- Restored PostgreSQL to one replica in `finally`. The same backend pod recovered to readiness 200/UP automatically; restart count remained 0. Saved data/history, PVC UID/volume, Secret identity/content, ConfigMap settings, and StatefulSet specification were unchanged.

Limits: this verifies a single-node local database outage and image rollout, not host reboot, node/storage loss, backup restoration, or production failover. The earlier cloud host's kind prerequisites remained unverified. Existing Helm settings still expose only `health`; monitoring behavior was outside this exercise.

## Current release acceptance (28 October 2026)

- Helm revision 3 uses `release-5ffe039-20261028015541` for both `request-tracker` and `request-tracker-frontend`. The inspected upgrade changed only these image references; database resources, Secret, PVC, and configuration identities/content were preserved.
- Custom-format backup: `C:\Users\DESKTOP\request-tracker-backups\20261028-015609\request-tracker.dump` (outside Git). Restored into a separate network-isolated PostgreSQL container, compared both original requests, and applied V4/V5 with the release image. Requests/history were preserved; Flyway reached 1–5. The source contained no assignments/history/staff; migration edge cases with populated values are covered by the staff integration tests.
- Deployed acceptance created three synthetic requests and two staff records and exercised search, filtered pagination (2 + 1), assignment/unassignment, rename snapshots, deactivation rejection, and reactivation. After a backend restart, the complete database snapshot was unchanged: five requests, two staff, nine history entries, Flyway 1–5. Readiness/liveness recovered to UP. A first check hit a transient frontend 502 during Service endpoint convergence; a repeated check with a saved snapshot and bounded retry passed. This is not zero-downtime evidence.
- The 23 application tests, frontend build, and live API checks passed before this release; unchanged application checks were not repeated. Visual browser checks remain unverified because saved browser permissions blocked the preview. Manually check loading more requests/history, combined search/staff filters, and the directory's create/rename/deactivate/reactivate controls.

For another backup, stream `kubectl --context kind-request-tracker -n request-tracker exec request-tracker-postgresql-0 -- pg_dump -U request_tracker -d request_tracker -Fc --no-owner --no-acl` directly to a **binary** file outside the repository (avoid Windows PowerShell text redirection). Restore with `pg_restore --exit-on-error --no-owner --no-acl` into a separate temporary database, then run the candidate image there before upgrading the working database.

V5 replaces the free-text assignment column. Helm rollback to revision 2 is incompatible with this schema. Prefer a forward fix or a schema-compatible image; restoring the old backup requires a separately planned database cutover and loses later writes unless reconciled. Never restore over the working database as an automatic rollback.
