---
id: E6-T11d4
epic: 6
title: Compile bounded ordinary guest shaders with standard WebGL2 semantics
priority: 525.027037
status: in-progress
depends_on: [E6-T11d3]
estimate: S
risk: high
capstone: false
---

## Boundary

Add a separate host-selected standard shader compiler facet around the pinned
VirGL TGSI-to-ESSL translator and parser. Bound the complete grammar before the
general upstream parser, check its independently derived interface metadata,
then emit standard ESSL with typed word storage. Integer/untyped temporaries,
MOV/UCMP and flat interfaces must retain 32-bit words without float storage
canonicalizing NaN encodings. Actual floating operations use native highp math;
scalar TGSI results replicate the first swizzled lane. Keep metadata owned.
It is compilation admission, not an exact numerical certificate. Preserve the
existing ordinary/raw/private entry points and their exact admission/results;
no guest packet or supplied fact may choose or weaken that old proof facet.

The new facet admits ordinary uniform-fed floating operations, boolean/integer
lowerings and structured flow within its closed supported token set. It covers
the pinned complete original sources, scalar/vector masks and modifiers,
bounded constant/register/IO/sampler declarations and independent interstage
matching. Compilation resources and stack/heap/output stay fixed and checked.
Unknown stages/opcodes/properties/files, memory operations and excessive text,
indices, depth or resource extent fail without partial GLSL/metadata. Native
and Wasm results are deterministic and recover after malformed/allocation cases.
The new facet states its standard precision and undefined-domain rules plainly;
it grants no bit-exact/private/precondition authority and no positive capsets.

Production state integration and actual texture/storage/draw semantics remain
ordered successors. This isolated compiler does not claim a guest boot, full
API support, bounded GPU execution time or graphics throughput.

## Deterministic acceptance

`make verify-E6-T11d4` authenticates pinned source/image/ABI context and executes
the new guarded public C and actual fixed-memory Wasm entry points. Record
native and ASan/UBSan bounds/malformed/allocation/recovery tests with independent
seeds, exact native/Wasm outputs, complete original captured sources, each
accepted token/property/declaration family and both sides of every declared
limit. Cross-check emitted metadata against separately decoded pinned TGSI
records rather than trusting the bridge output as its own expected value.

Compile the complete captured programs on the headed hardware WebGL2 context;
link actual fragment-derived smooth/flat interfaces and physically draw a
bounded independently specified set, including ordinary dynamic SIN/EX2/LG2/
POW, nonuniform scalar replication, every admitted arithmetic/comparison word
family, literal NaN-mask custody, flat raw-word transport, default constant
banks, nontrivial masks/swizzles, branches and partial IO.
Record actual uploaded bytes, emitted sources, reflection, full pixel bytes and
independent mathematical pixel expectations with specified precision budgets.
Exercise original full compositor programs through this general facet without
private exact tuples/source pins/geometry specialization granting admission.

A real emitter/native-operation mutation must fail the independent physical
oracle. Preserve exact legacy/raw/private acceptance/results at representative
anchors and affected existing compiler gates. At the frozen source run the
submission gate once, one final pristine exact-head clone, seal source/input/
output/coverage/browser evidence, and submit to a fresh adversarial verifier.
No production demo imports or capabilities change in this isolated slice.

## Adversarial verification

Predict specific admitted dynamic operations and actual GPU values before
inspection. Attack oversized/wrapped/ranged/multidimensional/indirect register
fields, stage or IO mismatch, semantic collisions, unknown and partial token
consumption, immediate literal limits, depth/labels/flow balance, allocation
failure and stale response/input ownership. Cover every changed runtime hunk
with deterministic evidence or a narrowly justified waiver. Probe a separately
chosen well-defined dynamic shader and sabotage the promoted oracle once.
Check that no new facet result is confused with an old exact or conditional
contract; existing private rejection/results must carry unchanged.

## Verification log

### 2026-10-09 — worker — structural and physical self-validation

The unmodified upstream float-temporary translation compiled every complete
original but contradicted the independent 92cb corner-opacity oracle: at
pixel (358,228) bank 0 expected alpha 0.00010340225773969997 and observed
0.000000201957575995948. A separate 4×4 literal-mask probe confirmed
that MOV of `0xffffffff` through a float temporary followed by NOT/UCMP chose
the wrong branch (0.125 instead of 0.875, GL error 0 on M4 Max Metal).
The new facet therefore owns a typed word emitter after the pinned guarded
parser/interface transaction; it preserves raw integer custody and TGSI scalar
replication. The old C runtime body and exact APIs are unchanged.

Ephemeral self-validation at `target/evidence/virgl-standard-shader-draft/`
passes 634 native/Wasm structural/limit cases, independent TGSI metadata,
125 headed hardware draws and 2,390,624 independently recomputed pixel values,
including all three complete 92cb banks and six c580 corner/discard draws.
An actual SIN-to-COS emitted-operation mutation fails the physical oracle.
These are development checks, not a frozen submission or verifier verdict.

The first frozen recording at `bbfdfb36` passes the complete standard path and
offline pixel audit. An ancillary ancient E6-T10a browser fixture then fails
because it still expects text/GLSL/temp limits 16384/65536/117. The verified
predecessor `97ed2ca3` already publishes 49152/262144/511 (and vertex slot127);
the entire pre-existing C runtime body is byte-identical. This is a stale harness
assertion, not a new runtime contradiction. The affected ordinary gate uses the
current recorded original corpus instead: 19 unchanged bodies, 57 programs,
1,536 independently checked vertex words and 155,648 physical pixels pass.
No old runtime code or expected shader value is changed to clear the fixture.

The second frozen recording at `d03edbd2` again passes the complete standard
submission and current original corpus, then encounters the same obsolete limit
assertion in the ancient raw-bit full-suite wrapper. The final retained raw path
executes the unchanged authored MOV/AND/OR/NOT/SHL/USHR shader bodies and the
unchanged independent BigInt reference on actual GPU banks spanning shift counts
0, 1, 7, 15, 23, 31 and 32. It replaces only that ancillary obsolete wrapper;
no numerical oracle, old shader source, profile or runtime body changes.

The source-frozen `ea1c446d` hot submission passes all compiler, metadata, native/
Wasm, 125-frame pixel, mutation and retained entry-point checks. Its first
pristine clone exposes a harness portability defect: macOS's `/var` temporary
alias and canonical `/private/var` module root produce an outside-repository
relative input path. Canonicalizing both input and root paths fixes that bounded
recording wrapper. Runtime and expected values remain unchanged; the final
exact-head cold-clone proof is rerun because this was a portability failure.
