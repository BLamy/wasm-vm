---
id: E6-T11d32
epic: 6
title: Compile original integer samplers and format-selected fragment outputs
status: implemented
estimate: S
risk: high
priority: 525.027039000374
depends_on: [E6-T11d31]
capstone: false
---

## Boundary

One explicitly selected C/Wasm compiler facet. Admit original homogeneous FLOAT,
SINT and UINT 2D sampler-view return declarations, retain original raw sampled words,
and select native fragment output signedness from host color-format masks. Keep old
stage/pair ABI responses byte-identical against the authenticated original compiler.
Original texture operations/coordinates/queries, typed/packed vertex selectors,
dimensional/buffered-zero constants and all fixed memory/stack/text/token limits remain.
No resource/decoder/state/cache/executor/capset/guest/demo authority is added here.

New profile fields: selected integer-images flag, original sampler return types,
and disjoint bounded host color-output masks. Old facets initialize all new fields
zero. New native sampler declarations are highp isampler2D/usampler2D (FLOAT remains
sampler2D). Word-storage texture results use uvec4(ivec4) or original uvec4 without
any float conversion. Fragment signed outputs use ivec4(raw words), unsigned use
raw uvec4, FLOAT uses the existing uintBitsToFloat path. Host masks must correspond
to emitted COLOR semantic locations (including broadcast), never textual guest keys.
Preserve all original source modifiers, TXF integer coordinates/level, TXQ integer
coordinates/query metadata, numeric LOD/gradient/bias and stage restrictions. Audit
TGSI saturation with pinned source semantics and native proof before admitting typed
sample modifiers; do not convert integer samples to numeric floats by accident.
Broadcast must re-emit original raw source words separately per output type; a
cross-type assignment of fsout_c0 is not a bit-preserving representation.

## Deterministic acceptance

make verify-E6-T11d32

Native, ASan/UBSan and actual fixed-memory Wasm agree on complete responses and
original tokens. Record sampler declarations and texture instructions directly from
pinned original parser tokens (including four return-type fields), immediate words,
operand file/index/slot/swizzles/modifiers/masks. Strict own-request/configuration,
disjoint 4-bit output masks, vertex selectors, all active stage/slot extents,
unused declarations, caller mutation, source ownership, actual allocation failures,
independent memories and real fixed-heap exhaustion/recovery are exercised. Pin
predecessor compiler bytes by extracting authenticated D31 worker generated module.
Replay all affected historical stage/pair ABIs against that actual module and carry
unchanged renderer/storage evidence/seals by code/dependency/digest.

Compile actual C-emitted ESSL on headed Apple Metal WebGL2. Use independent original
8/16/32-bit R/RG/RGB/RGBA SINT/UINT source words (including signed minima and unsigned
values above 2^31), all legal stage/texture op combinations, nearest-compatible
samplers, full/truncated NPOT levels, checked fetches and queries, sparse/high slots,
masked raw lane preservation, word modifiers, and mixed typed outputs. Preserve full
input bytes/native image planes/reflection/output planes and physical fence identities.
Compare entire defined sampled/query/output planes with an independent original-word
oracle. FLOAT outputs keep existing native semantics; assert exact integer words only
where defined. Undefined query z, out-of-range fetch/LOD/derivatives/overflow supply no
fabricated numeric truth. Real wrong texture selection/type emission must finish a GPU
fence before unchanged original oracle failure; native type-link error is a separate
negative control, not a replacement for wrong-pixel detection.

Record full LLVM/V8 nested source/ranges and classify every changed governing region;
actual failure interposition covers each genuine allocation site and byte-exact recovery.
Measure optimized actual Wasm stack within unchanged262144 and fixed16MiB memory. Run
selected affected historical compiler gates once at frozen head, final exact-head hot
record and same-command pristine scrubbed cold once, seal/reopen every indexed member,
then submit to a fresh independent critic.

## Adversarial verification

Predict original sampler types/raw texture results, owned native declarations/metadata,
reflection types and whole integer output planes before evidence. Independently hash
entire sealed archive/source/generated/input closure, derive original raw words from
original bytes, and hold full nested C/V8 counters against changed hunks. Attack type
masks, malformed original declarations, boundaries, all real allocation failures and
caller lifetime/ownership; invent one bounded native integer/modifier/query attack and
sabotage with real wrong pixels after original physical completion. Carry unchanged
HELD storage/runtime/old ABI facts and final cold by authenticated exact boundaries.
Critic may promote tests/evidence/log/status only; it never fixes runtime.


