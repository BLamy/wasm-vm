---
id: E5-T30c
epic: 5
title: Load and interpose real RISC-V ELF calls in the local Replay driver
priority: 0.3813
status: pending
depends_on: [E5-T30b]
estimate: S
risk: high
capstone: false
---

## Boundary and acceptance

Port actual ELF machine/relocation recognition and driver symbol interposition for
RISC-V. Keep recorded function signatures/argument handling architecture-correct;
never reinterpret another architecture's instruction bytes as executable RISC-V.

Acceptance: `python3 local/chromium-riscv64/driver/verify-interposition.py`.

Use real RISC-V ELF/shared-library fixtures, compiler-produced relocations and the
actual driver hooks. Prove original and redirected calls, internal libc/PLT cases
needed by Chromium, return addresses and cache coherence; reject unsupported
relocations explicitly. Record native wasm-vm guest execution/digests, affected
warning-clean C++ builds, varied cases and final exact-head private cold clone.

Fresh high-risk critic audits every changed relocation/hook path, mismatched ELF,
unknown types, argument corruption and one novel bounded interposition attack.
Sabotage one new test once. No bypass, fake recorder, upstream push or publication
of private implementation/proofs.

## Verification log

(empty)
