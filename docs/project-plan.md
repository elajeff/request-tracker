# Project plan

## Goal and constraints

Maintain a support-request application and study its development, testing and operation on local infrastructure. The application is a modular monolith; infrastructure serves specific learning or engineering needs. Labs use synthetic data and do not depend on paid services.

## Completed work

| Area | Reference |
| --- | --- |
| Application and tests | Request workflows, staff, history, pagination; backend and isolated browser tests in CI |
| Kubernetes | [kind](kind-deployment.md), Helm probes/limits, persistent storage and service accounts |
| Operations | [Monitoring](monitoring.md), [recovery](runbooks/local-recovery.md), [delivery](runbooks/delivery.md) |
| Distribution practice | Selected deployment/recovery checks on [k3s](runbooks/k3s.md) through k3d |
| Controller | [PreviewEnvironment](../preview-controller/README.md) lifecycle, ownership, expiry, retention and RBAC |
| Authentication | [Session/CSRF protection](authentication.md), REQUESTER/SUPPORT roles and ownership |
| Dashboard | One React/TypeScript root for sessions, requests, history and staff; browser workflows cover stale responses and session clearing |
| Milestone C | [React deployment](verification/react-deployment.md) and [authenticated canary verification](verification/canary-release.md) |

Milestone C is complete. Database migration V6 defines authentication storage; the next project release is v0.2.0. Source-only release preparation is tracked in the [release checklist](release-checklist.md).

## Remaining work

- Replace full-directory browser-memory staff search with bounded server-side search.
- Investigate unresolved transient latency and diagnostic-route network failures.
- Define SLOs from representative measurements.
- Extend configuration-error and whole-cluster recovery coverage.
- Consider RKE2 and further security labs when local capacity permits.
- Prepare source-only v0.2.0 notes and inventory; binaries/images and clean-machine bundle verification remain deferred.

## Contribution checks

Changes require clear acceptance criteria, a focused implementation, relevant tests, updated documentation and review of security and operational effects. CI and `git diff --check` must pass. Issues track work, decision records explain design choices, and runbooks describe repeatable procedures.
