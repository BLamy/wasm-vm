---
id: E7-T08
epic: 7
title: Milestone — a real x86_64 Linux CLI application runs under box64
priority: 708
status: pending
depends_on: [E7-T04, E7-T05]
estimate: M
capstone: false
---

## Goal
A **real, non-trivial x86_64 Linux CLI application** — not a fixture, an actual upstream
release binary with no riscv64 build — runs correctly and usably in the guest via transparent
box64. This is the concrete proof of Layer F's value: software that exists *only* as x86_64
now runs in the browser.

## Context
Pick an app that is genuinely x86_64-only-here and exercises real functionality: candidates
include a prebuilt x86_64 language toolchain or runtime (e.g. an official x86_64 Node.js
release binary — a nice bookend to Epic 3's riscv64 Node), an x86_64 database CLI, or a
proprietary-style static tool. Verify it's x86_64 (`file`), run it through binfmt/box64
(E7-T04), exercise a real task, and confirm correct output against a native x86_64 reference.
Note any box64 gaps and resolve or document them. Record speed (from E7-T05 context) so
"usable" is a number.

## Deliverables
- A pinned real x86_64 application binary + a scripted task that exercises it and asserts on
  output vs a native x86_64 reference run.
- A short compatibility note: what worked, any box64 config needed, measured speed.

## Acceptance criteria
- [ ] The chosen x86_64-only app (verified `file` → `x86-64`) runs transparently (no explicit
      box64 prefix) and completes a real task with output matching a native x86_64 reference.
- [ ] Recorded wall-clock for the task is within the documented "usable" bound from E7-T05.

## Adversarial verification
Diff the app's output against a native x86_64 run byte-for-byte where deterministic; any
divergence refutes correctness. Run a second, different x86_64 app to show it isn't a
one-binary fluke. Confirm via `BOX64_DYNAREC_LOG` that box64 actually translated it (not an
accidental riscv64 shim on PATH). Stress it (larger input) to surface latent syscall gaps.

## Verification log
(empty)
