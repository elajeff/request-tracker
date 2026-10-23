# Request Tracker

Request Tracker is a service-request management application used to practise the full software development lifecycle: maintainable application code, automated testing, container builds, Kubernetes deployment, progressive delivery, observability, security, and recovery.

**Current functionality:** a Java 21 / Spring Boot API backed by PostgreSQL, plus a TypeScript/Vite dashboard for creating, searching, editing, and updating service requests. Container/Kubernetes deployment and operational platform capabilities remain planned until implemented.

## Application

Employees can submit service requests. The dashboard supports searching the queue, editing titles and descriptions, changing priority, and advancing status from `NEW` to `IN_PROGRESS` to `RESOLVED`. Assignment and change history remain future work.

Implemented API:

- `POST /api/requests` — create a request.
- `GET /api/requests` — list requests, newest first.
- `GET /api/requests/{id}` — retrieve a request by UUID.
- `PUT /api/requests/{id}` — update a request title and description.
- `PATCH /api/requests/{id}/status` — advance request status.
- `PATCH /api/requests/{id}/priority` — update request priority.
- `GET /actuator/health` — application health.

A new request has a title, description, UUID, creation timestamp, and `NEW` status. Titles must be 1–120 characters and descriptions 1–2000 characters. This initial API has no authentication and is intended for local development, not public deployment.

## Technology and roadmap

- Java 21, Spring Boot, PostgreSQL, JDBC, and Flyway migrations.
- A TypeScript/Vite dashboard with a development proxy to the Spring Boot API.
- Reproducible local development with Docker Compose.
- CI with GitHub Actions for backend verification and frontend builds; container image builds remain planned.
- Kubernetes deployment using `kind`, then selected exercises on k3s and RKE2.
- Helm, Argo CD, Argo Rollouts, Prometheus, and Grafana.
- Security checks, backup/restore exercises, incident runbooks, and a small custom Kubernetes controller.

These roadmap items are not claims that the capabilities already exist. See [`docs/project-plan.md`](docs/project-plan.md).

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

## Development workflow

Work is tracked in GitHub Issues, implemented on short-lived branches, and submitted through pull requests with a summary, actual verification results, and risk/rollback notes. Keep changes small and avoid claiming checks have passed unless they were run.

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
