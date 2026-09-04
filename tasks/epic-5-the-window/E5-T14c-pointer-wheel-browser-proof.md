---
id: E5-T14c
epic: 5
title: pointer wheel capture and browser proof
priority: 514.3
status: implemented
depends_on: [E5-T14b, E5-T13c]
estimate: S
risk: medium
capstone: false
---

## Goal

Finish the pointer surface with deterministic wheel normalization, drag-outside pointer capture,
documentation, guest evtest fixtures, and one browser proof that exercises the complete host-to-
guest path.

## Deliverables

- Per-axis PIXEL/LINE/PAGE wheel accumulators with the documented evdev sign and detent policy.
- Pointer-capture drag handling that continues outside the canvas until button-up, plus the mode
  toggle/debug UI and pointer focus-loss release integration.
- Guest-side evtest transcript/fixtures and a single local Chromium harness covering coordinates,
  drag, wheel, relative mode, lock loss, and zero browser errors.
- `docs/input.md` pointer-mode, wheel, and browser limitation policy.

## Acceptance criteria

- [ ] One PIXEL and one LINE wheel detent each emit exactly one signed `REL_WHEEL` event; 1000
      small deltas accumulate deterministically without sign flips or unbounded state.
- [ ] A drag leaving the canvas still delivers movement and its button-up; a relative-mode exit
      leaves both pointer devices neutral and the next absolute move has no jump.
- [ ] The exact-head browser proof records the guest evtest stream, mode transitions, UI state, and
      zero unexpected console/page/request errors.

## Adversarial verification

Send 1000 `+3px` wheel events and compare the total to the accumulator contract. Combine a held
button with Pointer Lock denial, Escape, blur, view toggles, and pointer capture outside the canvas;
then type/inspect a guest event stream and require no stuck button or modifier. Re-run the corner,
center, DPR, and CSS-zoom matrix through the built page.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation is frozen at `bc9b69ba0e0c23902c3389e20fa75e64c170f2d8`. It completes the
byte-identical TypeScript/browser pointer bridge with signed per-axis PIXEL/LINE/PAGE wheel
detents, bounded fractional remainders, horizontal `REL_HWHEEL`, vertical `REL_WHEEL` inversion,
wheel debug state, captured drag-outside handling, pointer-cancel cleanup, and blur/hidden/view
toggle/Pointer Lock-loss cleanup. It adds the guest-side signed wheel/button fixture and transcript,
the documented browser Pointer Lock and wheel policy, and the reproducible built-page proof harness.

Focused gates passed at the frozen implementation head: `cargo fmt --all -- --check`; `cargo test
-p wasm-vm-core --test virtio_pointer --quiet` (3/3); `cargo clippy -p wasm-vm-wasm
--target wasm32-unknown-unknown -- -D warnings`; `npm run test:pointer` (12/12);
`npm run test:keyboard-hardening` (14/14); `node --test web/tests/e4-t32-worker-protocol.test.mjs`
(22/22); JS syntax, source/dist parity, and diff checks; and `make web-dist`.

The exact-head local Chromium recording ran `node tools/verify/e5-t14c-pointer-wheel-browser-proof.mjs`
against the built demo and booted the real busybox guest to `guestReady`. It exercised six
DPR/zoom configurations across the four corners and center, a real `page.mouse` drag outside the
surface with button values `[1, 0]`, a real browser wheel event producing `REL_WHEEL -1`, a LINE
detent plus 1000 `+3px` PIXEL events producing 26 deterministic wheel frames with zero remainder,
and pointer-lock-change, blur, view-toggle, Escape-style exit, pointer-cancel, and denial recovery.
The final UI was absolute with no held pointer or keyboard buttons; console, page, and request
errors were empty.

Evidence: `evidence/e5-t14c/pointer-wheel-browser-2026-09-03.json`, SHA-256
`9de229469e3d33b1927fbd8b5766d114a533c0e38415dad0d08194e69a0bce7e`; screenshot
`evidence/e5-t14c/pointer-wheel-browser-2026-09-03.png`, SHA-256
`bbb6145092b9512c55db8d8f71eebcd13bc1f8c9170eabfa62283bcc58d9c7bd`; guest transcript
`evidence/e5-t14c/guest-evtest-2026-09-03.txt`, SHA-256
`a3cd5f1d311a9c5b23da1897f848533be521dc1c1c677ade5f591883918f119e`.
