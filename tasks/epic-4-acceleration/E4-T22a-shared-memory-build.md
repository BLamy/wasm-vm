---
id: E4-T22a
epic: 4
title: Shared-memory wasm build and fallback artifact contract
priority: 422.1
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- **Shared artifact — HELD.** Predicted the nightly build would emit a bounded shared memory
  imported from `env.memory`, not merely a module compiled with atomics enabled. The exact build
  printed `memory[0] pages: initial=19 max=32768 shared <- env.memory` and preserved the raw module
  at `crates/wasm/pkg-shared/wasm_vm_wasm.wasm`.
- **Fallback artifact — HELD.** Predicted the stable build would remain an internally-owned,
  non-shared memory after the shared build. `wasm-objdump` reported `memory[0] pages: initial=19`
  for `target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm`, and its import section contained
  no shared `env.memory` import.
- **Determinism and attack surface — HELD.** Predicted a repeat from a scrubbed shell would retain
  the shared artifact identity and the build recipe would fail closed if its inspection tool could
  not prove the import. The repeat assertion held SHA-256
  `b49488580899e9e6a4d8f6e84c67a0734cc330e46fb1a3ea878ff8dde28d9947`; the initial missing
  `rust-src`/`wasm-objdump` attempts failed before acceptance and were resolved by installing only
  the documented local prerequisites. The build then passed with no source-local `RUSTFLAGS` relied
  upon by the script.
- **Coverage — HELD.** The changed build recipe, output preservation, and ignore rule all executed
  in the exact two-variant run; the raw shared and stable wasm identities are recorded separately.
- **SUITE:** promoted the repeatable artifact inspection JSON as the durable proof.

Implementation commit: `8fbffd5`.

Evidence: `evidence/e4-t22a/shared-memory-build-2026-09-03.json` (SHA-256
`2d0d5f726fb2ea1a603ef963284c979c65d263270a6403e5b4e8e40cde67a8e2`).

Commands: `bash -lc 'bash tools/build-web-shared.sh && cargo build -p wasm-vm-wasm --release
--target wasm32-unknown-unknown'`; `wasm-objdump -x -j Import` and `wasm-objdump -x -j Memory`
inspection; the same build repeated with a SHA-256 equality assertion; `python3
tools/check_task_policy.py`; and `python3 tools/build_queue.py`. The shared recipe's optional
version-matched wasm-bindgen glue was not generated because the 0.2.126 CLI is absent; the raw
shared-memory artifact and import proof are complete.
