---
id: E5-T13c
epic: 5
title: browser focus hardening and keyboard recovery proof
priority: 513.3
status: verified
depends_on: [E5-T13b]
estimate: S
risk: medium
capstone: false
---

## Goal

Wire the hardened keyboard state into the browser demo so focus theft, visibility changes,
pointer-lock exit, view toggles, worker restart, and an intentional panic release are visible,
recoverable, and proven against the guest getty.

## Deliverables

- Browser integration for release/reconciliation hooks, worker teardown/reset, and a visible
  “release all keys” control with currently-held keys and repair statistics.
- Documentation of focus-loss recovery, host lock-key policy, and the remaining OS/browser
  shortcut limitations.
- One deterministic Chromium proof harness covering focus theft, both visibility modifier
  branches, the panic control, restart reset, and post-recovery guest typing.

## Acceptance criteria

- [ ] Holding Alt and firing a browser blur or hidden-visibility event releases it within one
      guest frame; the debug surface reports zero held keys, and typing afterward produces a
      lone unmodified `a` (unless host CapsLock is on).
- [ ] The proof covers Ctrl held across visibility loss: Ctrl is re-pressed on return only when
      `getModifierState('Control')` remains true, and both branches leave the guest neutral after
      key-up.
- [ ] The panic button releases a genuinely held key, repeated release is safe, worker restart
      clears the ledger, and the browser proof records the recovery state plus zero unexpected
      console/page/request errors.
- [ ] The debug panel exposes held keys and reconciliation statistics, and the documentation
      matches the implemented focus and lock-key policy.

## Adversarial verification

Use the local browser harness to steal focus during Alt+Tab-like chords, fire a JS alert while a
modifier is held, exit pointer lock with Escape, toggle views, and restart the worker. After each
attack type `a` at the guest getty and assert no phantom modifier. Invoke the panic button during
a held physical key and require the later physical keyup to be a no-op. Run 500 randomized focus
flaps interleaved with chords and require an empty final held set.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `5655c3c3edb06cbd14b3dc1257cb53966e7e9ee4` wires the T13a held-key lifecycle
ledger and T13b reconciler into the live demo. Blur, hidden visibility, pointer-lock loss, and
reserved view-toggle events share an idempotent release path; queued late keyups are suppressed
until the next real keydown so recovery cannot immediately re-press a still-down host modifier.
The terminal bar now exposes currently-held physical codes, modifier/lock repair counts, and a
visible **Release keys** panic control. Worker/main-thread controllers expose guest LED feedback,
restart teardown resets the bridge without post-stop RPCs, and `docs/input.md` documents the policy.
The deploy assembler now includes the no-bundler `web/src` tree required by the generated shell.

The frozen-head Chromium recording ran `node tools/verify/e5-t13c-focus-hardening-proof.mjs` after
`make web-dist`. It booted the real busybox guest, proved Alt release on blur, Ctrl visibility
reconciliation on both host-state branches, panic release plus late-keyup no-op, worker restart
reset, 500 deterministic lifecycle flaps, and post-recovery shell typing reaching
`E5_T13C_RECOVER_42`. The debug surface ended `Held: none · repairs: 0`; page, console, and request
error lists were all empty. Static source/dist parity covered `main.js`, `ide.js`, `loader.js`,
the worker protocol, and all shipped input modules.

Narrow gates also passed: 53 keyboard/protocol tests, JS syntax checks, `cargo fmt --all --
--check`, `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`, and `git diff --check`.
Host rr, independent machines, and WebKit are waived for this browser-only local proof per the
current verification policy and user direction.

Evidence: `evidence/e5-t13c/focus-hardening-2026-09-03.json`, SHA-256
`048c92d22f51e543581d2e7e1875491a82fdec49ec57b99a5525b7fee53210cb`; screenshot SHA-256
`cf89b0e905d4f6327d5de7209353f17c96ef1287e7c1a844f6503d326a36eb4b`. The JSON binds the run to
the exact implementation commit above.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Lifecycle release — HELD.** Predicted that a held Alt chord would be cleared in dependent-key-
  first order at a blur boundary, and that the queued F1/Alt keyups would not reintroduce a
  modifier. The frozen Chromium evidence records `F1 up`, `AltLeft up`, an empty held set, and a
  lone `KeyA down/up` afterward.
- **Visibility reconciliation — HELD.** Predicted that hidden visibility would clear Ctrl, then
  re-press it before F3 only while Chromium still reported Control down; after the physical Control
  release, F5 would have no synthetic Control make. The evidence records both exact sequences and
  one modifier repair; the false branch is exactly `F5 down/up`.
- **Panic/restart/stress — HELD.** Predicted that the visible panic control and a repeated release
  would be idempotent, controller retirement would reset stale keys without post-stop RPCs, and 500
  deterministic blur/pointer-lock/view-toggle flaps would finish neutral. The recording observes
  the panic release, empty post-retirement ledger, `iterations: 500`, and final held `[]`; the
  post-restart guest reaches `E5_T13C_RECOVER_42`.
- **UI/docs/deploy coverage — HELD.** Predicted that the debug surface would expose held keys and
  repair counts, the docs would name the same focus/lock policy, and the generated deploy shell
  would load every no-bundler input module. Static parity covers source/dist main, loader, protocol,
  and all input modules; the browser requested all four new runtime modules with zero failed
  requests, and the final UI reads `Held: none · repairs: 0`.
- **Integrity and gates — HELD.** Recomputed the JSON digest
  `048c92d22f51e543581d2e7e1875491a82fdec49ec57b99a5525b7fee53210cb`, matched its exact
  implementation head `5655c3c3edb06cbd14b3dc1257cb53966e7e9ee4`, and confirmed it is an ancestor of
  verifier head `5f096553424daa7aeafefb60206721c403932c3d`. The 53-test keyboard/protocol matrix,
  default targeted clippy, keyboard core tests (2/2), wasm32 build, fmt, syntax, and diff checks
  passed. The broader all-features clippy command reached unrelated pre-existing `dead_code`
  errors in `crates/core/src/dispatch.rs` and `crates/core/src/hart/mod.rs`; the T13c diff does not
  touch those lines, so this is not a task finding.
- **SUITE — HELD.** Retain the deterministic Chromium harness, exact-head JSON/screenshot, the
  existing 53 unit/protocol tests, and the bounded 500-flap attack as permanent proof artifacts.
