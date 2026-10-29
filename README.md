# Request Tracker

Request Tracker is a service-request management application used to practise the full software development lifecycle: maintainable application code, automated testing, container builds, Kubernetes deployment, progressive delivery, observability, security, and recovery.

**Current functionality:** a Java 21 / Spring Boot API backed by PostgreSQL, plus a TypeScript/Vite dashboard for creating, searching, editing, and updating service requests. Docker Compose and Helm support local deployment. Local monitoring, verified Argo CD/Rollouts delivery, kind/k3s recovery exercises, and an isolated PreviewEnvironment controller are implemented; see the [release checklist](docs/release-checklist.md).

## Application

Employees can submit service requests. The dashboard supports searching the queue, editing titles and descriptions, changing priority, and advancing status from `NEW` to `IN_PROGRESS` to `RESOLVED`. Requests can be assigned to persistent active/inactive staff directory records; new assignments to inactive staff are rejected. Each request shows persistent change history for its details, status, priority, and assignment. Names are not authenticated identities.

Implemented API:

- `POST /api/requests` — create a request.
- `GET /api/requests` — list requests, newest first.
- `GET /api/requests/{id}` — retrieve a request by UUID.
- `PUT /api/requests/{id}` — update a request title and description.
- `PATCH /api/requests/{id}/status` — advance request status.
- `PATCH /api/requests/{id}/priority` — update request priority.
- `PATCH /api/requests/{id}/assignment` — assign, reassign, or unassign support staff.
- `GET /api/requests/{id}/history` — list recorded changes, newest first.
- `GET /actuator/health` — application health.
- `GET /actuator/prometheus` - application metrics in Prometheus format.

Queue and history GET responses contain `items` and `nextCursor` (null at the end), replacing the previous bare arrays. Both accept `limit` (default 25, range 1–100) and the returned `cursor`. Queue search uses `q` across all titles, descriptions, UUIDs, and assignees, case-insensitively with literal substring matching. Queue responses also contain global `counts` (`total`, `newCount`, `inProgressCount`, `resolvedCount`).

Use **Load more requests** or **Load older changes** to append pages. Search and Refresh restart from the newest results. Queue order is creation time then UUID descending; history uses descending change IDs. Cursors avoid shifts from new arrivals but do not freeze edits to search results.

A new request has a title, description, UUID, creation timestamp, and `NEW` status. Titles must be 1–120 characters and descriptions 1–2000 characters. This initial API has no authentication and is intended for local development, not public deployment.

## Metrics

Spring Boot exposes HTTP request, JVM, and runtime metrics at `/actuator/prometheus`.

This endpoint is unauthenticated and intended for local or cluster-internal monitoring. Do not expose it publicly without access controls. For the optional local collector and provisioned Grafana dashboard, see [local monitoring](docs/monitoring.md).

## Technology and roadmap

- Java 21, Spring Boot, PostgreSQL, JDBC, and Flyway migrations.
- A TypeScript/Vite dashboard with a development proxy to the Spring Boot API.
- Reproducible local development with Docker Compose.
- CI with GitHub Actions for backend verification, frontend builds, and container image builds.
- Helm deployment to local `kind`, with probes, resource limits, persistent PostgreSQL storage, ConfigMap/Secret configuration, and a ServiceAccount without API-token automount.
- Verified deployment/recovery exercises on kind and k3s; RKE2 is deferred for v0.1.0.
- Helm, Argo CD, Argo Rollouts, Prometheus, and Grafana.
- Security checks, backup/restore exercises, incident runbooks, and a small custom Kubernetes controller.

These roadmap items are not claims that the capabilities already exist. See [`docs/project-plan.md`](docs/project-plan.md).

## Run with Docker Compose

Requires Docker Desktop with Docker Compose.

Start the backend and PostgreSQL:

    docker compose up --build -d --wait

The API is available at http://localhost:8080.
Check http://localhost:8080/actuator/health for health status.

View backend logs with `docker compose logs -f app`.
Stop the containers with `docker compose down`.
PostgreSQL data remains in its named volume.
Running `docker compose down -v` deletes that data.

## Deploy to Kubernetes with kind

See [the local Kubernetes guide](docs/kind-deployment.md) for deployment, verification, dashboard access, and cleanup. Kubernetes has a database volume separate from Docker Compose.

## Run locally

Requires Java 21, Docker Desktop with Docker Compose, and an internet connection for the initial dependency downloads.

Start PostgreSQL from the repository root:

```powershell
docker compose up -d --wait postgres
```

Run verification with the database available:

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
```

Start the backend:

```powershell
.\mvnw.cmd spring-boot:run
```

The API is available at `http://localhost:8080`. Local-development database credentials are defined in `compose.yaml` and `application.properties`; override them with environment variables outside local development.

