---
id: E6-T11d3
epic: 6
title: Execute scalar through four-component float vertex fetches
priority: 525.027036
status: verified
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

### 2026-10-09 — fresh verifier — VERDICT: verified

VERDICT: verified

Reviewed frozen source `2ba17ed3d5373eea3991225c8cd8160920928499` against
verified parent `bcdb820620092aaf869aa0574ffce6de793dd5fe`; worker submission
`aaaf3565`. Predictions preceded opening the evidence; this verifier changed
no runtime implementation. The guest/browser evidence replaces the waived host rr layer.
Predictions: `evidence/virgl-float-vertex/verifier/predictions.json:1`, SHA256 `ee24f920bee31866a08c9217e4e3e1a96942ceefd5aaf17257cd20718c48f635`.

- P1 — HELD. 196 seal members,382 exact-head sources,generated modules,served scripts and pristine final cold clone authenticate. Citation: `evidence/virgl-float-vertex/verifier/authentication.json:1`, SHA256 `561fa80b41099ace2ba00ca7f720c0bd741db5c27066c874715e1c9bdeb945b1`.
- P2 — HELD. Fresh native and ASan/UBSan pinned C enum/layout oracles match widths4/8/12/16; admitted formats are exactly28..31. Citation: `evidence/virgl-float-vertex/verifier/enum-audit.json:1`, SHA256 `bd54935a372432b28acf5f61ea4da3a78464fa6bd9f7e77f697ad85361319746`.
- P3 — HELD. Aligned u32 last offsets,remainders,overflows,divisors and slot bounds hold,including3132 fresh seeded wire predicates. Citation: `evidence/virgl-float-vertex/verifier/fresh-wire/report.json:1`, SHA256 `b4e75c6fa47dd964eac3ad527f9e15a5b5c7dee6704c3ecd23fc70a63c88abfe`.
- P4 — HELD. Every scalar/RG/RGB recorded pixel derives from actual GPU bytes and independent missing lanes; no padding leakage. Citation: `evidence/virgl-float-vertex/verifier/hot-hardware-audit.jsonl:4`, SHA256 `e67e54e893faff157e48e50854d79b8d60ea1a8392645be73162ca2bede3c898`.
- P5 — HELD. Fourth color alpha64 and clip reciprocal W128/64/32 agree at pixel8,8 and every recorded pixel. Citation: `evidence/virgl-float-vertex/verifier/hot-hardware-audit.jsonl:7`, SHA256 `e67e54e893faff157e48e50854d79b8d60ea1a8392645be73162ca2bede3c898`.
- P6 — HELD. First and actual-last fetch bounds,offsets,252/overlapping strides,actual u16 maxima,exact ends and short rejection/recovery hold. Citation: `evidence/virgl-float-vertex/verifier/recording-audit.json:1`, SHA256 `677176a943931d8e864e939de40728c6228913925c13641d4b5fa94b0bb6f663`.
- P7 — HELD. Inactive slot15,A/B/A,public unref/ID reuse,old-generation retention,rebind and current transfer match native bytes and pixels. Citation: `evidence/virgl-float-vertex/verifier/fresh-hardware-audit.jsonl:5`, SHA256 `65114338302eba4903a20643df5b68ec2a39129e7fe3c94482d56ead066d5a02`.
- P8 — HELD. Owned async input,real read/completion fences and varied delays0/1/3 plus fresh0/2/5 hold; short cases issue no draw. Citation: `evidence/virgl-float-vertex/verifier/fresh-audit.json:1`, SHA256 `81c585f1ec1ae46ca9aac75608919f20b552b757be97577c99e13bed0aa64d9d`.
- P9 — HELD. All three sealed physical source-size faults contradict their named pixel predictions,without unrelated failures. Citation: `evidence/virgl-float-vertex/verifier/recording-audit.json:1`, SHA256 `677176a943931d8e864e939de40728c6228913925c13641d4b5fa94b0bb6f663`.
- P10 — HELD. Every changed runtime predicate/lane expression and all its extent/native-pointer consumers execute; zero runtime waivers. Citation: `evidence/virgl-float-vertex/verifier/recording-audit.json:1`, SHA256 `677176a943931d8e864e939de40728c6228913925c13641d4b5fa94b0bb6f663`.
- P11 — HELD. 257 unchanged compiler/private/cache sources and parent D2 HELD results carry; current H/nine original draws and promoted22 blend frames authenticate. Citation: `evidence/virgl-float-vertex/verifier/carry-forward.json:1`, SHA256 `dd9f19214ecf3bdf751d43ab18b888dab77c6396b7dd8a0e7d10cd573ad05f34`.
- P12 — HELD. 96 fresh varying-W/partial-color frames,24576 independently derived pixels and144 rejections hold; real RGBA-size3 sabotage produces alpha255 instead of203 at2,2. Citation: `evidence/virgl-float-vertex/verifier/fresh-audit.json:1`, SHA256 `81c585f1ec1ae46ca9aac75608919f20b552b757be97577c99e13bed0aa64d9d`.

