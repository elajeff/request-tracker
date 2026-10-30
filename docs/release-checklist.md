# Proposed v0.1.0 release checklist

This checklist describes a local educational release, not production readiness. No tag or GitHub Release has been created. The security/capstone changes are integrated into main at `44d2351`. The agreed v0.1.0 scope is source-only; no image or binary distribution is included. Runtime results below are recorded evidence, not newly repeated checks.

## Roadmap disposition

| Agreed area | Evidence/status for v0.1.0 |
| --- | --- |
| Repository workflow, reviews, CI | Existing manual milestone PR history, `.github/workflows/ci.yml`, and [architecture decision](decisions/0001-start-as-a-modular-monolith.md). Check the documentation PR's CI before merge; this checklist does not assert a fresh CI result. |
| Application, migrations, tests | Request CRUD/status/priority, assignment/history, cursor pagination, staff rules, and conservative V5 migration are integrated. Recorded backend verification includes 24 passing tests; frontend build and HTTP workflows passed. See [recovery](runbooks/local-recovery.md) and [capstone results](runbooks/capstone-demonstration.md). |
| Dashboard acceptance | Manual acceptance passed. No automated browser coverage is claimed. |
| Containers and configuration | Dockerfiles, Compose, Helm values, ConfigMap/Secret references, unique local image tags, and build checks are present. Full build/distribution reproducibility gaps remain below. |
| kind, probes, limits, permissions | [Deployment](kind-deployment.md), [restart/database recovery](runbooks/local-recovery.md), readiness regression coverage, and PostgreSQL limits correction are recorded. A separate kind configuration-error exercise is not established by this evidence. |
| Monitoring, logs, alerts | [Monitoring configuration and rule checks](monitoring.md), diagnostic logs, Prometheus metrics, and live analysis are recorded. Error/latency thresholds used for exercises are not production SLOs. |
| Failure diagnosis and recovery | [Drain investigation](runbooks/delivery.md), backend/database recovery, isolated restores, and [new capstone outage/restore](runbooks/capstone-demonstration.md) have evidence. A complete lost-cluster rebuild was not demonstrated. |
| GitOps and progressive delivery | Git synchronization, drift reconciliation, actual promotion, automatic abort, and stable restoration are recorded in [delivery](runbooks/delivery.md) and [capstone results](runbooks/capstone-demonstration.md). The latest Git-published walkthrough counted 165 HTTP 500s in 6,360 normal-route requests, including 39 in the restoration window; no retries/fallback concealed them. |
| k3s practice | [k3s results](runbooks/k3s.md) distinguish actual k3s from the k3d Docker helper and local Argo overrides from the later Git-published release demonstration. RKE2 remains deferred under the current scope. |
| PreviewEnvironment extension | [API, retention, ownership, RBAC and verification](../preview-controller/README.md): 14 unit tests, completed revised 24-check live runner, separate retained-data readback, and restricted-admission checks. Earlier interrupted verification remains identified separately. |
| Security/capstone | [Bounded review](runbooks/security-capstone.md) and [executed demonstration](runbooks/capstone-demonstration.md). No vulnerability scan, penetration test, encryption-at-rest audit, HA, or production security assurance is claimed. |
| Walkthrough, architecture, release | Written commands, observations, runbooks, and modular-monolith ADR exist. No screen recording was captured. Release packaging/publication remains pending. |

Accepted v0.1.0 deferrals: formal SLO definition; configuration-error and whole-cluster recovery exercises not demonstrated; broader certification-style labs and RKE2; video recording; published image/binary distribution and clean-machine bundle verification. These remain deferred, not complete. Public hosting, authentication, and additional product features remain outside the release scope.

## Reproducibility and packaging gaps

- Application Dockerfiles still use upstream build/runtime tags; timestamps, artifact bytes, and transitive build inputs are not guaranteed reproducible. The controller's Python base, package versions, and PostgreSQL image are pinned, but this is not a bit-identical-build claim.
- Application/controller image references in local manifests depend on images already built and imported into kind/k3d. There is no published registry distribution or verified clean-machine release bundle yet.
- Local kubeconfig paths, Windows tooling, storage-class names, and cluster-specific image/Secret parameters need to be followed explicitly. Credentials must be generated separately; existing credentials are never release assets.
- Binary/image artifact builds, digest manifests, distribution, and clean-machine bundle verification are deferred. Review current merged-main CI before tagging; no fresh CI result is asserted here. Source-only release preparation does not close the deferred distribution gaps.
- Raw evidence and backups live outside Git on this workstation. Curate a sanitized summary if portable release evidence is required; never attach raw dumps, Secrets, kubeconfigs, or private configuration.

