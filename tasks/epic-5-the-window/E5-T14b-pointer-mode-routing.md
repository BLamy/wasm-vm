---
id: E5-T14b
epic: 5
title: pointer mode state machine and coordinate/button routing
priority: 514.2
status: implemented
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
