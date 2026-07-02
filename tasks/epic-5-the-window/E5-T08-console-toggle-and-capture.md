---
id: E5-T08
epic: 5
title: Host chrome — serial console toggle beside the display, screenshot and recording
priority: 508
status: pending
depends_on: [E5-T07]
estimate: S
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
(empty)
