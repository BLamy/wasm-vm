---
id: E5-T24c
epic: 5
title: Add host clipboard permissions and gesture-ordered sync
priority: 524.3
status: verified
depends_on: [E5-T24a, E5-T24b]
estimate: S
risk: high
capstone: false
---

## Goal

Implement the browser-side clipboard service on top of the verified Channel, including permission
staging, paste-event ordering, direction-aware echo suppression, and a visible honest state.

## Boundary

This slice owns only host clipboard service state and DOM event wiring. Guest integration and the
cross-browser/permission proof remain outside this task except for deterministic service fixtures.

## Deliverables

- Gesture-adjacent `clipboard.writeText` staging with a user-visible pending/denied state and no
  uncaught permission errors.
- Focus-gated paste interception that sends host text to the guest before key delivery, plus a
  `clipboard.readText`-free explicit-event path.
- Direction/generation/content-hash echo guard and bounded 256 KiB text handling with deterministic
  listener/spy tests.

## Acceptance criteria

- [x] Host CLIP_SET reaches the guest before the corresponding canvas Ctrl+Shift+V key event, even
      with a sub-50 ms scheduling gap; unfocused canvases do not read or sync clipboard data.
- [x] Guest CLIP_SET writes immediately when permitted and stages otherwise; a later user gesture
      flushes it without throwing, and denial is represented honestly in the UI state.
- [x] Twenty alternating identical/different host↔guest copies do not echo; each user action emits
      at most one clipboard frame and 257 KiB/invalid input is rejected per T24a.

## Verification command

`node --test web/tests/clipboard-service.test.mjs`

## Adversarial verification

Run 100 immediate host-copy/paste pairs, alternate identical strings in both directions, deny
clipboard permission, remove focus, and install a clipboard-read spy. Any stale paste, feedback
loop, background read, or uncaught permission rejection is a refutation.

## Verification log

### 2026-09-04 — worker — implementation submitted

- Commit: `9efe610` (`feat(e5-t24c): add host clipboard service`).
- Proof hardening: the deterministic fixture was extended with 100 immediate host-copy/guest-echo
  pairs before verification.
- Exact evidence: [`evidence/e5-t24c/clipboard-service-2026-09-04.txt`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24c/clipboard-service-2026-09-04.txt), SHA-256 `b7ba86ed6db651a9bc8c27f21c721a48ede3821013b50c203aa72a7746fecd06`.
- Command: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T24c`; plus `node --test web/tests/agent-channel.test.mjs`, `make web-dist`, source/dist hash comparison, and `git diff --check`.
- Claim: `ClipboardService` is a Channel-backed, focus-gated host service with direct paste-event text capture, ordered `onPasteReady` delivery after CLIP_SET handoff, permission-aware guest-copy staging, gesture-only retries, visible status state, strict T24a size/UTF-8 validation, and bounded direction/generation/content-hash echo history. The deterministic fixtures cover permitted and denied writes, delayed gesture flush, 100 immediate paste/echo pairs with one frame per action, sub-50 ms ordering shape, unfocused clipboard-data spying, identical/different alternation, expired echoes, reconnect generation invalidation, listener disposal, and no asynchronous clipboard read path. Host rr/independent-machine and WebKit checks are waived per the user instruction.

### 2026-09-04 — verifier — VERDICT: verified

- P1 focused paste ordering/privacy — HELD. Predicted a focused paste would synchronously hand one
  `CLIP_SET` to the Channel before `onPasteReady` (the caller's key-delivery barrier), while an
  unfocused target would not even touch `clipboardData`; the exact-head suite observed order
  `send` → `key-ready`, one frame, and a getter-spy count of zero while unfocused.
- P2 permission and honest state — HELD. Predicted a permitted guest copy would write immediately,
  a `NotAllowedError` would retain one bounded value in `DENIED` state, and a later gesture would
  flush without an unhandled rejection; the exact-head fixture observed all three states and one
  successful retry, with the status element reporting the blocked/pending condition.
- P3 echo/bounds attack — HELD. Predicted 100 immediate alternating host-copy/guest-echo pairs would
  create exactly 100 host-to-guest frames, suppress all 100 expected returns, and produce zero host
  feedback writes; observed 100/100/0. The same suite held different and expired identical content,
  reconnect-generation invalidation, 257 KiB/invalid UTF-8 rejection, and history depth <= 2.
- P4 coverage — SUFFICIENT. Changed runtime code is exercised by the seven service fixtures; the
  existing 14-test Channel suite remains green; listener disposal, status rendering, source/dist
  parity, and the no-async-read boundary are checked. No browser permission prompt, host rr,
  independent machine, or WebKit claim is made under the user-directed waiver.
