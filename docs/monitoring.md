# Local monitoring

Prometheus scrapes the backend every 15 seconds. Grafana provisions a Prometheus datasource and a Request Tracker dashboard with scrape availability, HTTP traffic, 5xx rate, mean response latency, JVM memory/threads, CPU utilization, and database connections. HTTP panels exclude Actuator traffic. Rates need at least two scrapes and application traffic; idle routes can have no latency data. Latency is a mean, not a percentile.

## Start

Create a Grafana admin password file once, from the repository root. Keep it out of Git (the `.env.*` pattern is ignored).

Bash:

```sh
mkdir -m 700 .env.monitoring
(umask 022; openssl rand -hex 32 > .env.monitoring/grafana-admin-password)
chmod 644 .env.monitoring/grafana-admin-password
```

PowerShell:

```powershell
New-Item -ItemType Directory -Path .env.monitoring
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[System.IO.File]::WriteAllText((Join-Path $PWD '.env.monitoring/grafana-admin-password'), [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
$rng.Dispose()
```

Do not rerun password generation over an existing file. On Linux the secret file must be readable by Grafana (UID 472); the private parent directory limits host access to your account. On Windows restrict the directory ACL to your account. If your checkout uses a restrictive umask, make the non-secret `monitoring/` directories traversable and their configuration files readable by the containers. Start the optional overlay:

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml up -d --build --wait
```

Open Grafana on `http://127.0.0.1:3000`, sign in as `admin` with the password from the local file, and select **Dashboards → Request Tracker → Request Tracker**. Prometheus is on `http://127.0.0.1:9090`. Both ports bind to localhost; Prometheus has no authentication. These services are for local development only. Grafana retains its initial admin password in its database; changing the file after first startup does not rotate it. Use Grafana's password-change interface for rotation.

Use the dashboard to inspect requests made from the application dashboard or API. In Prometheus, query `up{job="request-tracker"}` (expected: `1`) and `http_server_requests_seconds_count{job="request-tracker"}`. The **Targets** page shows scrape errors. Check container logs if the datasource or target is unavailable:

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml logs prometheus grafana app
```

Metrics are stored in a named volume with seven-day retention. Grafana settings also persist in a named volume. To stop only monitoring:

```sh
docker compose -f compose.yaml -f compose.monitoring.yaml stop prometheus grafana
```

Do not use `down -v` to stop monitoring: it also deletes the application's database volume. The ordinary `compose.yaml` remains usable without the monitoring overlay or password file.
