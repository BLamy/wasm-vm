---
id: E5-T18
epic: 5
title: Boot-to-desktop bring-up — seat/udev/permissions debugged, playbook written
priority: 518
status: pending
depends_on: [E5-T08, E5-T15, E5-T17]
estimate: L
capstone: false
---

## Goal
Cold page load boots all the way into the T17 desktop with a working cursor, focusable
windows, and a terminal launchable from the WM menu — plus a written debugging playbook
capturing every failure mode found on the way (this task *is* mostly debugging; the
playbook is how that work compounds).

## Context
Everything exists; now it must agree. The classic failure chain, each a known suspect:
compositor can't open `/dev/dri/card0` (seatd not running / user not in `video` +
`seat` groups / udev didn't set mode), no input (`/dev/input/event*` perms, user not in
`input`), immediate exit (`XDG_RUNTIME_DIR` missing/wrong perms), black screen with
cursor (renderer chose GL and failed — force `WLR_RENDERER=pixman`), wrong resolution
(EDID ignored → check T04 negotiation), cursor invisible (compositor used cursor plane
before T15 wired — should be done, verify cursorq traffic), keyboard dead in compositor
but alive in evtest (missing `xkeyboard-config`/XKB data). Debug channels: T08 serial
console (compositor stderr → `/var/log/desktop.log` via the start script),
`WAYLAND_DEBUG=1`, `dmesg`, `libinput debug-events`, and the GPU/input trace modes from
T07/T10. Expect to iterate: every root cause found gets a playbook entry
(symptom → diagnosis command → fix) in `docs/desktop-bringup.md`.

## Deliverables
- Whatever config/udev/group/service fixes bring-up requires, committed to the T17
  builder (image rebuilt; no hand-poked-image state).
- `docs/desktop-bringup.md`: the playbook, with the debug-channel cheat-sheet and every
  encountered symptom→fix pair.
- start-desktop hardened: logs to a file, restarts the compositor on crash ≤3 times,
  drops to a getty on tty1 with a visible error banner if it gives up.
- A boot-to-desktop time measurement added to the perf stats (cold and warm cache).

## Acceptance criteria
- [ ] Fresh browser profile, cold load: desktop wallpaper + panel/menu visible, no
      manual serial intervention, 10/10 consecutive boots.
- [ ] WM menu → terminal (foot/xterm per T16) opens, accepts typed input (T12 path),
      `ls` output renders correctly in it.
- [ ] Host cursor and guest hover-highlight coincide (T15 check under real desktop);
      window buttons (close/maximize) hit-test correctly at DPR 1 and 2.
- [ ] Compositor crash (kill -9 from serial) → automatic restart with a log entry;
      3 crashes → getty fallback banner (forced via a broken-config boot in a test).
- [ ] Playbook contains every failure mode actually hit during this task (reviewed
      against the task's commit/log history — an undocumented fixed failure is a miss).

## Adversarial verification
Refute the 10/10 claim: 25 scripted cold boots with cache disabled; any hang, black
screen, or missing cursor refutes. Attack ordering: add a 500 ms artificial delay to
seatd start (test hook) — boot must still succeed or fail *with the playbook's
documented symptom*, not a novel one. Break it on purpose: remove the user from
`video`, delete XDG_RUNTIME_DIR init, force `WLR_RENDERER=gles2` — each must produce
the playbook's predicted symptom and be diagnosable in ≤ 5 min using only the playbook
(have someone other than the implementer run this drill). Verify no dirty-image cheats:
rebuild the T17 image from the committed manifest and re-run the 25-boot gauntlet on
the rebuilt artifact.

## Verification log
(empty)
