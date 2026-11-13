# Authentication and permissions

Login accounts and staff records are separate things. A staff record is just a name that requests can be assigned to; it cannot log in. There is no sign-up page and no default account.

Usernames are 3-64 lowercase letters, digits, dots, underscores or hyphens, start with a letter or digit, and cannot be changed. Passwords are 12 characters or more (at most 72 bytes) and stored with BCrypt.

## Permissions

| Action | REQUESTER | SUPPORT |
| --- | --- | --- |
| Create a request | Yes, MEDIUM priority only (anything else gets 403) | Yes, any priority |
| View requests, history and counts | Own requests only | All requests |
| Edit title and description | Own requests, only while NEW | Any request |
| Change status, priority or assignee | No | Yes |
| View or change the staff list | No | Yes |
| Manage login accounts | No | Yes |

Request owners come from the logged-in account, never from the request body. A request that belongs to someone else returns 404, the same as one that does not exist.

## Managing accounts

SUPPORT users manage accounts from **Manage accounts** on the dashboard, or through the API:

| Call | Body |
| --- | --- |
| `GET /api/accounts?q=&limit=&cursor=` | |
| `POST /api/accounts` | `{"username": "alice", "role": "SUPPORT", "password": "..."}` |
| `PATCH /api/accounts/{username}/enabled` | `{"enabled": false}` |
| `PATCH /api/accounts/{username}/role` | `{"role": "REQUESTER"}` |
| `PUT /api/accounts/{username}/password` | `{"password": "..."}` |

- Disabling an account, changing its role or resetting its password ends that account's sessions. A session keeps the role it logged in with, so this is what makes a role change take effect.
- At least one enabled SUPPORT account must always exist. A change that would remove the last one is refused with 409, from the page, the API or the command line.
- On the dashboard you cannot disable or demote your own account. You can reset your own password, which signs you out.
- Passwords are never returned. Search matches usernames and ignores case, and results are ordered by username.

## Creating accounts

The first SUPPORT account has to come from the command line, because everything above needs someone signed in. The command line also works if you are locked out. Build the jar and point it at your database with the usual `SPRING_DATASOURCE_*` variables:

```sh
java -jar target/request-tracker.jar --accounts.action=create --accounts.username=alice --accounts.role=SUPPORT
java -jar target/request-tracker.jar --accounts.action=disable --accounts.username=alice
java -jar target/request-tracker.jar --accounts.action=enable --accounts.username=alice
```

`create` asks for the password with hidden input. For scripts, set `REQUEST_TRACKER_ACCOUNT_PASSWORD` instead; never pass it as an argument. These commands do not start the web server. With Compose, run `docker compose run --rm -it app` followed by the same options.

The command line can create, disable and enable accounts. Resetting a password and changing a role are done from the dashboard.

### Older requests

Requests created before accounts existed have no owner, so only SUPPORT can see them. To give one to a requester:

```sh
java -jar target/request-tracker.jar --accounts.action=claim-legacy --accounts.username=bob --accounts.request-id=<request uuid>
```

## Sessions and CSRF

1. `GET /api/session` returns the current user (or null) plus a CSRF token and its header name.
2. `POST /api/session/login` takes a form-encoded `username` and `password` plus the CSRF header. Success is 204. Any wrong, unknown or disabled login gets the same 401.
3. Fetch `/api/session` again after logging in, because login issues a new CSRF token.
4. Send the CSRF header on every state-changing call, including `POST /api/session/logout`.

401 means you are not signed in; 403 means you lack permission or the CSRF token is wrong.

Sessions are stored in PostgreSQL, so several backend replicas share them, and expire after 30 minutes idle. The `RTSESSION` cookie is HttpOnly, SameSite=Lax and Secure. Set `SESSION_COOKIE_SECURE=false` only for local HTTP (Helm: `backend.sessionCookieSecure`).

## Endpoints without login

Only `/api/session`, `/api/session/login` and the health endpoints (`/actuator/health`, `/liveness`, `/readiness`) are open, plus `/actuator/prometheus` when it is exposed. The nginx frontend returns 404 for `/actuator`, so these are only reachable on the backend port. Keep that port on localhost or inside the cluster.

## Upgrading from the pre-login version

Migration V6 adds the account, owner, history-actor and session tables and does not change existing data. Back up the database first. Upgrade the frontend and backend together, and remove every old backend from both routes: an old backend ignores the new permission rules, so it is not a safe canary or rollback target. Roll back only to a version that includes V6.

## Not covered

Brute-force protection, self-service password recovery, MFA and TLS termination are out of scope for this project.
