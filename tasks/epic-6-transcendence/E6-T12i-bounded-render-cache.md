---
id: E6-T12i
epic: 6
title: Cache WebGL2 shader programs and state with complete bounded keys
priority: 525.02703
status: implemented
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

### 2026-10-09 — worker — frozen submission

Frozen source `6ec98cebea12fc9551e333746d9616999be1e5d2`; task base is independently verified H
`bc2c619f72c0bb13ced896411829cd19954ba163`. Commands:

```sh
make verify-E6-T12i
python3 tools/virgl-command/cache-cold.py --output target/evidence/virgl-render-cache-cold
python3 tools/virgl-command/cache-seal.py target/evidence/virgl-render-cache target/evidence/virgl-render-cache-cold evidence/virgl-render-cache/worker
```

The hot and pristine cold gates pass. Each normal and all-hashes-collide run
records all 10,000 actual native WebGL draws and 10,240,000 raw RGBA bytes;
the Python receipt independently checks every byte against alternating literal
blend predictions. Omitting the blend key fails at toggle 1; omitting exact
shader text fails the pressure shader 0 pixel oracle. Exact owner/string equality
survives every hash colliding. The 33 native predicates and over 21,000 physical
predictions cover bounded LRU pressure, recreation after eviction, owner/selector
and resource generations, changed target/layout keys, actual ESSL-linked frame
captures, honest overflow/bypass counts, twenty context lifecycle cycles, reset
and disposal. Real translation/compile/link/draw invocations agree with exported
counters; successful async jobs under delays 0/1/3 retire through native GPU
fences, and disposal of unfinished work remains a failed submission. Browser
console/page/request errors are zero and the recordings identify physical ANGLE
Metal GPU execution. V8 coverage, original command hex and draw observations
are authenticated in the reports.

The gate retains affected H/G5 native, pinned shader Wasm and physical decoder,
resources, state, indexed draw, jobs, normalized/depth formats, view/flat pairing
and inline-upload paths, their existing source faults and promoted format-role
and complete RGB-fetch boundary regressions. Historical full-inspection equality
assertions now distinguish truthful changing telemetry from preserved native
state and allocations. Existing program-quota tests exercise eviction and literal
view pixels; native failure rollback still forbids leaked native allocations,
while successful checked CPU translation can remain bounded after native failure.
Trusted output-injection fixtures select a distinct uncached TGSI body so reuse
cannot conceal the injected fault. Transport-only wrapper module-list changes
have no additional runtime semantics. Rust and compiler numerical semantics
are unchanged, so unrelated workspace/compiler walls are not repeated.

Cold clone: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-cache-cold-15hmjyhg/wasm-vm`. It is exact-head and pristine
before/after the identical gate, with compiler/Rust/Cargo/Node/Python overrides
scrubbed. Hot records: `target/evidence/virgl-render-cache`; cold records:
`target/evidence/virgl-render-cache-cold`. Committed seal:
`evidence/virgl-render-cache/worker/{manifest.json,records.json,recording.tar.gz}`
contains 168 regular records / 7,143,802 archive bytes.

- Archive SHA256: `ad9165fcca40cca50382079c4df648d37525951bbae2e0b17012c236e9b097b7`
- Index SHA256: `68a61aac2fc646cf0ae26ab71b7a7bf94de8affe77c539181d800b79b448593b`
- Hot receipt SHA256: `18b7d6767af582fa3325b4418c9bd39c0e1651568bda170f6cb8803648f06824`
- Cold receipt SHA256: `29ad7d679a6734336ba45a4673621796f5d06d017c37bdeb414a45b3e7f025b0`
- Cold report SHA256: `159ecceb50bbb04dabd8b4653303f24081db41cd439058ddc99227700a7f9117`

This proves isolated bounded renderer reuse and host-labelled capture. It does
not infer guest frames, advertise capabilities, certify production hit rate,
measure JS heap/driver memory, or claim live guest execution, FPS or MIPS.
The renderer remains outside demo imports; production hookup/deployment belongs
to E6-T11d. A fresh adversarial verifier must interrogate this claim and diff
before the task can become verified. No merge is performed.
