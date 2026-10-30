# Authentication cutover verification

Recorded on 29 October 2026 at `74f7683`, using backend/frontend image `auth-08e4a87-20261029041407`.

## Kind

The initial Helm upgrade partially changed Deployments but failed on Service field ownership. A disposable reproduction established that client-side `--server-side=false` with reused values preserves the maintenance selector and Service identity.

- Initial attempt: 177 probes, comprising seven HTTP 200, 169 HTTP 502 and one network failure; stopped after 90.31 seconds.
- Recovery: 679 probes, including 62 HTTP 401, seven HTTP 502 and 12 network failures during maintenance. All 507 post-opening samples passed. Generated traffic returned 1,095 HTTP 200s, and all three analysis metrics passed three measurements each.
- Total maintenance lasted 20 minutes 6.402 seconds, including the interruption; probe coverage between attempts is discontinuous. The recovery execution alone took 182.6 seconds.
- Original seven requests, three staff and 26 history rows were unchanged. PostgreSQL restart count and Rollout UID were unchanged; V6 was applied.

## K3s

Initial maintenance lasted 308.100 seconds. The full probe record contained 409 samples: 287 HTTP 200, 91 HTTP 502, 18 network failures and 13 HTTP 401. All 134 post-opening samples passed; generated traffic returned 1,091 HTTP 200s and all three analysis metrics passed.

A 401 failed the gate because its phase/authentication context was ambiguous: phase was read at completion rather than dispatch. It remains a failure. Maintenance was reinstated; cached Argo health did not establish an open route.

Dispatch-attributed verification then recorded 80 requests with expected outcomes: 44 private acceptance requests, 30 authenticated queue requests over 61.642 seconds and six final checks. Its preservation gate failed because a legacy-ownerless helper was used on owned V6 rows. No ownership mutation was established, but the initial V6 snapshot was not saved, so complete comparison for that attempt is unavailable.

Finalization used a new initial snapshot and matched the prior stopped checkpoint. It preserved eight requests (four owned), two staff, 21 history entries, four accounts and six Flyway rows. Existing acceptance additions remained included. All 44 finalization requests met their expected status, including 30 queue reads over 61.908 seconds. Finalization took 98.177 seconds.

## Acceptance and final state

API checks covered CSRF, REQUESTER isolation, SUPPORT access, assignment/history, logout, account deactivation and cross-replica sessions. These were not browser or progressive-release checks. The original k3s four requests, one staff and eleven history rows survived migration. Both clusters ended Healthy/Synced with baseline 1/1 and delivery 4/4, original synchronization policy, storage, Secrets, settings and retained previews. Only expected session state changed.

Later [React browser acceptance](react-deployment.md) and [authenticated canary verification](canary-release.md) provide separate evidence. Original failures and the missing-snapshot limitation remain. No zero-downtime guarantee follows from these checks.
