---
id: E6-T11d35
epic: 6
title: Preserve original packed normalized image storage and transfers
status: verified
estimate: S
risk: high
priority: 525.027039000377
depends_on: [E6-T11d34]
capstone: false
---

## Boundary

One original allocation/transfer representation boundary: packed UNORM 565,
4444, 5551 and 1010102 image words and their pinned R/B/opaque aliases. Preserve
original little-endian component fields, native precision, alpha or implicit one,
base/mip storage, original padded public backing, native GPU range copies and
retained generations. Add a separate selected resource/backend profile; keep
historical exports, decoder, compiler, command consumer and budgets closed.
The held legacy 233 representation remains unchanged. No production capset,
complete API, guest execution or command-consumer authority follows.

## Deterministic acceptance

make verify-E6-T11d35

First record exact verified D34 original storage/layout refusals for thirteen
formats 5, 6, 7, 8, 122, 131, 135, 308, 319, 320, 321, 407, 409 across base/mip and render,
sampler and combined roles, before any allocation. Bind every original metadata
record to the pinned VirGL enums and Mesa 26.2.2 channels/swizzles. The legacy 233
positive remains held by exact unchanged source/dependency/digest.

On actual headed Apple Metal WebGL2, upload original words, preserve physical
native formats and compare complete defined native component planes plus full
public readbacks with an independent inverse. Exhaust all 65536 original 16-bit
words for each applicable layout; cover all 32-bit fields, alpha endpoints,
adversarial mixed words and varied seeds. Canonicalize only original ignored X
fields to implicit one; preserve all defined original bits. Exercise odd padded
rows/offsets, scatter-gather backing, original base/mip boxes, GPU-only native
range copies, isolated levels, caller state, detached generations and ID reuse.
No second uncharged CPU image or GPU shadow may escape the existing budgets.

Record actual native allocation/upload/blit/readback/fence/poll/CPU-capture and
once-only retirement identities. CPU reads follow their own completed fences.
Compare snapshot budgets against exact original and native sizes, including PBO
staging and scratch. Cover limits at/beyond bounds, ownership/getters/traps,
invalid resource/transfer/range roles, failure cleanup, cancellation/disposal
and three varied schedules. A real post-completion packed native target word
corruption must fail the unchanged independent inverse after another native
completion. A synthetic failure is additional evidence, never the pixel oracle.

Run affected historical resource/transfer gates, nested V8 coverage against every
changed runtime hunk, frozen exact-head hot acceptance and the same command once
in a pristine scrubbed clone. Seal and reopen complete original inputs, native
events, pixels/backings, screenshots, sources, coverage and cold proof for a
fresh independent critic. Carry unchanged compiler and command facts only by
exact code, dependency and evidence digest.

## Adversarial verification

Predict original component fields, native packed order, implicit alpha and full
transfer/backing bytes before inspecting evidence. Authenticate all predecessor
and worker members. Independently invert original inputs rather than importing
new conversion helpers. Audit all changed smallest governing nested V8 counters
and every waiver. Attack ownership, overflow, budget, state restoration and
retained range/failure boundaries with fresh schedules. Invent one bounded
packed alias/mip/partial-box attack and sabotage a real packed target after
physical completion. Only the fresh critic sets verified; no merges authorized.

## Primary sources

Pinned original enums: renderer/virgl-shader/vendor/src/virgl_hw.h.
Mesa 26.2.2 source archive:
https://archive.mesa3d.org/mesa-26.2.2.tar.xz,
SHA256 eeb29ca7e56cfaa8e8a79538dcf834e3b18e501c31bef5145e959ea437cc4216.
Original channels and swizzles: src/util/format/u_format.yaml.
The actual GLES3 predicate requires EXT_texture_type_2_10_10_10_REV, selected
from original 8 or 131 sampler support in src/mesa/state_tracker/st_extensions.c.
GLES3.0.6 sized texture/transfer formats and packed words:
https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf.
Checked 2026-10-11; these sources do not grant a complete API claim.

