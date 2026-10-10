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

The `383f6fac` cold run also passes the full standard path and retained ordinary/
raw probes. The ancillary retained raster generator then exposes a second
portability dependency: its fixed predecessor directory needs both freshly
generated geometry bytes and the JSON instruction/event provenance. The recipe
now stages those same newly recorded artifacts at that fixed path and seals
their hashes. It never copies old ignored evidence into a cold checkout.

### 2026-10-09 — worker — implemented; frozen compiler submission

Compiler/source head: `571c22593967e1cdae801d0c54ab0833d94b2c43`.
Commands: `VIRGL_STANDARD_SHADER_EVIDENCE_DIR=target/evidence/virgl-standard-shader-final-complete make verify-E6-T11d4`;
`python3 tools/virgl-standard-shader/cold.py --output target/evidence/virgl-standard-shader-final-complete-cold`;
`python3 tools/virgl-standard-shader/seal.py target/evidence/virgl-standard-shader-final-complete target/evidence/virgl-standard-shader-final-complete-cold evidence/virgl-standard-shader`.
The pristine exact-head clone is clean before and after acceptance, with inherited
RUST/CARGO/compiler/browser overrides scrubbed. Both commands exit zero.

The compiler recording demonstrates 634 independent native/sanitized/Wasm
cases, separately parsed pinned TGSI metadata, actual allocation-site failures
and exact recovery, fixed 16 MiB Wasm memory, 238 hardware compiles/programs,
125 real GPU frames and 2,390,624 independently recomputed RGBA pixels. It
executes all three full original 92cb banks and six c580 color/discard frames
through the standard facet. An actual emitted SIN-to-COS mutation fails by
0.398157 at the first pixel. Direct retained proofs pass 19 ordinary original
bodies/57 programs, 42 original raw-bit frames, and both private original-pair
paths. The pre-existing C body is byte-identical to verified `97ed2ca3`; its
unchanged HELD semantic evidence carries forward. No guest boot, positive
capset, complete API, GPU-time bound or graphics throughput is claimed.

Evidence: `evidence/virgl-standard-shader/{manifest.json,records.json,recording.tar.gz}`
seals 409 records, 15,363,226 compressed bytes. Archive SHA256
`ee57339a1ce43d5f600a4d0d2c0e4bc47b361a189b78e1807cc31061225067b8`;
index `a9a18780e726e13e0f6c883ce447e1c415314ff9d4b2604daa6273b5528bff2b`.
Hot receipt `f2f3adf4665cda7f3a89b97fe79463df1f4fd325f5b0730098f30cf90b086497`;
cold receipt `0f3dd8c91f66f8de021753922be3e65837345d7810be122e9cae670ae64a37ca`.

The seal tool alone was corrected afterward at `505a9e59`: receipt generation
hashes the log before printing its one confirmation line. Sealing authenticates
that exact recorded prefix and exact final line and binds all finalized bytes;
prefix edits, footer edits and appended text reject. It refuses any post-freeze
change outside that sealing file. The seal separately records the actual helper
head and SHA256 `7651a22aaa59bf8b50824420f018f96c32926f29be590c2bc9dbb7974c527a21`
and includes its bytes. No compiler, acceptance or cold-clone behavior changed;
the final exact-head cold proof at `571c2259` is retained incrementally.
A fresh adversarial session must judge correctness and every changed hunk.


### 2026-10-09 — fresh adversarial verifier — VERDICT: refuted

VERDICT: refuted

- **P2/P3 supported declaration order — FAILED.** Before execution, independent
  case 528 predicted admission and a 512-vector constant bank for the exact
  source below. Optimized native, ASan/UBSan and the actual public fixed-memory
  Wasm facet instead return only `ok:false` and `translation-error` with
  `Standard conversion failed or metadata/output bounds disagree.` Rechecked
  the single input independently on all three paths. At `bridge.c:2283`, an
  unmodified-source `-g -O0` ASan/UBSan debugger build observes
  `profile.constants=512`, `info.num_consts=513`: direct expressions in
  `evidence/virgl-standard-shader/verifier/finding/lldb-debug.log:21` and `:23`
  (SHA256 `36ce777862c86b6e606d101d88ecd2d75fe8bc664575ecd7fa04df24ade8cac2`). The maximum extent is retained by
  `standard_guard.c:144`; pinned `vendor/src/vrend/vrend_shader.c:1958–1966`
  sets 512 for Last511, then increments for Last0; the new strict metadata
  comparison at `bridge.c:2284` rejects the admitted source. The positive
  prediction, case bytes and optimized result at `promoted-final/native/native.jsonl:529`
  are sealed below. Repair the standard-only upstream metadata transaction,
  retain strict extent checking and all old entry-point bodies, and record this
  declaration-order regression on native/sanitized/Wasm plus final exact-head
  cold acceptance. This is an admitted-grammar completeness failure.

```tgsi
FRAG
DCL CONST[511]
DCL CONST[0]
DCL OUT[0], COLOR
0: MOV OUT[0], CONST[511]
1: END
```

