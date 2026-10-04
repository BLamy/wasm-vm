---
id: E6-T12g2
epic: 6
title: Map required color formats and forced alpha with role-safe storage
priority: 525.0270102
status: implemented
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
Chrome155 / ANGLE Metal Apple M4 Max. Selected unchanged original inputs are
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
