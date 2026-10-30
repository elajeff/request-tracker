# V6 progressive-delivery verification

Milestone C runtime verification completed on 30 October 2026. This is sanitized evidence from the completed kind-only exercise, not a command to repeat it.

## Completed approved V6 exercise: Milestone C closeout

On 30 October 2026 all four approved normal fast-forward pushes and their sequential runtime gates passed. Each publication checked the exact preceding remote tip, direct parent, commit bytes, file scope and elajeff author/committer identity. No force push, application-request retry, fallback traffic or weakened threshold was used. The remote demo branch is an exercise record, not the final Application source.

| Stage | Push confirmation UTC | Observed result |
| --- | --- | --- |
| Correction/baseline | 02:15:01.350 | Readiness/checkpoint and missing-metrics rejection passed. |
| Healthy retry | 02:15:26.653 | Strict 4/4 promotion and both analyses passed. |
| Fault | 02:19:30.150 | Measured error ratio 1.0; automatic abort and stable recovery. |
| Restore | 02:21:20.752 | Original stable V6 image returned, followed by main restoration and preservation. |

### Fresh dual baselines and readiness

Brand-new concurrent 120-second authenticated baselines used separate disposable cookie-jar sessions through the host frontend port-forward and in-cluster frontend ClusterIP Service. The in-cluster observer shared kind's node network namespace in a disposable Docker process, without deploying a diagnostic Kubernetes workload. Every bootstrap/login/CSRF-refresh/queue/history attempt was counted, with unique wire IDs, three-second socket limits, no retries and no redirects/fallback. Credentials were supplied in process environments/in-memory input only; no credentials, cookies, CSRF values, session attributes or Secret contents were recorded.

| Baseline stream | Completed | HTTP 200 | HTTP 204 | HTTP/network/client failures |
| --- | --- | --- | --- | --- |
| Host frontend route | 2,326 | 2,322 | 4 | 0 |
| In-cluster frontend Service | 2,403 | 2,399 | 4 | 0 |

Host completed at 02:14:47.711382 UTC; in-cluster completed at 02:14:48.454900 UTC. Full independent recounts/hashes, strict final summaries and one-to-one nginx wire-ID/status correlation passed. At the guarded publication start, host age was **10.695989 seconds** and cluster age **9.952470 seconds**, under the unchanged 60-second limit. The publisher rechecked actual completion times after Git preflight and evidence reading, with no intervening approval pause.

At 02:15:16.248 UTC all four generator workers had authenticated, refreshed CSRF and completed queue access. The explicit frozen readiness checkpoint had 20 starts/completions, zero in flight, and independently matching raw hash. The missing-revision analysis failed all three metrics on the first measurement: traffic `[0]`, error-rate `[]`, latency `[]`. Missing data was not accepted as success.

### Promotion, abort and restoration analyses

Healthy promotion passed the candidate-specific gate after **235.218 seconds** of observation, within the calculated 295-second work window plus five-second closing-read allowance. Argo revision matched the healthy commit; the Rollout was Healthy with current/stable hash `77f8cb76c7`, and its owned candidate ReplicaSet had exactly four desired, ready and available replicas of the expected image. Three candidates plus one old stable replica could not satisfy the predicate. Both 25% and 50% stages were observed; representative measured candidate traffic shares were 25.509% and 45.733%, reflecting approximate replica weighting.

| Owned AnalysisRun | Result | Measured candidate behavior |
| --- | --- | --- |
| `request-tracker-delivery-77f8cb76c7-13-2` | Successful: all three metrics, three successful measurements each | 9.640-10.560 requests/s, error ratio 0, mean latency 7.210-8.225 ms |
| `request-tracker-delivery-77f8cb76c7-13-5` | Successful: all three metrics, three successful measurements each | 17.993-19.480 requests/s, error ratio 0, mean latency 7.899-8.550 ms |
| `request-tracker-delivery-7f96f7464b-14-2` | Failed as intended at 02:20:44 UTC | Error ratio **1.0** exceeded the unchanged 0.05 gate; candidate rate 10.161 requests/s and mean latency 6.992 ms demonstrate present measurements, not a missing-vector abort. |
| `request-tracker-delivery-6c5f99c4c8-15-2` | Successful: all three metrics, three measurements each | Restoration traffic/error/latency gates passed. |
| `request-tracker-delivery-6c5f99c4c8-15-5` | Successful: all three metrics, three measurements each | Restoration traffic/error/latency gates passed. |

Rollouts set abort automatically; no manual abort/promotion or analysis override was performed. At the recovery gate stable hash was still `77f8cb76c7`, four healthy stable replicas were ready, the stable Service had four ready addresses, the faulty ReplicaSet desired/ready count was zero and no fault pod remained. The final 100 fault-phase requests in each traffic stream were HTTP 200, while all earlier injected failures remain counted below. The fault ReplicaSet and its failed analysis no longer exist live; their full result remains in saved observations/abort evidence. Existing historical negative fixtures were not deleted.

