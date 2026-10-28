# Local GitOps and progressive delivery

## Ownership and scope

Use context `kind-request-tracker`, namespace `request-tracker`. The Helm release `request-tracker` remains the schema-compatible fallback. Its database StatefulSet, PVC, Secret, configuration, ServiceAccount, and application resources are not adopted by Argo CD. Both application stacks share the existing database; this is not a separate test database.

Argo CD Core v3.5.6 manages only the chart's `delivery.enabled` mode, with resource names prefixed `request-tracker-delivery`. The AppProject excludes Secrets, PVCs, StatefulSets, and cluster resources. Argo Rollouts v1.10.1 owns backend ReplicaSets and the stable/canary Service hash selectors. Argo CD ignores only that hash selector field. Do not run `helm upgrade` with delivery mode enabled: Helm owns the baseline, Argo CD owns delivery desired state, and Rollouts owns rollout progression.

The ordinary chart mode remains unchanged. The delivery frontend routes to the delivery backend. Four replicas implement approximate pod-weighted 25% → 50% → 100% exposure through a ClusterIP Service, with a separate stable Service for availability checks. These are replica-based proportions, not precise request-routing guarantees. No ingress or service mesh is installed.

One in-cluster Prometheus scrapes each backend pod every five seconds and labels metrics with its Rollout hash. Existing Compose Prometheus is independent. Analysis requires at least 0.5 candidate requests/second, less than 5% 5xx, and mean response time below one second, for three measurements at 15-second intervals after warmup. Missing vectors/traffic and NaN cannot pass. These are exercise gates, not measured production SLOs.

The optional read-only traffic deployment makes about ten requests/second against queue, staff, and saved-request history endpoints with new HTTP connections. Prometheus and Argo administrative endpoints are ClusterIP/internal only; use localhost port-forwards. Prometheus data is ephemeral (two-hour retention), so save exercise evidence outside Git.

## Bootstrap and release preparation

The host has 12 logical CPUs and about 15 GiB available to kind. `delivery/bootstrap.ps1` installs pinned upstream Core/Rollouts bundles and sizes controllers; ApplicationSet is disabled because this exercise does not use it. No Argo CD API server, dashboard, SSO, or infrastructure monitoring stack is required.

1. Complete the release/restore checks in [local recovery](local-recovery.md). Never roll back below schema V5 with an old application image.
2. Build/load the immutable application tags referenced by `delivery/values-kind.yaml` into the existing cluster. Local kind loading is a development mechanism, not a registry publication workflow.
3. Run `helm lint helm/request-tracker -f delivery/values-kind.yaml`, render both chart modes, and server-dry-run the delivery resources after installing the CRDs. Inspect resource names: none may overlap baseline resources.
4. Publish the reviewed `delivery/argocd-rollouts` branch **only with explicit permission**. Then apply `delivery/application.yaml` with context `kind-request-tracker`. Argo CD must fetch that branch from the actual origin; local files are not GitOps evidence.
5. Wait for Application Synced/Healthy and Rollout Healthy. Use `python delivery/observe.py --expect healthy --output target/delivery-initial.json`. Inspect actual Prometheus targets and HTTP metrics before starting a candidate.

## Exercise sequence

Prepare four reviewed Git commits: baseline with traffic enabled, healthy candidate, faulty candidate, and the healthy candidate restored with traffic disabled. Advance the same published branch through those exact commits in order, waiting between each. Obtain permission for the specific branch/commits before any push. A healthy candidate may reuse the tested release artifact under a new immutable tag; no product feature is added by this exercise.

- Drift: scale `deployment/request-tracker-delivery-frontend` from one to two replicas. Observe OutOfSync and automatic restoration to one replica, then Synced/Healthy. Do not drift database resources.
- Healthy candidate: publish its commit and run `delivery/observe.py --expect healthy --require-availability --output target/delivery-good.json`. Require successful AnalysisRuns at both exposure stages, observed stable/canary traffic, and final stable hash equal to the candidate hash.
- Missing metrics: create an AnalysisRun using `request-tracker-delivery-http` with revision `nonexistent`. It must fail; zero traffic is not evidence of success.
- Faulty candidate: build only with `docker build -f delivery/fault/Dockerfile -t request-tracker:<unique-fault-tag> .`, then load it into kind. This isolated fixture adds an API-500 filter while leaving probes/metrics alive; it is absent from normal source/image builds. Publish its commit and run `delivery/observe.py --expect abort --require-availability --output target/delivery-bad.json`. Require failed error-rate analysis, automatic abort, a usable stable Service, and candidate scale-down.
- Restore: publish the prepared healthy desired-state commit. Require Synced/Healthy, no fault-image pods, and traffic disabled/pruned. Compare requests, staff, history, and Flyway with the pre-exercise snapshot. Disabling traffic also means a future analysis cannot pass until representative traffic is available again.

An aborted Rollout can still reference the bad desired image until Git is corrected. Do not stop at a manual abort or patch the image behind Argo CD. If Git synchronization is unavailable, pause reconciliation explicitly before emergency changes and later reconcile the reviewed stable Git state. The Helm frontend remains a fallback throughout this isolated delivery exercise.

## Evidence

Controller installation and manifest preparation alone do not complete Delivery. Record actual commit IDs, Application sync revisions, analysis outcomes, exposure measurements, stable availability, final image/hash, persistence comparison, and any failed/unrun checks after running the exercises. Browser verification remains separate from API/rollout verification.
