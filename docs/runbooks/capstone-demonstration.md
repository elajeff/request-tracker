# Capstone demonstration results

## Executed segments

The 28 October 2026 walkthrough used the existing k3s lab, hardened controller image `request-tracker-preview-controller:security-20261028184215`, and a new disposable `capstone-demo` PreviewEnvironment. This is new demonstration evidence, separate from the earlier 24-check E2E run, which was not repeated. No screen recording was captured.

| Segment | Observed result |
| --- | --- |
| Application workflow | Four disposable requests and one staff record; assignment, combined search/staff filtering with pages of 2/1, and assignment history verified. Eleven HTTP calls completed without failure through the preview frontend route. |
| Database outage | Only the disposable preview database was stopped. Readiness failure was observed after 10.08 seconds; sampled liveness remained UP and the backend restart count did not increase. |
| Recovery | Nested `finally` cleanup restored the preview database and lab controller. Backend readiness recovered. Existing application databases were not stopped. |
| Isolated restore | A 9,751-byte custom-format dump restored into a separate PostgreSQL process with ephemeral storage. Requests, assignments, staff, history, and Flyway matched exactly. The temporary restore pod was removed. |
| Expiry/retention | TTL was shortened to 60 seconds measured from original CR creation. Expiry finalized and retained the preview PVC/Secret. After preserving the dump and evidence, only that disposable pair was intentionally removed. |
| Security | Impersonation denied controller access to existing application Secrets and CRD creation. A server-side dry run denied a privileged pod under restricted admission; no unsafe pod was created. |

The lab controller was paused only during the disposable database outage so ordinary drift repair would not immediately undo the outage. Its replica count was restored to one. The two pre-existing retained PVC/Secret pairs preserved their UIDs and content hashes. The existing k3s application dataset matched its before-run snapshot; kind was not modified. Both existing Argo Applications ended Healthy/Synced with their original source configurations.

Controller scripts, timestamped commands/results, stdout/stderr, API record identifiers, backup, snapshots, and security observations are outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\capstone-demo-20261028-185252`. `walkthrough.py` records the executed disposable-resource procedure; `walkthrough.json`, `independent-results.json`, `security-demonstration.json`, and `final-argo.json` contain its observations. Credential values and diagnostic dumps are not committed.

## Git-published release segment: not executed

Healthy promotion and faulty-release abort remain pending publication approval. Earlier promotion/abort results do not count as results for this walkthrough. No local image override was substituted for a Git-published release.

The prepared branch `demo/security-capstone-delivery` is based on published main `e4bded1` and changes only `delivery/values-capstone.yaml`:

1. `19c76ae`: baseline equivalent to the current rendered k3s desired state.
2. `c61c346`: healthy image `request-tracker:capstone-good-20261028185252`.
3. `891b7bc`: isolated fault image `request-tracker:capstone-fault-20261028185252`.
4. `5611dca`: restore the original stable image.

After approval, publish one stage at a time, verify Argo synchronization at each commit, collect timestamped normal-route traffic and analysis results, and require actual promotion/automatic abort. Temporarily select the demo branch/values file in the k3s Application, removing local image parameters. Restore the saved original Application source after the stable stage or on failure. Stop publication if any preceding gate fails; restoring the original source does not require publishing unverified later commits. Kind must remain unchanged.

The baseline rendering was checked against the saved original source and was identical. No Secret, storage, selector, or database change is part of the queue. This review does not authorize publication by itself.

## Completion criteria

- Complete the pending Git-published promotion/abort segment and record every failed request, including restoration failures.
- Verify final source configuration, application readiness, data preservation, and absence of fault-image pods after that segment.
- Review and integrate the security/capstone branch and final documentation through the normal manual PR process.
- Review the agreed roadmap checklist and label remaining work explicitly deferred; do not imply a production security assessment, HA storage, or RKE2 coverage.

Trusted images/administrators, namespace/node deletion risks, retained-data backup responsibilities, and the single-node storage limitations remain as documented in [the security review](security-capstone.md).
