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

## Verification

See [recorded recovery checks](../verification/recovery.md) for backend/database outage results, preserved data and the historical V5 upgrade.

## Backup and rollback

For another backup, stream `kubectl --context kind-request-tracker -n request-tracker exec request-tracker-postgresql-0 -- pg_dump -U request_tracker -d request_tracker -Fc --no-owner --no-acl` directly to a **binary** file outside the repository (avoid Windows PowerShell text redirection). Restore with `pg_restore --exit-on-error --no-owner --no-acl` into a separate temporary database, then run the candidate image there before upgrading the working database.

V5 replaces the free-text assignment column. Helm rollback to revision 2 is incompatible with this schema. Prefer a forward fix or a schema-compatible image; restoring the old backup requires a separately planned database cutover and loses later writes unless reconciled. Never restore over the working database as an automatic rollback.
