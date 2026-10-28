# Project Plan

## Goal

Build and maintain a useful service-request application while practising a realistic development-to-operations workflow on free, local infrastructure wherever possible.

The repository is also a learning record. Each completed milestone should have reproducible steps and evidence, such as passing tests, CI results, screenshots, logs, or a tested runbook. Do not claim an exercise was completed if it was only configured but not run.

## Constraints

- Do not depend on paid services, expiring cloud credits, paid certification exams, AI APIs, or local AI models.
- The core application and Kubernetes labs must be runnable on the developer's own computer.
- Use GitHub as the project source of truth: Issues, branches, pull requests, CI, commits, releases, and documentation.
- Prefer a modular monolith. Add infrastructure only when there is a specific learning or engineering reason.
- Keep implementation complexity appropriate to the demonstrated need; avoid unnecessary abstractions and microservices.
- Use only synthetic/demo data. Never commit credentials, tokens, real personal data, database dumps, or private configuration.

## Planned application

Request Tracker is a service-request management system for a small organization. Employees can submit a request; support staff can review, assign, prioritize, update, and resolve it. Changes to important request fields should be traceable.

The initial backend will be Java 21 with Spring Boot and PostgreSQL. A TypeScript frontend will be added after the first end-to-end API slice is working. Database schema changes will use migrations.

## Milestones

### 0. Repository and team workflow

- Create this repository with a clear README and project plan.
- Use Issues with acceptance criteria for work items.
- Use branches and pull requests for changes, including solo work; perform an explicit self-review when no peer is available.
- Add automated CI checks with the first application code.
- Maintain decision records for important choices and note actual verification results.

### 1. First working application slice

- Add a minimal Spring Boot backend and health endpoint.
- Commit the Maven wrapper so a separate Maven installation is not required.
- Add a small test set and automated CI.
- Document the local run and test commands.

### 2. Application and database

- Add PostgreSQL and versioned schema migrations.
- Implement create, list, retrieve, and status-update request workflows.
- Validate inputs and enforce business rules in the application layer.
- Add unit and integration tests for normal behavior and edge cases.
- Add the frontend after API contracts and behavior are stable.

### 3. Container and CI

- Create a reproducible container image.
- Use Docker Compose for a convenient local application/database environment.
- Run tests and image/build validation in GitHub Actions.
- Keep secrets out of source, image layers, logs, and artifacts.

### 4. Kubernetes with kind and Helm

- [x] Deploy the frontend, API, and PostgreSQL to local `kind` through Helm.
- [x] Configure probes, resource limits, Services, persistent storage, ConfigMap/Secret configuration, and a ServiceAccount without API-token automount.
- [ ] Exercise restart, configuration-error, and database-connectivity failure/recovery scenarios.

### 5. Observability and progressive delivery

- [x] Add application metrics and a local Prometheus/Grafana dashboard.
- [x] Add tested local availability, error-rate, and latency alerts.
- [ ] Define service-level objectives from measured application behavior.
- [x] Use Argo CD for GitOps synchronization and verify controlled drift reconciliation.
- [x] Use Argo Rollouts for successful canary promotion and automatic abort under measured HTTP traffic; see [delivery results](runbooks/delivery.md).
- Document a failure, diagnosis, corrective change, and recovery.

### 6. Distribution practice

- [x] Repeat selected deployment, recovery, promotion, and abort exercises on k3s; see [verified results](runbooks/k3s.md).
- Compare selected behavior with RKE2 if local resources allow.
- Record only observed differences; do not imply cloud-provider deployment unless it was actually performed.

### 7. Advanced controller and operational capstone

- Define a `PreviewEnvironment` CustomResourceDefinition and implement a small controller that reconciles preview resources.
- Test idempotency, retries, invalid specifications, status conditions, cleanup, and RBAC.
- Complete targeted CKA/CKAD/CKS-style practice labs without requiring paid exams.
- Test database backup and restore, document cluster recovery procedures, and run selected failure/security scenarios.
- Publish a final walkthrough, architecture documentation, runbooks, and a release when the product is sufficiently complete.

## Out of scope for the initial version

- Paid or always-on cloud infrastructure.
- Running EKS, AKS, and GKE concurrently.
- Microservices solely to increase the technology count.
- Kubernetes operators before the basic deployment and rollout workflow is reliable.
- Claims of production scale without measured evidence.

## Definition of done for a change

- Requirements and acceptance criteria are clear.
- The implementation is focused and reviewed for unnecessary complexity.
- Relevant tests are added or updated and actually run.
- `git diff --check` passes and no secrets or generated artifacts are included.
- Documentation and operational consequences are updated where necessary.
- The pull request records verification, remaining risks, and rollback considerations.

## Progress tracking

GitHub Issues and pull requests are the task tracker. Update this plan when a milestone is genuinely complete. Keep design rationale in `docs/decisions/` and repeatable operational procedures in `docs/runbooks/`.