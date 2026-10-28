# PreviewEnvironment v1 lab

The namespace-scoped controller uses Kopf for watches, timers, retries, and finalizers, and the official Kubernetes Python client for child resources. It runs one standalone replica in `preview-lab` on `k3d-request-tracker-k3s`; it has no RoleBinding in existing application namespaces. CRD installation requires an administrator, but the runtime has no CRD or namespace administration permissions.

## API and acceptance

`previews.request-tracker.dev/v1`, kind `PreviewEnvironment`, is namespaced. Names must be DNS labels starting with a letter, at most 30 characters. Required `backendImage` and `frontendImage` references include a tag or digest. `ttlSeconds` defaults to 3600 and accepts 60–86400. `storageRetentionPolicy` is immutable, defaults to `Retain`, and accepts `Retain` or `Delete`.

Acceptance covers create → Ready → image update → controlled drift repair → actionable failure → recovery → deletion/expiry. Invalid specifications must be rejected by the API. Reconciliation must preserve credential values and avoid repeated workload updates. Foreign resource collisions must be reported without adoption or deletion. Retention and explicit destructive cleanup are tested only on disposable lab data.

Each preview has UID-derived names, separate frontend/backend/PostgreSQL Deployments and ClusterIP Services, nginx configuration, generated credentials, a 256Mi `local-path` PVC, and a NetworkPolicy allowing only its own pods plus DNS. Database resources use `Recreate` updates to avoid concurrent access to the PVC. All app/database containers run non-root with dropped capabilities and no service-account token. The backend has a read-only root filesystem and a five-second termination drain.

The fixed lab namespace has a ResourceQuota. Preview limits are intentionally bounded; this is not a general-purpose workload operator. Status exposes a Ready condition, generation, expiry, and resource prefix. Failure reasons include image pull/crash failures, ownership conflicts, missing credentials, and Kubernetes API errors. Status and logs contain no generated credential values. Five-second timers reconcile child drift and expiry; network/API retries and deletion finalizers use Kopf. There is no custom watch framework.

## Storage and ownership

`Retain` preserves both PVC and credential Secret without garbage-collection owner references. Other children have controller owner references. A deleted/recreated CR name gets a new UID and cannot adopt its earlier database. If a credential Secret disappears while its PVC exists, reconciliation stops with `CredentialsMissing` rather than generating a new password for an existing database.

`Delete` explicitly removes owned database storage and credentials after workloads terminate. With the lab's `local-path` Delete reclaim policy, this destroys disposable data. Owner UID checks and delete preconditions prevent deleting a different object at a reused name. Foreign objects are skipped during cleanup. Retention does not protect against namespace/cluster deletion or provide backups; retained resources require an explicit administrator decision before reuse or removal.

## Run and verify

Build `preview-controller/Dockerfile` with the tag in `lab.yaml`, and import it into `request-tracker-k3s` with the approved k3d executable. Use the isolated kubeconfig for every command:

```powershell
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s apply -f preview-controller/crd.yaml -f preview-controller/lab.yaml
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s apply -f preview-controller/example.yaml
python preview-controller/e2e.py --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s --output target/preview-e2e.json
```

The E2E script creates and deletes only disposable previews and test fixtures in `preview-lab`. It deliberately changes the lab controller replica count for the ownership-conflict test. It leaves default-retention data in place. Unit tests run inside the controller image with `python -m unittest discover -s /tests -v` and this directory mounted read-only at `/tests`.

No PR events, GitHub automation, ingress, external DNS, authentication, or high-availability controller coordination is included. Namespace administrators and API-server port-forward access remain trusted; network policies are not an authorization boundary against them. Expiry begins cleanup on the next timer tick and is not a hard deletion deadline during API, controller, or storage failures. A controller outage can leave finalizers pending until recovery.

## Observed verification

On 28 October 2026, nine unit tests passed. Live k3s checks verified Ready creation, normal-route request creation, unchanged generations/credentials across repeated reconciliation, image update, replica drift repair, bad-image status and recovery, controller restart, and same-preview versus cross-preview network access. Five invalid specifications and retention-policy mutation were rejected; server defaults were verified separately.

TTL expiry with explicit `Delete` removed its disposable workloads, PVC, and credentials. Default-retention deletion removed workloads but kept the original PVC/Secret. A separate temporary PostgreSQL pod read the original request from retained storage, then was removed. Recreating the CR name used independent resources. A foreign Service collision produced `OwnershipConflict`; finalization preserved that Service while deleting owned disposable resources. Separate impersonation checks denied existing application-namespace access and CRD administration.

The final image is `request-tracker-preview-controller:lab-v7`. Initial runtime revisions failed due to a missing process username, cluster-discovery permissions, and incorrect status-subresource use; these were corrected before final verification. A concurrent credential-creation race was also corrected and regression-tested. Lifecycle, ownership/RBAC, retained-data readback, and final-state observations are stored separately outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\preview-controller`.

Final state: the controller is Ready, no previews are active, and one PVC/credential Secret pair remains intentionally retained. Kind and k3s application data and Argo health/sync state were unchanged. No release exercises were repeated. Manual dashboard acceptance remains recorded separately; these controller checks do not add automated browser coverage.
