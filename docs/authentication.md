# Authentication and permissions

Login accounts and staff records are separate things. A staff record is just a name that requests can be assigned to; it cannot log in. There is no sign-up page and no default account.

Usernames are 3-64 lowercase letters, digits, dots, underscores or hyphens, and cannot be changed. Passwords are 12 characters or more (at most 72 bytes) and stored with BCrypt.

## Permissions

| Action | REQUESTER | SUPPORT |
| --- | --- | --- |
| Create a request | Yes, always MEDIUM priority | Yes, any priority |
| View requests, history and counts | Own requests only | All requests |
| Edit title and description | Own requests, only while NEW | Any request |
| Change status, priority or assignee | No | Yes |
| View or change the staff list | No | Yes |

Request owners come from the logged-in account, never from the request body. A request that belongs to someone else returns 404, the same as one that does not exist.

## Creating accounts

Accounts are created from the command line, since there is no admin page yet. Build the jar and point it at your database with the usual `SPRING_DATASOURCE_*` variables:

```sh
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=create --accounts.username=alice --accounts.role=SUPPORT
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=disable --accounts.username=alice
```

`create` asks for the password with hidden input. For scripts, set `REQUEST_TRACKER_ACCOUNT_PASSWORD` instead; never pass it as an argument. These commands do not start the web server. With Compose, run `docker compose run --rm -it app` followed by the same options.

Disabling an account ends its sessions and rejects its next request. There is no password reset or role change yet.

### Older requests

Requests created before accounts existed have no owner, so only SUPPORT can see them. To give one to a requester:

```sh
java -jar target/request-tracker-0.0.1-SNAPSHOT.jar --accounts.action=claim-legacy --accounts.username=bob --accounts.request-id=<request uuid>
```

## Sessions and CSRF

1. `GET /api/session` returns the current user (or null) plus a CSRF token and its header name.
2. `POST /api/session/login` takes a form-encoded `username` and `password` plus the CSRF header. Success is 204. Any wrong, unknown or disabled login gets the same 401.
3. Fetch `/api/session` again after logging in, because login issues a new CSRF token.
4. Send the CSRF header on every state-changing call, including `POST /api/session/logout`.

401 means you are not signed in; 403 means you lack permission or the CSRF token is wrong.

Sessions are stored in PostgreSQL, so several backend replicas share them, and expire after 30 minutes idle. The `RTSESSION` cookie is HttpOnly, SameSite=Lax and Secure. Set `SESSION_COOKIE_SECURE=false` only for local HTTP (Helm: `backend.sessionCookieSecure`).

## Endpoints without login

Only `/api/session`, `/api/session/login` and the health endpoints (`/actuator/health`, `/liveness`, `/readiness`) are open, plus `/actuator/prometheus` when it is exposed. Keep metrics on localhost or inside the cluster.

## Upgrading from the pre-login version

Migration V6 adds the account, owner, history-actor and session tables and does not change existing data. Back up the database first. Upgrade the frontend and backend together, and remove every old backend from both routes: an old backend ignores the new permission rules, so it is not a safe canary or rollback target. Roll back only to a version that includes V6.

## Not covered

Brute-force protection, password recovery, MFA and TLS termination are out of scope for this project.
