# Session authentication

Login accounts and support-staff directory records are separate. There is no public registration or default account. Usernames are immutable, case-sensitive, and contain 3–64 lowercase letters, digits, dots, underscores or hyphens. Passwords use Spring Security's delegating BCrypt encoder and must contain at least 12 characters and at most 72 UTF-8 bytes.

## Permissions

| Operation | REQUESTER | SUPPORT |
| --- | --- | --- |
| Create request | Own account; MEDIUM priority | Own account; any priority |
| Queue, counts, search, filters, request and history pages | Own requests only | All requests, including ownerless legacy records |
| Edit title/description | Own requests while NEW | Any request |
| Status, priority, staff assignment | Denied | Allowed |
| Staff directory reads and changes | Denied | Allowed |

Ownership comes from the authenticated account. Unknown JSON fields, including forged owner/role fields, are rejected. Queue counts cover the account's visible dataset, independently of search/filter selection. Foreign and missing request IDs both return 404. Requester filters can narrow their own requests but cannot enumerate the staff directory.

New history events record the authenticated account ID and a username snapshot in the mutation transaction. Existing history keeps its original values and has no fabricated actor. Staff renames do not rewrite assignment history. History is not a tamper-proof audit log.

## Local provisioning

Build the application, then use its local command with the target database supplied through `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. Confirm the database before running an account operation. These commands do not start an HTTP server:

```text
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=create --accounts.username=local-support --accounts.role=SUPPORT
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=create --accounts.username=local-requester --accounts.role=REQUESTER
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=disable --accounts.username=local-requester
```

Create prompts for hidden password input in an interactive console. For automation, supply `REQUEST_TRACKER_ACCOUNT_PASSWORD` through a protected process environment and remove it afterward. Do not use password arguments, shell history, committed environment files, or log environment dumps. The command accepts no password argument. With Compose, `docker compose run --rm -it app` followed by the same `--accounts.*` options uses the configured Compose database and a hidden prompt.

Disabling an account deletes its stored sessions. Each authenticated API call also checks the current enabled flag, including sessions created on another replica. Requests already executing when an account is disabled may finish. There is no password-reset, account-renaming, role-editing, or account-reactivation API.

### Legacy ownership

V6 preserves existing requests, staff assignments and history. Existing requests have no owner and are SUPPORT-only. After independently confirming the intended owner, an operator can assign one ownerless request to an active REQUESTER:

```text
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=claim-legacy --accounts.username=local-requester --accounts.request-id=REQUEST_UUID
```

This operation cannot replace existing ownership. It records an OWNER event containing the target username and ID, with no authenticated actor: the local operator must not be falsely identified as the target account. Staff names are never used to infer ownership.

## Session and CSRF protocol

- `GET /api/session` returns the current account or null, plus `csrfToken` and `csrfHeaderName`. It creates an anonymous session when necessary and has no application-data access.
- `POST /api/session/login` accepts URL-encoded `username` and `password`, with the CSRF header. Success is 204; invalid, unknown and disabled accounts receive the same 401 message. Login rotates the session ID and CSRF token.
- Fetch `/api/session` after login to obtain the new CSRF token. Send its header on every state-changing API call, including logout.
- `POST /api/session/logout` invalidates the session and clears its cookie; success is 204.
- Missing authentication returns 401; insufficient permissions or an invalid CSRF token returns 403. The dashboard clears private state on session loss and requires a fresh login. Failed writes are not automatically retried.

Sessions are stored in PostgreSQL through Spring Session JDBC, allowing backend replicas to share them. Idle timeout is 30 minutes. `RTSESSION` is HttpOnly, SameSite=Lax, path `/`, and Secure by default. Use HTTPS when Secure is enabled. Set `SESSION_COOKIE_SECURE=false` only for local HTTP; Compose and the disposable browser harness set it explicitly. Helm exposes `backend.sessionCookieSecure` (default true); local HTTP installations require an explicit false value. Vite and nginx keep browser API requests same-origin; no CORS exceptions or JWT storage are required.

## Operational boundary

Only these operational reads bypass login: `GET /actuator/health`, `GET /actuator/health/liveness`, `GET /actuator/health/readiness`, and `GET /actuator/prometheus` when exposed. Health omits component details; the root response may list the liveness/readiness group names. Other actuator paths and operational mutations are denied. The default Helm configuration exposes health only; delivery also exposes Prometheus.

Keep these endpoints on loopback port-forwards or cluster-internal Services and restrict them at any external proxy/network boundary. nginx also forwards `/actuator/`; the authentication layer does not make operational metadata safe for public exposure. Login/session routes expose no request or staff data. No application-data endpoint is anonymous.

The optional delivery generator requires `delivery.traffic.accountSecret`, referencing a separately provisioned SUPPORT login with Secret keys `username` and `password`, and a valid `delivery.traffic.requestId`. It authenticates using sessions, counts HTTP/network failures without retrying failed requests, and logs counts only. Analysis includes 4xx and 5xx errors and excludes session/actuator traffic. Do not enable it with an old anonymous client. No authenticated Kubernetes rollout exercise is claimed by this milestone.

## Migration and deployment

The prepared [authentication cutover](runbooks/authentication-cutover.md) defines the coordinated baseline/delivery transition for kind and k3s.

V6 adds account, ownership, actor and session storage without changing V1–V5 or rewriting existing values. Back up the database before a deployment. Coordinate frontend/backend upgrades and remove all pre-authentication backends from both application routes before exposing the new release. An old V5 backend can still bypass the new authorization rules; it is not a safe security rollback or canary peer. Shared V6 session storage does not protect traffic handled by an old binary.

Roll back only to an authentication-compatible image, preserving V6 tables. Restoring a pre-V6 backup loses subsequent changes and requires an explicit recovery decision. This milestone does not deploy to the existing kind/k3s applications. Local administrator access, database access and application images remain trusted. Internet-facing brute-force protection, password recovery, MFA and TLS termination are outside this local-lab milestone.

## Verification

Run `node e2e/run.mjs` for the disposable PostgreSQL/backend/nginx/Chromium environment. It provisions random test passwords through environment variables, verifies SUPPORT and REQUESTER journeys, and removes only its randomly named Compose project. PostgreSQL uses memory-backed storage. Backend integration tests also require a disposable PostgreSQL database configured through the datasource environment variables; never point them at a development or cluster database.

Authenticated traces are disabled because they contain passwords and reusable session/CSRF material. Failures retain screenshots, JSON results, sanitized error contexts and stack logs. Test assertions remain active with zero retries. GitHub Actions uses the same browser command; local success does not establish a GitHub CI result.
