# Service-level objectives

Targets for how the app should behave, based on what we measured on the local cluster. This is a learning project on one node, so the numbers show how to define and check an objective. They are not a promise to anyone.

## What we measured

From the canary rerun on 1 November 2026 (see [canary delivery](canary-delivery.md#what-we-measured)), with a synthetic client sending 13 to 26 requests per second:

- no 5xx responses from the healthy backend,
- a mean response time of 6 to 7 ms,
- startup in 3.7 to 4.3 seconds with the 2-core CPU limit.

These are short runs on a laptop with a light workload. They show the targets below are reachable with a wide margin, not how the app behaves under real load.

## Objectives

| Objective | Target | Measured by |
| --- | --- | --- |
| Availability | At least 99.5% of API requests do not return 5xx | Backend metrics |
| Latency | Mean response time under 250 ms in at least 99% of 5-minute windows | Backend metrics |
| Startup | A new backend pod is ready within 30 seconds | Pod events |

Requests to `/actuator/*` are left out, as in the alerts. The login and session calls are included, because a user who cannot sign in cannot use the app.

The error budget for availability is 1 request in 200. If a 28-day window has used it up, stop shipping features until the cause is fixed.

## How to check them

Availability, as a fraction (Prometheus):

```promql
1 - (
  sum(increase(http_server_requests_seconds_count{job="request-tracker",uri!~"/actuator/.*",status=~"5.."}[7d]))
  / sum(increase(http_server_requests_seconds_count{job="request-tracker",uri!~"/actuator/.*"}[7d]))
)
```

On the canary cluster (job `request-tracker-delivery`, window `[1h]`) this read 99.04% an hour after the broken-release test, below the target, because the broken pod answered about a quarter of the requests with 500 until the rollout was aborted. The objective is doing its job: that release would have used up the budget quickly.

Mean response time over the last 5 minutes:

```promql
sum(rate(http_server_requests_seconds_sum{job="request-tracker",uri!~"/actuator/.*"}[5m]))
/ sum(rate(http_server_requests_seconds_count{job="request-tracker",uri!~"/actuator/.*"}[5m]))
```

## Limits of these objectives

- The window is 28 days, but the Compose overlay keeps 7 days of metrics and the canary's Prometheus keeps 2 hours. Use `[7d]` locally.
- Latency is a mean, because the backend does not publish a histogram. A mean hides slow outliers. Real objectives use a percentile such as the 95th, which needs `management.metrics.distribution.percentiles-histogram.http.server.requests=true`.
- The metrics come from the backend. A 502 returned by nginx while a pod is being replaced never reaches the backend, so it is not counted. Measuring at the frontend would be more honest.
- The [alerts](monitoring.md#alerts) fire at 5% errors and one second mean latency. These are early-warning thresholds well outside the objectives above, not the objectives themselves. The canary checks use the same loose thresholds as gates.
- There are no notifications, so nobody is paged when an objective is at risk.
