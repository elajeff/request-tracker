# Full React dashboard deployment verification

Verified on 30 October 2026 at main `aaef01663c93a792965bdd81bd85479cc7c8d427`. PR #37 and the merged main CI passed. All four frontends use `request-tracker-frontend:react-dashboard-fc9e818ac52b-20261030-072600`, built from source `fc9e818ac52bc4dbb90b66a90fba545c1b90a4e7`.

Configuration digest: `sha256:075fa525f91c5d0f4d0c9331f2ba323e5a471beed8e39d599b093ea9949ee43c`. Both runtimes contain the same eleven filesystem layers, chain `sha256:1d0a834d2217e5e66ea7141b7c0feebdeeb5627ffcfc22483f39e1815dcfc4d4`. Kind reports the imported manifest as its running image identity; k3s reports the configuration digest. These references identify the same prepared artifact.

| Cluster | Baseline Helm | Argo | Frontends |
| --- | --- | --- | --- |
| kind | Revision 7, deployed | Healthy/Synced at verified main | Baseline 1/1, delivery 1/1, prepared image |
| k3s | Revision 4, deployed | Healthy/Synced at verified main | Baseline 1/1, delivery 1/1, prepared image |

Delivery reconciled through existing automation. Baseline upgrades reused values and used client-side Helm reconciliation. Only the frontend image changed; no rollback was required.

## Deployed acceptance

Chrome 156.0.8078.48 exercised both frontend Services in each cluster using separate browser contexts and cluster hostnames. Checks covered login/logout, session restoration and invalidation, requester creation and permitted editing, ownership isolation, SUPPORT status/priority/assignment changes, queue search, staff and loaded-page status filters, request details/history, staff rename/deactivation/reactivation and assignment-history consistency. Backend 401/403/404 denials remained authoritative. Session loss cleared protected content and staff state.

The completed functional run retained 195 browser/API observations: 151 HTTP 200, 16 HTTP 204, eight HTTP 201, eight HTTP 404, four HTTP 403, four HTTP 401 and four client network-error events. The four network-error events each retained an HTTP 401 response plus `net::ERR_ABORTED` during deliberate session invalidation; they are expected client-abort observations, not erased transport events. The 48 direct API checks comprised 28 HTTP 200, four HTTP 204, eight HTTP 404, four HTTP 403 and four HTTP 401. All direct checks met their expected status.

Separate read-only browser checks verified loading, whitespace validation, retained content after a failed refresh and visible manual-retry controls on all four routes. Their 44 observations comprised 32 HTTP 200, eight HTTP 204 and four deliberate browser-intercepted HTTP 503 responses. No backend fault or automatic request retry was used. Desktop and 390px screenshots were captured; inspected desktop/narrow samples retained usable controls and no horizontal overflow. Narrow pages require substantial scrolling. No automated accessibility-compliance claim follows.

## Availability and retained failures

The independently recounted observer streams retained these completed requests, including authentication, setup and final drain:

| Route | Earlier upgrade observer | Completed acceptance observer |
| --- | --- | --- |
| kind baseline | 58 HTTP 200, one HTTP 204, one connection error | 374 HTTP 200, one HTTP 204 |
| kind delivery | 54 HTTP 200, one HTTP 204 | 366 HTTP 200, one HTTP 204 |
| k3s baseline | Six HTTP 200, one HTTP 204 | 43 HTTP 200, one HTTP 204 |
| k3s delivery | Six HTTP 200, one HTTP 204 | 42 HTTP 200, one HTTP 204 |

All 958 starts in those streams matched completions, final in-flight counts were zero and raw evidence hashes matched independent validation. No failed request was retried or replaced by fallback traffic.

The kind-baseline connection error occurred at 18:14:21.061 UTC. Its port-forward log recorded connection refusal in the outgoing frontend pod and then lost its pod connection. The replacement frontend was ready; the failure remains part of the upgrade observations. It does not establish a backend failure or continuous normal-route availability.

A distinct 60.046-second window, 18:16:31.349–18:17:31.395 UTC, completed 498 HTTP 200 responses: kind baseline 224, kind delivery 222, k3s baseline 26 and k3s delivery 26. It had no HTTP or network failures. Requests completed after the window boundary remained included in the full final observer totals above.

Harness failures remain separate: an initial credential-field initialization error retained four HTTP 200 bootstrap responses with rejected incomplete summaries; an optional check after port-forward cleanup retained one `ERR_CONNECTION_REFUSED` navigation; a client-only loading simulation stopped on a text-selector encoding error after eight completed observations (seven HTTP 200, one HTTP 204). That last attempt did not finalize its held intercepted request and is not used as complete availability evidence. The completed supplemental checks above used a corrected selector and separate evidence.

Observation did not cover delivery reconciliation completed before acceptance or the k3s baseline replacement interval. The successful post-deployment window does not establish zero downtime, erase earlier failures or resolve the previously documented transient backend latency.

## Data and infrastructure preservation

Every pre-existing request, staff record, history entry, account and Flyway row matched by identity and every field. Kind preserved 13 requests, six staff, 42 history entries, four accounts and six Flyway rows; k3s preserved eleven requests, four staff, 28 history entries, five accounts and six Flyway rows.

Intentional fixtures added two requests, two staff records and twelve history entries per cluster: four requests, four staff and 24 history entries overall. Each request belongs to the existing acceptance requester and ended IN_PROGRESS, HIGH priority and unassigned. New staff ended active with their renamed values. No account was provisioned or disabled, and no migration ran. Only expected JDBC session access state changed.

Backend images, pod identities/restart counts, Deployment/Rollout specifications, Services, database/settings/Secret fingerprints, PVCs, retained preview resources and complete Argo source/policy were unchanged. Helm values differed only in the frontend tag, with expected release metadata changes. Final frontend pods were ready with zero restarts. Temporary port-forwards and observers were removed; no test workload was deployed.

The full React dashboard is ready for milestone closeout with these recorded failures and limits. Staff search still loads the directory into browser memory; status filtering covers loaded requests only. Live checks verified history cursors with small API page sizes, but did not create bulk fixtures to repeat the 25-record UI boundary. The isolated 16-workflow suite provides that separate coverage. Raw evidence remains private and is not part of the source release.
