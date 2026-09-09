---
id: E5-T28a
epic: 5
title: Publish the default desktop entry point and exact Level 5 demo script
priority: 528.1
status: pending
depends_on: [E5-T13c, E5-T15d, E5-T18e, E5-T20e, E5-T24d, E5-T22d, E5-T25d, E5-T26g]
estimate: S
risk: medium
capstone: false
---

## Goal

Make the verified desktop the normal product entry point, with the serial console
one toggle away, and publish the repeatable script used by the final integrated proof.

### Current release direction — user instruction, 2026-09-08

Ship a fresh, optimized desktop entry for the Omarchy release. Do not retain
production compatibility branches solely to preserve earlier demo behavior.
The Epic 5 desktop proof and merge still precede the prepared Omarchy image
rollout; this instruction does not move work into Epic 6.

Remove obsolete boot/benchmark launcher DOM and its bindings when replacing
the product entry, rather than hiding those controls behind the new desktop.
The production entry selects the current optimized runtime explicitly: old
`slowInterp` behavior and compatibility with older WASM controller APIs are
not release requirements. Keep any necessary differential controls in the
verification harness, not as alternate production boot behavior.

This is not permission to remove the interpreter needed for uncompiled guest
code, architectural semantics, integrity/identity checks, or current input,
audio, storage and shutdown safety. Old user data must not be deleted merely
to make a clean release; incompatible snapshots are rejected visibly, and
new release state is bound to the exact current artifacts.

## Boundary

Own only demo entry/configuration, the roadmap manifest, `docs/demos/level-5.md`, and
the entry-point acceptance harness. Do not change guest architectural semantics or
weaken the performance targets recorded in the parent E5-T28 contract.

## Acceptance criteria

- Default built-page load, without feature flags, selects the hash-bound desktop
  kernel/image and exposes its compositor, terminal launcher, and second GUI app.
- The shipped product entry has one current desktop boot path, not hidden legacy
  guest launchers or old-version API fallbacks. A missing required runtime API or
  incompatible release artifact fails visibly rather than booting an older mode.
- The production entry cannot select the old instruction-at-a-time interpreter
  through `slowInterp`; necessary oracle/diagnostic controls remain test-owned.
- Document exact clean build commands, browser/configuration, clicks, keystrokes,
  audio capture, clipboard permissions, resize, focus, restore, and clean shutdown.
- Document the active demo recording separately from the 30-minute idle leg; do
  not claim that the <=3-minute active recording contains the idle period or cold boot.
- The narrow entry/config tests and one Chromium built-page smoke pass with zero
  non-favicon errors, and serial/desktop switching preserves the running machine.

## Verification command

make verify-E5-T28a

## Adversarial verification

Use an empty profile with no cached storage and no test query parameters. Check that
the visible desktop uses the declared release bytes, not a local route substitution.
One bounded attack removes an artifact; boot must fail visibly without silently
booting a different image. Inspect the script for hidden serial intervention.
Inspect the shipped DOM and entry imports for retained obsolete launchers, and
check that an old `slowInterp` URL cannot select legacy production behavior.
Do not mistake required interpreter fallback or safe preservation of unrelated
stored user data for backwards-compatibility work.

## Verification log

(empty)
