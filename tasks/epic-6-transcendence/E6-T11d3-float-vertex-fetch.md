---
id: E6-T11d3
epic: 6
title: Execute scalar through four-component float vertex fetches
priority: 525.027036
status: implemented
depends_on: [E6-T11d2]
estimate: S
risk: high
capstone: false
---

## Boundary

Complete the pinned R32_FLOAT/R32G32_FLOAT/R32G32B32_FLOAT/R32G32B32A32_FLOAT
per-vertex fetch family. Preserve the GPU's missing-lane defaults (zero and W=one),
actual fourth color lane and homogeneous position W. Validate aligned source
and buffer offsets, exact element widths, actual last fetch and u32 arithmetic
before native drawing. Preserve ordinary nonzero strides, arrays/indexed strips,
owned generation/lease/context and asynchronous completion contracts. Zero-stride,
instancing, other vertex formats and production capsets stay explicitly gated.

This one vertex-fetch prerequisite does not qualify the complete API or guest.

## Deterministic acceptance

`make verify-E6-T11d3` authenticates an independent compiled pinned enum oracle,
checks all four wire formats/overflows/alignment and rejection boundaries, builds
the actual shader Wasm, then draws original-form VirGL packets on the headed
hardware browser. Use separate position and color buffers to prove every lane
and padding, nonunit homogeneous W through gl_FragCoord.w, offsets/padded strides,
nonzero starts, indexed actual maxima and dishonest wire hints. Check physical
pixels from independently specified values plus native attribute/fetch evidence.

Record A/B/A, public resource unref/ID reuse, transfer updates, cache restoration,
varied async/fence schedules and one-short fetch recovery with no issued draw.
Sabotage scalar/four-component native sizes and require precise pixel failures.
Run affected retained draw/raster/async gates, one final exact-head cold clone,
seal raw packets/geometry/pixels/reflection/coverage and submit to a fresh critic.
No unchanged full compiler suite or unrelated cache stress wall is restarted.

## Adversarial verification

Predict native size, missing lanes, fourth-lane alpha and reciprocal clip W at
concrete pixels. Attack the last element at both bounds, maximum u32 offsets,
alignment, retained allocation replacement, inactive elements and actual indexed
maxima. Independently choose one nonunit-W/partial-color geometry and sabotage
the new oracle once. Cover every changed runtime hunk or narrowly waive it;
carry unchanged compiler/private and D2 blend results forward.

## Verification log

### 2026-10-09 — worker — activation

D2 was independently verified at `bcdb820620092aaf869aa0574ffce6de793dd5fe`.
The actual negative wire record is
`evidence/virgl-production-readiness/float-vertex-gap.json`; it binds the
original-form bytes and decoder/state/header identities to source `2b720fca`.
This isolated prerequisite has no imports from the production demo and does
not advertise new capsets. Its physical browser proof is the relevant browser
path; production surfacing and deployment remain in E6-T11d.


Pending negative readiness: pinned formats28/31 reject original-form
CREATE_OBJECT VERTEX_ELEMENTS with `unsupported-feature: Only per-vertex
RG32/RGB32_FLOAT elements are supported.` The currently accepted29/30 cannot
preserve an application's scalar input padding or fourth position/color lane.
The user request to finish production graphics continues the ordered chain.

### 2026-10-09 — worker — recorded submission for fresh falsification

Frozen source `2ba17ed3d5373eea3991225c8cd8160920928499`; parent independently verified D2
`bcdb820620092aaf869aa0574ffce6de793dd5fe`. Exact acceptance:

```sh
make verify-E6-T11d3
python3 tools/virgl-command/float-vertex-cold.py --output target/evidence/virgl-float-vertex-cold
python3 tools/virgl-command/float-vertex-seal.py target/evidence/virgl-float-vertex target/evidence/virgl-float-vertex-cold evidence/virgl-float-vertex/worker
```

Both hot and exact-head pristine cold runs passed: 630 independent wire
predicates, four admitted format IDs / 252 rejected IDs, independent native and
ASan/UBSan pinned protocol/layout oracles, actual fixed-memory shader Wasm,
57 physical hardware frames / 4128 predicates each, all
14,592 RGBA8 pixels independently re-derived from original-form packet state
and actual retained GPU buffer snapshots. Zero console/page/request errors.
Missing lanes, supplied alpha, clip W=2/4/8, aligned offsets, padded/max/overlapping
strides, nonzero array starts, indexed actual maxima despite false hints, unused
elements, poisoned A/B/A, public unref/ID reuse, transfer revision and async
0/1/3 schedules execute. Twenty-three invalid/short-layout and async failures
issue no native draw; one-byte-short recovery succeeds for each width.

Actual native-size faults fail pixels first: scalar padding reads green 96
instead of 0; RGBA drops alpha 64 to default 255; position W drops reciprocal-W
128 to 255. The independent Python packet/GPU-byte oracle also recomputes these
failures and rejects unrelated failure points. The recorded affected H gate
includes resources, indexed/async, upload/view/format and nine original draws;
the fresh D2 promoted 22-frame blend suite passes. Unchanged checked compiler,
private limits and D2 blend semantics carry; no full compiler/stress restart.

The first selected run exposed an older wire fixture's unaligned `0xfffffff7`
source offset. Corrected only the fixture to final aligned RG32 `0xfffffff4`,
then reran the selected set at the final frozen head. Early browser fixture
assumptions were corrected: the driver may retain an unused color input, and
indexed jobs have separate real index-read and final completion fences. Runtime
remained the small format/width/alignment change.

Evidence: `evidence/virgl-float-vertex/worker/recording.tar.gz`,
196 authenticated records, 5834228 bytes, archive SHA256
`b435606f2147094639d1bdf9018c3ef9c2a3ad0aa9dd7ef3a9661fd2fde34395`, record index SHA256
`f70fe5fc912d7523c4e624bcb25fb245a99ceb2d027957f2c3aac03da79f49c4`. Hot receipt
`9938461d48ef655a0d5a664d8dca669aeb4cf3864e82e8b3ac00631d8752330a`; cold receipt
`bb8fa0e9ddba7f6b2da060b6fafaacfb8e6ee4306945fe4cf5a57d9954d56750`; cold report
`ad6382b0468e13335029274e1828b279550f954264928e9ac809e2107ff42128`. Reopenable underlying runs remain at
`target/evidence/virgl-float-vertex` and `target/evidence/virgl-float-vertex-cold`.
The recording demonstrates only the isolated float-fetch boundary. No capsets,
production guest boot, complete API or graphics throughput are claimed.
