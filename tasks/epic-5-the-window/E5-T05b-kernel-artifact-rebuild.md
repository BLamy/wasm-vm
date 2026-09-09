---
id: E5-T05b
epic: 5
title: Rebuild and publish the Epic 5 kernel artifact
priority: 505.2
status: verified
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

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **Pinned rebuild — HELD.** Commit `7309032` runs `bash tools/build-kernel.sh` after deleting the exact `wasm-vm-kbuild-6.6.63` Docker volume. The clean-volume rebuild uses the pinned Linux 6.6.63 tarball (`d1054ab4…061835`) and reproduces the recorded Image, System.map, and config hashes.
- **Config/checksum gates — HELD.** `bash tools/check-kernel-config.sh 6.6.63` passes with the fragment honored and no modules; `(cd releases/kernel/6.6.63 && shasum -c SHA256SUMS)` reports Image, System.map, and config all OK.
- **Manifest binding — HELD.** `web/artifacts.json`, `web/artifacts-alpine.json`, and `web/artifacts-node-alpine.json` each bind `releases/kernel/6.6.63/Image` to SHA-256 `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce` and size `24208896`.
- **Size budget — HELD.** The Image grew from `22097408` to `24208896` bytes, a delta of `2111488` bytes / `2.013672 MiB`, below the `4 MiB` limit.
- **Tamper resistance — HELD.** Appending bytes to a temporary Image copy caused `shasum -c SHA256SUMS` to fail that artifact while the untouched System.map and config remained valid.
- **Scope note — HELD.** Independent machines and WebKit are outside this recorded proof per user direction; the clean local Docker rebuild is the task's reproducibility attack.
- Evidence: `evidence/e5-t05b/kernel-artifact-2026-09-03.json` (SHA-256 `1fa84fcaa3238135f8d5703f333176d874ed1db14776de4936b7438ca2be6f72`).
