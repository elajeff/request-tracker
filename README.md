# Request Tracker

A small support-request tracker. Requesters file requests; support staff triage, assign and resolve them.

Built with Java 21, Spring Boot, PostgreSQL, React and TypeScript. It started as a way to learn how a real project is built and shipped, so it also includes the deployment side: Docker, Helm, Prometheus/Grafana and canary releases on a local Kubernetes cluster.

## What it does

- Create, edit, search and filter requests, with status (New, In progress, Resolved) and priority.
- Two roles. Requesters see only their own requests. Support sees everything, manages the staff list and accounts, and assigns work.
- Every change is recorded in a per-request history.
- Cursor pagination for requests, staff and history.
- Session login with CSRF protection.

## Running it

You need Java 21, Node.js 24 and Docker. The Maven wrapper is included.

Start PostgreSQL and the backend:

```sh
docker compose up --build -d --wait
```

The API is at `http://localhost:8080`. To run the backend from source instead, start only the database and use `SESSION_COOKIE_SECURE=false` for plain HTTP:

```sh
docker compose up -d --wait postgres
SESSION_COOKIE_SECURE=false ./mvnw spring-boot:run
```

Then start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. There is no default login; [create the first support account](docs/authentication.md#creating-accounts) from the command line, then manage the rest from the dashboard.

On Windows PowerShell use `.\mvnw.cmd` and `$env:SESSION_COOKIE_SECURE = "false"`.

## Tests

```sh
./mvnw verify                 # backend; needs a disposable PostgreSQL, see below
node e2e/run.mjs              # browser tests in a throwaway Docker stack
python -m unittest discover -s preview-controller -p 'test_*.py'
```

Backend tests read `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. Point them at a separate database, never your development one. GitHub Actions runs the backend, frontend, browser, container, Helm and Prometheus rule checks.

## Project layout

| Path | Contents |
| --- | --- |
| `src/` | Spring Boot backend (modular monolith, plain JDBC, Flyway migrations) |
| `frontend/` | React + Vite dashboard, served by nginx |
| `e2e/` | Playwright browser tests |
| `helm/` | Helm chart for Kubernetes |
| `monitoring/` | Prometheus rules and Grafana dashboard |
| `delivery/` | Argo CD / Argo Rollouts canary setup and its checks |
| `preview-controller/` | A small Kubernetes controller for short-lived preview environments |
| `docs/` | Guides and design decisions |

## Deployment

Docker Compose runs PostgreSQL and the backend for local development; the dashboard runs through the Vite dev server. On Kubernetes (kind and k3s) the Helm chart deploys all three pieces, with nginx serving the dashboard. The chart has a normal mode and a delivery mode where Argo Rollouts promotes a new backend in steps (25%, 50%, 100%). Prometheus checks the error rate and latency at each step, and a bad release is aborted and rolled back automatically.

- [Kubernetes setup](docs/kubernetes.md)
- [Canary delivery](docs/canary-delivery.md)
- [Monitoring](docs/monitoring.md)
- [Backup and recovery](docs/recovery.md)
- [Preview controller](preview-controller/README.md)

## More docs

- [Authentication and permissions](docs/authentication.md)
- [Staff and request history](docs/staff-management.md)
- [Design decisions](docs/decisions/)
- [Service-level objectives](docs/slos.md)
- [Roadmap](docs/project-plan.md)

## Limitations

This is a learning project, not a production service. It runs on a single node with one database, its [service-level objectives](docs/slos.md) are only examples, and it makes no zero-downtime claim. The `/actuator/prometheus` metrics endpoint needs no login, so keep it on localhost or inside the cluster. Slow requests right after a backend pod starts were traced to a tight CPU limit; see [canary delivery](docs/canary-delivery.md#known-limits).

## License

MIT. See [LICENSE](LICENSE).
