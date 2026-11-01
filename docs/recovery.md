# Backup and recovery

Everything here is for a local deployment with synthetic data. Never use `docker compose down -v`, delete a PVC or recreate the cluster to fix an application problem; those delete the database.

## What should happen

If PostgreSQL goes away, the backend must report it without crashing:

- `/actuator/health/liveness` stays 200 (the process is fine).
- `/actuator/health/readiness` becomes 503, so traffic stops going to it.
- When PostgreSQL returns, the same backend recovers on its own, with no restart.

Readiness checks can take about 30 seconds to fail while the connection pool waits, so use a 40-second timeout.

## Docker Compose

Save a request and note its ID, then:

1. `docker compose restart app` and wait for readiness to return 200. The request should still be there.
2. `docker compose stop postgres`. Check that liveness is 200 and readiness is 503.
3. `docker compose up -d --wait postgres`, wait for readiness 200, and check the request again.

If something fails, look at `docker compose ps -a` and `docker compose logs --tail=100 app postgres`. Connection warnings during the outage are expected.

## Kubernetes

Note the backend pod name, its restart count and the saved request. Then scale the database to zero and back, restoring it even if a check fails:

```powershell
$k = @('--context', 'kind-request-tracker', '-n', 'request-tracker')
try {
    kubectl @k scale statefulset/request-tracker-postgresql --replicas=0
    kubectl @k wait pod/<backend-pod> --for=condition=Ready=false --timeout=180s
    # Port-forward to the pod: readiness should be 503, liveness 200.
} finally {
    kubectl @k scale statefulset/request-tracker-postgresql --replicas=1
    kubectl @k rollout status statefulset/request-tracker-postgresql --timeout=180s
}
```

Forward to the pod rather than the Service, because the Service stops routing to an unready pod. Afterwards the same pod should be Ready again with the same restart count, and all data should be unchanged.

When this was tried on kind, readiness dropped within about 32 seconds, the pod did not restart, and the database volume and all records were unchanged afterwards.

## Backup and restore

Stream a dump to a binary file outside the repository. Avoid PowerShell's text redirection, which corrupts binary output:

```sh
kubectl --context kind-request-tracker -n request-tracker exec request-tracker-postgresql-0 -- \
    pg_dump -U request_tracker -d request_tracker -Fc --no-owner --no-acl > backup.dump
```

Restore into a separate temporary database with `pg_restore --exit-on-error --no-owner --no-acl`, and run the new image against it before upgrading the real one.

## Rolling back

Schema migrations only go forward. V5 replaced the free-text assignee column, so an older Helm revision will not run against it, and V6 added accounts. Prefer a fix-forward or an image that is compatible with the current schema. Restoring an old backup loses everything written since, so treat it as a planned decision, never an automatic rollback.
