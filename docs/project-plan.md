# Roadmap

The goal is a small, well-built support-request app, plus the testing, deployment and operations work around it, all running locally on free tools with synthetic data.

## Done

- Request workflows, staff directory, history, pagination, search and server-side filtering.
- Session login, roles and per-account request ownership.
- React + TypeScript dashboard, with Playwright browser tests in CI.
- Docker Compose, Helm chart, kind and k3s deployments.
- Prometheus and Grafana monitoring with alert rules.
- Canary releases with Argo CD and Argo Rollouts, including automatic rollback.
- A preview-environment controller for short-lived test deployments.
- An accounts page for support users: create, disable and enable accounts, change roles and reset passwords, without the command line.
- Backend and frontend cleanup: errors that carry their message, one layer of role checks, the request queue and staff list loaded through small hooks, ESLint in CI, plainer dashboard text.
- Two source releases: [v0.1.0](https://github.com/elajeff/request-tracker/releases/tag/v0.1.0) and [v0.2.0](https://github.com/elajeff/request-tracker/releases/tag/v0.2.0). The database migration number (V6) is separate from the release version.

## Next

- Rerun a full canary with the higher CPU limit and request-timing logs on, to confirm the startup timeouts are gone.
- Define service-level objectives from real measurements.
- Cover more recovery cases: bad configuration, whole-cluster loss.

## Later

- Request comments.
- Published images and a clean-machine install check.
- RKE2 and further security exercises.

## How changes are made

Each change has a clear goal, a focused diff, tests, and updated docs. Issues track work, [decision records](decisions/) explain design choices, and the docs in this folder describe how to run things. CI must pass before merging.
