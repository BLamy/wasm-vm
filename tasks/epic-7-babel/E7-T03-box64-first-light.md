---
id: E7-T03
epic: 7
title: box64 first light — run a static then a dynamic x86_64 Linux binary in the guest
priority: 703
status: pending
depends_on: [E7-T02]
estimate: L
capstone: false
---

## Goal
The Layer F first light: **an actual x86_64 Linux binary executes correctly inside the
RISC-V-on-WASM machine**, translated by box64. Two steps — a fully static x86_64 binary (no
loader dependencies) first, then a dynamically-linked x86_64 coreutils/busybox binary
resolving the E7-T02 x86_64 libraries. This is emulation-in-emulation working end to end: an
x86 dynarec (box64) running as a guest process on our riscv64 CPU, itself running on WASM.

## Context
Start with a hand-built static `hello` (verified `file` → `x86-64`) run as `box64 ./hello`;
this exercises box64's ELF loader, its dynarec producing riscv64 for x86_64 instructions, and
Linux syscall pass-through (box64 forwards guest syscalls to the guest kernel). Then a dynamic
binary (e.g. x86_64 `coreutils` `sha256sum`, or an x86_64 build of busybox) to exercise loader
+ library mapping. Expect and debug: box64 syscall/ioctl coverage gaps, TLS handling, `mmap`
with x86 page semantics, and unaligned/segment quirks. box64 has extensive logging
(`BOX64_LOG`, `BOX64_DYNAREC_LOG`, `BOX64_TRACE`) — lean on it. Correctness is the bar here;
speed is E7-T05.

## Deliverables
- `tests/x86_64/` fixtures: a pinned static `hello`, and a dynamic x86_64 binary with a
  checkable output (e.g. `sha256sum` of a known file), plus their expected outputs.
- A scripted smoke test running both under box64 in the guest and asserting outputs.
- A findings log: every box64 syscall/feature gap hit and how it was resolved (config, box64
  version bump, or a documented limitation).

## Acceptance criteria
- [ ] `box64 ./hello` (static x86_64) prints the expected string; exit code 0.
- [ ] `box64 ./sha256sum <file>` (dynamic x86_64) prints the *correct* hash matching a
      native reference — proving the translation is semantically correct, not just non-crashing.
- [ ] Both runs complete with no unhandled-syscall aborts; any box64 "unsupported" warning is
      either resolved or explicitly logged as a known non-blocking gap.

## Adversarial verification
Corrupt one byte of the expected-hash fixture and confirm the test *fails* (the assertion is
real, not vacuous). Run a dynamic binary that touches several syscalls (an x86_64 `ls -la` of
a populated directory) and diff its output against native `ls` — any divergence in file
metadata rendering refutes correctness. Cross-check: run the *same* logical program compiled
for riscv64 natively and for x86_64 under box64; outputs must match. Confirm the binary really
is x86_64 (`file`) and box64 really translated it (`BOX64_DYNAREC_LOG=1` shows block
generation) — a binary secretly run by a riscv64 interpreter would refute the whole premise.

## Verification log
(empty)