- **P1 evidence custody — HELD.** Independently authenticated all 409 worker
  records, both source lists and generated binaries, exact frozen compiler
  `571c2259`, clean actual cold clone before/after, and all final log bytes.
  Audited the post-freeze `seal.py` diff, its separately recorded helper head
  `505a9e59` and SHA256 `7651a22aaa59bf8b50824420f018f96c32926f29be590c2bc9dbb7974c527a21`;
  independently sabotaged hot/cold prefix, confirmation and appended bytes
  (six mutations), all rejected. Worker archive/index remain
  `ee57339a1ce43d5f600a4d0d2c0e4bc47b361a189b78e1807cc31061225067b8` /
  `a9a18780e726e13e0f6c883ce447e1c415314ff9d4b2604daa6273b5528bff2b`.
- **P2/P3 other exercised grammar and metadata — HELD.** Worker 634 cases
  match native/sanitized/actual Wasm and separately decoded pinned TGSI.
  Fresh seeds `608135816`, `2242054355`, `320440878` add 483 predicted cases
  (66 admitted) covering wrapped/ranged/multidimensional/indirect fields,
  collisions, stages, labels/depth/flow, partial tokens and literal limits;
  native/sanitized/Wasm and independent metadata agree. These successful
  cases do not waive the positive declaration-order failure.
- **P4 ownership/allocation — HELD.** Worker 41 actual allocation-site faults
  recover, and caller text mutation preserves original paired results.
  Fresh fixed-16MiB Wasm pressure lets input allocation succeed, then exercises
  C arena failure after releasing 2048 bytes and checked upstream parser failure
  after releasing 65536 bytes; single/pair return no partial output and fully
  recover after freeing allocations. Owned-field, getter/proxy, stale-result
  and wrapper-exhaustion attacks also hold (`wasm-pressure.json`,
  `independent/node.json` in the critic archive).
- **P5/P6/P7 physical semantics — HELD.** Recomputed both sealed hot/cold
  recordings offline: 125 frames / 2,390,624 pixels, all three complete 92cb
  banks and six c580 frames. Predicted dynamic SIN, first-swizzled EX2
  replication, literal NaN-mask custody and raw flat words before inspection;
  all satisfy the independent budgets/word assertions. A separate bounded
  uniform-fed shader combines ARL-selected constants, scalar EX2/LG2/SIN/COS,
  nonuniform swizzles, masked aliases, unsigned source negation/comparison and
  flow on defined finite inputs. Three fresh hardware frames / 768 pixels
  have maximum errors `7.256596390448067e-8`, `4.334021097562868e-8`,
  `2.165692496447491e-7` (`fresh-physical-audit.json`). Browser console/page/
  request error counts are zero.
- **P8 isolation / prior architectural boundary — HELD.** The complete legacy
  C body hash `60b2defc35edff77c760bf641cddb8c4719b58e5727e9e883e3bc07b94183e9e`
  and 250 pre-existing compiler files are unchanged. Retained ordinary
  19 bodies/57 programs, raw 42 frames, and private original-pair anchors
  preserve their profiles/results. Carry prior verified architectural evidence
  forward only for that unchanged boundary. The standard authority remains
  distinct; no production capability or throughput claim is inferred.
- **P9/P11 novel attack and sabotage — HELD.** Actual emitted SIN-to-COS
  mutation fails the independent fresh physical oracle at pixel (0,0):
  expected lane0 `2.9353883300152694`, observed `1.5279462337493896`, error
  `1.4074420962658798`. Sabotaging the candidate promoted CPU oracle by +0.125
  also fails at (0,0), error `0.12500000337037198`, with zero browser errors.
- **P10 sufficiency — partial audit retained, closure pending repair.** Sealed
  LLVM profiles re-export identically against their recorded binaries. Matrix
  line coverage is 332/335 guard and 213/218 emitter; allocation recordings
  cover the fault transactions, and fresh Wasm/physical attacks execute C
  arena/parser failures and unsigned source negation. Authenticated optimized
  stack records show pair108256 + conversion33552 + upstream49216 + emitter624
  =191648 bytes before small callbacks, within262144. Exhaustive defensive/
  branch waiver closure is unfinished after this semantic refutation; this
  entry grants no complete sufficiency verdict.

SUITE: no permanent promotion while correctness is refuted. Critic test
proposals are retained in the archive for the repair. The 483-case/three-frame
candidate passed after a Python3.9-only harness `zip` repair; the expanded
532-case/six-frame candidate stops at case528 before Wasm/browser. No six-frame
pass is claimed. Preserve HELD predictions when their code, dependency boundary
and evidence digests remain unchanged; rerun the affected semantic gates and
one final pristine exact-head proof for the repair.

Critic evidence: `evidence/virgl-standard-shader/verifier/{manifest.json,records.json,recording.tar.gz,verdict.json,finding/}`;
71 records, 2,212,835 compressed bytes;
archive SHA256 `1f59cd3fc8c56509ef73b9d02f766d02e488a9eae70df1e607a4ac036061e78c`;
index `2435c54371b4db9a5935683aec13881f6925db8993996b48b38024df864f86cd`. It binds original predictions,
fresh inputs/results/coverage, complete pixel bytes, both sabotage captures,
log-authentication attacks and the rechecked finding. Runtime was not edited.
Commands include independent `metadata.py` and `pixels.mjs` replays on both
unpacked worker sides; native/sanitized/Node critic matrices and pressure;
headed hardware critic draws and sabotage; independent offline pixel audit;
`xcrun lldb --batch` on the reproduced source at `bridge.c:2283`;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`.
