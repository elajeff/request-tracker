# Local k3s practice

## Isolation and setup

k3d v5.9.0 runs actual k3s v1.37.1+k3s1 in Docker Desktop's WSL2 Linux environment. It is a local container wrapper, not a different Kubernetes distribution or a native Windows k3s service. The Windows executable's SHA256 matched the official release checksum with TLS verification enabled.

`k3s/cluster.yaml` creates one server, no agents or load balancer, and binds its API to `127.0.0.1:6551`. The 5 GiB container limit includes the k3s control plane, containerd, system pods, and application workloads. Temporary k3d tools containers used for creation/image import are outside this limit and were removed after import. No dedicated CPU quota is configured.

Check host memory and disk capacity before running both local clusters. Do not prune Docker storage or delete either cluster to reclaim space without reviewing retained data.

Use the isolated kubeconfig at `target/k3s-practice/kubeconfig.yaml` and explicit context `k3d-request-tracker-k3s`. The default context remains `kind-request-tracker`. Kubeconfigs, generated credentials, dumps, logs, and diagnostic evidence stay outside Git.

1. Create the cluster with the installed k3d executable and `cluster create --config k3s/cluster.yaml`.
2. Export only its kubeconfig with `kubeconfig get request-tracker-k3s`; do not merge or switch the default context.
3. Build/import the unique tags in `k3s/values.yaml`. Create fresh `request-tracker-k3s-db` credentials in this cluster's `request-tracker` namespace; do not copy kind credentials.
4. Install the baseline chart with `helm upgrade --install request-tracker helm/request-tracker --kubeconfig <isolated-file> --kube-context k3d-request-tracker-k3s --namespace request-tracker -f k3s/values.yaml --wait`.
5. Bootstrap the pinned controllers using `delivery/bootstrap.ps1 -Context k3d-request-tracker-k3s -Kubeconfig <isolated-file>`. Kind remains the default only when these arguments are omitted.

## Verification

See [k3s results](../verification/k3s.md) for the pre-authentication baseline, recovery and canary measurements. Later [authentication](../verification/authentication-cutover.md) and [React](../verification/react-deployment.md) results cover the current application schema and frontend.
