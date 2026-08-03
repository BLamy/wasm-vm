---
id: E3-T22a
epic: 3
title: OSC 52 copy handler — decode, size cap, permission-failure UX, read-query gated off
priority: 322.1
status: verified
depends_on: [E2-T22]
estimate: S
risk: low
capstone: false
---

## Goal
A guest program emitting `OSC 52 ; c ; <base64>` sets the host clipboard through the in-page terminal,
with a hostile-guest size cap, a permission-failure affordance that never drops silently, and the
clipboard-READ query form (`52;c;?`) gated behind an explicit toggle that defaults OFF (a guest read
of the host clipboard is an exfiltration channel).

## Context
Split from **E3-T22** (clipboard integration) so the deterministic parse/cap/gate logic is an
independent, node-unit-testable boundary separate from the paste pipeline (E3-T22b), the guest image
conveniences (E3-T22c), and the browser E2E capstone (E3-T22d). xterm.js does not handle OSC 52 by
itself — a `registerOscHandler(52, …)` handler decodes the payload and calls
`navigator.clipboard.writeText()` (a secure-context API that can require transient user activation).

## Deliverables
- A pure `web/osc52.js`: `parseOsc52(data)` (selection + copy/query/invalid classification, strict
  base64 validation) and a `createOsc52Handler({writeClipboard, readClipboard, allowRead, maxEncodedBytes,
  onCopyBlocked, onCopied})` returning the `registerOscHandler(52, …)` callback.
- Size cap (default 100 KB of base64) enforced BEFORE decode; an oversize or malformed payload is
  dropped as invalid (handled, never a hang/throw).
- Read-query (`52;c;?`) returns nothing while `allowRead` is off; a write rejection routes to
  `onCopyBlocked(text)` (the "copied — click to confirm" affordance), never a silent drop.
- Wired into `web/terminal.js` with `navigator.clipboard` and the read toggle default-off.

## Acceptance criteria
- [x] `make verify-E3-T22a` (node --test): `52;c;<base64 of "hi">` decodes to `hi` and calls
  writeClipboard once; a rejected writeClipboard routes to `onCopyBlocked` with the same text.
- [x] A `>maxEncodedBytes` payload and a malformed-base64 payload are classified invalid — no decode,
  no clipboard call, no throw.
- [x] `52;c;?` yields no clipboard read while the toggle is off; with `allowRead` on it calls
  readClipboard and answers.

## Adversarial verification
A 10 MB payload must hit the cap and return promptly (no giant allocation, terminal responsive). A
malformed/garbage base64 payload and non-`c` selections must classify without panicking. With the read
toggle off, both the query form and any timing trick must yield nothing.

## Verification log
- 2026-08-03 — `make verify-E3-T22a`: **OK** (15 node --test cases). `web/osc52.js` is a pure module:
  `parseOsc52(data)` classifies `copy` / `query` / `invalid` (strict base64, cap enforced BEFORE
  decode, selection-field validation, UTF-8 multibyte round-trip), and `createOsc52Handler(...)`
  returns the `registerOscHandler(52, …)` callback — writes the clipboard once on a valid copy, routes
  a rejected write to `onCopyBlocked` (the preserved-payload confirm affordance, never a silent drop),
  and gates the read-query (`52;c;?`) behind a LIVE `allowRead` thunk (default off; honored per
  invocation, proven by flipping the toggle mid-test). A 10 MB payload hits the cap promptly (no giant
  decode). Wired into `web/terminal.js` (guarded `registerOscHandler`, `navigator.clipboard`, read
  toggle default-off via `setClipboardRead`, and `onClipboardCopyBlocked` for the host affordance);
  `node --check` confirms the wiring stays syntactically valid. The in-browser Clipboard-API exercise
  (real copy asserted via `readText`) is the E3-T22d capstone.
