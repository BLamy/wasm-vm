---
id: E6-T11d61
epic: 6
title: Compile original cube and array comparison texture shaders
priority: 525.027039000398
status: verified
depends_on: [E6-T11d60, E6-T11d57, E6-T11d49]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected C/Wasm compiler facet for original FLOAT SHADOWCUBE
and SHADOW2D_ARRAY declarations and instructions. Both vertex and fragment
stages admit TEX, TXD and TXQ with dimension-correct native comparison samplers.
Fragment cube bias uses original TXB2: src0.w remains the comparison reference,
and src1.x is a separate bias. Original input text/tokens, stage/slot identity,
source words/modifiers, result masks, qualifiers and query/comparison metadata
retain their independent custody. One slot must have consistent declaration and
instruction dimensions and compatible ordinary/comparison use.

Cube/array TXL/TXL2 have no core ESSL3.00 comparison overload and remain refused.
Refuse ordinary TXB for these shadows, array bias, vertex bias, dimensional
projection/fetch, shadow volumes, cube arrays, multisamples and offsets. Size
queries remain neutral between ordinary and comparison use, with native ivec2
cube and ivec3 array results. All seven qualified compiler factories/entry points
retain false selection and complete prior response bytes.

Add one distinct JS factory and stage/pair C exports. This compiler contract
carries no resource, sampler-state/consumer, decoder, framebuffer, submission,
capset or production Linux renderer authority. Dimensional depth storage and
ordinary views remain separately qualified by D59/D60. Guest offload and MIPS
are unproven until their actual integration acceptance.

## Deterministic acceptance

`make verify-E6-T11d61`

Optimized native C, ASan/UBSan C and the actual fixed-memory Wasm module must
agree on complete stage/pair responses. Independently parse original TGSI
tokens and predict sampler dimensions/types, query levels and comparison masks.
Exercise both stages, both dimensions, slots0/7/15, plain and explicit-shadow
views, legal operations, source modifiers, write masks, qualifiers, query/use
order, unrelated samplers and host input/output selections. Preserve complete
historical responses against the authenticated D57 compiler for all seven
prior facets, including new-dimension refusals and ordinary/shadow2D behavior.

Use actual headed M4 Max Metal WebGL2 for compile/link/reflection and complete
fenced RGBA32UI output planes from literal depth cube and array textures.
Distinguish every face/layer/mip, nonzero last layers, rounded/clamped array
indices, original fourth-lane reference, cube projected xyz gradients, ignored
array derivative z, fragment implicit derivatives and separate cube TXB2 bias.
Run three deterministic independent seeds/schedules. A physical reference-lane
or native-layer fault must fail the unchanged independent oracle after native
GPU completion. Preserve whole original inputs and raw outputs.

Refuse target/return/declaration conflicts, one-slot mixed dimensions or
ordinary/comparison samples, unsupported signatures, malformed/oversized text,
request/reflection traps, incompatible host masks and null/stage ABI inputs
without partial success. Exercise genuine allocation failures and exact
recovery, own source text before allocation, independently owned module memories,
fixed16MiB heap and262144-byte optimized stack. Audit finest changed LLVM/V8
regions; every changed hunk executes, is unchanged HELD or is statically waived.

Run one final scrubbed pristine clone at the frozen source head and seal/reopen
all complete recordings and source/module pins. Carry unchanged Rust/consumer
gates within their proven boundary. Surface truthful partial progress in the
built and live demo, preserving127/0 and zero browser errors. A fresh critic
must interrogate the diff and evidence before setting verified.

## Adversarial verification

P1: Predict original tokens, native sampler names, stages/slots and independent
query/comparison masks before reading results. All seven historical entry points
must refuse new shadows and preserve complete responses.
P2: Predict whole native output planes from literal face/layer/mip depth fields;
attack reference versus bias custody, cube projected gradients, array ignored
derivative z and layer neighbors, query dimensions and levels.
P3: Predict bounded complete refusals for unsupported signatures, target/type
contradictions, ordinary/comparison conflicts, malformed requests and host masks.
No implicit fallback or partial success may inherit consumer authority.
P4: Predict genuine allocation failure and exact subsequent recovery, immutable
owned input during caller mutation, fixed heap/stack and module isolation.
P5: Authenticate all complete evidence bodies, final clean-clone provenance and
finest changed regions; carry exact unchanged HELD boundaries. Invent one bounded
semantic attack and sabotage-check a physical GPU input against the same oracle.
P6: Built/live127/0 and actual partial roadmap state remain truthful, with default
production capability negotiation disabled and no complete guest-rendering claim.

