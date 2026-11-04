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
- Actuator requests and everything under `/api/session` (sign-in, sign-out and session reads) are excluded from the numbers.

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
- The traffic generator counted 7 failed requests out of about 2,800 during that rollout. It only printed totals then, so the cause was not recorded. The follow-up run below could not reproduce them.
- The broken release was aborted automatically about 50 seconds after Argo CD synced, at the first analysis, when its error rate came out at 100%. The four stable replicas kept serving. While the broken pod ran, the generator counted about 520 failed requests out of 6,700.
- After the healthy tag went back into Git, the rollout was Healthy straight away, because the stable version had never changed.

I did not compare database snapshots in this run. The 30 October run did, and found requests, staff, history and accounts identical before and after.

### Follow-up run, 2 November 2026

This run looked for the cause of the 7 failures. The traffic generator now prints one line per failed request, with its path and the HTTP status or error. Each rollout went through a short-lived test branch that Argo CD was pointed at, so `main` never named a test tag. The branch was deleted afterwards.

Five rollouts, each changing one thing that differed from the 1 November run:

| Rollout | Backend and frontend | Traffic rounds | Failed |
| --- | --- | --- | --- |
| Same images under a new tag | cleanup → cleanup | about 3,600 | 0 |
| Down to the 30 October build | cleanup → 30 Oct | about 3,600 | 0 |
| Up to the cleanup build, as on 1 November | 30 Oct → cleanup | about 3,600 | 0 |
| Traffic generator switched on in the same sync, as on 1 November | cleanup → cleanup | about 2,800 | 0 |
| Back to `main` | cleanup → cleanup | about 3,600 | 0 |

- Every rollout was promoted in 2 minutes 51 seconds to 3 minutes 1 second.
- The frontend's single replica was replaced in every rollout. The old nginx pod returned 200 for every request it served, then shut down cleanly. The one-replica frontend was the suspected cause, but that is ruled out for these runs.
- The overnight steady state before the run had no failures in about 214,000 rounds.
- The database check from the [recovery guide](recovery.md#losing-the-whole-cluster) gave identical results before and after all five rollouts.

The 1 November failures are still unexplained. They were not repeated in about 17,000 rounds under the same conditions. If they come back, the generator's log now says which call failed and why.

### Timeout bursts, 2 November 2026

With steady traffic later that day, the generator logged 40 failed requests out of about 137,000. 21 of them came while the database pod restarted for a chart upgrade, which is expected. The other 19 came in four short bursts, and each burst hit all four workers at the same moment.

- In each burst every backend pod logged slow requests at the same second, with almost the same duration, up to about 4 seconds. Outside the bursts the mean response time was about 6 ms.
- CPU use in the Docker VM stayed around 1.5%, and garbage collection pauses were short, so the backend was not overloaded.
- During a burst the database connections were waiting for the write-ahead log to be flushed to disk. Spring Session updates the session row on every API call, reads included, so every request waits for that flush.
- The bursts matched times when Docker images were being built, or kind clusters created and loaded, on the same machine.

I reproduced it by creating a throwaway kind cluster and loading an image into it while the generator ran. The database waited 1 to 2 seconds for each flush, and requests on all backend pods took 1.1 to 2.2 seconds in those same seconds. They stayed under the generator's 3-second timeout that time, so nothing failed. Writing a 4 GB file with a forced flush in a plain container did not cause it; the longest wait was 0.29 seconds.

So the bursts come from heavy Docker work slowing the shared Docker Desktop disk, not from the app. The 1 November failures may have the same cause, but that cannot be shown: the image builds and loads for that run finished about three minutes before the rollout started, and nothing else heavy was recorded during it.

## Known limits

- The five-minute observation budget is based on measurement, not a guarantee from Kubernetes.
- Service selectors do not switch atomically, so a rollout can briefly return 502s. Frontend pods wait 5 seconds before shutting down to reduce this. Nothing here claims zero downtime.
- Earlier runs saw a few request timeouts right after new pods started. A later load test found the backend's 0.5-core CPU limit throttled the JVM for most of its startup, and the first logins took about 1.6 s. With a 2-core limit, startup went from 12.7 s to 3 s and those logins took 0.86 s. The limit is now 2 cores. In the 1 November rollout, startup was under 4.3 s and no request was logged as slow. The exact 3-second timeouts have not been reproduced.
- Building images or creating kind clusters on the same machine can stall the database's disk writes for a few seconds, which slows every request at once (see the timeout bursts above). A stall during an analysis could fail the mean response time check, so avoid heavy Docker work while a rollout is being measured.
- The Prometheus thresholds are exercise gates, looser than the [service-level objectives](slos.md).
- The canary backend runs Flyway migrations against the shared database when it starts, before any analysis. A failed or aborted canary does not undo a migration.
- Sign-in requests are excluded from the analysis, and the traffic workers sign in only once, so a canary that breaks sign-in would not be caught.
- Prometheus keeps two hours of data. If you want to keep results, save them elsewhere.
- Pre-login backends must never be used as a canary or rollback target; see [authentication](authentication.md#upgrading-from-the-pre-login-version).
