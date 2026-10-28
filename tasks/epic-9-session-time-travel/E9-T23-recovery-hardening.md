---
id: E9-T23
epic: 9
title: Harden recording and seeking against crashes and corrupt history
priority: 524.923
status: in-progress
depends_on: [E9-T07, E9-T18c, E9-T20, E9-T21]
estimate: S
risk: high
capstone: false
---

## User scope amendment — 2026-10-28

The user waived the long original-cold boot/replay campaign. E9-T22d's full
performance campaign is therefore deferred and removed as an integration
prerequisite. The already verified storage, GPU-result, branch and import
boundaries remain prerequisites. All recovery/fuzz/context-loss criteria below
remain mandatory and use bounded deterministic/browser runs, without another
original Omarchy cold boot. This task makes no full-desktop qualification or
performance-budget claim.

## Goal

Keep recorded history and the browser usable across interruption, malformed data and device loss.

## Boundary

Integration recovery of accepted session boundaries: append/keyframe/branch/GC interruption, quota/eviction, multi-tab ownership, cancelled seeks and graphics context loss.

## Acceptance criteria

- [ ] A seeded fault matrix preserves the last committed prefix and every unaffected parent/sibling session; incomplete work never becomes playable.
- [ ] Exercise at least 10000 bounded manifest/event/keyframe mutations and varied completion schedules with no panic, out-of-bounds access, unbounded allocation or hung control request.
- [ ] Actual built-browser context loss, reload and stale-epoch injection resolve pending requests and show a recoverable state; evidence includes exact positions, digests and original failures.

## Deterministic acceptance

`make verify-E9-T23 E9_OUT=<unique-directory>` on a clean exact head.
The bounded gate runs format/clippy, native manifest/publication/witness tests,
a wasm32 metadata build, at least 10,000 actual codec mutations, seeded strict
IndexedDB crash/retention/multi-tab cases, real Linux file branches/reload and
physical GPU cancellation/context-loss/branch tests with independent byte
oracles. It performs no original Omarchy cold boot or long whole-history replay.

The storage matrix explicitly uses synthetic storage payloads rather than a
model VM. Separate short RV64/Linux recordings supply the actual guest/state
and physical-GPU evidence. Earlier development failures remain preserved.

## Adversarial verification

Choose new interruption points around commits and fence completion, race two tabs, and sabotage a cancellation/generation check to show that the promoted tests detect it.

## Verification log

### 2026-10-28 — worker — bounded development checks

The 12,000-case codec smoke passed. The final harness separately counts actual
mutations and valid controls so controls cannot satisfy the 10,000-mutation
criterion. The strict-IDB recovery development run `target/evidence/e9-t23-recovery-dev2`
passed 15 publication crash cuts, six GC cuts and 48 varied maintenance
schedules, preserving sibling manifests and the expected committed revisions.
The earlier dev1 failed on repeated evidence-export callback registration;
its unmodified failed receipt is retained. Fresh export pages repair that
harness-only issue. No runtime semantics changed. Final exact-head integration,
byte oracles and fresh actual Daybreak acceptance remain outstanding.
