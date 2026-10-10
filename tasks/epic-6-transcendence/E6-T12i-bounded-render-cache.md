---
id: E6-T12i
epic: 6
title: Cache WebGL2 shader programs and state with complete bounded keys
priority: 525.02703
status: verified
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


### 2026-10-09 — fresh adversarial verifier

VERDICT: verified

Reviewed the complete task and H-to-I diff before inspecting evidence; recorded
falsifiable P0–P8 predictions first. This session did not implement or modify
runtime code or the worker harness. Source remains
`6ec98cebea12fc9551e333746d9616999be1e5d2`, based on verified H
`bc2c619f72c0bb13ced896411829cd19954ba163`. Fresh report repository head
`6566e23fc81785feaf5f51842f85c5c76fb5e915` adds submission metadata only;
all executed runtime bytes independently match the frozen source.

- **P0 custody/cold isolation — HELD.** Authenticated all 168 unique safe regular
  worker archive members and 143 frozen source files, generated Wasm, served
  source, screenshots and precise V8 source digests. Worker archive
  `ad9165fcca40cca50382079c4df648d37525951bbae2e0b17012c236e9b097b7`
  and index `68a61aac2fc646cf0ae26ab71b7a7bf94de8affe77c539181d800b79b448593b`
  match. The retained cold clone is still pristine at the frozen source; its
  authenticated identical gate passed before/after with override scrubbing.
  No portability finding requires repeating that final cold run. Citation:
  critic `authentication.json`, worker `cold/{report.json,cold.log,receipt.json}`.
- **P1 physical toggles — HELD.** Independently compared every byte of all four
  frozen hot/cold hardware/collision streams (40,960,000 bytes), then two fresh
  hardware/collision streams (20,480,000 bytes), against literal alternating
  `[255,0,0,64]` / `[64,0,191,255]` predictions. All 10,000 ordered native
  `drawArrays(TRIANGLE_STRIP,0,4)` calls in each stream agree with blend parity.
  Warm work deltas are 10,000 draws, 30,000 applied commands and zero translation,
  compile or link invocations. Shared pixel SHA256:
  `dbf578ae8f10724d735c5c696ef118d4e2e717156b11dccd9c3091202e476af4`.
  Citation: `recording-audit.json`, `final-audits.json`, each `toggles.rgba`
  at byte offsets `1024*n..1024*(n+1)` and reports `/browserResult/result/toggles`.
- **P2 ownership/LRU/pressure — HELD.** Exact strings and private owners survive
  real FNV collisions and forcing every hash to zero. Primitive byte pressure
  evicts the two least recent values exactly once; same-key replacement releases
  the old owned value without double charge. Recorded renderer pressure produces
  17 native program, 50 state and 5 translation evictions while all residency
  and native allocation limits hold. Referenced selectors survive eviction and
  recreate real native programs. Citation: worker hot/cold reports
  `/native/assertions`, `/browserResult/result/pressure`; critic
  `promoted-physical/report.json:/result/{primitive,schedules}`.
- **P3 generations and teardown — HELD.** Another context/subcontext with equal
  TGSI makes its own two real stage translations and native programs. Public
  selector reuse changes owned identity and physical color; stale resource
  context generations issue no draw. Target formats 2/233/67 and altered vertex
  layouts have four distinct complete state keys while unchanged ESSL reuses one
  program key. Twenty context cycles end with every renderer/native/cache budget
  zero. Fresh subcontext id reuse receives a newer private generation, renders
  literal blue and preserves the other owner. Citation: worker reports
  `/browserResult/result/{ownership,pressure/frames/1}` and critic
  `promoted-physical/report.json:/result/schedules`.
- **P4 real work/accounting — HELD.** Exported translation, pair, compile, link,
  draw and allocation counts equal independent bridge/GL calls. A fresh semantic
  prefix applies exactly one uniform command, reports one failed attempt and
  zero draws; captured outcome is `[false,1,0]`. Completed jobs retire actual
  native fences; disposal of unfinished accepted work increments failures rather
  than losing an attempt. Three new schedules vary timeout counts and task
  delays with seeds `0x417c8b13`, `0x93a26e57`, `0xe5180ca9`, each requiring real
  driver completion. Citation: worker `/browserResult/result/jobs`; critic
  `promoted-physical/report.json:/result/schedules/*/{prefixDump,state,polls}`.
- **P5 capture honesty — HELD.** Independently walked owned raw command hex,
  checked extent/count, constant banks, viewport/scissor and native program
  generations against capture bindings. Captured ESSL matches actual attached
  native shader sources. Host labels say `presented:false`; overflow explicitly
  drops 99 submissions, 100 draws and 100 outcomes while end counters still
  count all 100 real draws and debug charge remains within 16,384 bytes. Reset,
  owner destruction and disposal release cached/native payloads. Citation:
  `recording-audit.json`; worker reports `/browserResult/result/{pressure/frames,
  diagnostics/dump,jobs}`; fresh active capture inspection exercises
  `state.mjs:1177`.
