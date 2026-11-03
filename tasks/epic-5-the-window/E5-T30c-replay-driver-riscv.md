---
id: E5-T30c
epic: 5
title: Load and interpose real RISC-V ELF calls in the local Replay driver
priority: 0.3813
status: implemented
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

### 2026-11-03 — worker — ELF/interposition component submission

Public activation head: `6d062252f`.
Frozen private runtime/test head: `f9578934f3e1281e35c1873f6495eed3eab26c09`,
parent `7c5e9e37807ce1bd0b31fd5fe9e446276ec99bef`. Runtime edits are limited to
the recording driver's RISC-V ELF branch. The non-recording loader and existing
architecture paths retain their prior behavior. No upstream push or replacement
driver API. Final source was a clean private-origin clone plus local commit
bundle, with no shared object store.

Final command in that pristine checkout:
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_HOME python3 test/cpp/verify-riscv64-platform.py --interposition --vm-root /Users/blamy/Documents/Codex/wasm-vm --output /Users/blamy/Documents/Codex/wasm-vm/local/chromium-riscv64/driver/elf-final-f957893`.
The ignored `driver/verify-interposition.py` wrapper enables the same mode. Selected
gates: full warning-fatal driver/fixture builds; two independently compiler-built
shared libraries with LLVM relocation transcripts; three QEMU prechecks; then
the identical real library and platform/call/ELF fixtures inside native wasm-vm.

Private evidence root: `local/chromium-riscv64/driver/elf-final-f957893/`.
Report SHA-256: `d2fdf9c62a6e4f4e1ed26824e321f41e760362e9daa1469af5bfc3130d7f7939`.
Serial SHA-256: `a65985a7c39bdb035482611f9b7089f23c4fbde764526771eaf61b5410598570`.
Guest-evidence SHA-256: `4fa5c22aaeda28087349390e4b683d796c0b0060209178c15783fc2b4a67946b`.
Final guest state: `4c26f0356d6f6ce7b182ce12e22fc13c63948e16163fd00103cfed7e0a46fb49`;
1,430,418,579 retired instructions, `Exited(0)`. JIT evidence is explicitly
retired-counter-only, not a full instruction trace. All binary/input/log bindings
and detailed code/evidence remain in the ignored private workspace.

All three seeds pass the earlier platform/call fixtures plus 183 ELF checks each.
The run covers the actual Chromium relocation forms, named imports and addends,
all three TLS forms without overwriting or misclassifying loader slots, mutable
relative-pointer diagnostics, genuine `AttachBinary` hooks through PLT/indirect
calls, initialized cached PIDs, unchanged original/pass-through behavior and real
clock-call recording output (100 production call-stream bytes per seed, including
an error case with errno/output checks). Data/TLS values vary by seed. Wrong
machine/FP/E ABI, unknown type, out-of-range/unaligned slot and nameless symbols
fail at the genuine driver's expected source location; no-op relocations succeed.
This proves this recording-driver component. Complete Chromium recordings,
browser attachment, replay execution, and the GUI recording workflow remain
subsequent requirements and are not claimed here.
