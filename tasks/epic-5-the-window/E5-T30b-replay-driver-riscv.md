---
id: E5-T30b
epic: 5
title: Generate genuine RISC-V call bridges for the local Replay driver
priority: 0.3812
status: implemented
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

### 2026-11-03 — worker — activation

E5-T30a is independently verified at `96adfda287aa7a9ba8a6c29bc2161badec4a866b`.
Its private runtime head remains unchanged. Start the actual RISC-V generated
call boundary in the ignored driver checkout. No Replay pushes or publication
of private source/binaries. Recording remains unproven until the later gates.

### 2026-11-03 — worker — generated-call component submission

Public activation head: `87f2a401e`.
Frozen private implementation: `7c5e9e37807ce1bd0b31fd5fe9e446276ec99bef`,
parent `33cc50ae728f8d116210d1c18186c25deffcca2b`. The complete real driver
builds for LP64D; no replacement driver exports or upstream pushes. The final
source came from a fresh private-origin clone plus the local commit bundle,
without shared objects, and was clean. The qualifier scrubs recording/replay,
loader and Rust/Cargo environment overrides for the authoritative native run.

Final command from that pristine checkout:
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_HOME python3 test/cpp/verify-riscv64-platform.py --call-abi --vm-root /Users/blamy/Documents/Codex/wasm-vm --output /Users/blamy/Documents/Codex/wasm-vm/local/chromium-riscv64/driver/call-abi-final-7c5e9e3`.
The ignored `driver/verify-call-abi.py` wrapper enables this same mode. Selected
gates: full affected C++ driver and fixture builds with warnings fatal, independent
assembler-byte comparison and compiler callees, three QEMU prechecks, then the
same real library and both platform/call fixtures in native wasm-vm Linux.

Private evidence root: `local/chromium-riscv64/driver/call-abi-final-7c5e9e3/`.
Report SHA-256: `11581c5f337101b5192fd2a15151ea5a98b6504619d9ed8b473f500d16dbcbd5`.
Serial SHA-256: `fdf16577e815e0669ef0eb924c1815252f8793d3c4f47350617809c64943ff4b`.
Guest-evidence SHA-256: `c890acf1858c72c82101e3d26195a4f107009792e749d531efe826521866ba51`.
Guest final state: `be06b31899f3b8355187144e4a9ed876d9420db9423fa6ec16fdff4d25fad7ef`;
1,336,880,660 retired instructions, `Exited(0)`. JIT evidence is explicitly
retired-counter-only, not a full instruction trace. Artifact and VM input digests
are in the private report. Full private source, detailed logs and binaries stay ignored.

All three seeds pass the existing platform fixture and 181 call-fixture checks
each: independent 40-byte assembler oracle; signed immediate/full-width literals;
integer/FP memory offsets and raw special values; eight integer/FP registers;
72 integer arguments covering all 512 spill bytes; mixed, paired and single FP
returns, FP spills, unsigned-32 extension and indirect structure returns; fixed,
indirect and nested bridges; poisoned s0-s11/fs0-fs11 with gp/tp preservation;
16-byte stack alignment; and two-thread publication/execution through the Linux
cache API. Ten malformed-input cases require the real driver's fatal source
location/reason, and the generated breakpoint executes as SIGTRAP. This proves
the local generated-call boundary, not physical cache hardware, ELF attachment,
browser recording, or replay. Those remain required subsequent gates.