## Primary source pins

Khronos GLSL ES3.00 revision6 (2016-01-29), sections4.1.3,5.4.1/5.4.2 and8.8,
https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf,
checked2026-10-10. Signed/unsigned integer constructors preserve bits, including
negative/high-bit values. Highp signed integers are32-bit two's complement. Both
facts must still be exercised through actual emitted native output words. Integer
sampler returns must retain their integer types until raw-word storage conversion.
Original TGSI source modifiers and saturation semantics remain from pinned Mesa
and the unchanged public parser/converter, not inferred from storage format names.


## Execution slices

The common standard_stage/standard_pair transaction can append explicit selected
integer-image and output-mask arguments; every historical C entry passes false/0.
Expose selected stage and pair exports plus a factory consistent with existing
standard texture/uniform methods. Typed stage requests use disjoint bounded host
color masks only for fragment stages; selected pair requests compose the five existing
vertex/buffer masks with those output masks. Unknown/getter/proxy fields refuse before
semantic allocation. Output masks refer to COLOR semantic locations, not OUT register
indices. Add no guest metadata selector and do not lift limits.

Store homogeneous SVIEW return types in bounded owned profile fields. Sampler native
type and texture-result conversion derive from those original declaration fields.
TEX/TXL/TXF/TXD/TXB use floatBitsToUint only for FLOAT returns; SINT/UINT returns enter
uvec4 word storage by bit-preserving integer construction. TXQ stays original raw
integer query output independent of sampler return type. Set pinned upstream fragment
cbuf signed/unsigned key masks from the same host masks. Output declarations and
metadata use the format-selected native types. Preserve exact old generated source
strings and entire ABI responses when all selected flags/masks are zero.

Broadcast COLOR0 must source the original raw output register separately for every
attachment type; direct assignment between float and integer fsout_c variables would
lose bits or fail native linkage. Native test integer FBOs use full-word readback and
original seeded arrays, not normalized images. Reconstruct signed/unsigned narrowing
independently. No numeric truth for undefined fetch/query lanes or NaN float arithmetic.

Original saturation is specified as a float destination clamp by the pinned TGSI docs
and converter (vrend_shader.c6148). Preserve that existing word-to-float clamp where
admitted; prove typed sampled-word modifier cases using finite normal float bit patterns
if testing SAT, and never invent integer numeric-clamp semantics. Ordinary integer
min/max opcodes already use raw signed/unsigned interpretation. Recheck these notes
against actual parser tokens and native behavior before implementation, not by assertion.

## Evidence boundary

This isolated compiler facet grants no original integer resource packet/consumer,
production capset, guest Mesa/compositor execution, worker scanout, demo deployment
or throughput result. No old compiler/runtime profile silently selects it.

## Implementation notes

The selected facet accepts one through four homogeneous original SVIEW return
fields and bounded SVIEW ranges. SAMP registers retain individual declarations:
the pinned converter exports only Range.Last into its sampler-used mask, so
admitting SAMP ranges would contradict original converter metadata. Six explicit
range refusals cover both stages and all three return types; full sixteen-slot
SVIEW range queries remain admitted with individual original SAMP declarations.

The recorded native matrix contains 2,586 cases, including 1,975 admitted cases
and 611 refusals. Full historical response comparison covers 957 cases against
the authenticated D31 generated module. The affected historical FLOAT facade
matrix retains its own original 932-case names and five selector fields.
Changed shared metadata paths include original system values, point size and
broadcast, in addition to selected integer outputs. Vertex TXB remains refused;
its unreachable vertex-emission alternative was removed without changing any
admitted historical source. Real native allocation interposition exercises 165
sites and byte-exact recoveries. These are worker submission boundaries, not an
independent verifier verdict.

## Verification log

### 2026-10-10 — worker — verified dependency and original refusal

