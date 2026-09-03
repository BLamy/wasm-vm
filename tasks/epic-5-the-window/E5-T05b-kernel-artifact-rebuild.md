---
id: E5-T05b
epic: 5
title: Rebuild and publish the Epic 5 kernel artifact
priority: 505.2
status: pending
depends_on: [E5-T05a]
estimate: S
risk: high
capstone: false
---

## Goal

Merge the Epic 5 fragment through the pinned Docker kernel pipeline and publish a matching Image,
System.map, config, SHA256SUMS, and loader manifests without hand-editing generated artifacts.

## Deliverables

- Rebuilt `releases/kernel/6.6.63/{Image,System.map,config,SHA256SUMS}` from the pinned Linux/toolchain
  inputs.
- Updated `web/artifacts*.json` entries whose kernel hash/size changed, with generated manifests
  matching the rebuilt Image.
- A recorded size delta against the pre-Epic-5 artifact and a clean-hash/provenance report.

## Acceptance criteria

- `tools/build-kernel.sh` completes, `tools/check-kernel-config.sh 6.6.63` passes, and
  `shasum -c releases/kernel/6.6.63/SHA256SUMS` validates every emitted artifact.
- The shipped manifest kernel URL, SHA-256, and byte size match the rebuilt Image exactly.
- Image growth is measured against the parent artifact and is at most 4 MiB.

## Adversarial verification

Delete the build volume and rebuild from the pinned tarball; compare the fresh Image hash and the
manifest against the recorded result. Tamper with one generated artifact and prove the checksum
gate fails before any manifest is accepted.

## Verification log
(empty)
