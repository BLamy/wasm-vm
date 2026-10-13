---
id: E6-T11d61
epic: 6
title: Compile original cube and array comparison texture shaders
priority: 525.027039000398
status: implemented
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
