# Preview security verification

## Review scope and results

The review covered preview ownership, finalizer/expiry behavior, credential handling, namespace RBAC, image references, pod permissions, and network isolation.

Two findings were corrected:

| Finding | Correction | Verification |
| --- | --- | --- |
| Restricted-compatible pods, but no namespace admission guard | Enforce/audit/warn `restricted` v1.37 only in `preview-lab` | Three generated pod types admitted; privileged, UID 0, host-path, and host-network variants denied by server-side dry run |
| Mutable PostgreSQL image tag | Pin the tested PostgreSQL 17 Alpine digest | One disposable preview reached Ready with that exact image, then finalized under explicit Delete policy |

The first privileged fixture combined incompatible security flags and failed basic API validation. After correcting the fixture, the Pod Security admission denial was verified. No unsafe test pod was created. Namespace dry-run validation reported no violations in the existing controller pod.

The verified controller image was `request-tracker-preview-controller:security-20261028184215`. Its disposable preview was removed. Both retained PVC/Secret pairs preserved their identities and content hashes; the k3s application dataset was unchanged. Final lab state was one controller pod and zero active previews. Kind resources were outside the mutation scope.

Ownership checks, UID delete preconditions, credential preservation, creation-time TTL calculation, sanitized API errors, and namespace-only RBAC retained their reviewed behavior.

Namespace enforcement follows the [Kubernetes Pod Security label mechanism](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/).
