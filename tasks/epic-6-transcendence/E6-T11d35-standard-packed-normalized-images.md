---
id: E6-T11d35
epic: 6
title: Preserve original packed normalized image storage and transfers
status: implemented
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