- **P6 source faults and retained failures — HELD.** Fresh omission of blend state
  fails `blend toggle 1 literal physical pixels`; omission of exact stage text
  fails `pressure shader 0 literal physical pixels`. All hashes zero pass exact
  output. Independently compared all twelve retained flat-link failure snapshots:
  contexts/native budgets/native allocation sets are unchanged and failed
  attempts increment. Twelve view native faults, six uncached checked-output
  guards and exact/one-byte-short variant quotas hold in both recordings.
  CPU translation residency after native failure remains bounded and permitted;
  leaked native allocation is forbidden. Citation: critic `carry-forward.json`
  and `final-audits.json`; worker view report `/browserResult/result/{flat/faults,
  budgets,checkedOutput}`. Wrapper-only module-list additions are transport
  metadata and introduce no additional runtime branch.
- **P7 coverage — HELD.** Source-authenticated precise V8 ranges execute all 52
  substantive added cache lines and 187 substantive added state lines. The
  remaining 35 added lines are comments, blank lines or punctuation, individually
  waived in the ledger. No changed runtime branch is unproven. The novel run
  closes the replacement-release path at `cache.mjs:48` and active-frame
  inspection at `state.mjs:1177`; syntax/receipt/policy gates cover declarative
  target, docs, status and transport-list changes. Citation:
  `coverage-audit.json` (all per-line ranges, counts and record digests), SHA256
  `991d487ff45a1bbef46bd8c436d490148d9e6d339cf0e1965b7a5dcb692af9b2`.
- **P8 bounded novel attack/promotion — HELD.** Three independent physical GPU
  schedules interleave two subcontexts under a one-program quota with changing
  uniform/scissor state, 19 program evictions each, copied asynchronous command
  input, id reuse, stale-context rejection and complete native cleanup. Every
  one of 144 recorded 16x16 rectangle frames matches an independent coordinate
  oracle; 147 actual draws and 4,593 predicates hold. Sabotaging only the scissor
  key makes pair `0/1` paint green at `(4,4)` where literal black was predicted.
  The promoted test itself was rerun and sabotaged. Citation:
  `promoted-physical/{report.json,seed-*.rgba,browser-coverage.json}` and
  `promoted-sabotage/report.json:/result/error/message`; normal report SHA256
  `6a8b6efc99a2a978e6bdcd3dab66f0c172844413c3c54c21711281141f010a32`.

SUITE: promoted `renderer/virgl-command/tests/cache-boundaries.mjs` as a direct
recurring physical regression for private subcontext isolation, referenced
program eviction, id reuse, state-key scissor sensitivity, failure-prefix
accounting, and actual fence retirement. The test also permanently covers exact
owner replacement in the LRU. Unchanged H/G6/compiler numerical boundaries carry
forward: resources, decoder, constant-domain and shader source are unchanged;
the generated shader module/Wasm digests equal the verified H seal. No broad
Rust/compiler wall is rerun for this JavaScript cache diff.

Commands (source mutations affect served copies only and exit 1 as predicted):

```sh
python3 evidence/virgl-render-cache/verifier/authenticate.py
python3 evidence/virgl-render-cache/verifier/audit_recording.py
python3 evidence/virgl-render-cache/verifier/audit_coverage.py
python3 evidence/virgl-render-cache/verifier/carry_forward.py
node tools/verify-virgl-render-cache.mjs --output evidence/virgl-render-cache/verifier/independent-hardware
node tools/verify-virgl-render-cache.mjs --output evidence/virgl-render-cache/verifier/independent-hash-collision --mutation hash-collision
node tools/verify-virgl-render-cache.mjs --output evidence/virgl-render-cache/verifier/independent-fault-blend --mutation blend-key
node tools/verify-virgl-render-cache.mjs --output evidence/virgl-render-cache/verifier/independent-fault-text --mutation translation-text
node renderer/virgl-command/tests/cache-boundaries.mjs --output evidence/virgl-render-cache/verifier/promoted-physical
node renderer/virgl-command/tests/cache-boundaries.mjs --output evidence/virgl-render-cache/verifier/promoted-sabotage --sabotage scissor-key
python3 evidence/virgl-render-cache/verifier/final_audits.py
python3 evidence/virgl-render-cache/verifier/seal.py
```

Committed critic seal: `evidence/virgl-render-cache/verifier/{manifest.json,
records.json,recording.tar.gz}`, 55 members / 1,477,694 archive bytes. All members
re-authenticate. Archive SHA256
`c6932986a04f4382148547ee5f06720fc496f0dce932eedb6f9b7c4e8a35105c`;
index SHA256 `55037f473afd9ac72ec791625dd100067ebb20e57f8e07af9543f1429aed2f1f`.
Audit scripts, predictions, exact diff, source snapshots, raw pixels, actual
native calls, V8 ranges and browser captures are preserved inside the archive.

Authority remains isolated bounded renderer reuse and host-labelled capture.
Byte charges estimate bounded owned payloads; they do not measure JS heap or GPU
memory. This verdict does not qualify capsets, live guest/compositor frames,
presentation, kmscube hit rates, FPS or MIPS. No push or merge is performed.
