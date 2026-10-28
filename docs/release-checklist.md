# Proposed v0.1.0 release checklist

This checklist describes a local educational release, not production readiness. No tag or GitHub Release has been created. The security/capstone branch is published at `0f581b3` but still requires manual integration. Runtime results below are recorded evidence, not newly repeated checks.

## Roadmap disposition

| Agreed area | Evidence/status for v0.1.0 |
| --- | --- |
| Repository workflow, reviews, CI | Existing manual milestone PR history, `.github/workflows/ci.yml`, and [architecture decision](decisions/0001-start-as-a-modular-monolith.md). Check the current capstone PR's CI before merge; this checklist does not assert a fresh CI result. |
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

Proposed v0.1.0 deferrals requiring explicit scope acceptance: production SLO definition, the unproven configuration-error exercise, whole-cluster disaster recovery, and any broader named certification-lab syllabus. These are not marked complete. RKE2, public hosting, authentication, and additional product features are outside the current release work; do not start them to satisfy this checklist.

## Reproducibility and packaging gaps

- Application Dockerfiles still use upstream build/runtime tags; timestamps, artifact bytes, and transitive build inputs are not guaranteed reproducible. The controller's Python base, package versions, and PostgreSQL image are pinned, but this is not a bit-identical-build claim.
- Application/controller image references in local manifests depend on images already built and imported into kind/k3d. There is no published registry distribution or verified clean-machine release bundle yet.
- Local kubeconfig paths, Windows tooling, storage-class names, and cluster-specific image/Secret parameters need to be followed explicitly. Credentials must be generated separately; existing credentials are never release assets.
- A final artifact build, digest/checksum manifest, clean installation from those artifacts, and current merged-main CI acceptance have not been demonstrated for a release candidate. Any added verification needs a bounded packaging plan and approval for external publication.
- Raw evidence and backups live outside Git on this workstation. Curate a sanitized summary if portable release evidence is required; never attach raw dumps, Secrets, kubeconfigs, or private configuration.

## Retained state and commit accounting

Both kind and k3s clusters, original application data, and the two retained preview PVC/Secret pairs remain preserved. Existing backup/diagnostic directories and ignored `target/`, frontend build/dependency output, Python caches, and local image archives remain local. Retained-pair disposal requires explicit selection and backup; it is not a release-cleanup step.

The original local commit `643812d` remains on `feat/argocd-track-main`; its still-needed wording patch is incorporated in published capstone commit `f4465c5`. Do not publish the original merely to duplicate that patch. Excluded `89d41d0`, superseded `7ee576c`, `68fdb1e`, `d8910ce`, and the original equivalent recovery commit `058ce04` remain preserved outside release ancestry. The actual published branches, rather than potentially stale local remote-tracking refs, determine publication status.

The demo branch `demo/security-capstone-delivery` remains at `5611dca` as evidence. Both Applications were restored to main with their original source settings; the demo branch is not their current source. Do not delete branches or clusters as part of release preparation without separate authorization.

## Proposed tag and contents

Propose annotated tag **`v0.1.0`** on the final reviewed/merged main commit after capstone integration and checklist acceptance, not on the temporary demo branch. No local or remote tag with this name was observed during preparation. Recheck the name and target before any authorized tag operation.

Proposed contents: source at that commit; application/frontend/controller Dockerfiles and dependency declarations; Helm chart; PreviewEnvironment CRD/RBAC/examples; migrations; tests and CI; setup/recovery/security runbooks; and a concise verification/limitations summary. If distributable binaries or OCI image archives are selected, build and verify them separately, include exact source/image digests and SHA256 checksums, and inspect them for sensitive material before attachment. They do not exist as an approved release bundle yet.

Do not include database dumps, kubeconfigs, credentials, `.env` files, raw diagnostics, dependency directories, disposable datasets, or an alleged video. Written demonstration evidence is available; a video is neither captured nor required unless separately agreed.

## Release gates

- [ ] Manually review/merge the capstone PR with accepted CI results and preserved history.
- [ ] Accept the explicit v0.1.0 deferrals or specify bounded remaining work.
- [ ] Decide source-only versus distributable artifacts; close the corresponding packaging/installation gaps.
- [ ] Review the final main diff, sanitized release notes, artifact contents, checksums, and proposed tag target.
- [ ] Obtain explicit authorization before creating/pushing the tag or publishing a GitHub Release.
