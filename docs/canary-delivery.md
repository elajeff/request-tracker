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
2. Create a SUPPORT account and a Secret with its username and password for the traffic generator (`delivery.traffic.accountSecret`, plus `delivery.traffic.enabled`). The generator signs in and keeps reading the queue, staff list and history, so the analysis always has traffic to measure.
3. Build the images, load them into kind, and apply `delivery/application.yaml`.
4. Change the backend image tag in the values file and push it. Watch it with `kubectl argo rollouts get rollout request-tracker-delivery -n request-tracker --watch`.

The repository also contains a deliberately broken backend (`delivery/fault/Dockerfile`) that returns HTTP 500 on API calls. It is only used to prove that a bad release is stopped, and is never part of a normal build. Build it with `docker build -f delivery/fault/Dockerfile -t request-tracker:<tag> .`.

A rollout can stay aborted while Git still names the bad image. Fix the image in Git rather than patching the cluster behind Argo CD's back.

## What we measured

The last full run on kind (1 November 2026), with the 2-core backend limit, the traffic generator on, and requests slower than 500 ms logged:

- A healthy release was promoted through both steps in 2 minutes 47 seconds. The analyses saw 13 requests per second at 25% and about 24 at 50%, with no errors and a mean response time of about 7 ms.
- The new backend pods started in 3.7 to 4.3 seconds. No request was slow enough to be logged.
- The traffic generator counted 7 failed requests out of about 2,800 during that rollout. The frontend has one replica and is replaced in the same sync, which is the likely cause, but I did not confirm it.
- The broken release was aborted automatically about 50 seconds after Argo CD synced, at the first analysis, when its error rate came out at 100%. The four stable replicas kept serving. While the broken pod ran, the generator counted about 520 failed requests out of 6,700.
- After the healthy tag went back into Git, the rollout was Healthy straight away, because the stable version had never changed.

I did not compare database snapshots in this run. The 30 October run did, and found requests, staff, history and accounts identical before and after.

## Known limits

- The five-minute observation budget is based on measurement, not a guarantee from Kubernetes.
- Service selectors do not switch atomically, so a rollout can briefly return 502s. Frontend pods wait 5 seconds before shutting down to reduce this. Nothing here claims zero downtime.
- Earlier runs saw a few request timeouts right after new pods started. A later load test found the backend's 0.5-core CPU limit throttled the JVM for most of its startup, and the first logins took about 1.6 s. With a 2-core limit, startup went from 12.7 s to 3 s and those logins took 0.86 s. The limit is now 2 cores. In the 1 November rollout, startup was under 4.3 s and no request was logged as slow. The exact 3-second timeouts have not been reproduced.
- The Prometheus thresholds are exercise gates, not production service-level objectives.
- Prometheus keeps two hours of data. If you want to keep results, save them elsewhere.
- Pre-login backends must never be used as a canary or rollback target; see [authentication](authentication.md#upgrading-from-the-pre-login-version).
