---
id: E6-T11d45
epic: 6
title: Preserve original primitive order for asymmetric S8 draws
status: implemented
estimate: S
risk: high
priority: 525.027039000383
depends_on: [E6-T11d44]
capstone: false
---

## Boundary

One opt-in native execution boundary for original active-S8 draws with unequal effective front/back references, comparison masks or write masks. D44 admits the original packets but deliberately refuses this actual WebGL restriction before compilation/private copies/draw. A new selected execution factory lowers the original ordered primitive stream into bounded private u32 POINTS/LINES/TRIANGLES. Preserve original vertex IDs, winding, last provoking identity, custom/fixed restart boundaries and incomplete tails. For each triangle in original order, execute the front and back culled passes with the selected original face state installed on both native faces; preserve original no-cull/BACK-cull selection. Original points/lines and BACK-culling triangles use effective front stencil state on both native faces while retaining the original native draw, instance IDs and divisor fetch. Only no-cull triangles require per-primitive two-face calls. Never gather all front primitives before all back primitives.

Require the already-qualified native LAST provoking convention for this lowering. Preserve the existing common-field, front-only, disabled and absent-S8 paths, and every predecessor execution factory. Native one-face draws retain all qualified original instance counts. Original instance fields0/1 mean one instance; active asymmetric no-cull triangle draws with effective instances>1 fail before compilation/private copies/draw until a separate compiler/instancing boundary verifies original INSTANCEID and divisor fetch for split calls. No shader rewrite, CPU vertex/fragment execution, new storage allocator, additional cull state, compiler change, production caps, guest execution or performance authority.

## Acceptance

`make verify-E6-T11d45` must independently reparse literal original wire, DSA/ref/raster fields, original TGSI and uploaded vertex/index bytes. Original overlapping alternating front/back primitives must physically distinguish preserved order from whole-front/whole-back grouping. Derive output solely from original fields and independently predicted native coverage. Cover all7 core primitive modes, original one-face native instancing/divisors/generics, array start, nonmonotonic u8/u16/u32 indices and byte offsets, disabled/custom/fixed/out-of-type restart, empty/partial/repeated/all-restart segments, strip parity, loop closure and fan center. Flat/smooth outputs and actual vertex-ID tags must hold. Test front-only unified and back-enabled literal semantics, all8 comparisons/ops, distinct effective references/value/write masks, depth fail/pass, scissor, both supported culling modes and both winding conventions, original20/126 formats and private mips. Original native depth, S8, public backing and all padding remain exact under the held conversion rules.

Use the existing owned normalized-index buffers: no more than12 times the original source-word ceiling in bytes, no more than64 buffers, bounded CPU scratch, <=6 times original source words in native vertex work and <=2 times original source words in native draw calls. Charge every original source word including restart markers and incomplete tails. Prove maximum and tightened budgets, short original source/fetch bounds, missing native provoking support, unsupported instance fields and real native allocation/upload/draw failure suffixes. Own before upload, detach before yield, restore literal guest stencil/cull state after lowering, retain native storage until consumed final completion/drain or explicit disposal. Three varied deterministic schedules prove context poisoning, public-name/generation reuse, captured sources/private mip writes, cancellation and both disposal orders. Record actual native arguments/state/private GPU index bytes, complete output/storage, original compiler/program/shader bodies and all writers/fences.

Carry complete D44 worker/critic seals and unchanged storage/compiler authority only at exact authenticated identities; exercise directly affected retained common stencil and primitive-list paths. Record finest nested V8 coverage for every new execution partition, only exact unchanged predecessor operands may be waived. Use relevant source/compiler/native/browser gates, one final frozen hot acceptance and one pristine exact-head cold clone with scrubbed environment. Reopen every sealed body. A fresh critic must perform three new schedules, one bounded original ordered-primitive attack and a real served order/state corruption completing native draw and consumed fence before detection. Production still depends on full API, guest Mesa/compositor, worker/scanout/demo/deploy and independent throughput measurement.

## Adversarial verification

Predict exact original primitive lists, strip winding, LAST vertex and ordered S8 transitions before evidence. Attack overlapping alternating faces that have noncommuting operations and unequal masks/refs; compare to the wrong whole-face grouping. Check point/line front-state semantics, absent-S8/disabled/common fast paths, all-restart/partial/degenerate segments and original culling. Attack stale stencil/cull/EBO/provoking state, original source/generation changes after capture, quota boundaries and allocation/upload/native-draw error suffixes. Require distinct consumed completion for actual order-corruption detection; metadata or patched expected values do not qualify. Full custody, finest coverage, final cold isolation and fresh verifier prediction log remain required. Do not expand this slice into compiler instancing or production deployment.

## Verification log

### 2026-10-11 — worker — verified dependency and original native asymmetry gap