## Retained state and commit accounting

Both kind and k3s clusters, original application data, and the two retained preview PVC/Secret pairs remain preserved. Existing backup/diagnostic directories and ignored `target/`, frontend build/dependency output, Python caches, and local image archives remain local. Retained-pair disposal requires explicit selection and backup; it is not a release-cleanup step.

The original local commit `643812d` remains on `feat/argocd-track-main`; its still-needed wording patch is incorporated in published capstone commit `f4465c5`. Do not publish the original merely to duplicate that patch. Excluded `89d41d0`, superseded `7ee576c`, `68fdb1e`, `d8910ce`, and the original equivalent recovery commit `058ce04` remain preserved outside release ancestry. The actual published branches, rather than potentially stale local remote-tracking refs, determine publication status.

The demo branch `demo/security-capstone-delivery` remains at `5611dca` as evidence. Both Applications were restored to main with their original source settings; the demo branch is not their current source. Do not delete branches or clusters as part of release preparation without separate authorization.

## Proposed tag and contents

Propose annotated tag **`v0.1.0`** on the final reviewed/merged main commit after capstone integration and checklist acceptance, not on the temporary demo branch. No local or remote tag with this name was observed during preparation. Recheck the name and target before any authorized tag operation.

Source-only contents: source at the reviewed final main commit; application/frontend/controller Dockerfiles and dependency declarations; Helm chart; PreviewEnvironment CRD/RBAC/examples; migrations; tests and CI; setup/recovery/security runbooks; and a concise verification/limitations summary. Use only the Git source archives and release notes. No custom binary, JAR, frontend bundle, OCI archive, database, or video attachment is proposed.

Do not include database dumps, kubeconfigs, credentials, `.env` files, raw diagnostics, dependency directories, disposable datasets, or an alleged video. Written demonstration evidence is available; a video is neither captured nor required unless separately agreed.

## Release gates

- [x] Capstone integration confirmed at main `44d2351`; no new CI result is claimed.
- [x] Explicit v0.1.0 deferrals accepted without marking them complete.
- [x] Source-only packaging selected; binary/image distribution and clean-machine bundle verification deferred.
- [ ] Review/merge release documentation, check its CI, and fetch the resulting main commit.
- [ ] Confirm the exact final main SHA, source inventory, sanitized release notes, and tag availability after documentation integration. A future merge SHA cannot be named in advance.
- [ ] Obtain explicit authorization before creating/pushing the annotated `v0.1.0` tag or publishing a source-only GitHub Release.

## Subsequent source-only v0.2.0 preparation readiness

The v0.1.0 proposal/gates above remain their historical scope. Milestone C runtime verification completed on 30 October 2026; [the closeout](runbooks/v6-kind-progressive.md#completed-approved-v6-exercise-milestone-c-closeout) records authenticated kind V6 promotion/automatic abort, 23,956 requests including 657 injected HTTP 500s, validated final accounting and preserved main-based Healthy/Synced state. All earlier failures and unresolved latency/search limitations remain documented; no zero-downtime or production-readiness claim follows.

The project is ready to **prepare** a source-only v0.2.0 release: curate the source inventory, sanitized verification summary and release notes. This execution created no v0.2.0 tag, GitHub Release, registry image or binary publication. Image/binary distribution, clean-machine bundle verification and bit-identical build guarantees remain deferred.

- [x] Complete Milestone C's bounded runtime verification and local factual closeout.
- [ ] Review/integrate the focused source/documentation changes and check current CI.
- [ ] Prepare/review the exact final source inventory, release notes, target SHA and tag availability.
- [ ] Obtain explicit authorization before creating/pushing a v0.2.0 tag or publishing a Release.

Proposed publication excludes demo-only values/fault-stage changes and all credentials, backups, raw diagnostics, generated evidence, dependencies and image/binary archives. The runtime execution created no PR and did not push its local closeout documentation. The focused review branch carries the subsequent integration changes.