## Verification log

### 2026-10-12 — worker — verified-head readiness; planned compiler boundary

D60 is independently verified at04ab18042036bf0ab19864bbe38e787dd4aadf48.
At that exact tracked-clean head, the actual unchanged D57 Wasm compiler refuses
16 original cube/array comparison TEX/TXQ programs across both stages and both
plain/explicit-shadow declarations. Six ordinary cube/array and shadow2D positive
controls pass with predicted native sampler names. Complete inputs, responses,
source bodies, generated module and runner remain in
`/tmp/wasmvm-dimensional-shadow-gap-04ab1804`.
Exact command:
`node /tmp/wasmvm-dimensional-shadow-readiness.mjs 04ab18042036bf0ab19864bbe38e787dd4aadf48 /tmp/wasmvm-dimensional-shadow-gap-04ab1804`.

Pinned primary authority is Mesa26.2.2 TGSI plus virglrenderer1.3.0 and Khronos
ESSL3.00 revision6. Both new comparison coordinates are vec4; cube gradients are
xyz and array gradients xy. Cube TXB2 carries a separate bias. New explicit-LOD
comparison overloads are absent. Consumer acceptance and production integration
remain later independently proven boundaries. Readiness and D60 publication are sealed in
`evidence/virgl-production-readiness/dimensional-shadow-compiler-gap/`:38
complete reopened bodies; manifestSHA256`b4e2f002125e4420a3d1497069d35b9ce0d46238bb90e0cfca4f2c2601ff9adb`,
indexSHA256`0147aa5ae15604247a240a4b155a5349ce093f055984a7aff97b886fad58d03e`,
archiveSHA256`c4ba827ff1c855cc1ab2e9f44a04224048b9a298bbb0afdc946ef05a57448c13`. PR538 appends to stack500 above
PR537. Both native stack identities and all138 earlier PR identities, order,
heads, bases and open/draft/unmerged state are unchanged. The app attachment
attempt reached its100-entry limit; existing attachments are preserved. Owned
clone cleanup authenticated every31,219 existing recorded body against retained
custody before removing the disposable checkout; all raw and sealed recordings
remain available.

### 2026-10-12 — worker — implemented; final compiler recording

Frozen runtime commit `b555747b0b51786e087a43e27b5021e4e7a1838c`;
final harness/source head `7e51570851ef46eb10e8054f3a49b3bea8b79141`.
The later commit changes only the cold-checkout definition and failure custody;
compiler semantics are identical. Acceptance command:
`python3 tools/virgl-dimensional-shadow-shaders/cold.py /tmp/wasmvm-dimensional-shadow-cold-7e515708`,
which executes `make verify-E6-T11d61` in the recorded detached, scrubbed clone.
The complete 41 commands, stdout/stderr, original tokens, LLVM/V8 regions,
original GPU inputs/outputs, screenshots, source closure and generated binaries
are in `/tmp/wasmvm-dimensional-shadow-cold-7e515708/recording`.
Both before/after tracked status are clean. Receipt SHA256
`d6ece2048e9883a812ab09d646e8fa1ab6331446a5758d5ef373eda57e1bb87f`.
The declared sparse checkout includes every source directory and the required
kernel/initramfs/boot-snapshot build inputs; only unrelated prior evidence and
other release images are omitted. This is a compiler/default-demo claim, with
no Linux-boot or deployment-portability claim.

