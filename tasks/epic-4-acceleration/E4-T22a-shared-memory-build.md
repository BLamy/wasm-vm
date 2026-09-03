---
id: E4-T22a
epic: 4
title: Shared-memory wasm build and fallback artifact contract
priority: 422.1
status: in-progress
depends_on: [E4-T11]
estimate: S
risk: high
capstone: false
---

## Goal

Produce two inspectable wasm artifacts for the CPU-worker path: a nightly shared-memory module
that imports `env.memory` with the declared maximum, and the stable single-threaded fallback that
owns ordinary linear memory. Keep the build flags and artifact locations reproducible.

## Context

`WebAssembly.Memory({shared:true})` is only useful when the module accepts the same imported memory.
The existing `tools/build-web-shared.sh` is the narrow build seam; the normal `make wasm` path must
remain stable and non-shared. This task proves the artifact contract before browser wiring consumes
it.

## Deliverables

- Shared build recipe and Makefile entry, including `+atomics,+bulk-memory,+mutable-globals`,
  `--shared-memory`, `--import-memory`, and the bounded maximum.
- Stable fallback build remains available at its documented path and is not accidentally linked with
  shared-memory flags.
- A small artifact inspection/result record with toolchain, wasm feature, import, and memory-limit
  facts.

## Acceptance criteria

- `bash -lc 'bash tools/build-web-shared.sh && cargo build -p wasm-vm-wasm --release --target wasm32-unknown-unknown'`
  exits successfully from a clean checkout; the shared script's own lld proof finds an imported
  `env.memory`, and the stable build completes afterward.
- The shared module reports a shared imported memory with the documented maximum, while the stable
  fallback reports a non-shared internally-owned memory.
- Repeating the command with the same toolchain and source produces the same artifact identity
  record apart from explicitly documented build timestamps.

## Adversarial verification

Unset `RUSTFLAGS`, set an unrelated target-feature value, and run the recipe from a fresh shell.
A successful-looking module with internal memory, an unbounded maximum, or an accidental shared
fallback is a failure.

## Verification log
