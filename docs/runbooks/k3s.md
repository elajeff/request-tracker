# Local k3s practice

## Isolation and setup

k3d v5.9.0 runs actual k3s v1.37.1+k3s1 in Docker Desktop's WSL2 Linux environment. It is a local container wrapper, not a different Kubernetes distribution or a native Windows k3s service. The Windows executable's SHA256 matched the official release checksum with TLS verification enabled.

`k3s/cluster.yaml` creates one server, no agents or load balancer, and binds its API to `127.0.0.1:6551`. The 5 GiB container limit includes the k3s control plane, containerd, system pods, and application workloads. Temporary k3d tools containers used for creation/image import are outside this limit and were removed after import. No dedicated CPU quota is configured.

The inspected host had 12 logical CPUs, 31.1 GiB RAM, 8.5 GiB free RAM, and 13.5 GiB free disk. Docker exposed 12 CPUs and 15.17 GiB RAM; kind used about 3.1 GiB. Both clusters remained running. Do not prune Docker storage or delete either cluster to reclaim space without reviewing retained data.

Use the isolated kubeconfig at `target/k3s-practice/kubeconfig.yaml` and explicit context `k3d-request-tracker-k3s`. The default context remains `kind-request-tracker`. Kubeconfigs, generated credentials, dumps, logs, and diagnostic evidence stay outside Git.

1. Create the cluster with the installed k3d executable and `cluster create --config k3s/cluster.yaml`.
2. Export only its kubeconfig with `kubeconfig get request-tracker-k3s`; do not merge or switch the default context.
3. Build/import the unique tags in `k3s/values.yaml`. Create fresh `request-tracker-k3s-db` credentials in this cluster's `request-tracker` namespace; do not copy kind credentials.
4. Install the baseline chart with `helm upgrade --install request-tracker helm/request-tracker --kubeconfig <isolated-file> --kube-context k3d-request-tracker-k3s --namespace request-tracker -f k3s/values.yaml --wait`.
5. Bootstrap the pinned controllers using `delivery/bootstrap.ps1 -Context k3d-request-tracker-k3s -Kubeconfig <isolated-file>`. Kind remains the default only when these arguments are omitted.

## Verified baseline and recovery

The unique backend/frontend tag is `k3s-e4a0d80-20261028063718`. The baseline Helm release installed at revision 1. PostgreSQL uses a separate `local-path` PVC and fresh Secret. The k3s default StorageClass is `local-path`, with `WaitForFirstConsumer` and `Delete` reclaim policy; deleting its PVC can delete its data.

Live requests/limits matched the chart, including PostgreSQL's 100m/256Mi requests and 500m/512Mi limits. Backend containers used UID/GID 10001, RuntimeDefault seccomp, a read-only root filesystem, no privilege escalation, and dropped capabilities. Frontend containers used UID/GID 101 with no privilege escalation and dropped capabilities. Service-account tokens were disabled for application/database pods. PostgreSQL retains the chart's unrestricted pod security settings; this exercise does not establish restricted-policy compliance for the database.

HTTP checks passed for request creation, status/priority updates, assignment/unassignment, staff rename/deactivation/reactivation, rejected inactive assignments, combined search/staff filtering over cursor pages, and history pagination/name snapshots. Manual dashboard acceptance passed on the existing deployment; these k3s workflow checks used HTTP APIs, not automated browser coverage.

Backend replacement preserved all data. During PostgreSQL scale-down, readiness became false after 19.14 seconds while sampled liveness stayed UP; the backend restart count remained zero. A `finally` block restored PostgreSQL, readiness recovered automatically, and database/Flyway digests matched. The first harness assertion incorrectly required literal `503` text from kubectl; the saved error was `ServiceUnavailable`. Saved observations and recovery were verified without repeating the outage.

The initial backend pod restarted once during first installation; its replacement had zero restarts across the outage. No cause is asserted for that initial restart.

`k3s-final.dump` restored into the separate `request-tracker-restore-check` PostgreSQL pod using ephemeral storage. All four requests, one staff record, eleven history rows, assignments, and Flyway V1–V5 matched exactly. The restore instance remains isolated from the working application.

Evidence and the backup are outside Git at `C:\Users\DESKTOP\request-tracker-backups\k3s-20261028-064246`.