## Execution slices

Append a bounded immutable packed-layout descriptor and selected owner/backend.
Permute original 16-bit fields into actual native565/4444/5551 word order inside
the charged upload scratch; permute original 32-bit R/B fields into actual native
2_10_10_10_REV order. Use actual native packed precision. Reconstruct original
16-bit fields from complete defined native normalized component readbacks;
preserve all 32-bit defined fields through actual packed native readback. Validate
and charge complete mips, public padding, native storage and staging before
mutation. Native range copies and held owner machinery remain the transaction.
A following original command consumer is a separate ordered prerequisite.

## Verification log

### 2026-10-11 — worker — ordered original storage prerequisite

D34 is independently verified at `b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06` and its
exclusive leases are released. At that exact head, `node evidence/virgl-production-readiness/standard-packed-normalized-image-gap.mjs`
records 78 original base/mip/render/sampler/combined metadata and layout refusals
for all 13 pinned packed UNORM aliases, with zero allocations. The adjacent JSON
retains the complete inputs and source digests. This selected storage prerequisite
continues the user-authorized production graphics chain; the unrelated general
queue entry remains deferred. Original command consumption follows separately.
No production capset or guest execution is claimed.

### 2026-10-11 — worker — pre-submission accounting prediction correction

At runtime head `2acc572aaea2368f1c2f2aad0def5c2d08ecc2d8`, the complete native
matrix, three ownership schedules and three physical corruption controls passed.
The independent budget assertion incorrectly added public staging backing to
GPU storage. Original bind524288 is intentionally CPU-only (`resources.mjs`
createResource allocationBytes); the observed first run has 392 texture bytes,
1090 backing bytes and a separate 612-byte native PBO. Correct the harness
prediction to count the public source and staging backings only on CPU and the
PBO only after native issue. Runtime semantics are unchanged. No successful
final receipt or task verdict follows from this interrupted recording; rerun the
selected frozen submission after this harness correction.

### 2026-10-11 — worker — exact recorded submission

Runtime is frozen at `2acc572aaea2368f1c2f2aad0def5c2d08ecc2d8`; final source and
harness head is `b6434e33c9e5399f48fc191656e02f318cd78075`, based on independently
verified D34 `b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06`. The selected packed
descriptor and resource/backend profile are the only two changed runtime files.
Decoder, command consumer, compiler, historical profiles and production caps
retain their predecessor digests.

Commands:

```
VIRGL_PACKED_NORMALIZED_EVIDENCE_DIR=target/evidence/virgl-standard-packed-normalized-final-hot-v3 make verify-E6-T11d35
python3 tools/virgl-command/standard-packed-normalized-cold.py --output target/evidence/virgl-standard-packed-normalized-final-cold
python3 tools/virgl-command/standard-packed-normalized-seal.py target/evidence/virgl-standard-packed-normalized-final-hot-v3 target/evidence/virgl-standard-packed-normalized-final-cold evidence/virgl-standard-packed-normalized-images/worker
```

The hot command and identical pristine-clone command exit zero on headed native
Apple Metal WebGL2, with zero recorded browser errors. Each proves 169 actual
native cases and three 26-case varied ownership/failure schedules. The
independent primary-table inverse checks 250 recorded runs, 15,144,788 native
components, 4,200,708 public bytes and 96,104 untouched padding bytes. Ten
16-bit layouts exhaust all 65,536 original words; three 32-bit layouts cover all
defined fields and alpha endpoints. Original transfer boxes, GPU-only changes,
isolated mip ranges, full backing, native formats, indexed state restoration,
retained generations, PBO fences and exact CPU/GPU/scratch budgets are compared.
Three physical upload/copy/completed-word corruptions are independently refuted
after native completion; `fault-completed-word/report.json` run 0,
`planes/0/observed/native` retains the second completed native fence and corrupt
packed component. The two other points are `fault-copy-level/report.json` run 0
`views/planes/native` and `fault-upload-lane/report.json` run 0
`planes/0/observed/native`.