All 20,927 original cases agree byte for byte between optimized native C,
ASan/UBSan C and the actual fixed-memory Wasm module: 14,009 admitted and 6,918
refused. All 15,612 historical calls retain complete response bytes against the
authenticated D57 module carried at verified D60. Independent literal TGSI
parsing checks 13,735 original texture instructions, declaration return types,
stages, slots, sources/modifiers, masks, dimensions and query/comparison
metadata. The new selected factory preserves original SHADOWCUBE/SHADOW2D_ARRAY
and separate cube TXB2 reference/bias custody; unsupported overloads remain
bounded complete refusals. All seven old factories retain false selection.

Actual headed Apple M4 Max Metal WebGL2 compiles/links/reflects 78 programs and
refuses 498 signatures. Three schedules/seeds (27461,82013,164021) each produce
182 complete fenced RGBA32UI planes from literal depth fields, including every
face/layer/mip, layer neighbors, projected cube gradients, ignored array z,
queries, modifiers and independent cube bias. The physical wrong-layer control
fails the unchanged oracle after actual native completion and still cleans up.
The independent physical audit reopens all raw blobs and checks actual source
uploads, native control values, full output words and fence ordering. No console,
page, request or GL errors occur. Genuine allocator injection exercises 181
failures and 181 exact recoveries, including caller-text mutation before semantic
allocation. Fixed heap is 16,777,216 bytes; selected stage/pair frame sums are
139,680/195,424 bytes within the 262,144-byte optimized stack. Finest changed
runtime coverage has 35 positive V8 partitions and 182 positive LLVM partitions,
no zero regions, plus ten static declaration/signature waivers. Rust and
consumer code are unchanged from verified D60 and retain their proven boundary.

The initial pristine run at b555 passed compiler, sanitizer, Wasm and all three
GPU schedules, then failed at demo build because the worker's sparse checkout
omitted `releases/kernel/6.6.63/Image`. It remains failed in full at
`/tmp/wasmvm-dimensional-shadow-cold-b555747b`, including generated compiler and
frozen source custody. Adding the required demo inputs repairs this environment
finding; the final fresh clone passes. No runtime code was repaired or silently
replaced. Ephemeral harness-construction/audit failures are retained under
`/tmp/wasmvm-d61-*`; they are not final acceptance evidence.

Worker seal: `evidence/virgl-dimensional-shadow-shaders/worker/` — all 44,485
logical members reopened, 992 complete unique bodies and 43,493 backward links,
with gzip EOF checked. Manifest SHA256
`862ccad57dcd39ef940c2ba495c4a638e3e30f82fd4b34546240937b7ce550f1`;
index `7211cf03b9264aa5215d8d90474fececa5d748bd35a43a0bed2fb1a1d89aac01`;
archive `d0a39567532a609f313ef2d2a39bea3473d05e7d4d1a43bf5a29edf03221d337`.
The archive includes the complete failed run separately from the successful
final authority, rather than substituting a successful caption for it.

Built and canonical live demo both pass 127/0 with zero browser errors, keep
Guest GPU offload partial, and expose no proof-only Rust exports. Default Wasm
remains `d45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36`.
Cloudflare publication uses the complete frozen 304-file staging tree; only
roadmap.js/sw.js change from the qualified D60 deployment. Actual command is
`npx --yes wrangler@4.149.0 pages deploy /tmp/wasmvm-dimensional-shadow-pages-7e515708/web/dist --project-name wasm-vm --branch main --commit-hash 7e51570851ef46eb10e8054f3a49b3bea8b79141 --commit-dirty=true`.
The staging's retained boot-manifest transformations account for dirty metadata;
its full source archive and unchanged boot inputs are recorded. Deployment
`7112b2df-1f4f-4f2a-a039-b429e39f5835` / <https://7112b2df.wasm-vm.pages.dev>
is confirmed by the actual Wrangler list, publication receipt and canonical
<https://wasm-vm.pages.dev> response bodies. Live command:
`node /tmp/wasmvm-d61-live-7e515708.mjs --output /tmp/wasmvm-dimensional-shadow-live-7e515708 --task E6-T11d61`.

