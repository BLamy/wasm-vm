---
id: E5-T33
epic: 5
title: Build Replay Node 26 for riscv64 with the unbundled driver
priority: 0.386
status: pending
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Cross-compile `replayio/node` `v26.13.1-replay` for riscv64 Linux (glibc, LP64D),
optimized (`-O2`/`-O3`, LTO if it fits), with no recording driver embedded or
fetched. Package `bin/node` plus its runtime files for the shared desktop image.

## Deterministic acceptance

Under QEMU riscv64: `node --version` prints `v26.13.1`, and a script that uses
`WebAssembly`, `crypto.subtle`, `worker_threads` and `fs` exits 0 with the expected
output. `tools/privacy/check-no-replay-backend.py` passes on the package.

## Adversarial verification

Medium risk: confirm the binary's architecture and ABI, and prove no driver bytes
are present or fetched at startup (no network access during the smoke).

## Verification log

(empty)
