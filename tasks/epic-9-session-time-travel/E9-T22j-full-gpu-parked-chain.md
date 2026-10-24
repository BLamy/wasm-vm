---
id: E9-T22j
epic: 9
title: Preserve parked owned block chains in full exact-GPU keyframes
priority: 524.922025
status: in-progress
depends_on: [E9-T22b, E9-T22h]
estimate: S
risk: high
capstone: false
---

## Goal

Allow a full exact-GPU keyframe at a fixed guest position to preserve an
already-owned, authenticated virtio-blk read parked after its base-chunk
completion, just as the delta keyframe path already does.

## Boundary

One native snapshot admission inconsistency. Keep the existing exact-session
section-20 encoding/validation and device completion semantics. Do not service
the parked chain, retire an instruction, move the 50M checkpoint, force a delta,
change the original assets/profile/storage limits, or weaken ordinary
non-session snapshot quiescence. E9-T22c owns the later complete workload run.

## Acceptance criteria

- [ ] With an actual owned block request accepted at an exact before-boundary,
      prove the broker has no pending request while the resident chunk, read pin
      and parked descriptor remain. Full and delta exact-GPU captures both
      succeed at the same unchanged position.
- [ ] Restore each capture into fresh compatible machines and show identical
      broker/cache/read-pin/parked-descriptor state. The next native service
      publishes DMA, used-ring and IRQ once, without a second host request or
      double completion; recording and replay witnesses agree.
- [ ] Keep unsupported/malformed section-20 data and non-exact torn snapshots
      fail-closed. Exercise the affected wasm/browser keyframe path, zero
      console errors and the live demo suite/roadmap gate.
- [ ] Freeze high-risk native/wasm/browser/guest evidence at the exact head,
      run the prescribed local gauntlet and final cold-clone proof, then obtain
      a fresh actual Daybreak verifier verdict and publish the browser-impacting
      result to the main Cloudflare Pages URL. No merge is authorized.

## Deterministic acceptance

`make verify-E9-T22j`. Implement a bounded native parked-chain regression and
an affected built-browser exact-GPU capture/replay proof; preserve the original
E9-T22c failure as the long-workload repro, not this task's acceptance shortcut.

## Adversarial verification

Invert the full-keyframe admission guard, corrupt a parked section-20 descriptor,
vary the completion order and chunk identity, and compare full/delta/restored
states at the same exact coordinate. Attempt to double-service the chain and
to admit a legacy torn snapshot. The verifier must inspect the executed diff,
one bounded novel attack, and a pristine-clone run at the final head.

## Verification log

### 2026-10-23 — worker — activate after E9-T22c exact failure

E9-T22c's full Omarchy cold run at `29fade9013c4a48e5ffd6736f27f756f3ca53e76`
failed its full keyframe at transition `4500000000` with one parked `Chunk`
chain after owned completion sequence 881. The exact report, saved prefix and
fresh Daybreak decode are cited in E9-T22c's blocked entry. This task isolates
the full-only runtime admission inconsistency beneath C; it claims no fix yet.
