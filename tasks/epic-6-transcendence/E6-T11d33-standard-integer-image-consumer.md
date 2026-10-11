---
id: E6-T11d33
epic: 6
title: Consume original signed and unsigned integer images in native draws
status: in-progress
estimate: S
risk: high
priority: 525.027039000375
depends_on: [E6-T11d32]
capstone: false
---

## Boundary

Complete one selected original integer image consumer boundary, composing
verified D31 storage and D32 compilation. Existing FLOAT-only normalizers and
the original view/surface decoder currently refuse this path. Add a selected
owned metadata/result/pair/interface contract for native
sampler2D/isampler2D/usampler2D and one COLOR0 whose vec4/ivec4/uvec4 type agrees
with explicit bounded host attachment masks. Retain original input register,
interpolation, system/raster value, uniform-block, typed vertex and query rules.
Keep every historical normalizer closed and byte-identical. Broadcast and multiple
color outputs remain outside this single-color consumer contract.

Expose a distinct profile constant and four entry points: metadata parsing,
single-result normalization, linked-pair normalization and interface derivation.
Single-stage host colors use own signedColorMask/unsignedColorMask fields;
pairs carry those plus the five established vertex/uniform selectors. COLOR0
masks are disjoint and bounded to bit0. A vertex stage's recorded color masks
must be zero. The compiler's semantic COLOR0 location may use a nonzero physical
OUT register. The original interpolation interface key remains unchanged;
attachment types are separate host authority for consumer cache keys.
Interface derivation retains the initial-stage smooth-to-flat promotion path.
A successful linked pair must contain the compiler's promoted vertex generic
types/interpolation matching each fragment generic input, in addition to the
established component-extent and interface-key checks.

Wire the contract into one selected async renderer/decoder profile for original
integer 2D views, single COLOR0 targets and raw integer clears. Native sampler
types must match retained storage signedness. Pair output masks come from the
actual retained target format and enter every material cache identity. Preserve
typed view swizzles, original texture operations, native iv/uiv clears, implicit
RGB alpha1 and existing job/generation/fence ownership. Keep unsupported integer
filter state explicit. All old factories, packets and FLOAT admission remain
unchanged. This selected consumer grants no production capset, guest, deployed
demo or performance authority.

## Deterministic acceptance

make verify-E6-T11d33

Replay actual frozen D32 native/Wasm compiler results through the selected
normalizers, deriving sampler/output types and COLOR locations independently
from original declarations and explicit host masks. Exercise all selected stage,
pair and interface entry points and retained vertex/uniform/query branches.
Original multi-color/broadcast and malformed contracts refuse. Existing
normalizers continue refusing the selected compiler profile; actual affected
historical accepted contracts remain byte-identical. Own getter-free snapshots,
caller mutation after capture, unknown or required-inherited fields, trapping
records, malformed errors,
partial results, array bounds/duplicates and selector/type disagreement refuse
without borrowed authority. Results remain recursively owned and frozen.

Execute original wire through the actual selected store, backend, decoder and
async renderer in headed hardware WebGL2. Cover all24 original integer sampling
formats and every qualified target format, both signedness classes, every legal
stage texture opcode, full/truncated NPOT mips, typed outputs/clears/swizzles and
RGB alpha1 after rendering. Independently reconstruct full defined native words
and original transfer bytes; never render expected output in JavaScript. Record
unique native sync objects, every poll, completion-before-read ordering and
handle retirement. Exercise same-shader target sign changes/cache hits,
mismatched views, stale generations, interleaved contexts/yields, retirement,
cancellation and complete drain. Actual native wrong-level, wrong-word and
completed-output sabotage must fail the unchanged oracle. Preserve affected
historical FLOAT consumer behavior.

Use the authenticated D32 generated module and its original inputs/native
response records, rather than a replacement translator or computed fixture
metadata. Exercise the new JavaScript contract in Node and a recorded headed
browser run with zero console/page/request errors and a screenshot. No demo
capability changes follow while this contract remains unreachable from the demo.

Carry verified D32 C/Wasm/native-GPU/stack/fixed-memory and D31 storage facts by
unchanged exact code/dependency/evidence digest. Capture every smallest governing
nested V8 interval over changed runtime bytes. Record the final exact head,
repeat the same command once in a pristine scrubbed clone, seal and reopen all
indexed source/input/record members, then obtain a fresh independent critic.

## Adversarial verification

Read the diff and predict exact normalized original sampler types, native color
types and owned fields before inspecting evidence. Reopen every indexed member,
derive original metadata independently, and audit the full nested changed-byte
coverage. Attack selectors, shader interfaces, unsigned/signed confusion,
caller-owned records, target/cache changes and malformed error paths. Run varied
deterministic schedules/seeds, invent one bounded novel native consumer attack
and sabotage a new assertion once. Carry only unchanged D32/D31
facts. The verifier promotes proof/tests/status and never fixes runtime.

## Verification log

The verified-head original refusal and dependency seals are required before
this pending task enters the active lane.

### 2026-10-10 — worker — verified dependency and original consumer refusal

D32 is independently verified at c64c3325c15d8978f455d57fc103559eec1b9d20
and published on existing open PR510, based on PR509. All verifier leases were
released before this plan. Reproduce at that exact source head:
`node evidence/virgl-production-readiness/standard-integer-image-consumer-gap.mjs`.
The script authenticates both complete D32 seals, reopens all 40,143 members,
and extracts the actual sealed generated compiler. All 22 original signed/unsigned
stage texts and two original pairs compile successfully, while the existing
metadata/result/pair/interface consumer refuses their selected profile. All 48
original format177..200 sampler-view and surface packets are refused. Complete
texts, results, wire bytes, source/generated hashes and dependency seals are in
the adjacent JSON. This negative demonstrates no native draw or guest execution.
The human instruction prioritizes completing production guest graphics ahead of
unrelated queue work, preserving the existing open PR chain.

### Primary sources

OpenGL ES3.0.6 (2019-11-01), sections3.8.13,4.1.7 and4.2.3:
https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf,
checked2026-10-10. Integer targets bypass blending, and integer clears require
the native signed/unsigned ClearBuffer entry point. Preserve original Gallium
full-clear scissor/write-mask behavior and RGB implicit alpha1 independently.
The selected consumer refuses non-nearest integer filtering explicitly; it does
not invent defined sampled values for an incomplete native integer texture.

### 2026-10-10 — worker — source freeze preparation

The selected implementation uses the authenticated D32 module without rebuilding
or changing compiler/storage/guest sources. Inner-loop runs exercised all586
original integer matrix cases; two additional physical OUT5 COLOR0 cases,
one selected FLOAT compatibility case and two native typed-vertex/constant0 cases
bring the frozen matrix to591 cases/1773 complete frames. The original contract
matrix replays all2586 responses in Node and the headed browser, with144 hostile
contract attacks and zero getter invocations. Every physical wrong-level,
wrong-word and completed-output control reaches genuine native completion and
fails the unchanged full-word inverse. The first boundary schedule passes24
complete frames; the submission repeats three distinct schedules. Affected
historical FLOAT draws pass their existing smoke command.

Full smallest governing V8 partitions are retained. Only exact pre-existing
older-facet/default operands and non-executable whitespace have explicit,
source-offset/digest-bound waiver entries in
`tools/virgl-integer-image-consumer/coverage-waivers.json`; all selected runtime
branches need positive evidence. Every waiver states its predecessor/static
reason and remains open to independent refutation. The final recorded command,
pristine clone, seals and exact source head will be added after recording.
