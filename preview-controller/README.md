# PreviewEnvironment v1 lab

The namespace-scoped controller uses Kopf for watches, timers, retries, and finalizers, and the official Kubernetes Python client for child resources. It runs one standalone replica in `preview-lab` on `k3d-request-tracker-k3s`; it has no RoleBinding in existing application namespaces. CRD installation requires an administrator, but the runtime has no CRD or namespace administration permissions.

## API and acceptance

`previews.request-tracker.dev/v1`, kind `PreviewEnvironment`, is namespaced. Names must be DNS labels starting with a letter, at most 30 characters. Required `backendImage` and `frontendImage` references include a tag or digest. `ttlSeconds` defaults to 3600 and accepts 60–86400. `storageRetentionPolicy` is immutable, defaults to `Retain`, and accepts `Retain` or `Delete`.

Acceptance covers create → Ready → image update → controlled drift repair → actionable failure → recovery → deletion/expiry. Invalid specifications must be rejected by the API. Reconciliation must preserve credential values and avoid repeated workload updates. Foreign resource collisions must be reported without adoption or deletion. Retention and explicit destructive cleanup are tested only on disposable lab data.

Each preview has UID-derived names, separate frontend/backend/PostgreSQL Deployments and ClusterIP Services, nginx configuration, generated credentials, a 256Mi `local-path` PVC, and a NetworkPolicy allowing only its own pods plus DNS. Database resources use `Recreate` updates to avoid concurrent access to the PVC. All app/database containers run non-root with dropped capabilities and no service-account token. The backend has a read-only root filesystem and a five-second termination drain.

The fixed lab namespace has a ResourceQuota. Status exposes a Ready condition, generation, expiry, and resource prefix. Failure reasons include image pull/crash failures, ownership conflicts, missing credentials, and Kubernetes API errors. Generated credential values are written only to Secrets; controller error reporting uses fixed messages and API status codes, not response bodies. Application images and administrator/debug access remain trusted. Five-second timers reconcile child drift and expiry; network/API retries and deletion finalizers use Kopf.

## Storage and ownership

`Retain` preserves both PVC and credential Secret without garbage-collection owner references. Other children have controller owner references. A deleted/recreated CR name gets a new UID and cannot adopt its earlier database. If a credential Secret disappears while its PVC exists, reconciliation stops with `CredentialsMissing` rather than generating a new password for an existing database.

`Delete` explicitly removes owned database storage and credentials after workloads terminate. With the lab's `local-path` Delete reclaim policy, this destroys disposable data. Owner UID checks and delete preconditions prevent deleting a different object at a reused name. Foreign objects are skipped during cleanup. Retention does not protect against namespace/cluster deletion or provide backups; retained resources require an explicit administrator decision before reuse or removal.

For retained-data recovery, identify the matching PVC/Secret pair by its original owner-UID label. Mount that PVC in a separate PostgreSQL 17 recovery pod at `/var/lib/postgresql/data`, set `PGDATA=/var/lib/postgresql/data/pgdata`, and reference the retained Secret's username/password keys. Use UID/GID/fsGroup 70, a disabled service-account token, and no Service. Never generate replacement credentials or run a second PostgreSQL process against a mounted live database. The recorded readback used this procedure and removed only its temporary recovery pod afterward.

Intentional disposal requires a backup and confirmation that no pod mounts the PVC. Inspect the exact PVC/Secret names, UIDs, and original owner-UID label using the isolated kubeconfig and `k3d-request-tracker-k3s` context, then delete only that confirmed pair in `preview-lab`. Avoid namespace deletion and broad label-based cleanup. No retained pair was disposed during integration review.

## Run and verify

The Python base is pinned by digest; `requirements.txt` declares direct dependencies and `constraints.txt` fixes their tested transitive versions. The fixed PostgreSQL 17 Alpine reference is also pinned by digest. This fixes image/package selection; it does not assert bit-for-bit reproducible builds. Application tags/digests must already be available in the cluster.

Build `preview-controller/Dockerfile` with a new unique tag, import it into `request-tracker-k3s` with k3d, and update the lab Deployment image explicitly. `lab.yaml` records the hardened `security-20261028184215` image; do not overwrite an existing image tag. Use the isolated kubeconfig for every command:

