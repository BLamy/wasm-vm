---
id: E5-T14
epic: 5
title: Pointer devices — absolute tablet, relative mouse with Pointer Lock, wheel
priority: 514
status: pending
depends_on: [E5-T10]
estimate: L
capstone: false
---

## Goal
Two pointer instances of the T10 chassis — an absolute tablet (the default, giving
pixel-exact host-cursor correspondence with no grab) and a relative mouse (behind
Pointer Lock, for apps that warp/hide the cursor) — with buttons, horizontal/vertical
wheel, and a clean mode toggle.

## Context
QEMU's proven pattern: virtio-tablet declares EV_ABS with ABS_X/ABS_Y
(`abs_info {min:0, max:32767}`), EV_KEY bits BTN_LEFT/BTN_RIGHT/BTN_MIDDLE/BTN_SIDE/
BTN_EXTRA, EV_REL bit REL_WHEEL (+REL_HWHEEL, REL_WHEEL_HI_RES optional); virtio-mouse
declares EV_REL REL_X/REL_Y/REL_WHEEL + buttons. Both devices are always present on the
bus; the host routes DOM events to exactly one based on mode. Coordinate math for
absolute: `pointermove` offsetX/Y → clamp → scale by 32767/(canvas CSS size), which must
track `devicePixelRatio` and CSS scaling of the canvas (getBoundingClientRect every
resize, not every event). Wheel: `wheel` events normalized across `deltaMode`
(PIXEL=0: accumulate, emit REL_WHEEL ±1 per 120px-equivalent detent; LINE=1: per 3
lines; PAGE=2: ±1) with per-axis accumulators; natural-scroll direction handled by sign
convention (evdev REL_WHEEL: +1 = scroll up/away). Relative mode:
`canvas.requestPointerLock({unadjustedMovement:true})` where supported, movementX/Y →
REL_X/REL_Y; Esc and `pointerlockchange` exit back to absolute mode; buttons via
`pointerdown/up` with `setPointerCapture` in absolute mode so drags leaving the canvas
keep reporting.

## Deliverables
- Tablet + mouse `InputDeviceSpec`s (fixtures diffed against QEMU config captures).
- `web/src/input/pointer.ts`: mode state machine (absolute ⇄ relative), coordinate
  scaling, wheel normalization with accumulators, button mapping (aux/back/forward →
  BTN_MIDDLE/SIDE/EXTRA), context-menu suppression while captured.
- Mode-toggle UI + auto-exit handling on pointerlockchange/error; doc section on when
  each mode is right.
- Guest-side evtest fixtures for both devices.

## Acceptance criteria
- [ ] Guest `/proc/bus/input/devices` shows both devices with expected ABS/REL/KEY maps.
- [ ] Click at canvas CSS position (x,y) yields guest ABS values within ±1 of
      `round(32767*x/w)` at DPR 1 and DPR 2 and with the canvas CSS-scaled to 150%.
- [ ] Drag that leaves the canvas mid-gesture continues reporting until button-up
      (pointer capture verified); button-up outside still delivered.
- [ ] One notch of wheel on a PIXEL-deltaMode device and one on a LINE-deltaMode device
      each produce exactly ±1 REL_WHEEL (accumulator test with synthetic events).
- [ ] Entering relative mode delivers movement deltas with no absolute jumps; exiting
      restores absolute mode with the next move (verified by evtest stream).

## Adversarial verification
Refute the coordinate math: with fbcon + `evtest`, script pointer moves to all four
canvas corners and the exact center at DPR 1/1.5/2 and CSS zoom 80%/125% — any corner
not reaching min/max (0/32767) or center off by >1 unit refutes (this is the classic
cursor-offset-drift bug; T18's desktop makes it visible as click-misses). Refute wheel
integrity: send 1000 wheel events of +3px each; total REL_WHEEL must equal
round(3000/120)±1 with zero sign flips. Attack the mode machine: request pointer lock,
have the browser deny it (permissions policy / iframe), Esc during a held button, and
alt-tab during lock — after each, buttons held must be released (pairs with T13
release-all) and mode state must match `document.pointerLockElement`. Middle-click
paste-chord and right-click must never show the browser context menu while captured.

## Verification log
(empty)
