---
id: E5-T14b
epic: 5
title: pointer mode state machine and coordinate/button routing
priority: 514.2
status: verified
depends_on: [E5-T14a]
estimate: S
risk: medium
capstone: false
---

## Goal

Route browser pointer events to the T14a devices with an explicit absolute-tablet versus
relative-mouse mode state machine. Absolute mode must remain pixel-exact under CSS scaling and
device-pixel-ratio changes; relative mode must enter and leave Pointer Lock without an absolute
jump.

## Deliverables

- `web/src/input/pointer.ts` and its byte-identical browser projection with absolute/relative mode,
  coordinate scaling, Pointer Lock request/error/exit handling, and mode diagnostics.
- Button mapping for primary, secondary, auxiliary, back, and forward buttons, with captured
  context-menu suppression and a clear mode-toggle API for the T08 chrome.
- Deterministic unit fixtures for mode transitions, rect/DPR scaling, button mapping, and pointer
  lock denial/loss.

## Acceptance criteria

- [ ] Absolute pointer moves emit tablet coordinates from the current canvas CSS rect, clamped to
      `0..32767`, with no dependence on the canvas backing-pixel size.
- [ ] Relative mode emits only `movementX`/`movementY` mouse deltas, requests Pointer Lock, and
      returns to absolute mode when lock is denied, lost, or cancelled.
- [ ] Button down/up pairs remain balanced through mode changes and map aux/back/forward to the
      documented evdev codes; captured right-click never opens the browser context menu.

## Adversarial verification

Use DPR 1/1.5/2 and CSS zoom 80%/125% at all four corners and the exact center. Deny Pointer Lock,
press Escape during a held button, and alt-tab during lock; every path must leave the selected mode
consistent with `document.pointerLockElement` and no button held.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation is frozen at `2c8c23713b2f91eab8cc0e64b90d4280305326a3` (runtime at `30bb0b5`,
the standalone proof harness cleanup at `87dc9a9`/`2c8c237`). It adds the byte-identical
TypeScript/browser pointer bridge, CSS-rect absolute tablet scaling, relative mouse routing,
five-button evdev mapping, captured context-menu suppression, Pointer Lock request/legacy retry,
denial/loss recovery, controller/worker RPC methods, lifecycle reset, and visible mode/debug chrome.
The roadmap manifest now exposes the capability as partial until the final wheel/browser slice.

Focused gates passed at the frozen head: `cargo fmt --all -- --check`; `cargo test -p
wasm-vm-core --test virtio_pointer --quiet` (2/2); `cargo clippy -p wasm-vm-wasm
--target wasm32-unknown-unknown -- -D warnings`; `cargo build -p wasm-vm-wasm
--target wasm32-unknown-unknown --release`; `npm run test:pointer` (9/9); `npm run
test:keyboard-hardening` (14/14); `node --test tests/e4-t32-worker-protocol.test.mjs` (22/22);
JS syntax/diff checks; `make web-build`; and `make web-dist`.

The exact-head local Chromium recording ran `node tools/verify/e5-t14b-pointer-mode-proof.mjs`
and booted the real busybox guest to `guestReady` before dispatching five CSS-rect corner/center
tablet moves, a side-button make/break pair, and relative mouse deltas. It then denied Pointer
Lock and observed the bridge return to absolute mode with `pointerLockElement` clear and no held
buttons; console, page, and request errors were all empty. The recording demonstrates the
acceptance behavior on the built demo surface, while the deterministic fixtures cover lock loss,
legacy requests, mode-release balance, DPR/backing-pixel independence, and context-menu/capture
handling.

Evidence: `evidence/e5-t14b/pointer-mode-2026-09-03.json`, SHA-256
`067ad449abe8c5fc366ed25339593c139666a6f370df73f56a86b43375501605`; screenshot
`evidence/e5-t14b/pointer-mode-browser-2026-09-03.png`, SHA-256
`74e34310eb098b1663a76aa7e3070d0bee456fc86e2fb1236cf78079dd789261`.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Absolute routing — HELD.** Predicted the live bridge would use the current CSS rect, ignore
  backing pixels/DPR, clamp each axis, and emit tablet `EV_ABS` frames; the exact-head Chromium
  recording observed the four corners as `(0,0)`, `(32767,0)`, `(0,32767)`, `(32767,32767)` and
  the center as `(16384,16384)`, while the 9-test fixture covers the same contract independently.
- **Relative routing and lock recovery — HELD.** Predicted relative frames would contain only
  `EV_REL/REL_X` and `EV_REL/REL_Y`, and a denied lock would return the UI and bridge to absolute;
  recording frame 8 contains only `(REL_X,11)` and `(REL_Y,-5)`, the diagnostic is
  `pointerlock-denied`, and the final state is absolute with `pointerLockElement` clear.
- **Button balance and mapping — HELD.** Predicted the documented side/back/forward mappings would
  preserve balanced make/break pairs through transitions; the browser recording observes the
  side code `275` pair, the fixture covers all five codes plus lock loss/cancel, and the bounded
  verifier attack completed 100 duplicate-down/cancel/mode-churn cycles with no held buttons.
- **Demo wiring and coverage — HELD.** Predicted the new wasm bindings, direct/worker controller
  allow-list, visible mode/debug controls, lifecycle reset, and deploy projection would agree;
  native pointer integration (2/2), worker protocol (22/22), source/dist byte parity, the exact
  evidence and screenshot SHA-256 checks, and the real busybox Chromium boot all held with empty
  console/page/request error lists. Every runtime hunk is exercised by the native fixture, worker
  protocol matrix, or live browser frame recording; generated deploy files are parity artifacts.
- **Policy/scope — HELD.** Host rr, WebKit, and independent-machine checks are waived by the
  repository policy and user direction; the local guest/native/Chromium evidence is the authority.
- **SUITE — HELD.** Retain `web/tests/pointer.test.mjs`, the native pointer fixture, the worker
  protocol coverage, the reproducible Chromium harness, and the exact evidence JSON/screenshot.

Commands: `npm run test:pointer`; `node --test tests/e4-t32-worker-protocol.test.mjs`; `cargo
test -p wasm-vm-core --test virtio_pointer --quiet`; `cargo clippy -p wasm-vm-wasm
--target wasm32-unknown-unknown -- -D warnings`; source/dist `cmp` plus evidence SHA-256 checks;
and the bounded 100-cycle duplicate-down/cancel/mode-churn probe.
