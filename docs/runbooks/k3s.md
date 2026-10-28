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

## Delivery results

Argo CD Core v3.5.6 and Rollouts v1.10.1 use the same chart and analysis gates as kind. Apply `k3s/application.yaml` only with the isolated kubeconfig/context. The chart comes from published main at `e4a0d80`; cluster-specific Application Helm parameters select local image tags and the isolated Secret. Release selection in this exercise changed those parameters, not published Git commits. The local Application file records the final healthy selection.

Frontend replica drift from two back to one reconciled in about 2.2 seconds. Both sampled Argo states were Synced; an intermediate OutOfSync state was not captured.

On 28 October 2026, healthy promotion ran from 04:48:28.670Z to 04:52:08.919Z. Ready stable/candidate replicas progressed 3/1 → 2/2 → 0/4. Samples during the two pauses showed candidate traffic shares of 30.8% and 47.0%; replica weighting is approximate. Both owned AnalysisRuns passed all three metrics with three measurements each. Candidate traffic measured 2.76–4.84 requests/second and error ratio zero.

The isolated `-fault` image automatically aborted at 04:53:19.559Z when its owned analysis measured error ratio 1.0 against the 5% gate. All 14 stable-Service samples during the fault stage passed. Normal frontend → Service → backend probes used fresh connections without retries or fallback:

| Stage | Requests | Failed requests |
| --- | ---: | ---: |
| Baseline/setup | 336 | 0 |
| Healthy promotion | 2,115 | 0 |
| Fault candidate | 770 | 143 HTTP 500 |
| Stable restoration | 114 | 5 HTTP 500 |

All 148 failures remain counted, including the five during restoration. Separately, stable-Service API-proxy samples passed 59/59 across promotion, fault, and restoration. This bounded result does not establish zero downtime or resolve kind's previously observed diagnostic-route gap.

At 04:53:41.362Z, Argo was Healthy/Synced at `e4a0d80`, with four ready stable replicas (`b696cdf94`) and no fault-image pods. The final backend is `request-tracker:k3s-e4a0d80-20261028063718-good`, an immutable alias of the tested baseline artifact; the frontend retains `k3s-e4a0d80-20261028063718`. Requests, assignments, staff, history, Flyway, Secret/configuration digests, PVC identity, and StatefulSet specification matched their snapshots. Kind's data/resources and default context were unchanged. The k3s server used about 3.14 GiB of its 5 GiB cap at the final sample; host free disk was 9.5 GiB.

The single-node cluster and local-path storage provide no node-failure redundancy. The restore pod remains running with its independent ephemeral database. These container-based k3s results do not cover native Linux service management, multiple nodes, RKE2, or cloud storage.