D31 is independently verified at `d8d510a689cfb5440cc8b3b65fd94adb9baee109`,
with all verifier leases released and the verdict published to existing open PR509.
At that exact head, the actual generated old C/Wasm compiler rejects all22
original UINT/SINT 2D sampler texts covering both stages and their legal original
TEX/TXL/TXF/TXD/TXB/TXQ combinations. Complete original texts, results, source and
generated hashes are retained in
`evidence/virgl-production-readiness/standard-integer-image-shader-gap.json`.
The adjacent standalone script reproduces those original refusals before this
selected compiler is implemented. No native draw, guest or production authority
is derived from the negative. The human instruction continues this graphics
chain ahead of unrelated queue work and leaves all pull requests open.

### 2026-10-10 — worker — frozen original integer shader submission

Frozen runtime and full harness: `3c0a3e348048c0ff293a6b67638a96fb5c3561cb`.
The preceding `b9f3f1a87e07fea807d177bf9b2d5a6b65eb12b4` hot/cold runs
passed, but pre-seal inspection found that the packer excluded its original
readiness fixtures. Only the receipt/packer changed to include those literal
fixtures and their source/toolchain/package dependencies. All C, Wasm-facade,
renderer/storage, native fixture and browser semantics remained unchanged.
The final submission repeats the prescribed command at the complete exact head.

Commands:
`EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc VIRGL_INTEGER_SHADER_EVIDENCE_DIR=target/evidence/virgl-integer-image-shader-complete-hot make verify-E6-T11d32`;
`python3 tools/virgl-integer-image-shader/cold.py --output target/evidence/virgl-integer-image-shader-complete-cold`;
`python3 tools/virgl-integer-image-shader/seal.py target/evidence/virgl-integer-image-shader-complete-hot target/evidence/virgl-integer-image-shader-complete-cold evidence/virgl-integer-image-shader/worker`.
Both final acceptance runs pass. The final pristine clone is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-integer-image-shader-cold-3c90nf1l/wasm-vm`;
its before/after tracked and untracked status is empty and compiler/runtime
environment overrides are scrubbed. Its receipt is at the same frozen head.

The native/sanitized/fixed16MiB-Wasm matrix agrees on all 2,586 complete
responses: 1,975 admitted and 611 refused, with original sampler declarations,
all four return fields and instruction/immediate/operand tokens retained. All
957 historical response bodies are byte-identical against authenticated D31
generated artifacts. The selected facade rejects malformed host selectors and
hostile own requests without invoking getters, owns caller snapshots, isolates
memories and recovers from actual fixed-heap input and upstream-scratch failures.
All 165 genuine allocation faults return no partial success and recover byte-for-byte.

The headed Apple Metal WebGL2 recording executes 542 original integer shader
draws, preserving 410,424 original bytes, 2,182 native source planes containing
262,304 whole words, and 141,312 output words. The independent original-byte
inverse finds zero normal mismatches. Wrong-level and wrong-word physical
controls each consume their original GPU fence and then fail that unchanged
inverse. Native incorrect type emission is separately refused by actual ESSL
compilation. The historical FLOAT facade's 932-case matrix and 246 actual
hardware draws pass; its three physical controls remain refuted. All browser
console/page/request error lists are empty. Full changed nested coverage has
145 positive V8 partitions and 367 positive C partitions, with no governing
zero partitions; complete LLVM/V8 records and 20 declaration/signature waivers
remain available for the critic. Conservative actual optimized Wasm stage/pair
stack sums are 139,568/195,280 bytes, below unchanged 262,144.

Worker seal: `evidence/virgl-integer-image-shader/worker/manifest.json`,
`records.json` and `recording.tar.gz`. All 22,894 indexed members were reopened
and independently size/hash checked. Archive SHA256:
`6489b7d7b97effba826b3f8555efc192b9dcfae59ca8a232142cea6355f68be0`;
index SHA256:
`7d670a9b824d7fc96f02c307b5e98d505658af4876430e80e77ac61b41e3f8dd`.
The complete recording demonstrates only the selected original integer sampler
and format-selected output compiler boundary. Unchanged D31 runtime/storage
and both predecessor seals are carried by exact code/dependency/digest. It
demonstrates no integer command consumer, production capset, guest graphics,
deployed demo or MIPS result. Fresh adversarial verification remains required.
