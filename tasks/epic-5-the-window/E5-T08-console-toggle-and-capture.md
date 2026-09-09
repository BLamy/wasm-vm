---
id: E5-T08
epic: 5
title: Host chrome — serial console toggle beside the display, screenshot and recording
priority: 508
status: verified
depends_on: [E5-T07d]
estimate: S
risk: medium
capstone: false
---

## Goal
The page hosts both faces of the machine: the canvas display and the xterm.js serial
console, switchable via UI tabs and a reserved hotkey, plus one-click screenshot (PNG)
and screen recording (WebM) of the canvas — the debugging harness every later task in
this epic will lean on.

## Context
Once the desktop exists, things will break in ways only visible from serial (compositor
logs, dmesg) — losing serial access when the GUI has focus would make T18's bring-up
debugging miserable. The toggle must work even when keyboard capture (T12) is grabbing
keys, so its hotkey is processed *before* the DOM→evdev pipeline and never forwarded
(document the reserved chord, e.g. `Ctrl+Alt+§`/`Ctrl+Alt+Backquote`, chosen to not
collide with common guest shortcuts). Screenshot: `canvas.toBlob('image/png')`.
Recording: `canvas.captureStream(fps)` + `MediaRecorder` (vp8/vp9 as supported), with
the caveat that captureStream on a WebGL canvas requires `preserveDrawingBuffer` or
frame-driven capture — verify against the T06 chosen backend.

## Deliverables
- Tabbed/split UI: display view + serial view, both live simultaneously (serial keeps
  scrolling while hidden); visible indicator of which view owns the keyboard.
- Reserved-hotkey router that runs ahead of all guest input handlers.
- Screenshot button producing a PNG download of the current front buffer.
- Record start/stop producing a downloadable WebM; duration cap + size indicator.
- `docs/ui.md` section documenting hotkeys and capture caveats per backend.

## Acceptance criteria
- [ ] Toggling to serial mid-boot-scroll and back loses no serial output and no frames
      (GPU flushes continue while display tab is hidden — verified by flush counter).
- [ ] The reserved hotkey works while guest keyboard capture is active (after T12 lands,
      re-verified) and the chord never reaches the guest (evtest shows nothing).
- [ ] Screenshot of the T07 fbcon screen is pixel-identical to a `getImageData` readback
      taken at the same flush generation.
- [ ] A 10 s recording during fbcon scroll plays back in Chrome and Firefox.
- [ ] Both views function after 50 rapid toggles (no listener leaks; handler count flat).

## Adversarial verification
Attack focus routing: toggle views while holding a guest key down — prove no stuck key
lands in either view (pairs with T13, pre-verify the host side: held-key set is flushed
on view switch). Attack capture: screenshot immediately after a partial damage flush —
the PNG must contain the *composited* frame, not a stale or torn buffer (compare against
readback). On the WebGL backend, take a screenshot with `preserveDrawingBuffer:false`
and prove it isn't black. Start recording, switch to serial view, stop — the WebM must
contain the frames drawn while hidden or the doc must explicitly state it doesn't.
Leak-check with 100 record start/stops (heap snapshot delta < 5 MB).

## Verification log
### 2026-09-04 — verifier — VERDICT: verified
- P1 visibility continuity — HELD. Predicted that switching to Serial would change only host
  visibility while guest delivery continued; Chromium 131 recorded 16 frames and 1,954 serial
  bytes during the hidden window, and Firefox 132 recorded 13 frames and 1,954 serial bytes.
  Both observed the deterministic hidden `/dev/tty0` flush marker, returned to Display, and ended
  with the Canvas2D surface visible. Evidence: `evidence/e5-t08/console-capture.json`.
- P2 reserved keyboard chord — HELD. Predicted one capture-phase `Ctrl+Alt+Backquote` toggle with
  no guest-forwarded codes or residual reserved keys; both browsers observed exactly one toggle,
  `forwardedCodes: []`, and `reservedCodesAfter: []`.
- P3 screenshot readback — HELD. Predicted a same-generation PNG whose decoded RGBA bytes matched
  `getImageData()` exactly; both browsers recorded `mismatchBytes: 0`, `pixelIdentical: true`, and
  equal SHA-256 digests at flush generations 24 (Chromium) and 21 (Firefox).
- P4 bounded recording — HELD. Predicted a non-empty WebM containing frames while Serial was
  active and stopping at the 10 s cap; Chromium decoded `video/webm;codecs=vp9` at 1280×800 for
  10,138 ms with 632 frames, and Firefox decoded `video/webm;codecs=vp8` at 1280×800 for
  12,536 ms with 80 frames. Both recorded `stopReason: duration-cap` and `playable: true`.
- P5 rapid-toggle/leak boundary — HELD. Predicted 50 transitions with the fixed two button
  listeners; both browsers recorded `transitionsAdded: 50`, `listenerCountBefore: 2`,
  `listenerCountAfter: 2`, zero dropped frames, zero presentation errors, and 500M+ retired
  guest instructions.
- COVERAGE — HELD. The exact-head browser proof at commit
  `d6756fa128fc4743f9e2855abd71a5aadcf84a8d` exercised the route, host controller, keyboard
  policy, presentation path, screenshot decoder, recorder, serial scroll, lifecycle cleanup, and
  deploy projection. Source/dist parity was checked for the route, host module, and roadmap.
- Commands: `node --check web/src/host/console-capture.js`; `node --check web/console-capture.js`;
  `node --check tools/verify/e5-t08-console-capture.mjs`; `node --test
  web/tests/console-capture.test.mjs web/tests/capture-policy.test.mjs web/tests/held-keys.test.mjs`
  (17 passed); `make web-build`; `node tools/verify/e5-t08-console-capture.mjs --output
  evidence/e5-t08/console-capture.json` (Chromium 131 + Firefox 132, zero console/page/request
  errors). WebKit, independent machines, and host rr are outside this task's agreed scope.
