# Roadmap

The goal is a small support-request app, plus the testing, deployment and operations work around it, all running locally on free tools with synthetic data.

## Done

- Request workflows, staff directory, history, pagination, search and server-side filtering.
- Session login, roles and per-account request ownership.
- React + TypeScript dashboard, with Playwright browser tests in CI.
- Docker Compose, Helm chart, kind and k3s deployments.
- Prometheus and Grafana monitoring with alert rules.
- Canary releases with Argo CD and Argo Rollouts, including automatic rollback.
- A preview-environment controller for short-lived test deployments.
- A full canary rerun with the 2-core CPU limit and request-timing logs: healthy release promoted in under 3 minutes, broken release aborted in about 50 seconds, no startup timeouts.
- Service-level objectives for availability, latency and startup, based on the measurements from the canary rerun.
- A bad-configuration recovery test on the normal install and through the canary: the old pods kept serving, `helm rollback` took a second and the canary aborted at its 300-second deadline.
- A whole-cluster loss test, simulated on a second kind cluster: the backup restored in 8 seconds and every row matched.
- A follow-up canary run looking for the cause of 7 failed requests: five rollouts and about 17,000 rounds with no failures, and the database identical before and after.
- A rewrite of the preview controller, tested through the full lifecycle on kind.
- An accounts page for support users: create, disable and enable accounts, change roles and reset passwords, without the command line.
- Backend and frontend cleanup: errors that carry their message, one layer of role checks, the request queue and staff list loaded through small hooks, ESLint in CI, shorter dashboard text.
- Four source releases: [v0.1.0](https://github.com/elajeff/request-tracker/releases/tag/v0.1.0), [v0.2.0](https://github.com/elajeff/request-tracker/releases/tag/v0.2.0), [v0.3.0](https://github.com/elajeff/request-tracker/releases/tag/v0.3.0) and [v0.4.0](https://github.com/elajeff/request-tracker/releases/tag/v0.4.0). The database migration number (V6) is separate from the release version.

## Next

- Nothing planned right now; see Later.

## Later

- Request comments.
- Published images and a clean-machine install check.
- RKE2 and further security exercises.

## How changes are made

Each change has a clear goal, a focused diff, tests, and updated docs. Issues track work, [decision records](decisions/) explain design choices, and the docs in this folder describe how to run things. CI must pass before merging.