The 300-second policy remains an empirical cached-image local-lab budget with documented margins, not a Kubernetes worst-case success guarantee. This successful run does not erase the earlier missed boundary observation or any latency uncertainty.

### Complete traffic accounting, including quiesce and restoration

The generator was explicitly quiesced after abort settled. It stopped new admission, drained in flight within the bounded protocol, and retained its full raw/final files while still available. At **02:21:16.663 UTC**, all 7,211 starts/completions and their SHA-256 were independently validated before the restore push/pruning. The independent observer continued through restoration/main reconciliation and finalized at **02:25:22.607 UTC** with all 12,016 requests captured. Both final datasets had zero unmatched/in-flight requests and complete summaries.

| Stream / dispatch phase | Completed | HTTP 200 | HTTP 204 | HTTP 500 | Other HTTP/network/client failures |
| --- | --- | --- | --- | --- | --- |
| Chart / setup | 122 | 118 | 4 | 0 | 0 |
| Chart / baseline | 78 | 78 | 0 | 0 | 0 |
| Chart / healthy | 4,842 | 4,842 | 0 | 0 | 0 |
| Chart / fault | 2,169 | 1,829 | 0 | 340 | 0 |
| Chart total | 7,211 | 6,867 | 4 | 340 | 0 |
| Independent / setup | 515 | 511 | 4 | 0 | 0 |
| Independent / baseline | 82 | 82 | 0 | 0 | 0 |
| Independent / healthy | 4,630 | 4,630 | 0 | 0 | 0 |
| Independent / fault | 2,141 | 1,824 | 0 | 317 | 0 |
| Independent / restore | 4,564 | 4,564 | 0 | 0 | 0 |
| Independent / main | 84 | 84 | 0 | 0 | 0 |
| Independent total | 12,016 | 11,695 | 4 | 317 | 0 |

Including both 120-second baselines, the attempt retained **23,956 completed requests: 23,283 HTTP 200, 16 HTTP 204 and 657 deliberate HTTP 500s**. Every HTTP 500 maps to a fault-phase start record. There were zero new HTTP timeouts, connection errors, other network errors, client errors or unexpected HTTP statuses. All setup, waiting, abort-settling, shutdown and restoration intervals remain included; no failure was reclassified, retried or replaced by stable-Service fallback traffic.

Generator raw SHA-256: `ad8d705141566132ceb72d666793c7e9111631a01080887eb4a9b86fa31d3262`. Independent raw SHA-256: `6d511752b13bfa23d758ee4be9de53d5efd74d5eec06d9e85c2355e3fac03070`. The two baseline hashes and publication age proof are in the external certificate. An additional independent post-run recount confirmed every dataset and the frozen checkpoint, without querying the deleted generator for evidence.

### Final state and preservation

The restore commit reached strict Healthy/Synced readiness after **236.889 seconds** of observation. At 02:25:17.950 UTC the Application source was returned to its complete original main configuration; the saved 02:25:21.752 UTC observation was Healthy/Synced at **`704354cb5c4f94e580817c28487986cc09de1ffb`**. Final stable/current hash is `6c5f99c4c8`, with four ready original V6 replicas using `request-tracker:auth-08e4a87-20261029041407`. Baseline Helm workloads remain unchanged. The two kind frontends still use `react-b5b0ad152cbe75ced040c2ae57a2b99601d96609`; the prior completed four-frontend deployment record is preserved without inspecting/changing k3s.

Strict comparisons matched every identity and field for **13 requests, 6 staff, 42 history entries, 4 accounts and 6 Flyway rows**. Owner/assignment/history links and account roles, enabled flags and credential fingerprints were unchanged. Existing Secret/configuration/PVC/StatefulSet identities/fingerprints, baseline Deployment specifications, PostgreSQL UID/restart count, Rollout UID, complete Application specification/policy and retained-resource set matched exactly. Only intended JDBC-session login/access state changed; no new application fixture, account provisioning, migration or database restore occurred.

Original automated prune/self-heal and source/value-file settings are restored. No fault ReplicaSet/pods, generator Deployment/ConfigMap/pods, missing-metrics diagnostic AnalysisRun, diagnostic Docker observers or task port-forwards remain. Successful Rollout-owned analyses and zero-scaled healthy history remain under the original reconciliation/retention policies. K3s and retained preview resources were untouched. No V5 image was selected, imported or used as a rollback peer by this attempt.

The active attempt, including fresh baselines and restoration, completed in **757.283 seconds**, with no cleanup error. Final runtime deliberately tracks main; temporary publication history is excluded from integration. All exact approved commits and preceding remote tips passed checks before their pushes.

### Closure and limits

**Milestone C's runtime verification is complete. The project is ready to prepare a source-only v0.2.0 release.** This authorizes no tag, release, registry publication or new GitHub activity. Source inventory/release-note preparation can proceed; review/integration of these local changes, current CI review and explicit release/tag authorization remain publication gates. Image/binary distribution and clean-machine packaging/reproducibility limits remain as previously documented.

