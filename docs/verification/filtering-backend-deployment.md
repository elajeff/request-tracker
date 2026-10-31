# Server-side filtering backend deployment

Verified on 31 October 2026 UTC at main `7bbf17a7490894f168f7c6d4497e6935c69f38e2`, integrating [PR #47](https://github.com/elajeff/request-tracker/pull/47). [Main CI](https://github.com/elajeff/request-tracker/actions/runs/41169750069) passed.

## Images and runtime

All baseline and delivery backends in kind and k3s use `request-tracker:server-filtering-retry-023024facc6b-20261030-231441`. The existing image was reused: all 52 backend build-input entries match its source revision, and both runtimes match its configuration digest, nine ordered layers and filesystem chain. No rebuild was required.

- Configuration: `sha256:19ea9c785f5089c138257ff142c30f3776bcbdc9e96175baec4ca738693d647d`
- Filesystem chain: `sha256:2f48517fbf5c4e0519db0f071107129a83aec98eb2cc37757ad69abe86581e77`
- Archive SHA-256: `adddc452729d80d831f734ace9416a0979e3d0b11f7e3eef2bd7c8ce5f24d225`

Both delivery Applications finished Healthy/Synced at the exact main revision with four ready/available stable replicas and zero candidates. Baseline Helm revisions are kind **8** and k3s **5**. Each baseline render, live specification and retained-values comparison changed only the backend image. All four frontends remain `react-dashboard-fc9e818ac52b-20261030-072600`.

## Sequential candidate verification

Workers authenticated once each under a completion-coordinated semaphore: four Service workers followed by one host diagnostic worker per cluster, with no simultaneous cluster authentication. Every request retained its three-second limit and unique wire ID; no request was retried or replaced by fallback traffic. Kind traffic was finalized before k3s setup to isolate cluster load.

K3s automated synchronization was temporarily disabled while kind reconciled naturally. Its source and other policy fields were preserved. The exact original automation policy was restored after k3s readiness passed; no forced synchronization occurred. Final complete Application specifications matched their originals.

Each cluster had a fresh 120-second baseline. Kind completed 2,420 Service and 582 host requests; k3s completed 2,418 Service and 582 host requests. Each Service baseline contained 1,600 sustained application reads with zero errors. These frozen checkpoints are prefixes of the final streams below, not additional requests.

| Final integration stream | Requests | HTTP 200 | HTTP 204 | Sustained application-read errors / reads |
| --- | ---: | ---: | ---: | ---: |
| kind Service | 11,310 | 11,306 | 4 | 0 / 7,527 |
| kind host diagnostic | 2,699 | 2,698 | 1 | 0 / 1,796 |
| k3s Service | 7,322 | 7,318 | 4 | 0 / 4,869 |
| k3s host diagnostic | 1,753 | 1,752 | 1 | 0 / 1,166 |

Both candidate-specific analyses passed in each cluster, with three successful observations per metric. Error ratios were zero; missing, empty or nonfinite values could not pass.

| Cluster / exposure | Throughput, requests/s | Mean latency, ms |
| --- | ---: | ---: |
| kind 25% | 3.520?4.520 | 10.446?11.014 |
| kind 50% | 8.441?8.521 | 10.164?11.117 |
| k3s 25% | 3.680?4.440 | 10.498?11.379 |
| k3s 50% | 7.480?8.000 | 10.483?12.915 |

Kind promoted in **243.825 seconds** and k3s in **243.170 seconds**, measured from the first observed candidate image to the successful gate. Both required the owned candidate ReplicaSet to have exactly four desired, ready and available replicas, Rollout Healthy and Argo Healthy/Synced at main. Three candidates plus one old stable replica could not pass. The 300-second budget remains empirical, not a Kubernetes worst-case guarantee.

## Acceptance and evidence

Browser/API checks covered all four routes: existing frontend authentication and session clearing, requester creation/editing and ownership denials, support priority/status/assignment changes, staff lifecycle and historical assignment values, queue/history cursors, desktop and narrow layouts. Direct API checks verified full-queue status filtering, combined text/status/staff/unassigned predicates, literal `%`/`_` staff search, trimming, active/inactive records, UUID pagination and HTTP 400 for invalid, empty, whitespace-only and padded statuses.

The initial acceptance run stopped after 69 requests because its unassignment check sent `{staffId: null}` rather than the required `{unassign: true}`. The backend correctly rejected it with HTTP 400. That unexpected harness result remains recorded; it is not rewritten as a passing check. A separate continuation used the documented payload, retained the existing fixture and completed the remaining checks without another deployment or automatic request retry.

Across both acceptance datasets, 478 requests completed: 396 HTTP 200, 25 HTTP 204, eight HTTP 201, 25 HTTP 400, eight HTTP 403, eight HTTP 404, four completed HTTP 401 and four client aborts following HTTP 401 during intentional session invalidation. The HTTP 400 count includes 24 expected validation responses and the retained malformed harness request. Expected authorization/validation responses and session-loss aborts stayed separate from sustained traffic errors.

All integration, upgrade and acceptance observers together completed **31,596 requests: 31,562 HTTP 200 and 34 login HTTP 204**, with zero unexpected HTTP responses, timeouts or network failures. Every start matched a completion; independent recounts, final summaries and SHA-256 checks matched with zero in-flight requests. Quiescing stopped admission and bounded draining to 12 seconds before capture and cleanup. Raw evidence and session material remain outside Git.

A separate final 60-second window recorded 633 HTTP 200 responses through the four host frontend routes: kind baseline 287, kind delivery 288, k3s baseline 29 and k3s delivery 29. Independent Service observers recorded another 1,198 kind and 1,200 k3s HTTP 200 responses. Host streams remained diagnostic; their different throughput does not establish forwarding overhead.

## Preservation and limitations

Every pre-existing request, account, staff, history and Flyway row matched by identity and field. Intentional fixtures added two requests, two staff records and 16 history entries per cluster: four requests, four staff and 32 history entries overall. No accounts or migrations were added. Final counts are kind 17 requests / 10 staff / 70 history / four accounts / six Flyway rows; k3s 15 / eight / 56 / five / six.

Secret/settings fingerprints, PVCs, retained preview resources, frontend workloads and reconciliation policies matched. Expected changes were the backend images, Helm release history, controller-owned stable/canary selectors and five backend pod replacements per cluster: four delivery and one baseline. The historical zero-scale k3s ReplicaSet was preserved. Forty-three residual observer/browser sessions were removed without targeting pre-existing sessions; browser logout also removed its own sessions. No active analyses, candidates, observers, port-forwards or diagnostic containers remained.

Earlier failures remain in [filtering verification limits](filtering-release.md) and [canary verification](canary-release.md). An additional stopped setup retained 54 requests: 35 HTTP 200, eight HTTP 204 and eleven timeouts (eight login, two refresh, one history), all before merge. A separate concurrency comparison retained 1,344 requests and 224 successful logins without reproducing those failures; it did not isolate the earlier cause. Sequential success does not resolve occasional authentication latency or establish zero downtime.

The filtering frontend was not deployed. Its existing browser-memory staff search and loaded-request status filtering remain until a separate frontend release. Live fixtures did not cross the 25-record UI page boundary; that boundary remains covered by isolated browser CI. Narrow layouts may require vertical scrolling.
