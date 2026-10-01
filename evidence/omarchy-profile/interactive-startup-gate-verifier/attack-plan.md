# E5.5-T03bc fresh verifier predictions

Verifier: fresh session, 2026-10-01. Source/task diff read first:
`git diff 5fd9d412..82978509` (implementation and tests reviewed separately
after the broad diff output was truncated). Scope is the medium-risk browser
startup gate, not guest speed, desktop readiness, or application response.

Predictions written before the fresh browser run and detailed evidence audit:

- P1: On the built app with the actual IDE canvas present, `wvm:guest-ready`
  leaves the overlay visible as a compact strip, with `pointer-events:none`
  on both overlay and card, all full-card controls hidden, and focus on the
  canvas. `document.elementFromPoint` at the canvas centre is the canvas.
- P2: Clicking a point covered by the compact strip but also inside the
  canvas and outside the unchanged desktop toolbar must reach the canvas,
  not any overlay descendant. A physical mouse
  click must have a trusted pointerdown/up and click target matching the
  computed target; clicking a blocking error overlay must not reach the
  canvas. The unchanged toolbar remains a legitimate separate target and
  its clicks must not be counted as guest input. This is the bounded novel
  hit-target attack.
- P3: `guest-error`, `guest-halted`, and a late `guest-state:done` each remove
  the interactive flag and restore a visible `pointer-events:auto` full
  overlay. Subsequent guest/desktop-ready events cannot reopen the gate.
  A new `guest-booting` resets the latch and keeps the full overlay until a
  new guest-ready event. Desktop-ready hides the overlay and keeps the
  existing `desktop visible · input is slow` state.
- P4: Guest-ready alone does not mark the toolbar ready or emit a desktop-
  ready event. The real compositor/pixel probe in unchanged `web/main.js`
  remains the producer of desktop-ready. The strict readiness tests pass.
- P5: In the worker physical recording, stats after the real input contain
  trusted pointer frames and keyboard transitions without drops/rejections.
  A later sample records a new real canvas presentation after input, rather
  than only the initial restored image or a replay of that image.
- P6: The two submitted screenshots match the log's SHA-256 values, and the
  physical trial has a source/harness receipt sufficient to bind the served
  startup implementation to the worker head. Missing source binding or a
  missing later presentation is a proof gap, not evidence of responsiveness.

The existing negative visible-response evidence is carried forward. No
synthetic nonce, screenshot, guest output, or successful application response
will be introduced. No cold clone is required for this medium-risk browser
presentation change because it makes no portability/deployment claim beyond
the already shipped page. Runtime and web implementation are read-only.
