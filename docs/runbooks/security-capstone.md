# Preview security and demonstration runbook

See [security verification](../verification/security.md) for the admission and image-pinning results.

## Trust boundaries and limits

The recorded demonstration used a local, trusted-administrator lab before session authentication was added; see [authentication](../authentication.md) for current account boundaries. Application images can access their own database credentials and remain trusted. Namespace/node administrators, API-server proxy access, and debug tooling are outside the network-policy boundary. Secrets are not safe to print or commit; Kubernetes Secret encoding is not a claim of encryption at rest. No encryption-at-rest audit, vulnerability scan, penetration test, or production SLO assessment was performed.

Restricted admission guards new pod creation; it does not remove existing pods or protect against an administrator changing namespace policy. The single-node local-path storage has no node-failure redundancy. Retention preserves credentials and storage, not backups, and does not survive namespace/cluster deletion. Repeated retained previews consume the lab quota. No existing retained pair should be deleted for the demonstration.

## Demonstration plan

The [capstone results](../verification/capstone.md) summarize application, recovery, preview and canary checks. Keep the default context unchanged and use explicit contexts throughout.

1. Show the controller CRD/Role, security namespace labels, and immutable image references. Explain that runtime permissions are confined to `preview-lab`, while CRD installation is administrative.
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