Deployment seal: `evidence/virgl-dimensional-shadow-shaders/deployment/` — 511
complete members reopened through gzip EOF, including all 194 served bodies.
Manifest SHA256 `02252e62162ee1eefcc5a56cf854123e4a5c99b37aa62a63899682676c5362b6`;
index `460526f4a3b2713c2f605c85eefdab8c9022da016396255bf7d181f43cdc8252`;
archive `13141c907e5b6d55f80ba0059b2e4cc6cc6dc6307dd27f925ddfabe77192ea21`.
This recording demonstrates only the selected comparison compiler contract and
truthful partial demo progress. It does not qualify a command consumer, resources,
production negotiation, actual Linux rendering or MIPS. Fresh verification is
required before this task can become verified.


### 2026-10-12 — verifier — VERDICT: verified

VERDICT: verified

Fresh critic submission: `3b2ba9f24bae5932d0677caab99f3084ca2d2857`.
Compiler runtime remains `b555747b0b51786e087a43e27b5021e4e7a1838c`;
recorded final source/harness is `7e51570851ef46eb10e8054f3a49b3bea8b79141`.
Predictions were written before opening the evidence. Critic files below are
relative to the reopened verifier archive, with the full raw directory preserved
at `/tmp/wasmvm-dimensional-shadow-verifier-3b2ba9f2`.

- P1 original tokens and historical boundaries — HELD. Independent bitfield
  decoding of the raw TGSI words agrees with literal original text and the
  upstream parser for all 13,735 texture instructions, declarations, immediate
  words, stages, slots, masks and source modifiers. All 20,927 complete
  optimized-native/sanitized/Wasm responses agree. Original fragment cube
  TXB2 at native JSONL line 20,662 retains IN[1].w reference, separate IN[2]
  bias and SAMP[7], target13, FLOAT return4 and fssamp7 samplerCubeShadow.
  Native array target12 and Cube/Array query dimensions and separate query
  masks agree independently. All 15,612 original historical calls were also
  reexecuted against the authenticated unchanged D57 module, preserving whole
  response bytes across all seven prior facets. `token-audit.json` and
  `fresh-compiler.json` pin the full source/module, raw token and response
  citations; no historical boundary is relabeled as newly qualified.
- P2 native dimensional output — HELD. A separate oracle imports no worker
  pixel helper: it decodes literal depth/attribute bytes, derives cube face UV
  and projected gradients, array rounded/clamped layers and ignored derivative
  z, native query levels, fourth-lane comparison, separate bias, masks and
  qualifiers, then compares every word of all 546 worker plus 182 fresh
  fenced RGBA32UI planes. Actual shaderSource, buffer/texture uploads, reflected
  native types, bound controls and fence/read order are checked against whole
  bodies. Fresh seed314159265 is independent of the three worker schedules.
  The physical layer0/4 swap fails the same unchanged oracle: fresh fault
  acceptance.frames[0], writer109, fence111/consumed115, read118; pixel(1,1).x
  is0x3f000000 instead of0xbf000000 after successful native completion.
  Full raw output SHA256 is
  `b7423768af01ad3faf4cc456581f5e0f7e9b490bd3b004b5b6f6dd72569f2809`;
  all native owners still retire. `gpu-audit.json` and `citations.json` preserve
  every frame, exact native event and output/body digest.
- P3 bounded refusal — HELD. Independently predicted signature table admits78
  and refuses498 of576 actual Metal cases. Every admitted original stage
  compiles, links, reflects the predicted comparison sampler and cleans up;
  every refused result is exactly ok/error with no GLSL or paired partial
  success. Dimensional contradictions, return types, mixed comparison use,
  unsupported dimensional overloads, malformed input, ABI null/stage inputs,
  masks and239 strict host/reflection rejections hold. Getters remain uncalled.
  `boundary-audit.json` cites complete compile-link acceptance.compiles[0..77],
  acceptance.refusals[0..497], original matrix and facade bodies.
