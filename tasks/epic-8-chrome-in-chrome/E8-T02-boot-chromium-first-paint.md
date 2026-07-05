---
id: E8-T02
epic: 8
title: Boot stock Chromium in the guest desktop — sandbox, threads, GPU, first paint
priority: 802
status: pending
depends_on: [E8-T01]
estimate: L
capstone: false
---

## Goal
Stock chromium-riscv64 **launches on the Level 5/7 desktop, loads a real web page, and renders
it** — first paint of a nested browser. Chromium is one of the most demanding Linux programs in
existence (multi-process sandbox, many threads, shared memory, GPU, futex-heavy), so this is a
brutal integration test of the entire stack beneath it.

## Context
Expect to debug: the multi-process/sandbox model (namespaces, seccomp — may need
`--no-sandbox` initially, documented, then hardened), SharedMemory/ashmem, the huge thread
count against our SMP (E6) scheduler, GPU acceleration (start with software/SwiftShader or the
E6 virgl path, whichever renders), and font/dbus/mesa dependencies in the image. This is where
SMP (E6), the JIT (E4 — V8 emits code at runtime, exercising FENCE.I coherence again), the
surface (E5), and networking (E7-T06) all get proven together under the hardest possible client.
Correctness and "it renders a real page" is the bar; record/replay is E8-T03+.

## Deliverables
- Chromium added to the desktop image with its runtime deps; a launch profile/flags documented
  (and a path to remove any temporary `--no-sandbox` crutch, tracked).
- A boot-to-browser bring-up playbook (sandbox, GPU path, thread/shm tuning) mirroring E5-T18.
- A scripted launch that opens a pinned local/real page and captures a screenshot of first paint.

## Acceptance criteria
- [ ] Stock chromium-riscv64 launches from the guest desktop and renders a non-trivial real web
      page (correct layout/text/images), verified by screenshot against a reference render.
- [ ] Keyboard/mouse input works (click a link, type in a field); the browser stays responsive
      enough to navigate between pages.

## Adversarial verification
Screenshot several real pages and compare to reference renders — gross layout/render failures
(from a GPU or font bug) refute "renders correctly". Navigate a multi-tab session and confirm no
sandbox/ipc crash. Confirm the running binary is the stock artifact from E8-T01 (`/proc/PID/exe`
+ sha256). Stress it (open a heavy page, scroll) and confirm the machine doesn't wedge. If
`--no-sandbox` is used, that is a documented known-gap, not a silent choice — an undocumented
disabled sandbox refutes the "stock configuration" honesty.

## Verification log
(empty)