COVERAGE: the decoder’s three changed lines execute in a 466-hit element map;
the changed `vertexComponents` expression executes 2,515 times in each hot/cold
capture. Its first-element extent, native pointer and actual-last-fetch consumers
execute with all widths. No runtime hunk is unexecuted or waived. README prose
and task/queue metadata are non-executable scope; recording scripts and aligned
retained fixtures are exercised by authenticated final acceptance logs.

The independent novel oracle uses general triangle cross products and exact
binary32/Fraction GPU values to re-derive all 24,576 fresh pixels. The deliberate
RGBA native-size3 fault reaches the physical predicate after a zero-GL-error check:
pixel (2,2) alpha203 becomes255. Reopen `sabotage-promoted-audit.jsonl:25`
or raw `sabotage-promoted/pixels.bin` alpha byte24715 (SHA256
`7136937d0c810e7b6d31af7a58fa08deb416bbc46196743f71c2c53380470316`).

SUITE: promoted deterministic `renderer/virgl-command/tests/float-vertex-boundaries.mjs`
retains 3,132 seeded wire predicates, 96 physical frames, 144 rejections, varying W
and partial lanes, A/B/A and retained generation transitions, actual index maxima,
both element bounds and async0/2/5. Its real source mutation must fail the named
alpha prediction. The initial critic harness incorrectly expected malformed async
`beginSubmission` to allocate a job; recording now preserves its immediate typed
rejection. This was a harness correction, with no product refutation.

Exact critic commands:

```sh
python3 evidence/virgl-float-vertex/verifier/authenticate.py
python3 evidence/virgl-float-vertex/verifier/recording_audit.py
python3 evidence/virgl-float-vertex/verifier/carry_forward.py
node --check renderer/virgl-command/tests/float-vertex-boundaries.mjs
node renderer/virgl-command/tests/float-vertex-boundaries.mjs --output evidence/virgl-float-vertex/verifier/fresh-wire --node-only true
node renderer/virgl-command/tests/float-vertex-boundaries.mjs --output evidence/virgl-float-vertex/verifier/fresh-hardware
node renderer/virgl-command/tests/float-vertex-boundaries.mjs --output evidence/virgl-float-vertex/verifier/sabotage-promoted --mutation rgba
# Above mutation exits1 at the predicted alpha pixel; baseline exits0.
python3 evidence/virgl-float-vertex/verifier/fresh_audit.py
python3 evidence/virgl-float-vertex/verifier/finish.py
```

The exact native and ASan/UBSan compile/execute commands and outputs are retained
in `enum-audit.json:1`; their pinned values agree. Final pristine/scrubbed
`make verify-E6-T11d3` at the frozen head is authenticated once and carried; no
unrelated compiler, stress or broad workspace gate is restarted.

Critic seal: `evidence/virgl-float-vertex/verifier/recording.tar.gz`, 240 authenticated records, 6585163 bytes; archive SHA256 `952d04551cffdb8a79618ef544214ef4683c08ee18bf6e792767bef319fb5734`; index SHA256 `8b3c4e7925fa75612f45077d68787884b27b6801054f3a342ea17e844c18f46b`.
Reopen with `tar -xzf evidence/virgl-float-vertex/verifier/recording.tar.gz -C evidence/virgl-float-vertex/verifier`.
The seal includes original hot/cold captures, all independent audit scripts/results,
fresh GPU bytes/packets/dumps/coverage/screenshots, faults and the promoted test.
Production negotiation remains disabled; no complete API, guest boot or throughput
claim is granted. E6-T11d remains outside this isolated verdict.