All seven affected historical resource/transfer gates pass. The complete nested
V8 audit has 449 positive smallest governing changed-runtime partitions, zero
zero-hit partitions and zero waivers. The predecessor audit reopens and hashes
223,159 members of four held worker/critic seals. Actual generated Wasm remains
`acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.
The cold clone is pristine before and after its single final exact-head run.

The earlier harness-only recording at `cebeb6892b77ade6cca991fc8eae4b7cb9591881`
reached the legacy color-format server's missing new-module 404. Final harness
head adds only pinned source-serving declarations to 27 historical harnesses
and supports the legacy single-source coverage shape. The serving auditor
reconstructs every original D34 file by removing those declared additions;
no historical algorithm or assertion changed. Both interrupted recordings are
retained locally; neither is offered as the successful final submission.

Evidence of record: `evidence/virgl-standard-packed-normalized-images/worker/`
contains the complete hot/cold inputs, native events, backing/pixel blobs,
source closure, screenshots, coverage, custody and receipts. Its 28,896 members
were reopened and hashed. Archive: 56,549,137 bytes,
SHA256 `c8e12f7832dfbfc94b5cab8a7d196e56409544e3a218eb493d919babcf9e07dc`;
index SHA256 `784a390eea7213a797b0881ef8911847771429a1f9fe27b2a8249dca73bedbfd`;
manifest SHA256 `3f099fb484d1529e1848d6f2ee80587cdd100d38412fda58de1f9221b454960e`.
Hot receipt SHA256 `8b0255a5f183ed2df1453284aeb5a4dd72dca11c65370c92f3ad95233e8a200e`;
cold receipt SHA256 `66b4e578e070c6e14fe57b5e29564afd232cce66b3581716f7d643181edc80bf`;
cold report SHA256 `ffe66714cb8cf7c478e2743863c17e21c4f791072c560e7fc2661e414faf3398`.

Claim: the isolated selected owner/backend preserves these thirteen original
packed normalized representations through actual native storage and transfers,
including full-mip and retained-generation transactions, within existing
budgets. This is a worker claim awaiting a fresh critic. It grants no guest
execution, original command-consumer, production negotiation or production draw
authority. The following command consumer remains a separate ordered task.

### 2026-10-11 — fresh verifier — independent adversarial replay

VERDICT: verified

Reviewed the complete task and scoped diff before inspecting captures, then wrote
`verifier/predictions.json`. Product source remained byte-identical to the runtime
freeze `2acc572aaea2368f1c2f2aad0def5c2d08ecc2d8`; final worker submission was
`1398a86992e0575a29c56a9a93bd5e9d11d80e11`, recorded acceptance source
`b6434e33c9e5399f48fc191656e02f318cd78075`, verified D34 base
`b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06`. No implementation was edited.

Citations below are exact archive-relative files and JSON points in the complete
critic seal. Every cited digest and the supporting raw capture/blob pointers are
also stored in `verifier/verdict.json`.

- P01 — **HELD**. Authenticated all28896 worker and223159 predecessor members, unique regular files with exact indexed bytes. Point: `custody.json#/worker`; SHA256 `d96b05463448bfd8f4cdab4b0542a088d045b2c064482058182548d431063774`.

- P02 — **HELD**. All13 fields independently derived from full pinned primary files and GLES packed offsets; original ignored X alone implies alpha one. Point: `primary-derived.json#/records`; SHA256 `cfe43eebf895e8a78c8c1679c7eb9be94b881b3e65954a9c628222ad228cd8ec`.

- P03 — **HELD**. Exact78 original D34 inputs replayed before allocation; current780 old owners/702 old layouts remain closed. Point: `baseline-refusals.json#/records`; SHA256 `59630395f2ab72747b80cb4976b8bcaf6bb58ad18cb69606be186ffd3b3c8686`.

