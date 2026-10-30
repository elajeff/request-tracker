# Local GitOps and progressive delivery

## Ownership and scope

Use context `kind-request-tracker`, namespace `request-tracker`. The Helm release `request-tracker` remains the schema-compatible fallback. Its database StatefulSet, PVC, Secret, configuration, ServiceAccount, and application resources are not adopted by Argo CD. Both application stacks share the existing database; this is not a separate test database.

Argo CD Core v3.5.6 manages only the chart's `delivery.enabled` mode, with resource names prefixed `request-tracker-delivery`. The AppProject excludes Secrets, PVCs, StatefulSets, and cluster resources. Argo Rollouts v1.10.1 owns backend ReplicaSets and the stable/canary Service hash selectors. Argo CD ignores only that hash selector field. Do not run `helm upgrade` with delivery mode enabled: Helm owns the baseline, Argo CD owns delivery desired state, and Rollouts owns rollout progression.

The ordinary chart mode remains unchanged. The delivery frontend routes to the delivery backend. Four replicas implement approximate pod-weighted 25% → 50% → 100% exposure through a ClusterIP Service, with a separate stable Service for availability checks. These are replica-based proportions, not precise request-routing guarantees. Replica-weighted canaries do not support traffic-router scale-down delays. No ingress or service mesh is installed.

One in-cluster Prometheus scrapes each backend pod every five seconds and labels metrics with its Rollout hash. Analysis uses the fully qualified Service address because the Rollouts controller runs in another namespace. Existing Compose Prometheus is independent. Analysis requires at least 0.5 candidate requests/second, less than 5% 4xx/5xx, and mean response time below one second, for three measurements at 15-second intervals after warmup. Session and actuator traffic is excluded. Missing vectors/traffic and NaN cannot pass. These are exercise gates, not measured production SLOs; the recorded pre-authentication exercises used the earlier 5xx-only gate.

The optional read-only traffic deployment uses four workers with a 200 ms interval, producing up to twenty requests/second against queue, staff, and saved-request history endpoints with new HTTP connections. Prometheus and Argo administrative endpoints are ClusterIP/internal only; use localhost port-forwards. Prometheus data is ephemeral (two-hour retention), so save exercise evidence outside Git.

Authentication-compatible releases require a provisioned SUPPORT account Secret for traffic and a coordinated upgrade of both application routes. Pre-authentication backends are unsafe rollback peers despite schema compatibility. See [authentication](../authentication.md#migration-and-deployment) before using this procedure with V6 images. The earlier observer and historical exercises predate authentication; anonymous availability probes cannot verify authenticated application workflows.

## Bootstrap and release preparation

`delivery/bootstrap.ps1` installs pinned upstream Core/Rollouts bundles and sizes controllers; ApplicationSet is disabled because this exercise does not use it. No Argo CD API server, dashboard, SSO, or infrastructure monitoring stack is required.

1. Complete the release/restore checks in [local recovery](local-recovery.md). For the current authenticated V6 database, release/rollback peers must be authentication-compatible V6; never select a V5/pre-authentication backend.
2. Build/load the immutable application tags referenced by `delivery/values-kind.yaml` into the existing cluster. Local kind loading is a development mechanism, not a registry publication workflow.
3. Run `helm lint helm/request-tracker -f delivery/values-kind.yaml`, render both chart modes, and server-dry-run the delivery resources after installing the CRDs. Inspect resource names: none may overlap baseline resources.
4. Apply `delivery/application.yaml` with context `kind-request-tracker`. The Application tracks main; candidate exercises use a separate reviewed branch and restore the original source afterward.
5. Wait for Application Synced/Healthy and Rollout Healthy. Use the candidate-specific readiness checks in [the authenticated procedure](v6-kind-progressive.md). Inspect actual Prometheus targets and HTTP metrics before starting a candidate.

## Exercise sequence

Prepare reviewed Git commits for baseline with traffic enabled, healthy candidate, faulty candidate, and the healthy candidate restored with traffic disabled. Advance the same published branch in order, waiting for verification between stages. The healthy candidate reuses the tested release artifact under a new immutable tag; no product feature is added by this exercise.

- Drift: scale `deployment/request-tracker-delivery-frontend` from one to two replicas. Observe OutOfSync and automatic restoration to one replica, then Synced/Healthy. Do not drift database resources.
- Healthy candidate: publish its commit and use the strict candidate gate in [the authenticated canary procedure](v6-kind-progressive.md). Require successful AnalysisRuns at both exposure stages, observed stable/canary traffic, and final stable hash equal to the candidate hash.
- Missing metrics: create an AnalysisRun using `request-tracker-delivery-http` with revision `nonexistent`. It must fail; zero traffic is not evidence of success.
- Faulty candidate: build only with `docker build -f delivery/fault/Dockerfile -t request-tracker:<unique-fault-tag> .`, then load it into kind. This isolated fixture adds an API-500 filter while leaving probes/metrics alive; it is absent from normal source/image builds. Publish its commit and observe the automatic-abort gate in [the authenticated canary procedure](v6-kind-progressive.md). Require failed error-rate analysis, automatic abort, a usable stable Service, and candidate scale-down.
- Restore: publish the prepared healthy desired-state commit. Require Synced/Healthy, no fault-image pods, and traffic disabled/pruned. Compare requests, staff, history, and Flyway with the pre-exercise snapshot. Disabling traffic also means a future analysis cannot pass until representative traffic is available again.

An aborted Rollout can still reference the bad desired image until Git is corrected. Do not stop at a manual abort or patch the image behind Argo CD. If Git synchronization is unavailable, pause reconciliation explicitly before emergency changes and later reconcile the reviewed stable Git state. Account for baseline-route diagnostics separately; they cannot replace failed normal-route traffic.

## Verification and limits

See [pre-authentication results](../verification/delivery.md) for shutdown/proxy behavior, network failures and the five-second preStop correction. Current [authenticated canary results](../verification/canary-release.md) are separate. The 40-second backend termination budget allows five seconds of drain, 30 seconds of graceful shutdown and five seconds of margin. Service-selector changes are not atomic; no zero-downtime guarantee follows.
