---
id: E6-T12g2
epic: 6
title: Map required color formats and forced alpha with role-safe storage
priority: 525.0270102
status: verified
depends_on: [E6-T12g1]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement the measured required normalized color formats, channel order,
X-format forced alpha, resource binding roles and framebuffer origin over the
bounded resource store. Preserve backing/storage/generation/scratch budgets and
owned sync/async upload/readback. Unsupported formats/roles remain rejected.
Sampling, render destination alpha and inverse guest readback must each be
faithful; allocation probes or an upload-only swizzle cannot prove all roles.
The real unmodified gears candidate selects format233 B10G10R10X2_UNORM;
include its packed10-bit channels and forced alpha rather than changing the
workload to request RGBA8. The verified G1 inventory is authoritative.

## Deterministic acceptance

`make verify-E6-T12g2` executes original required color resource/transfer
packets and independent actual WebGL2 upload/sample/attachment/readback cases
for each admitted format/role. Check BGR/RGB order, arbitrary X bytes versus
forced alpha one, odd padded rows, orientation, sync/async ownership and budgets.
Record GL formats/types and zero errors; retain RGBA8/tiny-scene/resource guards,
require a channel/alpha source fault to fail, and run final clean-clone proof.

## Adversarial verification

Attack reinterpretation, forbidden bind roles/format requests, stale leases,
odd strides, untouched padding, alpha-dependent blending, orientation and byte
budget pressure. Sabotage channel ordering or forced destination alpha and
require independent physical pixels/readback to refute it.

## Verification log

### 2026-10-04 — worker — execution boundary

Verified G1 parent is `0550aa94b59364380e543b0c6de41697c5f18fb8`. Its authenticated client
inventory requires format2 B8G8R8X8_UNORM, format67 R8G8B8A8_UNORM and
format233 B10G10R10X2_UNORM. This high-risk S slice changes the bounded
resource/color-surface boundary only. Use native RGB8 for BGRX8 and native
RGB10_A2 for packed10 storage, preserving lower-left flag0 orientation,
four-byte guest strides and conservative storage/scratch/PBO charges. X alpha
must be one when sampled and as a rendering destination; source fragment alpha
still controls RGB blending. Packed transfer/readback must preserve all10 bits.

Admit explicit render/sampler roles plus the measured SCANOUT/SHARED metadata
hints, reject other roles/flags/aliases, and retain exact resource generations.
Sampler-view specialization, depth, vec3/raster/draw closure, scanout conversion
and live caps remain subsequent boundaries. The production demo does not import
these isolated renderer modules; the authoritative browser proof is the local
hardware-WebGL acceptance page, with original packet/backing citations. Record
affected decoder/resource/tiny-scene regressions, new physical sampling/render/
inverse-readback checks, source faults and final pristine-clone proof. A fresh
independent critic must verify the frozen evidence before the next slice.

### 2026-10-04 — worker — frozen color storage submission

Implementation and harness head: `f0770a386271513fac56df8da26057e256a6ae8b`,
against verified G1 parent `0550aa94b59364380e543b0c6de41697c5f18fb8`.
Commands:

```sh
VIRGL_COLOR_EVIDENCE_DIR=target/evidence/virgl-color-formats-worker-final make verify-E6-T12g2
python3 tools/virgl-command/colors-cold.py --output target/evidence/virgl-color-formats-worker-cold
```

The gate passed syntax/format checks, rebuilt the pinned WASM shader compiler,
ran the affected original decoder/resource/state/draw/async regressions, and
recorded 822 metadata/role/layout assertions plus 941 hardware assertions on
Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max. Selected unchanged original inputs are
kmscube BGRX surface event176, original es2gears packed10 surface event5115,
and kmscube RGBA CPU upload event140. Physical GPU sampling and attachment
readback confirm native [8,8,8,0], [8,8,8,8], [10,10,10,2] component sizes,
all10 packed color bits, channel order, arbitrary X-bit rejection, lower-left
rows and alpha one. Synthetic tiny-scene variants separately establish stored
destination alpha and unchanged source fragment alpha under DST_ALPHA/SRC_ALPHA
RGB blending; the complete unchanged RGBA scene is a regression.

Recorded sync/async transfers cover odd split rows, untouched padding, staging
copy targets, cloned caller inputs, three delayed fence schedules, stale leases,
cross-format ID reuse, exact and one-byte-short CPU/GPU/scratch budgets, and an
injected packed framebuffer allocation failure with rollback. Every final GPU
path records zero console/page/request errors and zero GL errors. Source faults
swap BGR channels or permit packed destination-alpha writes: the independent
physical oracle rejects [37,5,231,255] instead of [231,5,37,255], and packed
alpha0 instead of3 respectively. These faults run from served copies; tracked
implementation bytes are untouched. The initial affected async lifecycle
fixture omitted normalized metadata's format; `f0770a38` explicitly supplies
67 without changing runtime code, then the full scoped gate was rerun.

