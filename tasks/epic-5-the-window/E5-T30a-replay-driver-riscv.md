---
id: E5-T30a
epic: 5
title: Linux signal and stack context in the local RISC-V Replay driver
priority: 0.3811
status: verified
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

### 2026-11-03 — worker — platform component submission

Public planning head: `5cc93c77e5001da9a60dc6d32004210519cff0e1`.
Frozen private implementation: `33cc50ae728f8d116210d1c18186c25deffcca2b`,
based on the pinned private upstream head. No upstream push. The final source
was freshly cloned from the private origin and the local commit imported by
Git bundle, with no shared object store and a clean working tree. A first local
promisor-clone attempt encountered recursive Git fetches and was stopped before
building; it is not evidence.

Final acceptance command (from the pristine private checkout):
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_HOME python3 test/cpp/verify-riscv64-platform.py --vm-root /Users/blamy/Documents/Codex/wasm-vm --output /Users/blamy/Documents/Codex/wasm-vm/local/chromium-riscv64/driver/platform-final-33cc50a`.
The ignored `driver/verify-platform.py` entry point runs this same frozen harness.
The command builds the full real target library and fixture with fatal compiler
warnings, executes three QEMU prechecks, then boots the identical library and
fixture in native wasm-vm Linux. No replacement driver exports are used.

Private evidence root: `local/chromium-riscv64/driver/platform-final-33cc50a/`.
Report SHA-256: `146eb0a4fbf706f6528cbad05bedcc093f3486cb0a9712f3408c026995afdb47`.
Serial SHA-256: `b9936584cd338d3e1806e470fbe9b8ebf5948705dd4292474acee7745012f268`.
Guest-evidence SHA-256: `56b589e6456b1d2caeb35ec994df42975ab9ceb0552a2d66a26917f8334c3f75`.
Final guest state: `ca69ab67ebab326bb9ad1a2b56bbaedf9310226434622df7b56e7d5fda241368`;
1,072,146,458 retired instructions, `Exited(0)`. JIT evidence explicitly uses
retired-counter-only mode, not a full instruction trace. The report binds the
private source head, compiler logs, initramfs files, native CLI, kernel, and
BusyBox by digest. Full private source and detailed run output stay ignored.

The native run demonstrates 192 real 16/32-bit breakpoint recoveries at varied
frame depths through the production crash handler, alternate-stack use and
writable PC/SP/FP context; independent compiler frame/return-address checks;
canonical synthetic chains with upper/lower, null, cycle, misalignment, corrupt
link and inaccessible-page edges; actual production syscall metadata; and real
sampling-profiler signal paths with labelled instructions and multi-frame stacks.
Every seed passed. This claim is limited to the platform component: call bridges,
ELF interposition, browser attachment, and genuine complete recordings remain
unproven and are required by the subsequent tasks.

### 2026-11-03 — verifier

VERDICT: verified

Private head: `33cc50ae728f8d116210d1c18186c25deffcca2b`.

Private verdict:
`local/chromium-riscv64/driver/critic-platform-33cc50a/verdict.md`.
SHA-256: `89feb7079d7a6274c0a6075d0ebdf01a300a8ea52f706455886df299b823e6b5`.

Private coverage:
`local/chromium-riscv64/driver/critic-platform-33cc50a/coverage.md`.
SHA-256: `8e5b102769c6dc94257cfc88538405c5d7a196c99a705e5064609359b3a81ad0`.

Private proof manifest:
`local/chromium-riscv64/driver/critic-platform-33cc50a/verifier-manifest.json`.
SHA-256: `9b4451fb8567230d37a6f434ffe92f8b850759052aba75ba470ad664f9401b26`.
