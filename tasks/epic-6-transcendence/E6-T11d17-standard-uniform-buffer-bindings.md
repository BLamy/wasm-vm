---
id: E6-T11d17
epic: 6
title: Bind original retained constant buffers to native uniform ranges
priority: 525.02703900036
status: verified
depends_on: [E6-T11d16]
estimate: S
risk: high
capstone: false
---

## Boundary

One original packet-to-native-range boundary using the independently verified D16 compiler. Add explicitly host-selected resource, decoder and async renderer facets; preserve the admission and public shapes of existing factories. Original buffer target0/format64 accepts constant binding64 and vertex/constant80, and original vertex16 may serve uniform data. Creation binding is a hint within the WebGL other-data class. Element-array/data aliasing is an ordered successor; no forbidden cross-class copyBufferSubData.

Original SET_UNIFORM_BUFFER27 is exactly five dwords: stage,index,offset,length,resource. Nonzero VS/FS bindings cover slots0..12, with nonempty ranges inside original allocation. Original resource0 unbind ignores incoming offset/length and canonicalizes both tozero. Empty inactive-stage/slot resets remain allowed within original15-slot reset limits. SET_CONSTANT_BUFFER12 inline/unbind clears the resource binding at that stage/slot; active inline words remain VS/FS slot0. Preserve all original words and byte offsets.

Each subcontext owns independent retained leases for both stages13 banks. Public unref, detach and numeric ID reuse preserve the exact original native allocation; only explicit rebinding adopts a replacement. Bounded host-only range snapshots retain allocation/context/lease/revision/range while index and constant-attribute reads suspend. Reject released leases, destroyed/reused contexts and successful/failed uploads before native draws. Backing-only changes cannot affect GPU words. Submitted snapshots become bounded allocation holds until final draw fences/error drains/cancellation/disposal; later ordered uploads are legal. Share the existing ticket budget, deduplicate submitted allocation holds and unwind every partial capture/preparation failure exactlyonce. No CPU uniform mirror, shader execution or numerical certificates.

Derive bufferZeroMask only from original bound state and declared stage-zero banks. Compose all four input-format masks and full sources/interface/subcontext identities in translation/program/draw-plan keys. Use both C-emitted stage bodies and validate canonical metadata after slot-zero promotion. System VirglBlock656 stays separately owned at binding0; guest banks get unique bindings1..26. Require actual limits for14VS/13FS/27combined blocks/bindings,16KiB blocks and query native offset alignment. Reflect complete native block/member type/count/stride/offset/size/stage references and reject unaccounted native blocks/uniforms. Missing referenced banks and short/unaligned/outside ranges fail before draw. Native-eliminated declarations need no backing. Retained but unreferenced native blocks may share bounded renderer-owned zero storage when the guest has no binding, justified by actual native draw behavior and never by source rewriting. Restore original ranges after host dirt, transfers, context switches and cache eviction.

## Deterministic acceptance

`make verify-E6-T11d17`

Record original resource metadata/transfers/op27/inline12 and actual native draw packets through fixed-memory C/Wasm output. Compare full original uploaded and read GPU words, native indexed UBO ranges, complete member/block reflection and independently predicted full pixels. Exercise both stages slots0/1/12, first/last vectors, dynamic compensated signed16 offsets, all26 guest banks plus system simultaneously using13 shared stage resources, all four integer/packed format masks and both slot-zero variants. Test unused native-retained banks with and without guest binding, native-eliminated declarations where available, inline/resource transitions on identical shader bodies and repeated cold/warm/evicted cache/context restoration.

Include exact/one-short ranges and alignment, original resource0 canonical unbind, malformed stages/slots/lengths/handles/roles, limits, strict descriptor/proxy/reentrant mutation, repeated varied delayed reads and partial read failures. Prove original storage survives unref/detach/ID reuse and explicit rebind selects replacement. Revisions including failed uploads, context destruction/reuse, released leases, cancellation, error/fence failures, resource/renderer disposal and every new cleanup branch are recorded with zero final budgets. Independent block-word/range/source-variant faults must complete actual draws/fences before original pixel assertions fail.

