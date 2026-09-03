---
id: E5-T13c
epic: 5
title: browser focus hardening and keyboard recovery proof
priority: 513.3
status: in-progress
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

(empty)
