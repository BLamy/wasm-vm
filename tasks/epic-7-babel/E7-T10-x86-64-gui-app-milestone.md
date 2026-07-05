---
id: E7-T10
epic: 7
title: Milestone — an x86_64 GUI application renders through virtio-gpu under box64
priority: 710
status: pending
depends_on: [E7-T08, E7-T09]
estimate: L
capstone: false
---

## Goal
An **x86_64 GUI application** (GTK or Qt, x86_64-only here) launches under box64 and **renders
to the screen through virtio-gpu**, accepting real keyboard/mouse input — the graphical
counterpart to E7-T08's CLI milestone, and the hardest box64 path (it drags in x86_64 GUI
toolkits, GL, fontconfig, dbus, and the display-server protocol, all translated).

## Context
This stresses box64's coverage far more than a CLI tool: the x86_64 GTK/Qt stack, Wayland/X11
client libraries, Mesa's software or virgl GL path (E6-T12), fontconfig, and often dbus. Pick a
representative x86_64 GUI app with no riscv64 build in the image (e.g. a prebuilt x86_64 editor,
viewer, or small tool). Debug the toolkit/GL/ipc gaps box64 exposes; coordinate with E6's
virtio-gpu-3D if the app needs GL. The reward is proof that arbitrary x86_64 *desktop* software
is reachable — the essence of CheerpX-via-emulation.

## Deliverables
- A pinned x86_64 GUI app in the desktop image (behind the E7-T09 menu) + a launch/interact
  script and expected on-screen result.
- A compatibility note: toolkit/GL/dbus gaps found and how resolved; measured responsiveness.

## Acceptance criteria
- [ ] The x86_64 GUI app (verified `file` → `x86-64`) opens a window on the guest desktop via
      virtio-gpu, renders correctly, and responds to real keyboard/mouse input.
- [ ] A basic interaction (open a file / type / click a control) produces the correct visible
      result; responsiveness within a documented bound.

## Adversarial verification
Screenshot the app's window and compare against a native x86_64 render of the same app/content
— gross rendering divergence (missing text, wrong colors from a GL path bug) refutes. Resize
and move the window; interact rapidly; confirm no crash from a box64 toolkit/GL gap. Confirm the
process is x86_64 (`/proc/PID/exe` + `file`). If GL is used, confirm it's the intended path
(virgl/software) and not a silent fallback that hides a bug.

## Verification log
(empty)
