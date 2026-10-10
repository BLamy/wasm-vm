---
id: E6-T11d17
epic: 6
title: Bind original retained constant buffers to native uniform ranges
priority: 525.02703900036
status: implemented
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
