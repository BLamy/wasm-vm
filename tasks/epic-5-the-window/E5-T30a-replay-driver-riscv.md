---
id: E5-T30a
epic: 5
title: Linux signal and stack context in the local RISC-V Replay driver
priority: 0.3811
status: in-progress
depends_on: [E5-T29a]
estimate: S
risk: high
capstone: false
---

## Boundary and acceptance

Port Linux PC/SP/FP context access and RISC-V frame records. Preserve unsupported
legacy syscall constants as unavailable metadata rather than aliasing differently
shaped calls. Build the real driver library, but do not claim its still-unported
machine-code bridges or recording path work. Scope is this Linux runtime ABI.

Acceptance: `python3 local/chromium-riscv64/driver/verify-platform.py`.

The recorded target run must use real production accessors and library code,
not replacement driver exports. Prove 16/32-bit breakpoint PCs, context writeback,
SP/FP extraction, caller frame/return addresses, bounded/corrupt frame handling,
and unavailable syscall metadata. Run on native wasm-vm Linux with guest evidence
and state digest; QEMU is a fast pre-check only. Use affected C++ builds with
warnings fatal, target tests, varied repeated signal/context cases, independent
compiler/ABI expectations, and the final exact-head pristine private clone.

Fresh high-risk critic: predict then inspect all listed cases, audit every changed
hunk, test frame edges/null/cycles and a bounded novel context attack, sabotage one
new test, and carry unchanged dependencies forward. Runtime semantic rework
restarts this selected gauntlet. Keep all private source/diffs and full evidence
under the ignored driver workspace; append only paths/digests/verdict here.

## Verification log

### 2026-11-03 — worker — activation

User explicitly corrected the goal to the genuine recording driver inside
wasm-vm. E5-T29a is verified at `022273fe284572fab4ff1306401a3210e0996110`.
The private driver checkout is local, with upstream pushes disabled. The initial
unmodified RISC-V build identified Linux context/stack and absent syscall-number
assumptions; actual generated call ABI and ELF interposition remain separate
subsequent gates. No private source or compile log is added to public Git.