Run affected resource and standard renderer gates once at frozen head; carry unchanged compiler/native/ASan/Wasm proofs by source/dependency/evidence digest rather than rerunning unrelated gates. Record full served/source/generated/Wasm/V8 custody, one final exact-head scrubbed pristine clone, seal the worker evidence and submit to a fresh adversarial verifier. This prerequisite is not yet reachable through the demo and supplies no production caps, actual guest execution or live deployment authority.

## Adversarial verification

Before inspecting evidence, predict concrete original resource generations/words, range offsets/lengths, member layout/stage flags, variants, held allocations and complete pixels. Authenticate source/generated/served/Wasm identities and cold clone. Attack all retained lifecycle transitions and partial failures under independent schedules, verify changed-code coverage, invent one bounded native GPU attack and sabotage its original pixel oracle after a completed fence. Carry unchanged HELD criteria by dependency/evidence digest. Promote only after correctness and coverage hold.

## Verification log

### 2026-10-10 — worker — ordered planning

The user's instruction is to finish production guest graphics. D16's verified compiler prerequisite supplies no original resource binding. Literal original opcode27 still rejects in the historical standard decoder, and original target0/format64/bind64 rejects resource admission; reproduce the packet and metadata in `evidence/virgl-production-readiness/standard-uniform-buffer-gap.json` against those existing factories. Pinned Mesa26.2.2 `virgl_context.c:638-667` sends opcode27 for any GPU buffer includingCB0; `virgl_encode.c:1242-1256` defines its five words. Pinned vrend `vrend_renderer.c:3508` retains the original resource reference and ignores incoming range on resource0. Mesa `bufferobj.c:159-186` treats creation role as a hint. WebGL2 prohibits copying across element-array/other-data classes (https://registry.khronos.org/webgl/specs/latest/2.0/); aliasing remains a separate successor.

A planning-only headed M4 Metal probe in `/tmp/wasmvm-unused-ubo-probe.mjs` shows an unused retained std140 block with both reference flagsfalse still makes an unbacked native draw return1282 after a signaled fence. This motivates recording a bounded zero-buffer policy for native-retained unreferenced declarations in this boundary. The confirming acceptance must capture full original C output/native reflection/pixels; the planning probe is not submission evidence. API/caps, original element-array/data reuse, actual RISC-V guest Mesa/kmscube/desktop, worker scanout and live demo remain ordered qualification work.


### 2026-10-10 — worker — activation

Selected as the first eligible Next up entry after D16 fresh verification. Native stack layer `codex/virgl-standard-uniform-buffer-bindings` is rooted on the published compiler verdict. The original range boundary above is the only active task. Temporary iteration has already produced full original pixels on headed M4 Metal for buffered VS/FS → buffered VS with inline FS → both stages inline on identical original bodies; those scratch records are not submission evidence.

### 2026-10-10 — worker — implemented; original retained ranges

Runtime commit `e771e262a37f9ee387f434fc752bd777187edcd8`; frozen submission head
`47eb713cb5a456c8723cc32463fb04a4afea9905`. The only later frozen changes repair
the evidence coverage reader/receipt; decoder, resource and renderer bytes are
identical. Recorded command:
`VIRGL_UNIFORM_BINDINGS_EVIDENCE_DIR=target/evidence/virgl-standard-uniform-bindings-final make verify-E6-T11d17`.
All runtime, actual fixed16MiB C/Wasm hardware, original pixel and affected old
resource/standard renderer gates passed. The final coverage parser encountered
an old resource coverage schema; commit47eb713c repairs that evidence-only reader
and authenticates its explicit two-file incremental boundary. Missing proof was
recorded with `python3 tools/virgl-command/standard-uniform-binding-coverage.py`
and `standard-uniform-binding-receipt.py` against that same final directory;
the original log preserves the parser failure. No runtime checks were restarted
for that harness-only repair.

The headed M4 Max Metal recording contains152 full16×16 frames,154 native draws,
436 native guest-block bindings,38912 independently checked pixels and67 literal
wire records. It exercises both stages slots0/1/12 at first/last vectors and
all signed16 relative offset endpoints, all26 shared-bank bindings plus system,
all four input-format masks including native and generic packed attributes,
all four stage-zero variants, cold/warm/evicted programs, context/subcontext
restoration,18 varied suspended-read lifetime actions, partial range/read budgets,
native allocation/write/fence/read failures, submitted allocation holds and
explicit resource-generation replacement. Every run records zero final resource,
renderer and uniform range budgets. All three independent faults (original GPU
word, native range offset, FS slot-zero compiler selection) complete actual
native draws/fences before original pixel assertions fail.

Two final unexecuted added-line samples were exercised in a focused recording:
`node target/evidence/virgl-standard-uniform-bindings-final/supplement/record-supplement.mjs --output target/evidence/virgl-standard-uniform-bindings-final/supplement`.
This recording changes only the served test harness; full generated/served
harness, its body and hashes are sealed beside the immutable runtime closure.
It proves shared zero-buffer allocation evicts a prior native system block at
exact17040-byte budget, and actual fenced scanout/PBO reads share a two-ticket
ceiling with pending original uniform ranges. Its independent literal packet,
full native word/reflection/pixel audit adds3 frames/768 pixels. The sealed
`original-oracle.mjs` extends only test-only handling of original shader-handle0
unbind, and `independent-audit.mjs` records that extension explicitly. The combined
complete V8 regions cover every added runtime line sample; full regions remain
critic authority. Native-eliminated bank behavior remains conditional on actual
native reflection; this Metal driver retained the unused declarations in these
recordings, so no cross-host elimination claim is made.

Pristine scrubbed proof:
`python3 tools/virgl-command/standard-uniform-binding-cold.py --output target/evidence/virgl-standard-uniform-bindings-cold-final`.
It runs `make verify-E6-T11d17` on final exact head47eb713c in a clean clone,
passes the full affected gates and independent audits, and leaves the clone
pristine. Unchanged D16 C/native/ASan/Wasm semantics are carried by complete
source/dependency hashes and the existing worker-offset-repair archive
`e481c471060723b3e183781836fa413eb76722ad53f8e97e2146308ad6046943`
and fresh critic archive
`66de35c269e44252dc302ddc152e93d0aa1cd02fe9d1cd9171247d91b0daf09e`.

Seal: `evidence/virgl-standard-uniform-bindings/worker/`;
6286 records,32965817 bytes; archive SHA-256
`73a5bdfa08e5b7568b96017d471ac40cfbb8f5d087d52c1b2842cf6c2235d9d5`;
index `93f1e05363dd0daced80f4a3229c4bc346410e38da3749288f03f4b20df3f7c4`;
hot receipt `9c9ec43a23d94a605ff50d3e985781f50701eb3aefbea6ed8c94e22132b773ff`;
cold report `d94cd5a48d2164cae9c9b76612cbce75f3711c3f3638bd5762c731aa55a5e0e1`;
cold receipt `76d4b28c99c1f432801f8043f0a97fdc1996a838c98053753a832a0a49d95226`.
Claim: the explicitly selected original packet/resource facet executes retained
native uniform ranges while preserving raw guest words, selected C stage bodies,
allocation identity, delayed-draw validation and bounded fence cleanup. This is
an isolated prerequisite; production guest Mesa, complete API/caps, scanout worker
integration, live deployment and a performance claim remain unqualified.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

Review boundary: independently verified base `3ec060c46a9743a62306ae409d0bf1a548d4a616`
through worker submission `16316900`. Runtime commit remains
`e771e262a37f9ee387f434fc752bd777187edcd8`; frozen evidence/parser head remains
`47eb713cb5a456c8723cc32463fb04a4afea9905`. The evidence-only parser repair is
exactly the two named coverage/receipt files. No implementation code was edited
in this fresh verifier session. Later changes are promoted test/oracle/verify
artifacts and this verdict/queue metadata only.

- P1 original packet/admission isolation — HELD. Predicted opcode27's five words,
  VS/FS slots0..12, original15-slot inactive resets and canonical resource0
  offset/length0 before inspecting evidence. All67 literal records and resource
  role/strict descriptor/proxy cases agree. Citation: worker archive
  `hot/wire/report.json` (SHA-256
  `eb2617f5cdbf709b0738767a1bac617223781cc2641950bc46af2e757cfe66ee`),
  `/wire/records`; no old factory admission/public-shape expansion.
- P2/P3 original GPU words, native ranges/reflection and full pixels — HELD.
  Independent Python code replays literal original packets/TGSI, never compiler
  output as its oracle. All152 hot and152 cold frames match their complete original
  uploads, actual indexed UBO ranges, complete member/block/stage references,
  attached native C stage bodies and full16×16 pixels. Example: hot frame0
  `original-vertex-0-0` predicts `[139,119,11,170]`; actual VS binding1 and FS
  binding14 use original generation5, byte start32, length8192. Guest members are
  type36296/count512/offset0/stride16. Separately owned binding0 has exactly656
  bytes, float1 at640 and zeros elsewhere. Citation: worker
  `hot/hardware/report.json` (SHA-256
  `a607b0de42b2546c0bc072c74175dad50a648ad8f54d1dbae9bb0289e5b8719f`),
  `/browserResult/result/frames/0`; pixel blob-0006 digest
  `0f7de51a4d39865b24393aee36d58119fcf571515584743832cb073dd5fdb8ac`.
  Both original stage sources and both C/Wasm outputs are compared in full.
- P4/P5 lifecycle, delayed reads, bounded cleanup and allocation holds — HELD.
  All18 original suspended-read actions, partial capture/read budgets, failed
  uploads, context/lease/resource/renderer invalidations, native allocation/write/
  read/fence failures and zero final budgets agree with prior predictions. Three
  new full matrices use independent seeds2718281829/362436069/521288629 and varied
  delays/step schedules. The bounded novel attack uses distinct VS/FS ranges in
  one allocation while original indexed/generic reads suspend: original generation7
  survives backing dirt, detach, unref/ID reuse and a replacement upload; VS
  start32 and FS start112, both length64, retain one submitted allocation hold.
  Explicit rebinding alone adopts the replacement, which remains held after both
  original resource0 unbinds through its final fence. Two schedules3141592653/
  733973753 pass. Citation: critic `novel-3141592653/report.json`,
  `/browserResult/result/frames/0/native/0/blocks` and `/ownership`;
  report digest `2a75564c8686b091cba424373f34e734cbbdc35ceaa72160d0114e71f2289872`.
- P6 slot-zero variants, all four format masks and native restoration — HELD.
  Original bound/declaration state predicts all four stage-zero masks; both
  complete C stage bodies match the actual native program. Original integer/
  packed masks compose with them. Cold/warm/evicted caches, dirty native bindings,
  transfers and context/subcontext switches preserve original ranges and pixels.
  Citations: worker hot/cold `hardware/report.json` frame labels `all26-banks-*`,
  `four-formats-*`, `variant-*` and `restore-*`; complete independent comparisons
  are in critic `recording-audit.json` and `independent-run-audit.json`.
- P7 original faults and new oracle sabotage — HELD. All three worker faults
  complete actual draws/fences before independent full-pixel assertions fail.
  The novel native-range fault changes FS start112 to128 while retaining the same
  original generation7 and length64; its actual draw/fence completes, then all1024
  original pixel bytes contradict `[117,218,164,184]`. Citation: critic
  `novel-sabotage/report.json`, `/partial/frames/0`, digest
  `b2f3bac2743387d9b92c2c9d81a03dc2eb774c0c7079dda1fcc87278ce559412`;
  captured pixel digest
  `48ac711953b217953bb63b4ab52f713d50477e6196c01fab9d5b80abfa5547da`.
  The promoted test repeats two positive schedules and this fenced sabotage.
- P8 custody, cold clone and unchanged D16 carry — HELD. Authenticated every
  byte/member of the6286-record worker archive and its index, all410 hot/cold
  source closures, full served/generated/Wasm/V8 identities and the scrubbed
  pristine exact-head47eb713c clone. Both generated compiler hashes agree:
  Wasm `fc479ec92133f8b75d26043d20fca97d00b1a1556481abf5c5daf23b66e00fca`.
  The original clone report remains digest
  `d94cd5a48d2164cae9c9b76612cbce75f3711c3f3638bd5762c731aa55a5e0e1`.
  Also authenticated every12192 worker/104 critic member of unchanged D16
  archives `e481c471060723b3e183781836fa413eb76722ad53f8e97e2146308ad6046943`
  and `66de35c269e44252dc302ddc152e93d0aa1cd02fe9d1cd9171247d91b0daf09e`.
  Complete source/dependency bytes match the verified predecessor, so its C/native/
  ASan/Wasm HELD proofs are carried without unrelated gate reruns. Citation:
  critic `authentication.json`; immutable runtime hashes in critic manifest.
- P9 complete changed-region coverage — HELD with scoped waivers. Audited all282
  added runtime lines against complete nested V8 regions, including expression
  fragments missed by line-start sampling. Every new admitted runtime behavior
  executed. Nineteen fragments are explicitly waived in `coverage-waivers.json`:
  exact unchanged old-factory/profile/blend expressions; defensive selector-zero
  configuration defaults (the owned selector record is always complete); and the
  metadata-only null index for native-eliminated declarations. Metal retained
  every declaration here, so the task's conditional eliminated-bank case gives
  no cross-host elimination claim. No stated behavior has a missing executable
  proof and no runtime deletion/repair is demanded. Full counter provenance and
  each fragment's bounds/reason are in `coverage-regions.json`.
- P10 supplemental shared-zero/ticket paths — HELD. Authenticated the complete
  generated/served test body and immutable runtime bytes. The17040-byte exact
  uniform budget evicts a prior system block to admit shared zero backing; real
  fenced scanout/PBO reads and uniform snapshots share the two-ticket ceiling.
  All three supplemental frames match original packets, raw native storage,
  reflection and768 independent pixels. The sealed original oracle differs only
  by literal shader-handle0 unbind handling; the independent auditor differs only
  in imports/directory/run selection. Citation: worker `hot/supplement/report.json`
  digest `49c5dc462c524a29011edc8029b2a8802b02712ad7e06388e31e8f23a52c3024`,
  `/browserResult/result/ownership`; exact full-byte custody proof is critic
  `supplement-custody.json`.
- SUITE: promoted the distinct-stage-range/generation/hold regression, its
  independent literal-packet/TGSI/native-storage/reflection/full-pixel oracle and
  `make verify-E6-T11d17-adversarial`. The promoted target passed two physical
  Metal schedules and caught the completed-fence range sabotage. Tools and
  tests only; no native renderer, resource, decoder, compiler or production edit.

Commands: `python3 evidence/virgl-standard-uniform-bindings/verifier/authenticate.py`;
`audit_records.py` on the sealed hot/cold/fault/supplement bytes and every independent
matrix/novel run; `audit_coverage.py` plus `classify_coverage.py`; exact supplemental
body/recorder/oracle checks with `audit_supplement.py`;
`VIRGL_UNIFORM_BINDINGS_ADVERSARIAL_DIR=evidence/virgl-standard-uniform-bindings/verifier/promoted make verify-E6-T11d17-adversarial`;
strengthened original-source identity assertions replayed against all existing
recordings after that oracle-only addition; syntax checks and `git diff --check`.
Worker frozen affected gates and exact-head pristine clone are authenticated and
carried once; no runtime change required restarting them.

Critic seal: `evidence/virgl-standard-uniform-bindings/verifier/`;
4657 records, 35580659 bytes;
archive SHA-256 `df3c55558fec56f14b838cc9c8f477fa4806a47657909c81696bcd595438542d`;
index `17f9f5b0729256dc06f71075e9b13c4cb725550d9fdabfe4354a387856cd787e`.
Pre-evidence prediction digest
`b24622a4c5da255cb327d10dbace235995be6d6dd6d7bbae62bfcea9eb513d6d`.
Worker seal remains archive
`73a5bdfa08e5b7568b96017d471ac40cfbb8f5d087d52c1b2842cf6c2235d9d5`,
index `93f1e05363dd0daced80f4a3229c4bc346410e38da3749288f03f4b20df3f7c4`.
The isolated retained-range claim is verified. Actual guest Mesa execution,
production API/caps/worker scanout, live deployment and performance remain
unqualified; this verdict supplies no positive negotiation or production authority.
