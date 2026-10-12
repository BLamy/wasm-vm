---
id: E6-T11d50
epic: 6
title: Retain the compositor's original resources within a bounded native store
priority: 525.027039000397
status: verified
depends_on: [E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

Add one explicitly selected desktop resource store with a 64 live/retained-resource
ceiling. Preserve every other existing resource, transfer, CPU/GPU/scratch,
context, ticket, lease and dimension limit; overrides may only tighten this
selected ceiling. Every existing public store retains its 16-resource ceiling,
input admission and deterministic results. Reuse the independently qualified
packed-depth backend and all its preceding storage families; do not change
formats, transfer algorithms, shader/command admission, transport or capsets.

The original reference compositor reaches 24 live Mesa resources and glmark2
reaches 35, excluding their recorded QEMU bootstrap 2D resource. At the verified
D49 head both stop at the first native-store count overflow. This task proves
the allocation/lifetime boundary alone. Full GLES, guest Mesa/worker/scanout,
the demo/live deployment and measured throughput remain parent acceptance.

## Deterministic acceptance

`make verify-E6-T11d50` authenticates the original compositor, glmark2-es2 and
kmscube event bytes against their published manifests, replays every original
Mesa create/unref pair in order up to completion or the first unrelated refusal,
through the actual selected store on headed
M4 Metal WebGL2, and matches independent live-resource/byte counters. It records
the one exact excluded bootstrap 2D call and does not skip any Mesa refusal.
All admitted native allocations must execute with zero GL/browser errors.
The compositor and kmscube pass their complete lifetime streams. Glmark2 must
advance beyond its old count-overflow event and stop at its complete original
Z32 format17 create (event3025), with an explicit unsupported-resource refusal
before allocation; retaining this separate format boundary is part of the
claim. Old-store controls still stop at the recorded count-overflow events.

Physically upload and independently read 64 distinct GPU allocations, including
slots above 16, using actual completed native fences. Refuse allocation 65
before a backend call. Unref while opaque leases and asynchronous reads retain
allocations; those hidden allocations must still count. Release one and admit
exactly one replacement with a distinct generation, without aliasing the old
allocation. Run three recorded independently seeded lifetime schedules and
dispose/cancel with outstanding holds; every resource, ticket, backing and
byte budget must return to zero. Sabotage count enforcement and a native
allocation's actual bytes separately; each control must fail its oracle after
a valid baseline (the byte attack needs a distinct completed fence).

Exercise all selected limit/default paths: 0/1/16/63/64 tightened counts,
65/negative/nonintegral/nonfinite/sparse/accessor/unknown limits, dimensions,
resource and aggregate byte limits, opaque-token misuse, failed backend
allocation rollback and inherited 16-resource factories. Compare all historical
factory outputs to the authentic verified predecessor module, without allowing
new-selected fields to leak into old results. Record full source closure,
original events, inputs/results/native bytes, finest-range V8 diff coverage,
browser screenshot and evidence digests. Every runtime hunk must execute or
have an exact reasoned waiver.

Run syntax/diff/policy checks and affected deterministic resource/browser gates
at the frozen head, then once in a pristine scrubbed exact-head clone. Unchanged
Rust, compiler, generated Wasm, image-family and D49 renderer facts carry
forward only with exact dependency/source/evidence digests. This isolated
unimported store is not yet a demo-reachable capability and does not deploy a
new production capset or imply a guest draw.

## Adversarial verification

Before looking at results predict concrete original overflow events, exact
selected/default ceilings, all retained/reused identities and zero final
budgets. Authenticate the full recording and original capture manifests;
independently reconstruct the create/unref model and native byte oracle.
Attack a capacity override, retained hidden-resource overflow and failed host
allocation; execute three new lifetime seeds, both sabotage checks and one
bounded novel attack. Audit each runtime hunk and carry held dependencies by
digest. The verifier must be fresh and must not modify implementation code.

## Verification log

### 2026-10-12 — worker — pending; original native refusal

At verified predecessor `e1066c663b64df546f9644f1a25508b4e71db636`, run
`node evidence/virgl-production-readiness/standard-resource-capacity-gap.mjs e1066c663b64df546f9644f1a25508b4e71db636 evidence/virgl-production-readiness/standard-resource-capacity-gap.json`.
The headed M4 Metal replay refuses compositor event454 and glmark2 event463
with `Live/retained resource count limit exceeded.` at exactly16 live resources,
without another native allocation. Kmscube's complete eight resource lifetime
calls pass. Original metadata and enter/return pairs are retained; only original
QEMU bootstrap resource2/event10/flags1 is identified as the separate 2D path.
This negative record makes no guest or production claim. Native stack500 is
continued above the existing D49 branch, preserving all128 previous PRs.

### 2026-10-12 — worker — scope held after original replay

The first self-validation of the selected capacity admits the compositor's
complete56 lifetime calls (peak24). Glmark2 passes the prior count overflow,
reaches25 live resources, then explicitly refuses original event3025/resource32,
format17, 800x600 depth storage. Its full stream peak35 includes this unqualified
format. The acceptance now requires that precise visible refusal and preserves
the single count boundary; this task does not add or pretend to prove format17.
The original source events remain fully authenticated and retained. Separate
ordered format work remains necessary before glmark2/full API qualification.

### 2026-10-12 — worker — implemented; frozen recording submitted

Runtime/harness head: `64bf6ed58a27a52a20e1548166e12d09dd719031`.
Final commands, all expected statuses satisfied:

```sh
VIRGL_RESOURCE_CAPACITY_EVIDENCE_DIR=target/evidence/virgl-resource-capacity-final/hot-2 make verify-E6-T11d50
python3 tools/virgl-resource-capacity/cold.py --output target/evidence/virgl-resource-capacity-final/cold
python3 tools/virgl-resource-capacity/seal.py target/evidence/virgl-resource-capacity-final/hot-2 target/evidence/virgl-resource-capacity-final/cold evidence/virgl-resource-capacity/worker
```

Selected native replay passes the compositor's complete56 and kmscube's eight
Mesa lifetime calls. Glmark2 advances beyond old event463, reaches25 live
resources, and explicitly refuses original format17/event3025 before allocating.
Selected/old controls contain156 original calls; independent original-event
counts/byte models agree throughout. All15 historical native factories match
the authentic predecessor, including16/17 ceilings. There are33 limit/budget/
host-failure cases, three lifetime seeds `0x501bc239/0x98ef03a7/0xdd31658b`,
81,408 independently compared native GPU bytes and15 completed fence citations.
Sixty-four buffers still count after unref while leases/reads retain storage;
final release admits one distinct-generation replacement, and disposal/cancel
returns every budget to zero. Count sabotage physically allocates65 and fails.
Byte sabotage follows a clean64-buffer baseline and a distinct completed fence;
the independent oracle catches resource1032/byte17. Browser/GL errors are zero,
headed Chrome155 uses native M4 Metal, and inherited E6-T12b decoder/transfers
and both original-input fault controls pass. Its browser server required one
already-qualified UN16/UN24 endpoint; that harness repair is in the frozen head.

Finest V8 covers all nine changed runtime lines with five exact non-runtime
comment/whitespace/delimiter waivers and zero uncovered operands. The pristine
clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-resource-capacity-cold-4zv577h6/wasm-vm`
starts/ends clean at the same frozen head and passes the same gates/controls.
Rust/web/compiler/guest boundaries are unchanged;290 carried shader/decoder/
state source hashes, generated Wasm/MJS identities and D49 indexes remain held.
This unimported host factory grants no new demo capability or production capset
and skips dist/deployment. A fresh critic must judge the worker's claim.

The worker seal under `evidence/virgl-resource-capacity/worker/` completely
reopens642 logical bodies. SHA256 identities:

- manifest `59cea015984012bb2bbd8c8ac469e509ae272c5ca10814dbf80af669566dbdd7`
- index `4a948c805eaf6d5c165a88694e81d575a630069d49292098274de625e4f1c4c8`
- archive (2,620,778 bytes) `7abb50b55a92b45ceec07aa52a95f0a024c94837dc0a44773465e3d4d3999420`
- hot receipt `f2ceeba4ee501604914fd07fc58fa987ad8a7a85b42b280b8c949afee72ba54c`
- cold report `d338595e16870b8821da10e31ab57265603380f5e235e5176de660dcd507165f`
- cold receipt `6c62e09123dd6721772db5091a025afb9ebc54125fd7a37bf5f8f4a132dc8ffc`

Claim: the selected bounded store closes the original compositor's live-count
gap within existing storage and byte ceilings, including hidden holds and real
GPU bytes; old factories remain unchanged. Full GLES/capsets, actual guest
Mesa/compositor, transport/worker/scanout/demo/deployment and300MIPS remain
unproven parent acceptance.

### 2026-10-12 — fresh verifier — VERDICT: verified

VERDICT: verified

The fresh critic read this task and the scoped diff before evidence. Predictions
P1–P9 were recorded before inspecting results in
`evidence/virgl-resource-capacity/verifier/predictions.json` (SHA256
`c25d2eddc3634fcadbfb9e7a3cdc3f66f8a25ba854f1a3120ce4925581aaa6ba`).
The implemented runtime remains byte-for-byte the frozen
`64bf6ed58a27a52a20e1548166e12d09dd719031` at worker submission
`2678da14d56640c5a1a9f680fa4aae7129c71efe`. The critic did not edit
implementation code. The exact appended critic Makefile target and task log are
non-runtime source waivers; the original acceptance target is unchanged.

- **P1 authentication / cold / carried boundary — HELD.** Independently reopened
  all642 logical worker archive bodies, including earlier-physical-body
  hardlinks, against their exact lengths/digests and frozen Git source. Original
  capture manifests match the verified predecessor. All290 carried sources,
  generated MJS/Wasm identities and both D49 published seal/index/archive hashes
  match; those unchanged HELD facts carry forward. The recorded pristine clone
  starts/ends clean at the frozen head, exits0 after the complete gate, and
  scrubs `RUST_LOG`; no portability finding warrants another cold run. Citations:
  worker `cold/report.json`, SHA256
  `d338595e16870b8821da10e31ab57265603380f5e235e5176de660dcd507165f`,
  and verifier `worker-audit.json`, SHA256
  `7f0d6c6ceefee3210ae343491805b9798b6caa19aa1dff41bb1383e43f891055`.
- **P2 original ordered lifetime boundary — HELD.** Independently reconstructed
  original create/unref calls. Old compositor/glmark2 controls stop at original
  event454/event463 with16 retained resources before allocating; selected
  compositor passes56 calls at peak24, and both kmscube streams pass all8 at
  peak4. Selected glmark2 passes old event463 and explicitly refuses the original
  format17/resource32/event3025 at25 live resources before allocating. It does
  not skip that refusal. Only the exact bootstrap create resource2/event10/
  target2/format2/flags1/iovCount0 is excluded. Citations: original compositor
  `events.jsonl:454` (digest `5aedec4ee9c7c803648e16399f0846a88b1a1223b4eb93bec88726bc25b36b72`),
  glmark2 `events.jsonl:463,3025` (digest
  `ceaefc4b26e9d5811a89d4bb1f4fe24cd2ecb57def339e697e001cfbbd03921c`),
  and verifier `fresh/replay/report.json` at
  `#/browserResult/result/runs/1/operations/24`,
  `#/browserResult/result/runs/2/operations/33` and
  `#/browserResult/result/runs/3/operations/24` (SHA256
  `989b442a0cbde2a7b262f3834f72ce2ac3bd8d1485162dd07463aaa64793822c`).
- **P3 independent original byte/count oracle — HELD.** Each of156 selected/old
  operations agrees with original-input counters: buffers charge their width,
  staging bind524288 charges zero GPU bytes, and admitted original images charge
  width×height×4. The model never uses returned byte lengths as its oracle.
  Native allocation call counts, complete cleanup, six completed fences and zero
  browser/GL errors agree. Citation: the same fresh replay body, each operation's
  `before`, `after` and `allocationCallsBefore/After`, plus the independently
  authenticated native M4 Metal screenshot.
- **P4 selected/default/limit and host rollback paths — HELD.** All33 recorded
  cases pass: selected64 with only count tightening; exact0/1/16/63/64 ceilings;
  invalid65/negative/fractional/nonfinite/sparse/accessor/unknown limits;
  zero accessor calls; preserved non-count, dimension and byte limits; bounded
  contexts/backing/tickets/leases; and actual host allocation failure with the
  inspected state unchanged. Citation: verifier `fresh/limits/report.json`,
  `#/browserResult/result/runs` (SHA256
  `065b6ee12c002f48d67e735a9c2972eb8907a72e3ce2c7a168db5e61b2ab14c3`).
- **P5 all historical factories — HELD.** All15 current public factories match
  full results from the authentic predecessor module, retain16 and refuse the
  seventeenth create/override without leaking selected fields. Citation:
  verifier `fresh/historical/report.json`, each run's `current` versus
  `predecessor` (SHA256
  `4422ccc03fc98bce56c0d313560e99c9426bb8674e7507c4898a8e6a81f4ed9d`);
  every predecessor source copy was authenticated against the verified Git head.
- **P6 independently seeded hidden holds / reuse / disposal — HELD.** Fresh
  seeds `0x73a9e20d`, `0xb48f1637`, `0x0c62d5ab` physically upload/read64 distinct
  GPU buffers after completed fences; the independent byte and seeded shuffle
  models agree. All64 unrefs retain the full count; releasing the first lease
  leaves its asynchronous read holding the allocation; final read release admits
  exactly one distinct-generation replacement. Stale tokens fail, remaining
  GPU bytes do not alias, and outstanding-read disposal/cancel zeros every
  budget. Citations: verifier `fresh/lifetime-0x73a9e20d/report.json` at
  `#/browserResult/result/runs/0/{planes,hidden,readRetained,reused,remaining,final}`
  (SHA256 `a6e21559747fbd95b724fbceac91c8b1caef392fae553af66766e73346572511`),
  with both other exact report digests in `records.json` and `worker-audit.json`.
- **P7 bounded novel attack — HELD.** An old retained ID71 generation2 and a
  new public ID71 generation5 coexist as distinct actual native buffers, with
  both resources and asynchronous staging bytes charged. A one-shot actual host
  allocation failure installs no identity and changes no visible budget; retry
  succeeds. Foreign-store, forged, released and stale tokens cannot reach the
  replacement. Final read release frees only the old native buffer; an independent
  GPU-byte refusal at one resource and exact single-slot replacement follow.
  Outstanding-read disposal leaves zero budgets and a single-use tombstone.
  Citation: verifier `fresh/novel/report.json`, `#/browserResult/steps/5,6,7–18,19–23`
  and `#/browserResult/nativePlanes` (SHA256
  `5ecf017cbd67f48f35c370ab39a2f0d67e655167ea0481bd8d6d3ae00a45e5a3`).
- **P8 actual sabotage controls — HELD.** After valid completed64-buffer
  baselines, count sabotage physically allocates65 and fails the count oracle;
  native byte sabotage changes only resource1032/offset17 by XOR128 after a
  distinct completed fence and fails the independent original-input byte oracle.
  Citations: verifier `fresh/fault-count/report.json`,
  `#/browserResult/partial/runs/1/overflow` (SHA256
  `c058a877d4cb047f0f588866c29a1acc948e3f73a2bd64f856181c7606ddf5b0`),
  and `fresh/fault-bytes/report.json`,
  `#/browserResult/partial/runs/0/{fences,corruptPlanes}` (SHA256
  `87d453f89d3a6884c41307623d614e7d9c548030c7352c4e4d08d6da70c729af`).
- **P9 runtime coverage / inherited endpoint — HELD.** Independent finest-range
  V8 accounting proves every operand at resources.mjs lines22,68–71,413–414,417,
  434 executes; lines20–21,412,415–416 are exact comment/whitespace/delimiter
  waivers. Runtime SHA256 is
  `23dcd1d6260e4d439d851432e21c56edd0194bff1cf086ddb5f2da0a616db4f0`.
  Worker hot/cold and fresh inherited decoder/transfers pass; both original-input
  sabotage controls fail at their precise texture/index byte oracle. The repaired
  endpoint serves the authentic predecessor `unorm-depth-images.mjs` body.
  Citations: verifier `worker-audit.json#/coverage` and
  `inherited-resources/receipt.json` (SHA256
  `c8769e0503fee43b06916c736b971ec8f74104a0cbc57363ad837f0d9984c243`),
  `inherited-resources/hardware/report.json#/servedFiles` (SHA256
  `a911f247647f0ebd6a1b40de189cfbc14b69c4ee009f287acdd115abd7d81163`).

Commands: syntax/diff/policy checks in verifier `checks.log`; individual
`node tools/verify-virgl-resource-capacity.mjs --output … --mode …` replay,
limits, historical, three explicit fresh lifetime seeds and both fault modes
(expected exit1); `node tools/virgl-resource-capacity/critic-native.mjs --output
target/evidence/virgl-resource-capacity-critic/fresh/novel`;
`VIRGL_RESOURCE_EVIDENCE_DIR=target/evidence/virgl-resource-capacity-critic/inherited-resources make verify-E6-T12b`;
`python3 tools/virgl-resource-capacity/critic.py --output
target/evidence/virgl-resource-capacity-critic/worker-audit.json --fresh
target/evidence/virgl-resource-capacity-critic/fresh`; and
`python3 tools/virgl-resource-capacity/critic-seal.py
target/evidence/virgl-resource-capacity-critic evidence/virgl-resource-capacity/verifier`.

SUITE: promote the independent sealed-body/original-input/V8 auditor and the
24-step retained-generation/native-byte/foreign-token attack through
`make verify-E6-T11d50-critic`. The verifier seal reopens365 logical bodies,
including full fresh original inputs, native bytes, source closure, screenshots
and coverage; complete predecessor archives remain published pinned dependencies
without recursive copying. Fresh native oracles compare81,792 bytes.
Verifier manifest SHA256 `7eb6715ab4f8345cf6093d1c7ed35e43aa5b8838d36d1d0ef63410338e353745`,
index `21dc44b2dd2401e5a056c1ff152fa474e1529cd62199e40596c8c6864e7e6a86`,
archive (1,595,381 bytes)
`4f038098d37c82b90234fcf03807b2e05632492a368a33647f014579dd0177cc`.
No refutations, proof gaps or uncovered runtime operands remain. This verdict
grants the isolated count/lifetime boundary only; the parent GLES/format17,
guest/transport/worker/scanout/demo/deployment and throughput claims remain open.
