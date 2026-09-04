---
id: E5-T24c
epic: 5
title: Add host clipboard permissions and gesture-ordered sync
priority: 524.3
status: in-progress
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

- [ ] Host CLIP_SET reaches the guest before the corresponding canvas Ctrl+Shift+V key event, even
      with a sub-50 ms scheduling gap; unfocused canvases do not read or sync clipboard data.
- [ ] Guest CLIP_SET writes immediately when permitted and stages otherwise; a later user gesture
      flushes it without throwing, and denial is represented honestly in the UI state.
- [ ] Twenty alternating identical/different host↔guest copies do not echo; each user action emits
      at most one clipboard frame and 257 KiB/invalid input is rejected per T24a.

## Verification command

`node --test web/tests/clipboard-service.test.mjs`

## Adversarial verification

Run 100 immediate host-copy/paste pairs, alternate identical strings in both directions, deny
clipboard permission, remove focus, and install a clipboard-read spy. Any stale paste, feedback
loop, background read, or uncaught permission rejection is a refutation.

## Verification log

(empty)