D44 independently verifies at `ff80836249c9f235cae516421498a574b51b6f9c`. Its fresh critic explicitly releases all Git/source and Node/compiler/browser/GPU leases; there are no remaining jobs or active tasks. Existing PR522 now contains the verified commit. The same native stacks499/500 and all122 earlier PR IDs/order/heads/bases are authenticated unchanged, open/draft/unmerged. This layer continues existing upper500.

At that exact verified head, the actual headed M4 Chrome predecessor command records18 original guard/native failures and the held inverse passes. Six original active-S8 unequal-reference/value-mask/write-mask draws across20/126 fail with unsupported-stencil at original DRAW byteOffset40/opcode8, before a native draw or blit in the refusal phase. Complete source/compiler/native/event bodies, browser identity and screenshot remain in the recording; no guest or production capability is asserted.

Exact original reproduction, before runtime changes:

```sh
node evidence/virgl-production-readiness/standard-ordered-stencil-gap.mjs
```

The recorder requires all510 complete predecessor source identities, runs the actual native failure actor and independently audits original wire/lifetimes. Original negative manifest `standard-ordered-stencil-gap.json` SHA256 `ab0246ef23fb77e353bbbe451c86372050a97e3fb748ce676a71c1f5a06cff4c`; full recording `ordered-stencil-gap/recording.tar.gz` is2,866,674 bytes / SHA256 `e37ee5c94be466e78b59271f0a2d9d1cf4afe52bf07b35e2d3b33143935be41b`; full index SHA256 `d62a3e86621ec234a2ca29bc5bd571a978e849af83813386d24a211ec8797a8c`. All938 complete logical members were reopened, with each length/digest checked. Recorded source and execution head are the same exact verifiedff head.

Original GLES3.0.6 PDF34/35/105 describes assembly order/strip parity/last provoking identity; PDF41/43/44/91 describes original instance order, vertex identity and divisor fetch. The pinned original renderer defines front-only and back-enabled stencil behavior at6673/6690. The next native plan retains the original one-face draw when points/lines or BACK culling select front state, preserving native instancing without changing the compiler. Only no-cull asymmetric triangles require ordered per-primitive face passes and their effective instance count remains0/1 until a later compiler/consumer boundary. This is a plan requiring actual native acceptance and a fresh verifier, not an implemented capability.

The user's production-graphics instruction continues this one S/high boundary ahead of unrelated queue work. Original complete production API/caps, guest Mesa/compositor, worker/scanout/demo/deployment and300 MIPS remain unproven. The selected factory is isolated from the demo.


The new exact-source recorder itself passes at the unchanged verifiedff head: all18 original failures retain52 consumed syncs, zero output frames and zero native draws; the six active-S8 guards have the exact original92-byte packets and no native draw/blit during their refusal phase. Syntax, independent inverse, task policy and diff checks pass. The task remains pending; this is the starting gap, not new acceptance.

### 2026-10-11 — worker — implementation and narrow native self-validation

The selected ordered-stencil factory lowers original no-cull triangles in
primitive order, with one front/back culled pair per original primitive and
original LAST identity. Original one-face draws retain native instancing;
asymmetric no-cull instances greater than one remain refused. Private normalized
indices use the held allocator and retirement, with explicit original source
charges and bounded native work. Literal stencil/cull state restores in finally.
No decoder, compiler, storage allocator, guest, caps, demo or deployment changes
are made in this isolated boundary.

Inner native recordings include168 array/index/mode/instancing cases,72 original
function/op paths,140 restart/tail/degenerate cases,22 guard/native suffix
failures,20 maximum/tightened budget cases, six absent-S8 native draws and16
lifecycle cases. Maximum one-face instancing physically reaches65536 instances
with exact final native INSTANCEID/divisor color. One fan owns786408 bytes;
64 fans own784896 bytes /64 buffers. The source-plus-generic read ceiling is
65552 bytes and minus-one refuses before normalization. Actual allocation,
upload and draw failures preserve a completed prefix and halt the suffix.

Independent full-body Node inverses and native lifetime audits pass for
`target/evidence/virgl-ordered-stencil-inner-final-arrays`,
`...-inner-final-segments`, `...-inner-limits-3`, `...-inner-boundaries-2`,
`...-inner-absent` and `...-inner-failures-prefix`. Each complete source/GPU/wire
body remains in its recording. Five actual native/served corruption controls
(order, operation, comparison mask, completed color and completed S8) contradict
original predicted pixels after distinct consumed completions. Wrong whole-face
grouping yieldsS8=125 where original primitive order requires119. These inner
runs are self-validation, not the frozen final submission.

