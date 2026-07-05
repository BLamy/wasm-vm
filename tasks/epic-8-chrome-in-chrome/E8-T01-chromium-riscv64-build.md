---
id: E8-T01
epic: 8
title: Stock chromium-riscv64 — obtain or build an unmodified browser artifact, pinned
priority: 801
status: pending
depends_on: [E6]
estimate: L
capstone: false
---

## Goal
A pinned, **stock, unmodified** `chromium-riscv64` build to run inside the machine. The whole
Level 8 thesis rests on this being *ordinary* Chromium — no fork, no instrumentation, no Replay
patches — so the determinism can live entirely in the VM around it. This task acquires (from a
distro/upstream riscv64 build) or reproducibly builds that artifact and records exactly what it is.

## Context
Chromium builds for riscv64 (Debian/openKylin/other distros ship it). Prefer a distro package or
an upstream release over a local build to reinforce "stock"; if we must build, do it from an
unmodified upstream checkout at a pinned tag with the config recorded, and check zero local
patches. Capture the build provenance (source, version, config, sha256) so the E8-T10 audit can
later certify "no fork." This is a large artifact — plan its place in the E3 chunked disk-image
pipeline (lazy fetch). No booting yet; this task just pins and provenance-checks the binary.

## Deliverables
- A pinned chromium-riscv64 artifact in `releases/` with a provenance manifest: exact
  source/package, version, build config, sha256, and an explicit "patches: none" attestation.
- The artifact integrated into the E3 chunked image pipeline (lazy-fetchable).
- `tools/verify-chromium-stock.sh`: re-derives the artifact's provenance and asserts it matches
  a known upstream/distro build (no local diffs).

## Acceptance criteria
- [ ] The chromium-riscv64 artifact is present, sha256 recorded, and provenance documents it as
      an unmodified upstream/distro build (patch list empty).
- [ ] `file` on the main binary → `ELF 64-bit ... RISC-V`; it is genuinely riscv64-native (it
      will run on our CPU directly, *not* under box64).

## Adversarial verification
Independently fetch the same upstream/distro version and diff — any local modification refutes
"stock". Confirm the binary is riscv64 (not an x86_64 build that would sneak in a box64
dependency). Verify the provenance script fails if a byte of the binary is altered (mutate a
copy and run it). Confirm no Replay/devtools instrumentation strings are present (grep the
binary for known instrumentation markers as a sanity check).

## Verification log
(empty)
