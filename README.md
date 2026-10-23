# Request Tracker

Request Tracker is a service-request management application used to practise the full software development lifecycle: maintainable application code, automated testing, container builds, Kubernetes deployment, progressive delivery, observability, security, and recovery.

**Current functionality:** a Java 21 / Spring Boot backend with a health endpoint and a PostgreSQL-backed service-request API. The frontend and operational platform capabilities remain planned until implemented.

## Application

Employees can submit service requests. Support staff will be able to review, assign, prioritize, update, and resolve them, with a clear history of changes.

Implemented API:

- `POST /api/requests` — create a request.
- `GET /api/requests` — list requests, newest first.
- `GET /api/requests/{id}` — retrieve a request by UUID.
- `GET /actuator/health` — application health.

A new request has a title, description, UUID, creation timestamp, and `NEW` status. Titles must be 1–120 characters and descriptions 1–2000 characters. This initial API has no authentication and is intended for local development, not public deployment.

## Technology and roadmap

- Java 21, Spring Boot, PostgreSQL, JDBC, and Flyway migrations.
- A TypeScript frontend after the API behavior stabilizes.
- Reproducible local development with Docker Compose.
- CI with GitHub Actions and container image builds.
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
