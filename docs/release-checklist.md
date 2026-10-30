# Release checklist

The published [v0.1.0 release](https://github.com/elajeff/request-tracker/releases/tag/v0.1.0) is source-only. Its [historical scope](v0.1.0-release-proposal.md) predates authentication and the React staff UI.

The source-only [v0.2.0 release](https://github.com/elajeff/request-tracker/releases/tag/v0.2.0) is published. See [GitHub Releases](https://github.com/elajeff/request-tracker/releases) for published versions.

## Checklist for subsequent source-only releases

Milestone C is merged and runtime verification is complete. Database migration V6 is not a project release number. Use the checks below for each subsequent source-only release.

| Verification | Reference |
| --- | --- |
| Sessions and deployment | [Authentication](authentication.md), [cutover results](verification/authentication-cutover.md) |
| React staff UI and deployed browser workflows | [React deployment](verification/react-deployment.md) |
| Authenticated canary promotion and automatic abort | [Canary results](verification/canary-release.md) |
| Recovery and network limitations | [Recovery](runbooks/local-recovery.md), [delivery](runbooks/delivery.md) |
| Controller lifecycle and security | [Controller](../preview-controller/README.md), [security](runbooks/security-capstone.md) |

- [x] Complete Milestone C verification and integrate its source/tests/documentation.
- [ ] Check CI for the final release target.
- [ ] Review source inventory and release notes against that target.
- [ ] Check tag availability and confirm the release version and target commit.
- [ ] Create an annotated tag and source-only release when publication is scheduled.

## Source contents

Include application/frontend/controller source, migrations, dependency locks, tests, CI, Dockerfiles, Helm resources and documentation. Exclude credentials, session material, kubeconfigs, private configuration, dumps, raw diagnostics, generated evidence, build output and image/binary archives. Preserve runtime databases and retained preview resources independently of source packaging.

## Limits

This is a local educational release, not production certification. Formal SLOs, high-availability storage, image/binary distribution and clean-machine bundle verification remain outside the release scope. The verification records retain material failures and unresolved latency/network behavior; no zero-downtime guarantee is made. React staff search still loads the directory into browser memory.