- P04 — **HELD**. Ten exhaustive16-bit and three dense32-bit cases have exact original/native defined fields and actual packed-sized texStorage2D. Point: `fresh-values.json#/dense`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P05 — **HELD**. Full native mips, original/private range correspondence, GPU-only clear/refresh, SG outputs and all padding hold. Point: `fresh-values.json#/`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P06 — **HELD**. Corrected source-contract prediction HELD: opaque init and range FBO/mask/scissor state restore; transfers establish dense pack/unpack and owned bindings. Point: `novel-promoted/report.json#/browserResult/result/runs/0/callerBefore`; SHA256 `291502c8bbe9bbeefe6bb77a5dd3d9365fbf6864298d59005235683e92288418`.

- P07 — **HELD**. Native packed mip sizes, CPU-only public backings, charged read scratch and PBO issue/release match exact stages; exact/one-short limits hold. Point: `fresh-values.json#/`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P08 — **HELD**. Each CPU native capture follows its live actually completed owned fence; all allocated objects/syncs retire once and final budgets are zero. Point: `fresh-values.json#/`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P09 — **HELD**. Old private words survive alias ID reuse; replacement generation differs, stale public tickets refuse and pending old read is physically discarded. Point: `novel-promoted/report.json#/browserResult/result/runs/0/replacementGeneration`; SHA256 `291502c8bbe9bbeefe6bb77a5dd3d9365fbf6864298d59005235683e92288418`.

- P10 — **HELD**. Getter/trap/unknown/prototype, role/level/stride/unsigned-coordinate/dataOffset refusals leave ownership/native state unchanged; caller byte mutation cannot change owned upload. Point: `receipt-values.json#/freshWire`; SHA256 `10866f0b52cf36fffca8db1ca4313d7a4a412b3d06a4e43ed41d69e71a48b5ab`.

- P11 — **HELD**. Three fresh schedules exercise all native failures and cancellation/disposal/context-loss with backend refusal and exactly-once cleanup. Point: `fresh-values.json#/records`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P12 — **HELD**. All three physical corruption controls fail unchanged independent inverse. Post-completion packed R bit changes expected21 to observed20 after a distinct sabotage fence. Point: `fresh-values.json#/faults/0`; SHA256 `dd7ff1857978d34dd25181e91b5a5e29e14149d15e773f416e27ff4aa655d3d1`.

- P13 — **HELD**. Both independently reconstructed smallest-governing V8 audits match449 positive partitions; zero missing/zero-hit partitions and zero runtime waivers. Point: `worker-hot-coverage.json#/partitions`; SHA256 `ab184377fa8ab22c0fd1589516ce1b76140bfb3e63b55b9873395a585fc1621e`.

- P14 — **HELD**. Both exact b643 acceptance receipts,805 recorded source pins, actual generated bytes, pristine/scrubbed cold report and logs bind correctly; runtime equals freeze and submission. Point: `receipt-values.json#/records`; SHA256 `10866f0b52cf36fffca8db1ca4313d7a4a412b3d06a4e43ed41d69e71a48b5ab`.

- P15 — **HELD**. All seven historical native gates pass in both lanes; all27 server diffs reverse to exact D34 declarations. Held decoder/state/compiler and production boundaries remain gated. Point: `receipt-values.json#/records`; SHA256 `10866f0b52cf36fffca8db1ca4313d7a4a412b3d06a4e43ed41d69e71a48b5ab`.

- P16 — **HELD**. Final promoted19-case bounded novel original alias/mip/partial-box/state/budget test and independent inverse held; six exact/one-short bounds and all87 physical fences covered. Point: `novel-promoted/report.json#/browserResult/result/runs`; SHA256 `291502c8bbe9bbeefe6bb77a5dd3d9365fbf6864298d59005235683e92288418`.

