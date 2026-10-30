# Local recovery verification

On 27 October 2026, the Compose exercise passed with Java 21, Spring Boot 4.1.2, and PostgreSQL 17.11. A saved request and its three history entries survived the backend restart. During a stopped-database outage, liveness returned 200/UP and readiness returned 503/DOWN. After PostgreSQL restarted on the same named volume, readiness recovered to 200/UP and the original request and history were unchanged, without another backend restart. No database volumes were removed.

On 28 October 2026, the Windows/Docker Desktop kind exercise passed in context `kind-request-tracker`, namespace `request-tracker`:

- The deployed image initially omitted database readiness. Updating it to the existing database-aware health configuration passed rollout and 14 backend tests against an isolated database.
- Saved request `54f35b91-dbfc-4b95-9570-da8c80dd5dea` and both existing request records survived the upgrade unchanged. Its history contained zero entries after migration.
- Scaled PostgreSQL from one replica to zero. Observed readiness 503/DOWN and backend Ready=false within 32.5 seconds, with liveness 200/UP and restart count 0. This is an observation time, not a required outage duration.
- Restored PostgreSQL to one replica in `finally`. The same backend pod recovered to readiness 200/UP automatically; restart count remained 0. Saved data/history, PVC UID/volume, Secret identity/content, ConfigMap settings, and StatefulSet specification were unchanged.

Limits: this verifies a single-node local database outage and image rollout, not host reboot, node/storage loss, backup restoration, or production failover. Existing Helm settings still expose only `health`; monitoring behavior was outside this exercise.

## Historical V5 release acceptance (28 October 2026)

- Helm revision 3 used `release-5ffe039-20261028015541` for both `request-tracker` and `request-tracker-frontend`. The inspected upgrade changed only these image references; database resources, Secret, PVC, and configuration identities/content were preserved.
- Custom-format backup: private evidence storage (outside Git). Restored into a separate network-isolated PostgreSQL container, compared both original requests, and applied V4/V5 with the release image. Requests/history were preserved; Flyway reached 1–5. The source contained no assignments/history/staff; migration edge cases with populated values are covered by the staff integration tests.
- Deployed acceptance created three synthetic requests and two staff records and exercised search, filtered pagination (2 + 1), assignment/unassignment, rename snapshots, deactivation rejection, and reactivation. After a backend restart, the complete database snapshot was unchanged: five requests, two staff, nine history entries, Flyway 1–5. Readiness/liveness recovered to UP. A first check hit a transient frontend 502 during Service endpoint convergence; a repeated check with a saved snapshot and bounded retry passed. This is not zero-downtime evidence.
- The 23 application tests, frontend build, and live API checks passed before this release; unchanged application checks were not repeated. Manual dashboard acceptance subsequently passed. No automated browser verification was performed.
