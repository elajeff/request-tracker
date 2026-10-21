# ADR 0001: Start as a modular monolith

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The project needs to demonstrate maintainable application development and the delivery/operations workflow without making infrastructure itself the main obstacle. It is maintained initially by one student and must remain possible to run locally for free.

## Decision

Start with one Spring Boot application and PostgreSQL. Keep clear boundaries between the API, business rules, persistence, and integration concerns. Add a separate frontend when the first API workflow is stable. Deploy the application as a container to local Kubernetes before adding extra controllers or supporting more distributions.

## Consequences

- Local development, testing, and debugging stay approachable.
- Database transactions and business rules can be tested without coordinating several services.
- The same container and Helm chart can be reused for cluster-distribution exercises.
- Separate services or additional infrastructure can be introduced later only when a demonstrated requirement justifies them.
- This choice does not imply that the application is already implemented or deployed.