The recorder now captures actual native vertex fetch state and complete GPU
vertex-buffer bytes, plus complete GPU normalized index bytes at retirement;
all CPU reads cite consumed fences after that buffer's writer. Its negative
active-attribute location guard avoids Chrome's builtin-ID enumeration poisoning
queries. Source/mip fixture dimensions are derived from the selected original
mip. Retained common stencil12 and original primitive-list loop/fan2 pass;
the old D10 server's closed list omits later imports, so the retained actor runs
through the complete D45 server closure.

Finest nested runtime coverage currently holds229 partitions and waives only17
exact unchanged predecessor profile/metadata operands, each pinned to fullff
source identity and original UTF16 range. No new runtime partition is waived.
Task policy, syntax and diff checks pass. Final frozen hot/cold recording, full
custody and a fresh adversarial verdict are still required before verification.


### 2026-10-11 — worker — frozen hot/cold submission

Runtime and harness freeze: `c510692cc77e0f0c99d1e2f28dff9de6de2f3372`.
Implementation is `7ae4f66c4c04e929c9a47d070e13dcbfa60d0a06`; c510 changes
only the coverage collector from glob to rglob so it includes the nested retained
primitive-assembly recording. The first 7ae recording passed all native groups
and controls but stopped at that collector gap. It is retained as a failed
submission, not substituted for the successful exact-c510 records.

Exact final commands, all exit0:

```sh
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc \
VIRGL_ORDERED_STENCIL_EVIDENCE_DIR=target/evidence/virgl-ordered-stencil-frozen-c510 \
make verify-E6-T11d45
python3 tools/virgl-ordered-stencil/cold.py --output target/evidence/virgl-ordered-stencil-cold-c510
python3 tools/virgl-ordered-stencil/seal.py target/evidence/virgl-ordered-stencil-frozen-c510 target/evidence/virgl-ordered-stencil-cold-c510 evidence/virgl-ordered-stencil/worker
```

The gate runs task policy, diff/syntax checks, actual unchanged pinned compiler
Wasm build, full predecessor custody, literal wire20, all six native groups,
three varied schedules, five actual corruption controls, retained common12 and
loop/fan2, finest nested V8 coverage and full-body receipt authentication. No Rust,
wasm VM, guest, demo or deployment source changed in this isolated selected factory;
those gates cannot confer guest or production authority on it.

Each hot/cold recording independently reopens476 cases /454 frames /552516
pixels,2930 native passes,7851176 normalized-index bytes and96650078 public
backing bytes. Its native audits record8110 consumed syncs and24 explicit-disposal
syncs. The original wire/GPU vertex and normalized-index bytes, compiled whole
programs, per-call state, all output/private mips and public padding agree with
the independent inverses. All original mode/index/restart/instancing paths,
allocation/work limits, refusal and real native error suffixes execute. Worker
schedule seeds are d9453211,13579bdf,9e3779b9. All five served/native/completed
corruptions physically contradict the original prediction after consumed
post-writer completions; whole-face grouping producesS8=125 instead of119.
Both coverage audits hold230 positive partitions, with only17 exact unchanged
predecessor operands waived and zero uncovered new partitions. Original D44
worker/critic48980 members and gap938 members are completely reopened; storage,
decoder and actual compiler identities stay held.

Cold clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-ordered-stencil-cold-qys8i72d/wasm-vm`
is exactc510, pristine before and after, with the specified build/runtime env
names scrubbed (the inherited RUST_LOG was removed). Its literal acceptance
command is `make verify-E6-T11d45`. Hot receipt SHA256
`1963002b56559bdf2c7efed661a1e54eb389d2a291eb8d0f63db63db935ceecf`;
cold receipt `e045b25dfd225076460d96f85c681d7963c3d2f99b25ba71aa240d22bb9df980`;
cold report `7a6e6cbd87183e8385f9fef867bf184756630752fb1961c511591e495e34331b`.

Committed worker archive `evidence/virgl-ordered-stencil/worker/recording.tar.gz`
is75846524 bytes / SHA256
`5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed`;
index `records.json` SHA256
`bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb`.
All83324 complete logical archive members are reopened with lengths/digests,
including earlier physical hardlink targets. The source closure is included.
Manifest SHA256 `6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c`.

Claim: the new opt-in factory executes the qualified original asymmetric active
S8 one-face draws and single-instance no-cull triangles in original primitive
order, with original native vertex identity, state, exact S8 and held depth/color
semantics. It preserves bounded ownership, original source work charges,
restoration, completed-prefix error behavior and final native retirement.
No-cull asymmetric effective instances>1 remain refused. A fresh verifier must
still attack this submission with three new schedules, one original ordered
primitive case and actual completed native/served corruption. Full production
API/caps, guest Mesa/compositor, worker/scanout/demo/deploy and300 MIPS remain
unproven. Native stacks499/500 and all123 prior PR identities/order/heads/bases
are rechecked unchanged, open/draft/unmerged; this branch continues upper500.
