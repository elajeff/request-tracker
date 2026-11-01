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

## Bad configuration

A wrong setting should stop the new pods from starting while the old ones keep serving. To test it, set `backend.slowRequestMillis` to a value that is not a number. Spring cannot turn `half-a-second` into a `long`, so the backend exits on startup and the pod goes into CrashLoopBackOff. The setting only affects the backend, so PostgreSQL is not touched.

### Normal install

```sh
helm --kube-context kind-request-tracker -n request-tracker upgrade request-tracker helm/request-tracker \
    --reuse-values --set-string backend.slowRequestMillis=half-a-second --wait --timeout 2m
helm --kube-context kind-request-tracker -n request-tracker rollback request-tracker <last good revision> --wait
```

The Deployment has one replica and the default rolling update, which rounds the unavailable pods down to zero. The old pod therefore stays until the new one is ready, which never happens. `kubectl logs` on the new pod shows the cause: `Failed to convert value of type 'java.lang.String' to required type 'long'; For input string: "half-a-second"`.

Results on kind, 1 November 2026, with a request to `/api/session` through the frontend every second:

- `helm upgrade` gave up after its 2-minute timeout and marked the revision as failed. The new pod had restarted 3 times by then.
- `helm rollback` took about a second and removed the broken pod.
- All 128 checks during the test returned 200.

### Canary

In delivery mode the same value goes through Argo CD and Argo Rollouts. To avoid committing a broken value to `main`, the test pushed it on a short-lived branch, pointed the Argo CD application at that branch, and then pointed it back:

```sh
kubectl --context kind-request-tracker -n argocd patch application request-tracker-delivery --type merge \
    -p '{"spec":{"source":{"targetRevision":"<test branch>"}}}'
# Afterwards, set targetRevision back to main the same way.
```

The canary pod never became ready, so the rollout stayed at its first step and never sent it traffic. With `progressDeadlineSeconds: 300` and `progressDeadlineAbort: true`, the rollout aborted itself.

Results on kind, 1 November 2026:

- Argo CD synced the branch 3 seconds after the patch. The rollout aborted exactly 300 seconds after it started: `ReplicaSet ... has timed out progressing`.
- The 4 stable pods kept serving the whole time. All 300 checks returned 200, and the traffic generator recorded no new failures in about 6,000 rounds.
- After pointing Argo CD back at `main`, the rollout was Healthy again in 5 seconds, because `main` matched the stable pods.

A bad value that does reach `main` is fixed the same way as a broken image: revert the commit and let Argo CD sync it.

## Backup and restore

Stream a dump to a binary file outside the repository. Avoid PowerShell's text redirection, which corrupts binary output:

```sh
kubectl --context kind-request-tracker -n request-tracker exec request-tracker-postgresql-0 -- \
    pg_dump -U request_tracker -d request_tracker -Fc --no-owner --no-acl > backup.dump
```

Restore into a separate temporary database with `pg_restore --exit-on-error --no-owner --no-acl`, and run the new image against it before upgrading the real one.

## Rolling back

Schema migrations only go forward. V5 replaced the free-text assignee column, so an older Helm revision will not run against it, and V6 added accounts. Prefer a fix-forward or an image that is compatible with the current schema. Restoring an old backup loses everything written since, so treat it as a planned decision, never an automatic rollback.