P06/P16 preserve their initial overbroad state assumptions in predictions.json.
Before the novel capture, the unchanged `resources-README.md:270-276` contract
corrected them: the backend owns an isolated context; transfers establish dense
PACK/UNPACK and their own bindings. Opaque initialization and range refresh restore
the caller state their contracts name. This source-based correction was made
before observing those native points. The first novel capture stopped because the
critic passed an overflowing coordinate through the original decoder, which
correctly refused it. The corrected critic constructs hostile decoded own fields;
the final run also probes the actual `dataOffset=0xffffffff` field. All earlier
captures and exact harness versions remain sealed; neither issue refuted product
behavior.

Fresh native proof: matrix seed `0x8bc7314d` passed169 cases; schedule seeds
`0x6d72ac49`, `0xc83b159e`, `0x27e04fd1` passed26 cases each. All three corruption
controls at `0x54a29ef7` failed after physical completion as predicted. The completed
target control changed original R21 to native R20, then waited a distinct native
fence before the unchanged inverse failed. Independently audited each hot, cold
and fresh lane:250 runs,15,144,484 successful native components,8,207,868 additional
raw transfer components,4,200,708 public bytes and96,104 untouched padding bytes.
The worker total15,144,788 additionally counts304 components from the three
intentionally refuted control planes. The final bounded novel seed `0xde37a921`
passed19 runs/3,949 assertions:7,028 native components,936 raw transfer components,
420 public bytes,8,348 unaffected backing bytes and87 physically completed fences.

COVERAGE: independently reconstructed all449 smallest governing nested V8
partitions over every added runtime line in both original recordings. All449
positive, zero zero-hit, zero runtime waivers. Exact innermost ranges/counts and
raw source/coverage digests appear in `worker-hot-coverage.json` and
`worker-cold-coverage.json`. Non-runtime primary/config/README/task/Make facts and
recipes are declarative;27 historical module-list additions reverse byte-for-byte
to D34 with no algorithm/assertion drift. Touched harnesses and auditors ran.

CUSTODY: fully reopened28,896 worker members and all223,159 D31/D34 predecessor
members with independently checked committed archive/index/manifest bytes. Both
original exact-head hot/cold receipts and805 source pins hold; cold was pristine
before/after with scrubbed environment and identical `make verify-E6-T11d35`.
No portability finding or runtime change required restarting that proof. Original
D34 refusal inputs replayed against authenticated source copies:78 refusals, zero
allocations. Generated Wasm remains
`acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.

Critic seal: `evidence/virgl-standard-packed-normalized-images/verifier/recording.tar.gz`, 28,065,231 bytes,
SHA256 `7142c920bdcd8ceda75ae58fe5a5cebdbfbcc7dfa455b73b3c0c765d5ede7d4a`. Every one of its 14,093
regular indexed members was fully reopened (127,986,969 raw bytes).
Index SHA256 `a34c7fc4f46c8b98dcf3dc61cd7b93f0ada0c939d840b8a409776c67ba6b6815`;
manifest SHA256 `106a7569d82db9cab3058b744c16d1ec8341a19311d34046c5d54db2619f8b0b`.

SUITE: promote `renderer/virgl-command/tests/standard-packed-normalized-critic.mjs`,
the precomputed independent original input/primary plan, native recorder and
separate Python inverse into `make verify-E6-T11d35-adversarial`. The new target
passed on real headed Apple M4 Max Metal with zero browser/GL errors. Existing
acceptance and physical sabotage controls remain. Authentication, exact receipts,
independent values, baseline replay and sealing tools are retained for reopening
this review. No guest, original command-consumer, production API, capset or
deployment authority follows. Parent remains blocked; no next task was activated.

Commands: critic-auth.py; critic-audit.py for reopened hot/cold with --coverage
and fresh hardware captures; original native runner with independent matrix,
three schedule and three fault seeds; fresh --node-only wire runner; independent
D34 baseline-source replay; critic-receipt.py; critic-novel-audit.py;
`make verify-E6-T11d35-adversarial`; critic-seal.py (complete reopen); scoped
JavaScript/Python syntax checks; `git diff --check`;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`.