## Try the API in PowerShell

Create a request:

```powershell
$body = @{
    title = "Laptop access"
    description = "Set up access for a new employee."
} | ConvertTo-Json

$created = Invoke-RestMethod `
    -Uri "http://localhost:8080/api/requests" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

$created
```

List saved requests:

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/api/requests"
```

Retrieve the created request:

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/api/requests/$($created.id)"
```

Stop PostgreSQL when finished:

```powershell
docker compose stop postgres
```

PostgreSQL data is stored in a named Docker volume and remains after stopping the container. `docker compose down -v` deletes that volume and its data, so do not use `-v` unless you deliberately want to reset the local database.

## Automated browser workflows

With Node.js 24 and Docker Compose available, run from the repository root:

```powershell
node e2e/run.mjs
```

The command builds the backend, dashboard, and Chromium-only test image, waits for functional readiness through nginx, and runs four independent UI journeys with synthetic records. The locked Playwright package installs its matching Chromium headless shell inside the image; no host browser installation is needed. Coverage includes create/edit persistence, staff assignment and filtering, status/priority history, and queue/history pagination under new arrivals. Detailed business-rule checks remain in the backend suite.

Each run uses a random Compose project, a private network with no host ports, and a fresh PostgreSQL database in memory. It never connects to development or Kubernetes databases. Cleanup removes only that run's containers, images, network, and temporary storage, including on ordinary failure or interruption; base images/build cache remain. Docker must stay available for cleanup.

Reports are written to `test-results/browser/<run>/`. Failures retain Playwright traces, screenshots, and stack logs containing only the synthetic test environment. Database credentials are not sent through browser/API requests or copied into reports. Tests have no retries. The command preserves the failing command's exit code; cleanup failure also fails an otherwise successful run. GitHub Actions runs the same command and retains artifacts for seven days. Optional Playwright arguments can follow the command, for example `node e2e/run.mjs --grep "create and edit"`.

## Development workflow

Project work is tracked through GitHub Issues. Changes are developed on short-lived branches and submitted through pull requests that summarize the change, report the verification performed, and describe relevant risks and rollback considerations.

## License

No license has been selected yet. Until one is added, do not assume that the source is licensed for reuse.

## Web dashboard (development)

The frontend uses TypeScript and Vite and connects to the Spring Boot API through a development proxy.

Prerequisites: Java 21, Docker Desktop, and Node.js.

1. Start PostgreSQL from the project directory:

   ```powershell
   docker compose up -d --wait postgres
   ```

2. Start Spring Boot from the project directory in a terminal dedicated to the backend:

   ```powershell
   .\mvnw.cmd spring-boot:run
   ```

3. Start the frontend from the project directory in a separate terminal:

   ```powershell
   npm.cmd ci --prefix frontend
   npm.cmd run dev --prefix frontend
   ```

4. Open `http://127.0.0.1:5173`.

To build the frontend, run from the project directory:

```powershell
npm.cmd ci --prefix frontend
npm.cmd run build --prefix frontend
```

## Assignment and history

Open **Manage support staff** beside the queue to create, rename, deactivate, or reactivate directory records. Names are 1–120 characters; duplicate names are allowed and IDs distinguish records. These are not authenticated users. Use **Load more staff** for additional directory records and selector options.

Choose active staff or **Unassigned** on a request. Deactivation preserves existing assignments but blocks new ones; reassignment and unassignment remain available. The staff filter includes inactive records and combines with search and pagination. Totals remain global. Expand **Change history** to load older changes or refresh.

Staff API: `POST /api/staff` and `PUT /api/staff/{id}` accept `{"name":"Alex Support"}`; `PATCH /api/staff/{id}/active` accepts `{"active":false}` (or true). `GET /api/staff` uses `limit`/`cursor` pagination, ordered by UUID. There is no delete endpoint. Assignment now accepts `{"staffId":"UUID"}` or `{"unassign":true}` instead of a free-text name. Queue filters use `staffId=UUID` or `unassigned=true`, not both.

Migration V5 copies every non-null legacy assignment exactly into a separate inactive staff record, linked to its request. Even equal names are not merged; review and reactivate, rename, or reassign them. Blank legacy names must be renamed before activation. The old text column is replaced only after copying its values; history rows are untouched. New assignment history captures name and staff ID at change time, in the same transaction. Renaming staff updates the current display without rewriting historical values. No-op/rejected updates add no history. History starts at V3 and identifies changes, not authenticated actors or a tamper-proof audit log.

V5 requires the matching backend and dashboard; the previous free-text-assignment backend cannot run against the new schema.
