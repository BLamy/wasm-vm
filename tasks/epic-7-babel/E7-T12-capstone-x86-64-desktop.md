---
id: E7-T12
epic: 7
title: "Capstone: x86_64 Linux binaries + a real desktop — CheerpX via emulation"
priority: 712
status: pending
depends_on: [E7-T10, E7-T11]
estimate: L
capstone: true
---

## Goal
The Level 7 (Babel / Layer F) threshold, demonstrated end-to-end from a cold start: the page
boots to a **real desktop**; the operator launches, transparently, both a **riscv64-native app
and an x86_64-only Linux application** (CLI and GUI) that run correctly and usably under box64;
a mixed-arch session is interactive, networked, and persistent across a reload. This is
CheerpX's entire value proposition — arbitrary x86 Linux software in a browser tab — reached
*through* the RISC-V machine instead of as the base layer.

## Context
Integration of the whole epic: box64 (E7-T01) on a multi-arch rootfs (E7-T02), transparent via
binfmt (E7-T04), fast enough via the DBT-in-DBT tuning (E7-T05), on a hardened network (E7-T06)
and durable persistence (E7-T07), composited into a desktop (E7-T09) running the CLI (E7-T08)
and GUI (E7-T10) x86_64 milestones, with Layer G intact across it (E7-T11). Per
`tasks/README.md`, the capstone runs from a cold start: fresh clone, documented build/fetch of
the desktop + box64 artifacts, fresh browser profile, no dev state. The demo script and its
automated variant are deliverables so a hostile verifier can run it without the implementer.

## Deliverables
- `docs/demos/level-7.md`: exact cold-start procedure — build/fetch, boot, launch the x86_64
  CLI and GUI apps, the mixed-session interactions, the persistence-across-reload step, with
  expected observations and `file`-verification steps at each launch.
- An automated headless E2E driving: cold boot → desktop → run x86_64 CLI app (assert output vs
  x86_64 native) → open x86_64 GUI app (assert a rendered result) → write a file → reload →
  file + apps still work.
- A recorded demo (≤ 3 min) in release assets; integration fixes each with a home-task regression test.

## Acceptance criteria
- [ ] Fresh clone + documented commands → desktop boots on a fresh browser profile; an
      x86_64-only CLI app (verified `x86-64`) runs transparently with correct output, and an
      x86_64-only GUI app renders and accepts input.
- [ ] A riscv64-native app and an x86_64 app run *simultaneously* in the same interactive
      session; clipboard round-trips across the arch boundary; FPS within E5-T25 bounds.
- [ ] The session is networked (a live download completes) and persistent (a file written
      before reload is present and the app still runs after reload).
- [ ] The automated E2E passes 3/3 with fresh browser contexts; box64 logs confirm real x86_64
      translation (no riscv64 shim), and the demo carries the same commit hash as the artifacts.

## Adversarial verification
Cold-start rule is absolute: run `docs/demos/level-7.md` on a machine/profile that never built
the project — any undocumented step refutes. Prove the x86 claim is real: on every launched
app, hash `/proc/PID/exe`, run `file` (must be `x86-64`), and confirm box64 translation via
`BOX64_DYNAREC_LOG` — a secretly-riscv64 binary refutes the entire capstone. Attack the seams:
run the x86_64 GUI app while a bulk download runs and a riscv64 app is busy — measure FPS and
input latency (must hold E5-T25 bounds); kill the tab mid-session and restore via snapshot, then
confirm the x86_64 app still runs; fill storage toward quota during the session. Diff the x86_64
CLI app's output against a native x86_64 reference — any divergence refutes correctness. Compare
subjectively against webvm.io (which does x86 natively) and record the honest performance delta.

## Verification log
(empty)
