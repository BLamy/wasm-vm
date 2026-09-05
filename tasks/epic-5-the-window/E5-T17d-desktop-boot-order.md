---
id: E5-T17d
epic: 5
title: Prove headless desktop boot ordering and seat runtime
priority: 517.4
status: in-progress
depends_on: [E5-T17c]
estimate: S
risk: high
capstone: false
---

## Goal

Show that the final Alpine desktop image reaches a serial autologin reliably, starts seatd before
the desktop command, and creates the correct desktop runtime directory without hanging init.

## Boundary

This slice owns repeated cold headless boots and ordering evidence. It does not repair compositor
behavior or rework the T17 image builder unless the ordering proof identifies a concrete defect.

## Deliverables

- A bounded native-emulator serial boot harness and `make verify-E5-T17d` target.
- Evidence from 20 cold boots showing the autologin user, seatd readiness, `start-desktop` launch
  order, runtime-directory mode/owner, and bounded failure logs.
- A concise boot-order playbook for T18, including the exact markers used to detect races.

## Acceptance criteria

- [ ] All 20 cold serial boots reach the expected autologin user without an init hang or timeout.
- [ ] Every boot proves seatd is running before autologin invokes `start-desktop`, and records the
      desktop user's `/run/user/1000` as mode 0700 with the correct owner.
- [ ] A deliberate compositor-start failure exits/logs within the bound and leaves init usable;
      it does not deadlock tty1 or hide the failure.
- [ ] `make verify-E5-T17d` passes using only the final T17c image/chunk handoff and produces
      replayable serial evidence.

## Adversarial verification

Delay service readiness, perturb boot timing with independent fixed seeds, and kill the first
desktop process. Look specifically for an autologin race, stale runtime-directory ownership, seatd
zombies, or an init process waiting forever. A single ordering inversion or unbounded failure is
a refutation.

## Verification log

(empty)