- P4 failures and ownership — HELD. The pinned sanitized allocator binary was
  rerun independently: its complete85,198-byte stream equals the sealed worker
  stream, digest
  `b56ef495652139953fd83f0b1dc8b890e6387c296384d1c804c1eff92bde83b3`.
  All181 genuine fault sites reject and exactly recover. Caller-custody lines
  27/53/99/145/191 exercise mutation after own text copies; summary line192
  confirms181 recoveries and no partial result. Independent selected factories
  have distinct16MiB buffers and unchanged peers. Pressure/scratch refusals
  and recovery hold. Actual optimized stack records retain139,680/195,424-byte
  selected frame sums below262,144 within the unchanged D57 call boundary.
- P5 custody, coverage and novel attack — HELD. All44,485 worker and511
  deployment members authenticate complete bytes/lengths and backward targets
  through gzip EOF, and every authoritative raw custody body is rebound to its
  seal. The final preserved clone is clean at exact7e515708; all source and
  generated pins and41 actual command streams agree. Its declared checkout
  contains all source directories and required default-demo boot inputs, with
  no borrowed generated binaries. The earlier b555 demo-input failure remains
  separately failed and complete. Independent full nested coverage agrees with
  all35 worker V8 and182 LLVM positive partitions and further splits native
  macro endpoints into308 positive lexical partitions (26 non-whitespace JS
  partitions); no changed executable zero remains. The ten waivers are exact
  C ABI signatures and one profile bool declaration, individually classified.
  Every diff hunk is classified in `coverage-audit.json`. Rust, consumer, guest
  and production Wasm remain exact unchanged HELD boundaries at verified D60.
  A bounded novel combined slot7 cube TXB2 and slot15 array shadow-query/ordinary
  sample attack varies query order and separately swizzled/negated bias. Six
  admissions and24 complete conflicts/refusals agree between optimized native,
  sanitizer and Wasm. The permanent cross-slot contract test is promoted at
  `renderer/virgl-shader/tests/standard-dimensional-shadow-texture-cross-slot.mjs`;
  sabotaging the query-neutral array sampler type makes that unchanged test
  fail. Fresh physical GPU sabotage also fails. Initial critic parser,
  stage/pair-shape and coverage-endpoint construction mistakes are documented
  and retained; none changes runtime code or relabels a failed product run.
- P6 truthful default demo — HELD. The304 frozen staging bodies and194 original
  canonical served bodies authenticate; only roadmap.js/sw.js differ from the
  qualified D60 staging. Actual Wrangler publication/list confirms production
  deployment7112b2df-1f4f-4f2a-a039-b429e39f5835. Recorded built and live plus a
  fresh canonical browser load pass127/0, zero errors, live compliance pip and
  queried partial Guest GPU offload pip with D61 text. The existing compliance
  screenshot is deliberately a127/0 crop; pip state is separately queried in
  the real DOM. Default Wasm remains
  `d45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36`,
  with proof exports absent and production acceleration disabled.

SUITE: the novel cross-slot literal contract test is promoted. Its30 full
requests/results, optimized-native/sanitized agreement, positive test recording
and expected sabotage failure remain in the verifier seal. No implementation
code was edited. No comparison consumer/resources, capset, framebuffer,
production integration, Linux Mesa/Hyprland rendering, MIPS or complete guest
GPU qualification follows from this compiler verdict.

Verifier seal: `evidence/virgl-dimensional-shadow-shaders/verifier/` —7,531
complete logical members,348 stored bodies and7,183 authenticated backward links,
reopened once by the writer and independently again through gzip EOF.
Manifest SHA256
`77ef1511cf4ff3a2aceccbdb89c99bce55a6ae89ade0af6cbb9c2ceeb6ec024a`;
index `e58839a053fe147e81b1ded7efd30023f8dae1fd1bdd97e49ca85ca251df647e`;
archive `3fd875a25de06b25221241934b515993e0f54dfe839a8ec1c66dbad22e88f3d6`.
`verdict.json` pins every audit and citations index; predictions SHA256
`7af750e8b32990f7e6fc6a86e25703afc082942f7c09b4c47ccf10ed8d07073b`.
Exact fresh commands are retained in `commands.json`; the original41-command
frozen risk-tier submission is carried without pretending an unrelated rerun.
Policy runs before queue regeneration, then this verifier verdict is committed.
All raw recordings, failed controls and the preserved clone remain available.
