# Request Tracker

Support request management application built with Java 21, Spring Boot, PostgreSQL, React and TypeScript.

## Features and architecture

- Create, search, edit, prioritize, assign and resolve support requests.
- REQUESTER/SUPPORT sessions, CSRF protection and account-scoped access.
- Active/inactive staff directory, assignment validation and persistent change history.
- Cursor pagination for requests, staff and history.
- Compose/Helm deployment, Prometheus/Grafana monitoring and Argo canary delivery.
- An isolated PreviewEnvironment controller for local Kubernetes labs.

The backend is a modular monolith using JDBC and Flyway. A same-origin Vite/nginx dashboard proxies API calls to Spring Boot. React owns the complete dashboard through one application root, including authentication, the request queue, inline details/history and staff management. PostgreSQL stores application data and shared sessions.

## Development

Requirements: Java 21, Node.js 24, Docker with Compose, and internet access for initial dependency downloads. The repository includes the Maven wrapper.

To run the packaged backend and PostgreSQL:

```powershell
docker compose up --build -d --wait
```

The API listens at `http://localhost:8080`; health is at `/actuator/health`. View logs with `docker compose logs -f app`. `docker compose down` preserves the database volume; adding `-v` deletes it.

For host development, start PostgreSQL and Spring Boot:

```powershell
docker compose up -d --wait postgres
$env:SESSION_COOKIE_SECURE = "false" # Local HTTP only
.\mvnw.cmd spring-boot:run
```

Start the dashboard in another terminal:

```powershell
npm.cmd ci --prefix frontend
npm.cmd run dev --prefix frontend
```

Open `http://127.0.0.1:5173`. Build the frontend with `npm.cmd run build --prefix frontend`.

[Provision SUPPORT and REQUESTER accounts](docs/authentication.md#local-provisioning) before signing in; no default login is installed. Local database defaults are defined in `compose.yaml` and `application.properties`; override them outside development. API clients retain cookies, fetch `/api/session` before login, then fetch a new CSRF token after login for state-changing calls.

## API and data

| Resource | Operations |
| --- | --- |
| `/api/requests` | Create and list; search with `q`, filter with `staffId` or `unassigned` |
| `/api/requests/{id}` | Retrieve and edit details |
| `/api/requests/{id}/{status,priority,assignment}` | Update the selected field |
| `/api/requests/{id}/history` | Read persistent changes |
| `/api/staff` and `/api/staff/{id}` | List, create and rename staff; `/active` changes availability |
| `/api/session` | Session/CSRF bootstrap; `/login` and `/logout` manage authentication |

Queue/history pages contain `items` and `nextCursor`; `limit` defaults to 25 (range 1-100). Queue counts are account-scoped. Search and staff filters use the API; the status filter applies only to loaded requests, including appended cursor pages. New requests start at NEW and progress through IN_PROGRESS to RESOLVED. See [authentication](docs/authentication.md) for the permission matrix and [staff/history](docs/staff-management.md) for assignment rules and migration behavior.

## Testing

Run backend tests against a separate disposable PostgreSQL database configured through `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`:

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
python -m unittest discover -s delivery -p 'test_*.py'
python -m unittest discover -s preview-controller -p 'test_*.py'
node e2e/run.mjs
```

The browser command builds an isolated backend/nginx/Chromium stack with memory-backed PostgreSQL. Sixteen UI journeys cover requests, staff, pagination, ownership, session loss, delayed responses and recoverable errors. It uses synthetic credentials and records, has no retries and cleans up its own resources. Sanitized reports are written to `test-results/browser/`; authenticated traces are disabled. GitHub Actions runs backend, frontend, browser, container and chart checks.

## Deployment and documentation

- [kind deployment](docs/kind-deployment.md), [k3s lab](docs/runbooks/k3s.md) and [preview controller](preview-controller/README.md)
- [Monitoring](docs/monitoring.md), [recovery](docs/runbooks/local-recovery.md) and [security](docs/runbooks/security-capstone.md)
- [Canary delivery](docs/runbooks/delivery.md) and [authenticated canary procedure](docs/runbooks/v6-kind-progressive.md)
- [React staff verification](docs/verification/react-deployment.md), [full dashboard deployment](docs/verification/react-dashboard-deployment.md), [canary verification](docs/verification/canary-release.md), [project plan](docs/project-plan.md) and [release checklist](docs/release-checklist.md)

Metrics at `/actuator/prometheus` require no login and belong on loopback or cluster-internal routes. External exposure requires access controls.

## Limitations

This is a local-lab application with single-node storage, no production SLOs and no zero-downtime guarantee. Staff search loads the directory into browser memory. The 300-second canary observation budget is empirical; transient backend latency and diagnostic-route failures remain unresolved. Database migration V6 provides authentication storage; project release versions are separate and listed in [GitHub Releases](https://github.com/elajeff/request-tracker/releases).

## License

No license has been selected. The source is not licensed for reuse.