```powershell
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s apply -f preview-controller/crd.yaml -f preview-controller/lab.yaml
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s apply -f preview-controller/example.yaml
python preview-controller/e2e.py --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s --output target/preview-e2e.json
```

The E2E script creates and deletes only disposable previews and test fixtures in `preview-lab`. It deliberately changes the lab controller replica count for the ownership-conflict test, restoring it in `finally`. It leaves default-retention data in place; repeated runs consume the bounded storage quota. Unit tests run inside the controller image with `python -m unittest discover -s /tests -v` and this directory mounted read-only at `/tests`.

No PR events, GitHub automation, ingress, external DNS, authentication, or high-availability controller coordination is included. Namespace administrators and API-server port-forward access remain trusted; network policies are not an authorization boundary against them. TTL is calculated from CR creation time, including after controller restarts; it is not restarted when the controller starts. Expiry begins cleanup on the next timer tick and is not a hard deletion deadline during API, controller, or storage failures. A controller outage can leave finalizers pending until recovery.

## Observed verification

On 28 October 2026, nine initial unit tests passed; integration review added expiry/restart, sanitized API-error, and foreign-object cleanup regression coverage, bringing the passing total to fourteen. During integration review, the dependency-pinned image passed `pip check` but was not deployed; the revised E2E safety cleanup was syntax-checked without repeating the lifecycle runner. The subsequent complete run is recorded below. Live k3s checks verified Ready creation, normal-route request creation, unchanged generations/credentials across repeated reconciliation, image update, replica drift repair, bad-image status and recovery, controller restart, and same-preview versus cross-preview network access. Five invalid specifications and retention-policy mutation were rejected; server defaults were verified separately.

TTL expiry with explicit `Delete` removed its disposable workloads, PVC, and credentials. Default-retention deletion removed workloads but kept the original PVC/Secret. A separate temporary PostgreSQL pod read the original request from retained storage, then was removed. Recreating the CR name used independent resources. The lifecycle runner stopped before its final ownership/RBAC assertions; its aggregate completion assertion was not reached. Separately executed ownership checks observed `OwnershipConflict` and confirmed that finalization preserved the foreign Service while deleting owned disposable resources. Separate impersonation checks denied existing application-namespace access and CRD administration.

The original live verification used `request-tracker-preview-controller:lab-v7`. Initial runtime revisions failed due to a missing process username, cluster-discovery permissions, and incorrect status-subresource use; these were corrected before final verification. A concurrent credential-creation race was also corrected and regression-tested. Lifecycle, ownership/RBAC, retained-data readback, and final-state observations are stored separately outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\preview-controller`.

The original verification ended with a Ready controller, no active previews, and one intentionally retained PVC/credential Secret pair. Kind and k3s application data and Argo health/sync state were unchanged. No release exercises were repeated. Manual dashboard acceptance remains recorded separately; these controller checks do not add automated browser coverage.

## Reviewed-image completion

The image `request-tracker-preview-controller:37969db-live-20261028182422` was built from reviewed commit `37969db`; its packaged controller source hash matched the Git version. The revised E2E runner completed with exit code 0 and reached its aggregate completion record after all 24 checks, including controller restoration, ownership-conflict cleanup, and RBAC denials. This complete run is separate from the earlier interrupted run and its individually completed assertions. No controller code changes were needed.

A separate temporary PostgreSQL pod read the newly retained request after preview deletion, then was removed. The pre-existing retained PVC/Secret pair preserved its UIDs and content hashes, and both kind/k3s application datasets matched their before-run snapshots. Final lab state: one Ready controller at one replica, zero active previews, and two intentionally retained PVC/credential Secret pairs. No generated credential values were found in controller logs. The default context remained `kind-request-tracker`.

Runner stdout/stderr, exit status, lifecycle records, readback, and preservation checks are outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\reviewed-e2e-20261028-182421`. The immutable image was selected with an explicit lab Deployment override; the original `lab.yaml` image tag was not rewritten.


The security/capstone review adds restricted Pod Security admission for `preview-lab` at policy version v1.37 and digest-pins PostgreSQL. See [review results and demonstration](../docs/runbooks/security-capstone.md).
