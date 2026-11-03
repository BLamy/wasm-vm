---
id: E0-T33
epic: 0
title: Preserve the local Replay Chromium RISC-V build workspace
priority: 0.36
status: in-progress
depends_on: [E0-T32]
estimate: S
risk: low
capstone: false
---

## Boundary

User-requested local project housekeeping and provenance. Retain a real copy of the
existing Replay Chromium RISC-V source/dependencies and build records inside this
project, without putting the large checkout or disk images in Git or Docker build
contexts. Record its exact source pin, local port patch digests, and incomplete build
status. This task makes no browser correctness, sandbox, performance, record/replay,
or wasm-vm guest integration claim. The cancelled stock-Chromium Epic 8 tasks stay
cancelled. Publishing is limited to BLamy/wasm-vm; never push or open a PR upstream
in replayio/chromium.

## Deliverables

- Ignored project-local `local/chromium-riscv64/` containing the source Git repository,
  dependency checkouts, local changes, build scripts/logs, and immutable GUI base.
- Small tracked provenance manifest, port patch archive, read-only local-copy check,
  and instructions explaining the separate active build container.
- Git and Docker ignore rules for the large local workspace.

## Deterministic acceptance

`python3 tools/chromium/check-local-copy.py`

The command must confirm the pinned Replay source revision, real local Git checkout,
port patches and changed-source digests, dependency revisions, and ignore rules.
It must report that the full Chrome executable is still unbuilt and that no sandbox
backport has been applied. It must perform no fetch, push, build, or source mutation.
The check requires the retained local workspace; a fresh clone of wasm-vm alone
contains its manifest and patch archive, not Chromium's large source tree or images.

## Adversarial verification

Low risk, direct result only: independently compare the retained source and patch
archive to the manifest, inspect Git/Docker exclusions, and ensure the documentation
does not present partial compilation or a standalone QEMU desktop as a working
Chromium or a wasm-vm browser integration. Source/patch archival is evidence of
preservation, not evidence that the archived runtime port is correct.

## Verification log

### 2026-11-03 — worker — activation

Requested directly by the user while cleaning old worktrees and updating to main.
Parent E0-T32 is verified. Based on `origin/main` at
`24e2a1a639993394f6dbddc74970eeeac8c0f054`; previous local edits and worktree proofs
are preserved outside this task's diff.
