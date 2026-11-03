---
id: E5-T30c
epic: 5
title: Load and interpose real RISC-V ELF calls in the local Replay driver
priority: 0.3813
status: in-progress
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

### 2026-11-03 — worker — activation

E5-T30b is independently verified at `90a24df8e8efc6c1acb4f7eeeddd2066480162e9`.
The actual built Chromium uses RISC-V relative, absolute-64 and PLT relocations;
its driver/libc dependencies also use dynamic and initial-exec TLS relocations.
Start the real recording driver's ELF recognition/interposition boundary, retaining
the prior platform/call proof. No upstream pushes or private asset publication.
