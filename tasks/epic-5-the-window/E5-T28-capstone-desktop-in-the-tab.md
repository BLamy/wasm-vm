---
id: E5-T28
epic: 5
title: "Capstone: a browser rendering surface + real GUI apps — type, hear, drag"
priority: 528
status: pending
depends_on: [E5-T13, E5-T15, E5-T18, E5-T20, E5-T24, E5-T25]
estimate: L
capstone: true
---

## Goal
The Level 5 threshold — a **browser rendering surface** with **real GUI applications** on
it, Layer E — demonstrated end-to-end from a cold start: the page boots unmodified Alpine
riscv64 to a graphical surface (a compositor + at least one real GUI app, e.g. a terminal
emulator and a second graphical application); real keyboard typing works in it; a sound
audibly plays; and a window drags at usable FPS — one continuous session, no cherry-picked
clips. This proves the pixels-out / input-in path and the compositor. The full multi-app
*desktop* — especially one compositing x86_64 apps under box64 — is Level 7's (Babel) job;
Level 5 delivers the surface those levels paint on.

## Context
Every piece exists and is individually verified; the capstone proves they hold
*simultaneously* — the failure mode of integrated systems is interaction, not units
(audio underruns during window drags, input latency collapsing under transfer load,
clipboard stealing gestures the audio unlock needed). Per tasks/README.md, a capstone
demo must run from a fresh clone and fresh browser profile: build artifacts from
committed sources (kernel from T05 config, image from T17 manifest), no dev-server
state, no cached IndexedDB/OPFS. The demo script is itself a deliverable — versioned,
so anyone can re-perform it, and the T25 harness runs *during* the demo session to put
numbers next to the subjective experience. This is the gate for Epic 6: SMP, WebGPU,
and self-hosting all assume this desktop exists.

## Deliverables
- `docs/demos/level-5.md`: the exact demo script — every click, keystroke, and
  expected observation, with target timings.
- A demo checklist page state: default page config boots the desktop path without
  feature flags or query params (the desktop is now the product, serial console one
  toggle away per T08).
- T25 harness results captured from the demo session, committed alongside baselines.
- A recorded artifact of one full demo run (T08's recorder, ≤ 3 min) checked into
  release assets (not the repo).
- Triage/fix commits for any integration bugs the capstone shakes out, each with a
  regression test in the owning task's area.

## Acceptance criteria
- [ ] Fresh clone → documented build commands → page load on a fresh browser profile
      (Chrome and Firefox, versions recorded) reaches the desktop with zero manual
      serial intervention.
- [ ] Terminal opened from the guest desktop's menu; typing
      `echo "Level 5: $(uname -m)" && aplay /usr/share/sounds/test.wav` with the real
      keyboard executes: correct text (shell metachars prove T12), `riscv64` output,
      and the wav is audible (and machine-verified via T20's tab-audio capture,
      zero underruns during playback).
- [ ] Window drag across the full desktop width sustains ≥ 15 FPS p50 (T25 harness,
      measured live in the demo session, config as stated in the baseline doc).
- [ ] During the same session: clipboard round-trips host⇄guest once each way (T24),
      a browser-window resize changes the guest resolution (T22), and Alt-Tab focus
      theft + return leaves no stuck keys (T13).
- [ ] The session survives 30 minutes idle + resume typing (no watchdog death, no
      audio-clock drift crash), then a clean guest `poweroff` ends it.

## Adversarial verification
Perform the demo yourself from the script on a machine that has never built the
project — any missing step, implicit dependency, or flag refutes the "fresh clone"
claim. Then attack the integration seams *during* a re-run: start the window drag and
simultaneously play audio while wiggling the cursor — measure underruns (must be 0)
and drag FPS (must hold the threshold within noise margins); resize the browser window
mid-drag; yank focus mid-chord and verify the desktop's modifier state; toggle to the
serial console and back mid-audio. Re-run the whole script under 2x CPU throttle: it
may be slower but must not deadlock, desync input, or wedge audio permanently.
Finally, reload the tab at an arbitrary point and restore via T26 with the desktop up
— resumed session must still pass the type/hear/drag trio. Any single unrecoverable
wedge, stuck input, silent-audio state, or sub-threshold measured FPS in the stated
config refutes the capstone.

## Verification log
(empty)