Final pristine clone at the same exact source head passed with scrubbed
environment and clean before/after checkout. Both executions bind identical
source/input sets and generated WASM bytes. Worker changed-line sweep reports
89/89 changed runtime lines reached across the hardware/regression coverage;
the fresh critic must independently classify semantic branch sufficiency.

Evidence of record: `evidence/virgl-color-formats/worker/manifest.json`,
`records.json`, and `recording.tar.gz` (60 recorded members, archive SHA256
`ef5cd601c77585b597b85fda5f77e227694d6ddb1a3041dd50ae398b6920b273`).
Archive paths include `acceptance/hardware/report.json`, hardware/source-fault
screenshots and V8 coverage, all five original regressions, the byte-budget /
generation assertions, generated translator inputs, and `cold/report.json` /
`cold/acceptance/receipt.json`. Happy receipt SHA256
`185ce3ecdf8b61727ca42aa2ebdb244906c67c936e62649f118f3eeb5d60074d`;
cold report SHA256
`d92a75f797ad0c570d5c24d36c51722d658976c0bc75372f710862d759d6e2d7`.
Convenient unsealed originals remain in the two target directories above.

Claim: this recording demonstrates faithful isolated storage/role/transfer
semantics for required color formats2/67/233. No full client draw closure,
new sampler-view specialization, depth, scanout conversion, live guest graphics
negotiation or MIPS improvement is claimed. G3/G4/G5/G6/H remain gated follow-ups.

### 2026-10-04 — fresh verifier — VERDICT: verified

VERDICT: verified

Read the task and exact diff `0550aa94..f0770a38` before inspecting evidence;
recorded falsifiable predictions in
`target/evidence/virgl-color-formats-verifier/predictions.md` first. The runtime
and harness boundary is exactly `f0770a386271513fac56df8da26057e256a6ae8b`;
later seal/submission changes are administrative. Detailed per-prediction,
mock/environment and per-hunk audit is
`target/evidence/virgl-color-formats-verifier/verdict.md`.

In the citations below, `H` is verifier-extracted
`recording/acceptance/hardware/report.json`, SHA256
`920bb51344081c0c89d2859366a014d5dc1c000a35a5d16e9163bc4cb1b80b75`;
`A` is `independent-attacks/report.json`, SHA256
`dcd06dc5a5a047207b2d8e037d9d3abbe6325ee8cedb2035ab80c639906c1515`.
Both paths are under `target/evidence/virgl-color-formats-verifier/`.

- P1/P9 authenticity and environment — HELD. Predicted frozen bytes and a
  pristine exact-head proof; observed all60 safe regular archive members and
  their indexed digests,89 frozen source/input bindings and matching generated
  translator bytes. Happy/cold binding sets are equal. Final cold report:4–19
  has exact head, exit0, scrubbed relevant environment and clean before/after;
  SHA256 `d92a75f797ad0c570d5c24d36c51722d658976c0bc75372f710862d759d6e2d7`.
  All five affected regressions passed; the explicitly historical fixture failure
  is excluded from acceptance. Preserved the existing clone proof. No demand.
- P2 originals — HELD. Predicted unchanged original color packets; observed
  kmscube format2/event176 and unmodified es2gears format233/event5115 with their
  exact metadata. CPU RGBA upload event140 physically hashes to original backing
  event139 (`e11634ce793311f855306dba6f1f97b7e83e02c0e8f5bae7565a3b0bc2780039`),
  not reference output. `H:10603` onward. No demand.
- P3/P4 precision, channels, origin and ownership — HELD. Predicted first
  physical texels `[231,5,37,255]`, `[37,5,231,12]`, `[1,257,1022,3]`, native
  bits `[8,8,8,0]`/`[8,8,8,8]`/`[10,10,10,2]`, canonical X-only inverse changes
  and untouched padding. Observed all asymmetric lower-left rows, all10 color
  bits, odd split/staging rows, owned poisoned inputs, and three read-fence
  schedules. `H:12753,14785,14877,15259`; independent partial pixels `A:9170`.
  No demand.
- P5 roles/reinterpretation — HELD. Predicted precise role grants/rejections;
  observed exhaustive unsupported formats0..300 and forbidden bind bits, hints
  without roles, level/layer rejection, and actual hardware render-only and
  sampler-only paths for every format. Format reinterpretation and forbidden
  actual surfaces reject. `A:2274,10586,30980,31764`. No demand.
