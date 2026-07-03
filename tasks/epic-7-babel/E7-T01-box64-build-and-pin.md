---
id: E7-T01
epic: 7
title: box64 build recipe and pinned artifact for the riscv64 guest
priority: 701
status: pending
depends_on: [E6]
estimate: M
capstone: false
---

## Goal
A reproducible, pinned build of **box64** (github.com/ptitSeb/box64) — the x86_64→native
userspace dynamic translator — compiled *for riscv64*, packaged so it can be dropped into the
guest and run there. This is the foundation of Layer F: box64 runs as an ordinary guest
process and translates x86_64 Linux binaries to riscv64 on the fly, giving the machine access
to the entire x86_64 binary universe without a second CPU core.

## Context
box64 targets riscv64 as a first-class host (it has a RV64 dynarec backend). We build it in
the Docker cross-compile pipeline already used for the kernel (E2-T12), pinning a specific
box64 commit and its build options (RV64 dynarec on, the extension set matching our CPU:
RVV off unless E1 grew it, Zba/Zbb per our config). The output is a static-ish `box64` binary
plus its default `box64.conf`. Nothing runs x86 yet — this task only proves box64 itself
builds, is pinned, and launches (prints its version/help) *inside* the guest. Coordinate the
CPU feature flags with box64's `BOX64_DYNAREC_*` expectations so the dynarec doesn't emit
instructions our machine lacks.

## Deliverables
- `tools/build-box64.sh`: pinned-commit Docker cross-build → `releases/box64-riscv64` with a
  recorded sha256 and the exact box64 commit + build flags in a manifest.
- box64 added to the Epic 7 rootfs manifest (an overlay on the Epic 5 desktop image).
- A smoke test: boot the guest, run `box64 --version` and `box64 --help`, assert output.

## Acceptance criteria
- [ ] `tools/build-box64.sh` from a clean tree produces a byte-identical binary (recorded
      sha256) on a second run/machine — the build is deterministic and pinned.
- [ ] Inside the booted guest, `box64 --version` prints the pinned version; the dynarec is
      compiled in (reported by box64's build banner / `BOX64_LOG=1`).
- [ ] The binary is genuinely riscv64 (`file box64` → `ELF 64-bit ... RISC-V`).

## Adversarial verification
Rebuild on a different host and diff the sha256 — any drift refutes "pinned/reproducible".
Confirm the dynarec backend is actually RV64 and not the interpreter-only fallback (run with
`BOX64_DYNAREC_LOG=1` and confirm block translation messages). Verify box64 does not require
CPU features our machine lacks: run it under the E4 differential/trace harness briefly and
confirm no illegal-instruction traps from box64's own code before any x86 payload is loaded.

## Verification log
(empty)
