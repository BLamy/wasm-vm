---
id: E5-T12b
epic: 5
title: DOM keyboard event normalization and evdev bridge
priority: 512.2
status: verified
depends_on: [E5-T12a]
estimate: S
risk: medium
capstone: false
---

## Goal

Translate normalized DOM keydown/keyup events into framed T11 evdev events through the
`WasmLinux` keyboard bridge. Track modifiers and held keys, suppress browser autorepeat and IME
events according to the written v1 policy, and preserve make/break ordering.

## Deliverables

- `web/src/input/keyboard.ts`: event normalization, modifier/held-key state, keydown/keyup
  translation, `event.repeat` suppression, and `isComposing`/keyCode-229 guard.
- The host adapter that calls `sendKeyboardEvent` and `syncKeyboard` for each coherent frame,
  including release ordering for modifier chords.
- Deterministic unit fixtures for shifted punctuation, AltGr's right-alt representation, rapid
  interleaved chords, repeat events, and IME/dead-key policy.

## Acceptance criteria

- [ ] A physical `KeyA` down/up produces exactly one KEY_A make frame and one break frame, each
      terminated by SYN_REPORT; DOM repeat keydowns add no frames.
- [ ] Shift/Ctrl/Alt/Meta modifiers are emitted before the dependent key and released after it;
      `Ctrl+C` and shifted punctuation have the expected evdev sequence.
- [ ] Composing events and keyCode 229 produce no guest events, while a dead key still maps by its
      physical `code` when not composing.

## Adversarial verification

Feed rapid `ShiftLeft` down, `KeyA` down, `ShiftLeft` up, `KeyA` up and a held key with 100 repeat
callbacks; assert exact sequence and no duplicate down. Feed Windows-style Ctrl+AltRight AltGr
ordering and verify the documented representation. Inject an unmapped code and require an explicit
diagnostic/no-op rather than an arbitrary evdev code.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `baf1d20` adds the JavaScript-compatible TypeScript keyboard bridge and
its no-bundler projection, plus the direct/whole-machine-worker WasmLinux adapter. Each accepted
physical key transition calls `sendKeyboardEvent(EV_KEY, evdev, value)` and then `syncKeyboard`.
The bridge tracks physical held keys, suppresses DOM repeat and IME/keyCode-229 events, maps dead
keys by `code`, reports unmapped/orphan events as diagnostics, and defers modifier breaks until
dependent keys have broken. The loader controller and versioned worker allow-list now expose both
keyboard methods; the protocol fixture asserts FIFO send-before-sync ordering.

The frozen-head recording ran the 35-test direct Node matrix covering KeyA make/break, 100 repeat
callbacks, rapid Shift/A release ordering, Ctrl+C, shifted punctuation, Windows Ctrl+AltRight
AltGr, IME/dead-key handling, unmapped/orphan diagnostics, adapter calls, listener lifecycle, and
the inherited T12a table. `npm run test:keyboard --prefix web` ran the 30 keyboard/protocol tests.
Both passed with zero failures; `node --check` on the changed browser modules, `git diff --check`,
and `cargo check -p wasm-vm-wasm` also passed. Output SHA-256 is
`0fbd11d2e8fbf5b6c31236aecd336c329882e03faed2a7a86608c926c7f9db31`.

Evidence: `evidence/e5-t12b/keyboard-bridge-2026-09-03.json`, including the exact frame
sequences and changed-file digests. Browser capture/preventDefault wiring and the getty proof
remain owned by E5-T12c.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Frame translation — HELD.** Predicted a physical `KeyA` make and break would each call the
  T11 event API once and then publish one sync frame; the bridge test observes exactly
  `EV_KEY 30 1`, sync, `EV_KEY 30 0`, sync. The direct and worker adapters both expose the same
  `sendKeyboardEvent`/`syncKeyboard` pair, and the protocol test observes send-before-sync FIFO
  order through the versioned allow-list.
- **Modifier ordering — HELD.** Predicted modifiers would precede dependent keys and would not
  break before them, including the adversarial `ShiftLeft down, KeyA down, ShiftLeft up, KeyA up`
  sequence; the observed frames are 42-down, 30-down, 30-up, 42-up. Ctrl+C, shifted punctuation,
  and Windows Ctrl+AltRight AltGr are covered by exact frame assertions.
- **Repeat/IME/dead-key policy — HELD.** Predicted 100 `repeat` keydowns add no guest frames,
  composing and keyCode/which 229 events add none, and a non-composing `Dead` key maps by physical
  code; the deterministic matrix observes those results. Unmapped and orphan events are explicit
  diagnostics/no-ops.
- **Coverage and integrity — HELD.** The verifier reran 35 direct Node tests and the 30-test
  package-script matrix at the post-evidence head, plus syntax checks, `git diff --check`, and
  `cargo check -p wasm-vm-wasm`; all passed. Changed bridge, loader, worker-protocol, test, and
  inherited keymap paths are exercised or read by the cited runs. Evidence digest:
  `evidence/e5-t12b/keyboard-bridge-2026-09-03.json` with output SHA-256
  `0fbd11d2e8fbf5b6c31236aecd336c329882e03faed2a7a86608c926c7f9db31`.
- **Scope — HELD.** This slice intentionally stops at normalized event translation and controller
  transport; capture/preventDefault UI policy and browser/getty proof are the next T12c boundary.
  No independent-machine or WebKit run is applicable to this local deterministic bridge claim.
- **SUITE — HELD.** The deterministic bridge/protocol tests and exact frame fixtures are retained
  as the permanent proof artifacts.

Commands: `node --test web/tests/keymap.test.mjs web/tests/keyboard-bridge.test.mjs
web/tests/e4-t32-worker-protocol.test.mjs`; `npm run test:keyboard --prefix web`;
`node --check web/src/input/keyboard.js`; `node --check web/linux-worker-protocol.js`;
`node --check web/loader.js`; `git diff --check`; `cargo check -p wasm-vm-wasm`.
