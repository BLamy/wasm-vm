---
id: E5-T13a
epic: 5
title: held-key ledger and release-all safety
priority: 513.1
status: verified
depends_on: [E5-T12c]
estimate: S
risk: medium
capstone: false
---

## Goal

Make the host-side set of keys believed down by the guest explicit, bounded, and
idempotent. A single release-all operation must turn every held key into an ordered guest
key-up frame and leave no stale modifier after focus or lifecycle loss.

## Deliverables

- `web/src/input/held-keys.ts` and its no-bundler browser projection, with press, release,
  release-all, snapshot, and reset operations.
- Lifecycle adapters for blur, `visibilitychange` to hidden, pointer-lock loss, and the T08
  view-toggle boundary that call the same release-all operation.
- Deterministic unit fixtures for make/break ordering, duplicate/orphan breaks, bounded state,
  and repeated lifecycle notifications.

## Acceptance criteria

- [ ] Pressing physical keys records each key once; releasing a held key emits one break, while
      duplicate or orphan releases are no-ops and cannot underflow the ledger.
- [ ] `releaseAll` emits exactly one break for every currently held key in deterministic order,
      terminates the frame with `SYN_REPORT`, and leaves the snapshot empty.
- [ ] Synthetic blur, hidden-visibility, pointer-lock-loss, and view-toggle notifications all
      invoke the same release-all path, including when notifications repeat.

## Adversarial verification

Feed 500 alternating lifecycle flaps and duplicate keyups through the isolated adapter, with
randomized held-key order. The final snapshot must be empty and every emitted break must have a
matching prior make. Call release-all twice during a held modifier chord; the second call must
emit no guest events.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `c62254f` adds the reusable `createHeldKeyLedger` with idempotent
press/release, deterministic dependent-before-modifier release-all ordering, re-entrancy-safe
clearing, reset, snapshots, and diagnostics. The T12b keyboard bridge now uses this ledger and
exposes `heldSnapshot`/`resetHeld`; `attachHeldKeyLifecycle` covers blur, hidden visibility,
pointer-lock loss, and the T08 reserved view-toggle boundary. The exact TypeScript and browser
projections remain byte-identical.

The frozen-head recording ran `npm run test:keyboard-hardening --prefix web`: 14 tests passed,
0 failed, including duplicate/orphan no-op behavior, reverse release ordering, empty-before-
callback re-entrancy, 500 repeated lifecycle-style releases, all four lifecycle reasons, bridge
release-all integration, and stale-state reset without guest breaks. JavaScript syntax checks,
the projection identity check, and `git diff --check c62254f^ c62254f` also passed.

Evidence: `evidence/e5-t13a/held-key-safety-2026-09-03.json`, SHA-256
`1217cf2ca5da034414464a1b40aaec56892ef8790d2d10380a6fc5a483da4d94`.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Ledger safety — HELD.** Predicted duplicate physical makes and orphan breaks would never
  create extra guest transitions or a negative held count; the frozen 14-test run observes named
  duplicate/orphan diagnostics and an empty ledger after release.
- **Release-all ordering — HELD.** Predicted a mixed held set would release dependent keys before
  modifiers in reverse make order, and that the ledger would be empty before any callback could
  re-enter it. The unit fixture observes `KeyB, KeyA, ShiftLeft`, with empty snapshots inside each
  callback; the independent re-entrancy attack observes three records, zero duplicates, and a
  second release-all of zero records.
- **Lifecycle boundaries — HELD.** Predicted blur, hidden visibility, pointer-lock loss, and the
  reserved view-toggle event would all invoke the same callback, while visible/locked transitions
  would not. The synthetic-target fixture observes exactly the four required reasons and detach
  removes all listeners.
- **Bridge coverage — HELD.** Predicted the T12b bridge would retain its exact EV_KEY/SYN behavior
  while using the shared ledger, and reset would clear stale state without emitting breaks. The
  bridge integration fixture observes the expected Alt+A release frames and a silent reset of
  `KeyB`; all changed source, projection, test, and package lines are exercised or are the
  byte-identity/proof metadata itself.
- **Integrity and scope — HELD.** Recomputed evidence SHA-256
  `1217cf2ca5da034414464a1b40aaec56892ef8790d2d10380a6fc5a483da4d94`, matched its recorded
  implementation head `c62254f`, reran the 14-test acceptance command, syntax checks, projection
  identity check, and `git diff --check`. This is a deterministic host/input layer; no browser,
  WebKit, or independent-machine run is applicable.
- **SUITE — HELD.** The isolated ledger tests, bridge regression tests, exact-head JSON evidence,
  and bounded re-entrancy attack are retained as permanent proof artifacts.

Commands: `npm run test:keyboard-hardening --prefix web`; `node --check
web/src/input/held-keys.js`; `node --check web/src/input/keyboard.js`; `cmp -s
web/src/input/held-keys.ts web/src/input/held-keys.js`; `git diff --check c62254f^ c62254f`;
re-entrant `releaseAll` attack via `node --input-type=module`.
