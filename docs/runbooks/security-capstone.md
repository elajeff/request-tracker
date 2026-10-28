# Security review and capstone demonstration

## Review scope and results

Main `e4bded1` matched the reviewed controller tip `1d845cc` before changes. The review covered preview ownership, finalizer/expiry behavior, credential handling, namespace RBAC, image references, pod permissions, and network isolation. The previously completed 24-check E2E run was not repeated.

Two findings were corrected:

| Finding | Correction | Verification |
| --- | --- | --- |
| Restricted-compatible pods, but no namespace admission guard | Enforce/audit/warn `restricted` v1.37 only in `preview-lab` | Three generated pod types admitted; privileged, UID 0, host-path, and host-network variants denied by server-side dry run |
| Mutable PostgreSQL image tag | Pin the tested PostgreSQL 17 Alpine digest | One disposable preview reached Ready with that exact image, then finalized under explicit Delete policy |

The first privileged fixture combined incompatible security flags and failed basic API validation. After correcting the fixture, the Pod Security admission denial was verified. No unsafe test pod was created. Namespace dry-run validation reported no violations in the existing controller pod.

The hardened controller image is `request-tracker-preview-controller:security-20261028184215`. Its disposable preview was removed. Both retained PVC/Secret pairs preserved their identities and content hashes; the k3s application dataset was unchanged. Final lab state was one controller pod and zero active previews. Kind resources were outside the mutation scope.

Ownership checks, UID delete preconditions, credential preservation, creation-time TTL calculation, sanitized API errors, and namespace-only RBAC retained their reviewed behavior. Their prior unit/live evidence was inspected rather than rerun. The wording correction from local commit `643812d` is included in the delivery runbook; the original commit remains preserved separately.

Evidence is outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246\security-20261028-184156`. Namespace enforcement follows the [Kubernetes Pod Security label mechanism](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/).

## Trust boundaries and limits

This is a local, trusted-administrator lab, not an authenticated multi-tenant service. Application images can access their own database credentials and remain trusted. Namespace/node administrators, API-server proxy access, and debug tooling are outside the network-policy boundary. Secrets are not safe to print or commit; Kubernetes Secret encoding is not a claim of encryption at rest. No encryption-at-rest audit, vulnerability scan, penetration test, or production SLO assessment was performed.

Restricted admission guards new pod creation; it does not remove existing pods or protect against an administrator changing namespace policy. The single-node local-path storage has no node-failure redundancy. Retention preserves credentials and storage, not backups, and does not survive namespace/cluster deletion. Repeated retained previews consume the lab quota. No existing retained pair should be deleted for the demonstration.

## Demonstration plan

The following walkthrough is prepared, not a claim of another executed release or E2E run. Keep the default context unchanged and use explicit contexts throughout.

1. Show the merged history, controller CRD/Role, security namespace labels, and immutable image references. Explain that runtime permissions are confined to `preview-lab`, while CRD installation is administrative.
2. Show the saved complete 24-check lifecycle evidence and the new admission/digest-pin results. Identify the earlier interrupted run separately.
3. Show the retained PVC/Secret names and UIDs without reading Secret values. Explain default Retain, explicit Delete, recovery, and namespace-deletion limitations.
4. Show kind/k3s Argo health and the normal dashboard through a localhost port-forward. Dashboard acceptance was manual; it is not automated browser coverage.
5. Explain measured delivery outcomes: kind permanent drain installation had five 502s in 1,894 requests; k3s fault/restoration stages had 143 and five HTTP 500s. Local Argo overrides were used for k3s release selection. Do not describe these as zero-downtime guarantees or Git-published k3s release commits.

Useful read-only commands:

```powershell
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s get namespace preview-lab --show-labels
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s -n preview-lab get deployment,preview,pvc
kubectl --kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s -n preview-lab get role preview-controller -o yaml
kubectl --context kind-request-tracker -n argocd get application request-tracker-delivery
```

For a dashboard presentation, use `kubectl --context kind-request-tracker -n request-tracker port-forward service/request-tracker-delivery-frontend 5173:80 --address=127.0.0.1` and open `http://127.0.0.1:5173`. Any optional live preview creation must use disposable lab data and the documented retention policy; it is unnecessary to repeat the entire acceptance suite for this walkthrough.