- P6 alpha — HELD. Predicted fixed X destination alpha through CLEAR/DRAW,
  unchanged source alpha under blending, and ordinary RGBA behavior; observed
  packed DST_ALPHA `[1023,0,0,3]` and SRC_ALPHA `[0,0,0,3]`, corresponding BGRX
  and RGBA controls and actual draw masks. `H:15695,15741`. No guest DST_ALPHA
  admission is inferred from this physical storage test. No demand.
- P7 generations — HELD. Predicted old storage/format survive public ID reuse
  and stale accesses reject before collection; observed all three pairs,
  old format233 inverse bytes despite new format2, retained GPU72 then24,
  revoked lease `stale-storage`, and independent content/backing revocations.
  `H:19213,15357`; `A` records `stale-storage`/`stale-ticket`. No demand.
- P8 budgets/rollback — HELD. Predicted exact fits, one-byte-short rejection
  before physical reads and cleanup on failed allocation; observed all six
  worker pressure cases and injected packed framebuffer rollback with restored
  mask/scissor, deletion and zero charge. `H:13063,19899,20463,20991`.
  Independent partial reads fit GPU/CPU/scratch136/93/36 exactly;135/92/35 fail
  before readPixels with identical budgets. `A:32252,32442`. No demand.
- P10 fault sensitivity — HELD. Both sealed worker faults fail their physical
  oracle. Independent served-source packed-channel sabotage at resources.mjs:668
  produced `[18,447,992,3]` instead of `[992,447,18,3]` at seed74565; rejected
  by raw attachment pixels, with no browser/import errors.
  `sabotage-packed-order/report.json:30,110`, SHA256
  `8f8690b2654ecd103d0cd264260b68e9684af781530bbd295a0d920aa9e75b99`.
  Tracked implementation is untouched. No demand.
- P11 coverage — HELD. Independent narrowest-range V8 audit, excluding worker
  audit/faults/cold duplicate, confirms89/89 changed runtime lines have hits.
  All72 behavior lines executed;17 standalone comments/braces are explicitly
  waived, with no dead/unproven behavior. `coverage.json:2–9`, SHA256
  `98cf2284c98d77996667fcb7bde34600b4665078aa0a1931ecaaeaead56beecd`.
  Declarative docs/task metadata are waived; Makefile/fixture/receipt/cold glue
  and corrected trusted async fixture are exercised by scoped transcripts.
  No additional run or deletion demanded.
- P12 bounded novel attack — HELD. Three independent seeds74565/195939070/
  7847937 × three formats tested3×3 boxes at(1,1) in5×5 textures, stride17/
  offset7/split and unaligned caller inputs, all16 untouched neighboring pixels,
  withheld actual GPU fences with no early CPU collection, stale accesses,
  hardware roles and byte pressure. `A:103,2300`;2,191 held assertions and zero
  console/page/request/GL errors. No demand.
- SUITE: retain the committed literal physical/inverse/role/quota/alpha cases,
  both source-fault gates and `make verify-E6-T12g2`; preserve the independent
  seeds/pixels/sabotage as verifier evidence. No runtime or new tracked harness
  mutation was required. The metadata-only backend was never counted as GPU
  proof, and original CPU uploads were never reference-rendered expected output.

Commands: `python3 target/evidence/virgl-color-formats-verifier/authenticate.py`;
`python3 target/evidence/virgl-color-formats-verifier/coverage.py`;
`node target/evidence/virgl-color-formats-verifier/attack-browser.mjs`;
`node target/evidence/virgl-color-formats-verifier/attack-browser.mjs --fault`.
Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max, headed hardware WebGL2.
Host rr is waived by the user's September policy. No `ssh dev`, unrelated
Rust/shader/guest walls, or second cold clone was used. Production web sources
do not import the isolated renderer modules; this verdict proves G2's color
storage boundary only. Queue rebuild/commit belongs to the parent session.

### 2026-10-04 — worker — preserve independent verdict

Sealed the fresh critic's 15 nonduplicate artifacts under
`evidence/virgl-color-formats/verifier/manifest.json`, `records.json` and
`recording.tar.gz`, archive SHA256
`256ddef416cb9740a8fb4c8e0e9f06617f47a1136fa71b03ed509d6197799471`.
The exact predictions, authenticators, independent hardware/packed-fault runs,
V8 sweep and verdict are preserved; extracted duplicates remain bound to the
original authenticated worker archive. No runtime or verifier conclusion changed.
