---
id: E7-T09
epic: 7
title: Assemble the desktop — compositor, app suite, mixed riscv64 + x86_64 session
priority: 709
status: pending
depends_on: [E7-T04, E7-T06, E7-T07]
estimate: L
capstone: false
---

## Goal
Turn the Level 5 rendering *surface* into an actual **desktop**: a compositor with a working
panel/launcher, a file manager, a terminal, and a small application suite, running a **mixed
session** where some apps are riscv64-native and some are x86_64-under-box64 — indistinguishable
to the user. This is the "real desktop" half of Layer F, standing on E5's surface, E6's SMP/3D
horsepower, and Babel's hardened network (E7-T06) and persistence (E7-T07).

## Context
E5 proved one GUI app on a surface; this proves a usable multi-window desktop. Build the
desktop image (extend E5-T17's Alpine desktop image) with a compositor (labwc/weston or the
E5-T16 choice), a launcher/panel, file manager, terminal, image viewer, text editor — mixing
riscv64 packages with x86_64 apps launched transparently via E7-T04. Debug the seat/session
integration for box64 apps (env inheritance, DISPLAY/WAYLAND_DISPLAY, clipboard across the
arch boundary). Keep it within the size and performance budgets; this is the desktop the
capstone (E7-T12) demonstrates and the surface E8's Chromium will run on.

## Deliverables
- An extended desktop image manifest with the compositor + app suite, including at least one
  x86_64-under-box64 app in the default menu.
- A boot-to-desktop bring-up playbook for the mixed session (seat, env, clipboard, box64 wiring).
- A scripted checklist: launch riscv64 app + x86_64 app, move/resize windows, use clipboard.

## Acceptance criteria
- [ ] Boot to a desktop with panel/launcher; open a file manager, a terminal, and both a
      riscv64-native app and an x86_64-under-box64 app in separate windows simultaneously.
- [ ] Windows move/resize, focus switches cleanly, clipboard round-trips between a riscv64 and
      an x86_64 app; the session stays interactive (FPS within E5-T25's harness bounds).

## Adversarial verification
Run the mixed session under load (network download + heavy app) and confirm no compositor
wedge or input desync. Launch several x86_64 apps at once — box64 instances must not interfere
(shared caches, memory). Confirm the x86_64 apps are genuinely x86_64 (`file` on each running
binary via `/proc/PID/exe`). Kill and relaunch apps repeatedly; leaked processes or a degraded
desktop over time refutes. Verify clipboard content is correct across the arch boundary (not
truncated/mangled).

## Verification log
(empty)
