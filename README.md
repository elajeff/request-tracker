# OpsDesk Platform Lab

OpsDesk is a service-request management application used to practise the full software development lifecycle: requirements, maintainable application code, automated testing, container builds, Kubernetes deployment, progressive delivery, observability, security, and recovery.

**Project status:** Initial repository setup. Application functionality and platform capabilities will be marked complete only after they are implemented and tested.

## Planned application

Employees will be able to submit service requests. Support staff will be able to review, assign, prioritize, update, and resolve them, with a clear history of changes.

## Planned engineering work

- Java 21 / Spring Boot backend, a TypeScript frontend, and PostgreSQL.
- Database migrations, automated tests, and documented business rules.
- Reproducible local development with Docker Compose.
- CI with GitHub Actions and container image builds.
- Kubernetes deployment using `kind` first, then selected exercises on k3s and RKE2.
- Helm, Argo CD, Argo Rollouts, Prometheus, and Grafana.
- Security checks, backup/restore exercises, incident runbooks, and a small custom Kubernetes controller.

These are roadmap items, not claims that the capabilities already exist. See [`docs/project-plan.md`](docs/project-plan.md).

## Development workflow

We use GitHub Issues to define small tasks and acceptance criteria. Work is done on short-lived branches, then submitted as pull requests with a summary, test evidence, and risk/rollback notes. Automated checks will be required as they are introduced. Changes are not described as tested unless the checks were actually run.

## Current state

The repository currently contains project planning and contribution templates. The first implementation task is tracked in GitHub Issues.

## License

No license has been selected yet. Until one is added, do not assume that the source is licensed for reuse. A license will be chosen before the project is distributed for reuse.