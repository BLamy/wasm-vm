---
id: E6-T12i
epic: 6
title: Cache WebGL2 shader programs and state with complete bounded keys
priority: 525.02703
status: in-progress
depends_on: [E6-T12h]
estimate: S
risk: high
capstone: false
---

## Boundary

Add bounded translation/program/state caches keyed by every semantically relevant
shader body/key, vertex layout, target format and render state, with explicit
context ownership and eviction. Document hit/miss denominators and lifetime
accounting; hashes alone must not allow collisions to alias unequal state.
WebGL2 program/state caching replaces the obsolete WebGPU pipeline cache while
retaining its correctness and efficiency milestones. Expose counters and a
frame-N dump of original commands, emitted ESSL300, bindings and cache keys.

## Deterministic acceptance

`make verify-E6-T12i` replays deterministic workload/state sequences through the
actual renderer, toggles blend state per draw 10^4 times, and requires exact
independent pixels without state bleed. Force cache pressure and demonstrate
eviction, bounded memory and correct recreation. Record hits/misses, residency,
translation/link counts and zero GL errors. The live kmscube >95% hit-rate
criterion after frame10 remains mandatory in E6-T12k, not claimed by this
synthetic test. Run affected high-risk gates and final clean clone.

## Adversarial verification

Attack deliberate hash collisions, stale context generations, changed shader
keys/target formats, eviction while referenced and repeated create/destroy.
Sabotage one key component and require the state-toggle oracle to fail. Debug
instrumentation must report real submitted/rendered work, not hide misses or
dropped draws. Cached objects must release on reset and context destruction.

## Verification log

### 2026-10-09 — worker — activation

Continue the user's production graphics offload dependency chain from independently
verified E6-T12h at `bc2c619f72c0bb13ced896411829cd19954ba163`. This high-risk
atomic cache boundary precedes truthful guest negotiation. The unrelated queue
work remains outside this explicit graphics request.

Implement bounded, context-owned translation/program/state reuse with exact
equality behind hash buckets, eviction and explicit accounting. Preserve complete
GL restoration and live uniform/storage validation; cached state cannot inherit
host bindings or authorize stale resource generations. Record real translation,
link and draw counters and an explicitly host-labelled bounded frame dump. Prove
10,000 blend toggles through physical WebGL pixels, pressure/recreation, collisions,
generation/cleanup attacks, affected retained gates, source fault sensitivity and
a final pristine clone. This layer does not advertise production caps, certify
live kmscube hit rates or claim FPS/MIPS.
