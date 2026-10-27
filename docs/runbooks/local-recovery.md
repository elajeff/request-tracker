# Local recovery checks

Run against a local development deployment, using synthetic data. Keep the same Compose project name and database volume throughout. These exercises interrupt local requests; stop other development work first. Do not use `down -v`, delete a PVC, or recreate a cluster to recover from an application error.

## Docker Compose

Start the application and save a synthetic request through the dashboard or `POST /api/requests`. Record its UUID and retrieve it before and after each exercise.

1. Run `docker compose restart app`. Wait for `GET /actuator/health/readiness` to return HTTP 200 with `status: UP`, then retrieve the saved request. A connection failure while the application starts is expected.
2. Run `docker compose stop postgres`. Check `GET /actuator/health/liveness`: it should remain HTTP 200/UP. Check `GET /actuator/health/readiness`: it should return HTTP 503/DOWN. Database checks can take about 30 seconds while waiting for a connection; with curl use `--max-time 40`.
3. Always restore PostgreSQL, even if a check failed: `docker compose up -d --wait postgres`. Wait for readiness to return 200/UP, then retrieve the same request. The backend should reconnect without a restart.

Use `docker compose ps -a` and `docker compose logs --tail=100 app postgres` to diagnose failures. PostgreSQL connection-validation warnings during the outage are expected. A readiness failure routes traffic away from the service; a database outage should not require restarting an otherwise live application.

## Kubernetes follow-up

The Helm chart uses separate startup/liveness and database-aware readiness probes. Helm lint and rendering passed with Helm 3.19.0. Recovery was **not** tested on Kubernetes in the cloud development host: kind's default bridge failed because the host lacked the IPv6 filter table; an IPv4-only bridge allowed node creation, but kubelet failed because `/dev/kmsg` was absent. These are host prerequisites, not evidence of a chart defect.

On a host that supports kind, deploy using [the deployment guide](../kind-deployment.md), save a synthetic request, and record the backend pod's restart count and PostgreSQL PVC before testing:

```sh
kubectl get pods,pvc -n request-tracker
kubectl rollout restart deployment/request-tracker -n request-tracker
kubectl rollout status deployment/request-tracker -n request-tracker --timeout=180s
```

Retrieve the same request after the backend restart. For the database outage, first inspect the actual controller and record its current replica count with `kubectl get deployment,statefulset -n request-tracker`. Temporarily scale only the PostgreSQL controller to zero, observe the backend becoming unready while liveness remains healthy, then restore the recorded replica count immediately. Wait for the database and backend to become ready, and retrieve the same record without restarting the backend. Do not delete storage. Record actual results before marking the Kubernetes reliability milestone complete.

## Verified results

On 27 October 2026, the Compose exercise passed with Java 21, Spring Boot 4.1.2, and PostgreSQL 17.11. A saved request and its three history entries survived the backend restart. During a stopped-database outage, liveness returned 200/UP and readiness returned 503/DOWN. After PostgreSQL restarted on the same named volume, readiness recovered to 200/UP and the original request and history were unchanged, without another backend restart. No database volumes were removed. These results do not establish Kubernetes recovery behavior.
