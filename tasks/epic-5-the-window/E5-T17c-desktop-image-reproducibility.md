---
id: E5-T17c
epic: 5
title: Prove desktop image reproducibility, size budget, and chunk deduplication
priority: 517.3
status: verified
depends_on: [E5-T17b]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that the T17 desktop builder is reproducible from its committed profile and that the real
uncompressed image delta and streamed chunks stay within the E3 budget.

## Boundary

This slice owns normalized build comparison, byte accounting, and E3 chunk reuse. It does not
change startup configuration or perform the repeated runtime boot/persistence proof.

## Deliverables

- A two-build verifier comparing timestamp-normalized `apk info -v` and `find` file manifests.
- Real ext4 delta accounting using allocated/content bytes, with a loud failure above 350 MiB.
- A chunk manifest/diff showing unchanged E3 chunks are reused and only desktop delta chunks are
  fetched, plus a deterministic `make verify-E5-T17c` target.

## Acceptance criteria

- [ ] Two consecutive builds from the same profile have identical normalized package versions and
      file listings; the verifier reports any content divergence with the first differing entry.
- [ ] The builder fails when the real uncompressed ext4 delta exceeds 350 MiB, and the passing
      build records the current delta in machine-readable evidence.
- [ ] The chunk manifest deduplicates unchanged E3 base chunks and identifies every new desktop
      chunk; a sparse-file size or full-base re-upload cannot satisfy the check.
- [ ] `make verify-E5-T17c` passes from a scrubbed environment without relying on timestamps,
      host paths, or an undeclared package cache.

## Adversarial verification

Touch files without changing content, vary build timestamps and output directories, and compare
again; normalized manifests must remain equal. Replace one byte in a package/config file, remove a
base chunk from the dedupe index, and feed a sparse image to the size check; each mutation must be
detected or rejected.

## Verification log

### 2026-09-05 — worker — IMPLEMENTED

- Commit: `10e4b5866225d8a61c0fda8a20fc25c8464137e7` (`feat(e5-t17c): prove desktop image reproducibility`).
- Exact submission command: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17c`.
- Evidence: [`evidence/e5-t17c/desktop-image-reproducibility.json`](../../evidence/e5-t17c/desktop-image-reproducibility.json), SHA-256 `df531f72268c01ee9968667fd13d88f8681dcc2265d768768099ca9ba29f842c`.
- The run passed `cargo fmt --check`, the affected CLI `cargo clippy -- -D warnings`, release build, shell/Node syntax checks, the T17a profile check, two fresh 1 GiB desktop image builds in distinct output directories, the T17b startup verifier, ext4 inspection, and `wasm-vm chunk`/`chunk-verify`. Both images are byte-identical at SHA-256 `99cede87db8ffec8b68933862f5f1aa8abfb30d9c4968b7127a30e7b79bad785`; normalized package and custom-file manifests remain equal after timestamp perturbation. The real allocated ext4 delta is 103,636,992 bytes and the conservative content/chunk delta is 105,250,816 bytes, both below the 367,001,600-byte (350 MiB) budget. The E3 comparison reuses 3,211 of 4,096 base positions (0.7839 ratio), identifies 803 new objects, and rejects full-base upload, base-index deletion, package/config mutations, and a sparse non-ext4 file. The evidence uses only local native tooling and Docker e2fsprogs; independent machines, WebKit, SSH/rr are intentionally waived per the active verification policy/user direction.

### 2026-09-05 — verifier — VERDICT: verified

- Predictions held: evidence is bound to `10e4b5866225d8a61c0fda8a20fc25c8464137e7`, result `passed`, both images share SHA-256 `99cede87db8ffec8b68933862f5f1aa8abfb30d9c4968b7127a30e7b79bad785`, and normalized package/file manifests plus portable metadata paths match.
- Ext4 accounted delta `105250816 <= 367001600`; sparse rejection is recorded. Chunks are 131072 bytes (128 KiB), with 3211 unchanged positions and 803 new objects; full-base upload rejection is recorded. All five mutation self-tests are recorded.
- Bounded novel attack: replacing build-B `desktop-info.json` with build-A metadata was rejected (exit 1) on the exact wrong-image-path assertion. Original metadata was restored; no implementation code was modified.
- Commands: short jq assertions/path inspection; metadata-swap verifier invocation; `python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`; `make tasks-json`.
