---
id: E5-T30b
epic: 5
title: Generate genuine RISC-V call bridges for the local Replay driver
priority: 0.3812
status: pending
depends_on: [E5-T30a]
estimate: S
risk: high
capstone: false
---

## Boundary and acceptance

Implement the RISC-V instruction emitter and LP64D interception/invocation ABI in
the actual driver. This is the generated function-call boundary, not a replacement
recorder. Preserve integer/floating arguments, spilled stack data, structure-return
pointers, return values, RA, stack alignment and callee-save registers.

Acceptance: `python3 local/chromium-riscv64/driver/verify-call-abi.py`.

Use real generated routines against independently compiler-generated callees and
callbacks, fixed and indirect targets, boundary/full-width immediates, mixed FP,
8+ arguments, nested calls and poisoned nonvolatile registers. Record target
execution and guest digests in native wasm-vm Linux, plus independent disassembly
comparisons and varied seeds. Check instruction-cache publication. Run affected
warning-clean builds and final exact-head pristine private clone once.

Fresh high-risk critic covers every new emitter/call path, one bounded novel ABI
attack, negative alignment/buffer boundaries, test sabotage and source/evidence
binding. Do not add unexecuted instruction helpers or placeholder driver APIs.
Private implementation and full proof remain ignored/local.

## Verification log

(empty)
