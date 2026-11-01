# Monitoring

An optional Docker Compose overlay adds Prometheus and Grafana. Prometheus scrapes the backend's `/actuator/prometheus` every 15 seconds. Grafana comes with a Request Tracker dashboard showing scrape availability, HTTP traffic, 5xx rate, mean response time, JVM memory and threads, CPU and database connections. Actuator traffic is left out of the HTTP panels. Latency is a mean, not a percentile, and rates need at least two scrapes and some traffic.

## Start it

Create a Grafana admin password file once. It is git-ignored (`.env.*`). Do not run this again over an existing file.

```sh
mkdir -m 700 .env.monitoring
(umask 022; openssl rand -hex 32 > .env.monitoring/grafana-admin-password)
chmod 644 .env.monitoring/grafana-admin-password
```

On Windows, create the folder and write a random hex string to `.env.monitoring/grafana-admin-password`, and restrict the folder to your user.

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml up -d --build --wait
```

- Grafana: `http://127.0.0.1:3000`, user `admin`, password from the file. Open **Dashboards > Request Tracker**.
- Prometheus: `http://127.0.0.1:9090` (no login). Check that `up{job="request-tracker"}` is 1.

Both ports are bound to localhost only; this setup is for local development. Grafana keeps its first admin password in its database, so changing the file later does not change it. Use Grafana's own password page.

Metrics are kept for seven days in a named volume. To stop monitoring without touching the app, run `docker compose -f compose.yaml -f compose.monitoring.yaml stop prometheus grafana`. Do not use `down -v`; it also deletes the app's database.

## Alerts

| Alert | Fires when | For |
| --- | --- | --- |
| RequestTrackerUnavailable | The metrics target is down or missing | 1 min |
| RequestTrackerHighErrorRate | More than 5% of requests return 5xx | 5 min |
| RequestTrackerSlowResponses | Mean response time is over 1 second | 5 min |

The two traffic alerts need at least 0.1 requests per second over five minutes, so a single stray request on an idle dev machine does not trigger them. No notifications are configured; the alerts only show on Prometheus's Alerts page. The thresholds are development defaults. An unavailable target could be a dead app or a failed scrape, so check the target error and the app logs.

CI tests the rules with promtool. To run the same check locally:

```sh
docker run --rm --entrypoint /bin/promtool -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" \
    -w /etc/prometheus prom/prometheus:v3.10.0 test rules alerts.test.yml
```
