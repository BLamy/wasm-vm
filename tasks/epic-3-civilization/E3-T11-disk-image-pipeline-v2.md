---
id: E3-T11
epic: 3
title: Reproducible Alpine disk-image build pipeline v2 with chunking
priority: 311
status: pending
depends_on: [E3-T01]
estimate: M
capstone: false
---

## Goal
One command builds the production Alpine riscv64 disk image reproducibly — pinned package
versions, preinstalled baseline, deterministic bytes — then chunks it, generates the T01
manifest and the T03 boot profile, and emits a CDN-ready artifact directory with
content-addressed, immutably-cacheable files.

## Context
Epic 2's image was hand-rolled; Civilization needs an image we can rebuild byte-identically
(so chunk hashes are stable and CDN caches stay warm across rebuilds that don't change
content). Build via Docker (or apko/alpine-make-rootfs) against a *pinned* Alpine snapshot
mirror or an explicit apk-versioned world file; set `SOURCE_DATE_EPOCH`, normalize
timestamps/uids in the ext4 image (mke2fs `-d` with fixed hash seed via `-U` and
`E2FSPROGS_FAKE_TIME`). Baseline packages: alpine-base, agetty/openrc bits from Epic 2,
ca-certificates, curl, nano or vim — lean; python3 stays *out* (the capstone installs it).
`/etc/apk/repositories` must point at the mirror scheme the network stack will actually
reach (see T17/T20) — coordinate the URL now, plain-HTTP mirror is acceptable because apk
verifies signatures. Artifacts: `manifest.json`, `chunks/{sha256}.bin`, `boot-profile.json`,
`image-info.json` (build inputs, versions) — all safe to serve with
`Cache-Control: immutable` because names are content hashes.

## Deliverables
- `tools/build_image/` (Dockerfile + script or Makefile): rootfs build → ext4 → chunk +
  manifest + boot-profile generation, one entrypoint `./build.sh`.
- Reproducibility check built into the script: build twice, diff manifests, fail on drift.
- Pinning mechanism (snapshot mirror URL or committed `world` + explicit versions) checked
  into the repo.
- `docs/design/image-pipeline.md`: inputs, determinism techniques, how to bump packages,
  CDN layout and cache-header guidance.
- The built artifact set adopted as the image the web app loads by default.

## Acceptance criteria
- [ ] Two consecutive `./build.sh` runs on the same commit produce identical
      `manifest.json` (hence identical chunk set) — asserted by the script itself.
- [ ] The image boots to login through the T02/T03 streaming path and `apk update`
      succeeds once networking exists (until then: `apk version` runs and the repositories
      file matches the documented URL).
- [ ] No chunk file exceeds the manifest's chunk size; every file in `chunks/` is
      referenced by the manifest and vice versa (script-asserted).
- [ ] `image-info.json` records the Alpine release, mirror snapshot, and package list with
      exact versions.
- [ ] A one-package change (add `htop`) rebuilds with the majority of chunk hashes
      unchanged (record the churn percentage in the log — this validates CDN-friendliness).

## Adversarial verification
Rebuild on a *different machine/OS* (or at least a different Docker cache state) and diff
manifests — any drift refutes reproducibility. `mount` the assembled image and hunt for
nondeterminism sources: timestamps newer than SOURCE_DATE_EPOCH, random seeds, `/etc/
machine-id`, ssh host keys (must be absent/generated-on-first-boot). Corrupt one chunk in
the artifact dir and confirm the manifest hash check catches it at load. Verify the churn
claim: if adding one package rewrites >50% of chunks, the ext4 layout isn't stable — refute
and demand investigation (e.g., fixed inode allocation via `-d` ordering).

## Verification log
(empty)