Every earlier failure remains a failure: the React initial observer result and narrow expected 401/client abort, the four unresolved transient-backend timeouts, the stale-baseline/empty-generator halt, the earlier observer deadline failure and its restoration network error. The controller-log diagnosis remains alongside the failed observer result. A later clean attempt does not establish their root causes or zero downtime. Full-directory React staff search still loads browser memory. Prometheus exercise thresholds are not production SLOs, HTTP metrics do not capture every transport failure, and the private harness/raw evidence remain outside source control rather than a portable full exercise runner.

Raw evidence and independent checks are retained privately outside Git. Only sanitized prose is tracked; no backups, credentials, cookies, tokens, Secrets, dumps, generated evidence or image archives are committed.

## Earlier failures and orchestration corrections

Earlier results remain failures and are not replaced by the successful attempt:

- Initial accounting preparation stopped before publication because periodic-only counters could lose shutdown-tail requests.
- The first authenticated startup attempt stopped before publication: 21 requests included 13 HTTP 200, four HTTP 204 and four three-second timeouts (two session refreshes, one queue read, one history read). All requests had completion records; the failed authentication-refresh run was rejected. Correlation found three nginx 499s and one late nginx 200, with multi-second backend timers on one pod. The underlying latency cause remains unresolved.
- A 120-second diagnostic comparison passed 2,269 host and 2,387 in-cluster requests without failures. It did not establish the earlier cause or justify weakening the gate.
- The controlled retry's 120-second baselines passed 2,274 host and 2,401 in-cluster requests, but were incorrectly reused after a three-hour pause. Only the baseline stage was published. Its first generator read failed and its empty final dataset was rejected. The independent observer retained 959 requests (955 HTTP 200, four HTTP 204), including 398 cleanup responses. Main and preservation were restored.
- The subsequent freshness/readiness-corrected attempt passed new baselines (2,325 host and 2,408 in-cluster requests), both healthy analyses, and then failed the 250-second observer promotion gate. Chart evidence retained 5,421 requests (5,417 HTTP 200 and four HTTP 204). The independent observer retained 10,028 requests (10,023 HTTP 200, four HTTP 204 and one restoration history-read network error). All final starts/completions and hashes matched. No fault stage followed.

Controller logs later established that the fourth candidate in that attempt was created/scheduled at 01:27:23 UTC, started at 01:27:24 using the cached image, and became available around 01:27:49. It was not scheduling/pull blocked or removed before readiness. The last observer sample at 01:27:48.459 showed only 3/4 candidates; Rollouts logged completion at 01:27:49.279, Argo Healthy at 01:27:49.385, and the observer reported timeout at 01:27:50.525. The failed observed gate remains failed; the exact internal monotonic deadline and deleted Pod Ready-condition timestamp were not retained.

The correction derives a 300-second empirical budget: 75 seconds of pauses, 60 seconds of concurrent-metric analysis spans, 144 seconds for four serialized startups at the slowest measured duration rounded up, five seconds for sync, six seconds controller margin, five seconds probe margin and a five-second closing read. It preserves the strict candidate-specific 4/4 predicate. The 60-second dual-baseline freshness fence and atomic readiness checkpoint prevent the prior orchestration errors. None of these changes resolves the original latency or removes the earlier restoration network failure.

## Gate interfaces for future reviewed exercises

The helpers are local control/evidence gates, not a complete portable runtime runner. Obtain approval for the exact future sequence before collecting new baselines; never reuse the historical successes above. Baseline mode uses `TRAFFIC_BASELINE_SECONDS=120`, a fresh shared `TRAFFIC_ATTEMPT_ID`, `TRAFFIC_ROUTE=host` or `cluster` and separate evidence directories. Supply credentials through the environment, not command-line arguments. Every application request has a unique wire ID and retains its outcome without retry.

`certify-baselines <root> <attempt-id> <frontend-service-ip>` validates both complete datasets and records their actual completion times and hashes. `publish-first <commit> <root> <attempt-id> <expected-tip>` checks the caller's reviewed remote tip, ancestry/scope/identity and both datasets again, enforcing the fixed 60-second freshness limit immediately before invoking one normal push. It reserves the attempt to prevent an automatic retry after failure or uncertainty. An approval pause cannot keep expired evidence usable.

`wait-generator <pod> <uid> <restarts> <output>` polls only control files with a 30-second readiness deadline and bounded reads. Its atomic four-worker marker references a frozen raw checkpoint that is independently validated. Initialization is distinct from corrupt evidence; traffic failures, timeouts and invalid ready data fail with diagnostics. Readiness is not finalization: quiesce explicitly, allow the 12-second bounded drain, capture and validate the full final dataset before any pruning. Keep independent restoration accounting until final reconciliation.

The calculated observation policy and strict candidate predicate are unit tested. Callers must enforce the overall exercise/cleanup bound, cap status-read I/O to the supplied budget, retain deadline/state timestamps, verify both owned analyses, and perform preservation checks. The stage gates never make transport failures disappear merely because Prometheus HTTP measurements pass.
