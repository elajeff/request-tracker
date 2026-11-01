# Canary delivery

A new backend version is rolled out gradually and checked against live metrics. If the checks fail, it is rolled back without anyone doing anything.

## How it works

- **Argo CD** watches this repository and applies the chart in delivery mode (`delivery.enabled`, with resource names prefixed `request-tracker-delivery`).
- **Argo Rollouts** runs four backend replicas and moves a new version to 25%, then 50%, then 100%. Traffic is split by replica count through a normal Service, so the percentages are approximate. There is no ingress or service mesh.
- **Prometheus** scrapes every backend pod every 5 seconds. At each step Rollouts runs an analysis and only continues if all of these hold, for three measurements 15 seconds apart:
  - at least 0.5 requests per second reach the new version,
  - less than 5% of those requests return 4xx or 5xx,
  - mean response time is under one second.
- Missing data counts as a failure, so a version that receives no traffic can never pass.
- Login and actuator requests are excluded from the numbers.

Delivery mode uses the same database as the normal Helm install. Argo CD manages only the delivery resources; the database, its volume and its Secret stay with the baseline Helm release. Do not run `helm upgrade` while delivery mode is enabled.

## Trying it

1. Install the baseline chart and bootstrap Argo (`delivery/bootstrap.ps1`; see [Kubernetes setup](kubernetes.md)).
2. Create a SUPPORT account and a Secret with its username and password for the traffic generator (`delivery.traffic.accountSecret`, plus `delivery.traffic.enabled` and a real `delivery.traffic.requestId`).
3. Build the images, load them into kind, and apply `delivery/application.yaml`.
4. Change the backend image tag in the values file and push it. Watch it with `kubectl argo rollouts get rollout request-tracker-delivery -n request-tracker --watch`.

The repository also contains a deliberately broken backend (`delivery/fault/Dockerfile`) that returns HTTP 500 on API calls. It is only used to prove that a bad release is stopped, and is never part of a normal build. Build it with `docker build -f delivery/fault/Dockerfile -t request-tracker:<tag> .`.

A rollout can stay aborted while Git still names the bad image. Fix the image in Git rather than patching the cluster behind Argo CD's back.

## What we measured

The last full run on kind (30 October 2026):

- A healthy release was promoted through both steps in about 4 minutes. Measured traffic to the new version was about 25% and 46%, with no errors.
- The broken release was aborted automatically at the first analysis, when its error rate came out at 100%. The four stable replicas kept serving and the broken pods were scaled down.
- Restoring the healthy version finished in about 4 minutes.
- Requests, staff, history and accounts were identical before and after.

## Known limits

- The five-minute observation budget is based on measurement, not a guarantee from Kubernetes.
- Service selectors do not switch atomically, so a rollout can briefly return 502s. Frontend pods wait 5 seconds before shutting down to reduce this. Nothing here claims zero downtime.
- A few request timeouts during earlier test runs were never explained. The roadmap lists this as open work.
- The Prometheus thresholds are exercise gates, not production service-level objectives.
- Prometheus keeps two hours of data. If you want to keep results, save them elsewhere.
- Pre-login backends must never be used as a canary or rollback target; see [authentication](authentication.md#upgrading-from-the-pre-login-version).

The scripts in `delivery/` check the promotion budget, count traffic and compare database snapshots. They were written for these exercises and are not a general runner.
