---
id: E6-T11d6
epic: 6
title: Execute standard instanced and wide-index vertex draws
priority: 525.027039
status: verified
depends_on: [E6-T11d5]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the explicit standard command/async renderer facet's existing vertex
fetch boundary. Admit positive instance counts with per-element u32 divisors,
u8/u16/u32 index bindings, and issue the native instanced or ordinary calls that
preserve pinned VirGL1.3's wire convention (instanceCount=0 still executes
one ordinary instance). Counts zero/one use equivalent ordinary native calls;
counts above one use native instanced calls. Preserve old factory grammar and behavior. No provenance, compiler
metadata or caller option selects the facet. Triangle/strip mode, zero base
vertex/base instance, nonempty counts and no restart stay the current boundary;
constant stride, other core topologies and restart lowering are ordered gaps.

Derive per-vertex fetches from actual owned index bytes and per-instance fetches
from floor((effectiveInstanceCount-1)/divisor). Never use wire min/max hints as
bounds. Prove offsets, component width, byte end, signed GL call dimensions,
actual MAX_ELEMENT_INDEX and total vertex-instance work before issuing a draw.
Index staging bytes are count*indexSize, with subtraction/division bounds before
arithmetic. Keep the existing per-submission budget by charging count times the
effective instance count, including cumulative draws. The existing later-task storage read retains and validates the same
resource generation/content revision through native draw; reset/cancellation
must drain and release it. Reject fixed restart sentinel explicitly until the
ordered restart slice exists, since WebGL2 always enables restart.

Restore every native divisor on each draw and context switch. Normalize wire
divisors above the 65,536 total-work ceiling to that ceiling: all admitted
instance indices are smaller, so both divisors select element zero. Record both
the original wire divisor and the actual bounded native divisor; include divisor,
instance/index width and native fetch ranges in deterministic draw recording.
Use native gl_InstanceID and gl_VertexID without CPU shader evaluation. This
slice does not grant positive caps or connect production device paths.

## Deterministic acceptance

`make verify-E6-T11d6` records independent literal packet/fetch predictions and
actual fixed-memory compiler plus hardware queued draws. Cover ordinary and
instanced arrays/indexed calls, sizes1/2/4, nonzero bound offsets, divisors0/1/2/
large/u32-max and active attribute15. Use independent seeded geometry and
native instance/vertex IDs to predict disjoint per-instance tiles and exact
flat colors before inspecting full pixels. Exercise effective count0 wire
convention, partial last divisor groups, A/B/A restoration after native state
poisoning, retained resource name reuse, later-task schedules and cancellation.

Prove both triangle and strip calls, an actually fetched u32 index above 65535,
and exact total-work-budget admission followed by one-above rejection.

A too-short per-instance buffer, final actual vertex fetch, partial index extent,
index-size alignment, host max-element-index and total draw work must fail
before native draw. False min/max hints must neither accept an out-of-bounds
fetch nor reject a valid actual fetch. Malformed tail rejects whole snapshot.
A real native divisor/fetch corruption must fail its named pixel oracle.

Carry unchanged D5 compiler/constants/samplers/ownership proofs. Run the directly
affected old decoder/draw/async/float paths once and the new gate at frozen head;
record one pristine exact-head clone, seal original packet/index/vertex bytes,
GPU calls, native bindings, pixels, sources/coverage and fences, then submit to a
fresh adversarial critic. This isolated factory is not demo reachable yet.

## Adversarial verification

Predict actual per-vertex/per-instance byte ends and native divisor/ID pixels
before inspection. Invent one bounded independently seeded mix of differing
attribute divisors and wide indices, and one exact-end/one-byte-short countercase.
Attack forged wire range hints, large multiplication, stale index revision,
resource generations, divisor restoration and cancellation while GPU index
read is pending. Distinguish real native observations from proxy assumptions;
sabotage the promoted pixel oracle once. Hold each changed hunk against recorded
execution or a narrow waiver. Do not add full API/guest boot/performance criteria
before the subsequent qualification boundary.

## Verification log

### 2026-10-10 — worker — recorded bounded standard draw claim

Frozen runtime and acceptance head:
`c9963d71add68b550d9f26a2b9e9d417f3daa437`; dependency/unchanged compiler,
constants, resources and cache authority:
`761a912a88823954e3424f7b003c15887e7c9034`.

Commands on the frozen tracked tree:

```sh
VIRGL_STANDARD_DRAW_EVIDENCE_DIR=target/evidence/virgl-standard-draw-final make verify-E6-T11d6
python3 tools/virgl-command/standard-draw-cold.py --output target/evidence/virgl-standard-draw-final-cold
python3 tools/virgl-command/standard-draw-seal.py target/evidence/virgl-standard-draw-final target/evidence/virgl-standard-draw-final-cold evidence/virgl-standard-draw/worker
```

The final gate built the actual fixed16MiB Wasm compiler, checked JS/Python/shell
syntax and diff hygiene, predicted 80 original literal packets/160 standard and
legacy outcomes, and executed 37 headed hardware frames with 10,296 full-pixel
predictions on ANGLE Metal/Apple M4 Max. Real native bindings and GPU buffer bytes
match original owned inputs. Three later-task schedules exercise ordinary and
instanced arrays/elements, actual u32 index70003, all index widths, divisors0/1/2/3/
65535/u32-max, attribute15, full A/B/A restoration after native poisoning, and
all active attributes per-instance. Wire count0 executes one ordinary instance.
The exact65,536-work case succeeds; one-above and cumulative overflow stop before
the failing native draw. Eleven negative bounds/sentinel/snapshot cases issue no
draw; three invalid native host limits reject at construction. Pending GPU index
reads cancel or reject changed content revisions without drawing, drain their
real fence, and release staging. Public name reuse retains and draws the original
resource generation. Cleanup returns every owned budget to zero. No browser
console/page/request errors were observed.

The independent offline literal packet model authenticates all original upload,
native buffer/index and complete pixel blobs, recomputes per-instance/vertex
fetch ends and native call arguments, and checks the queried native divisors.
A served runtime mutation changes the actual IN1 divisor2 to1; its completed
`drawElementsInstanced` produces red149 instead of19 at x8,y0 in mixed-wide-0,
and the physical pixel oracle rejects with error130. This intended failure is
recorded, not substituted with a fake result. The directly affected old decoder,
draw, async and float gates pass once in each final hot/cold run. The pristine
clone uses a scrubbed environment, starts/ends clean, and executes the identical
acceptance at the exact frozen head.

Evidence of record:
`evidence/virgl-standard-draw/worker/{manifest.json,records.json,recording.tar.gz}`.
The deterministic archive contains752 records/2,615,399 packed bytes. SHA-256:

- Archive: `4a6c5816f8979dbf7e6ed75abd05bedf53073becae307e6a0d970d9c0382270b`.
- Record index: `6613d8d1075325f89a0cca63c78b0a65b73c138f629780b786d21dcad03d77dd`.
- Hot receipt: `9f106b441b5e7d31e3e9f01bb8fde545722ad2126362225dfd664085d8767abf`.
- Cold report: `1c024ba641e0972eff7e487b2feb11e6eca25b5cc921b119687ceb5b0b70d380`.
- Cold receipt: `4936409d84709204d6c828be3e628c5f752d72e8686fc2c26716bbab3926e86c`.

Ephemeral originals: `target/evidence/virgl-standard-draw-final` and
`target/evidence/virgl-standard-draw-final-cold`; pristine checkout:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-draw-cold-usyz1uze/wasm-vm`.

Claim scope is the isolated host-selected standard async vertex-fetch facet.
There is no production negotiation, actual guest execution, complete GLES/API,
frame-rate or MIPS claim. Existing compiler/constant/sampler/ownership results
carry only where their bytes and boundary are unchanged. A fresh critic must
attack this submission before the task can become verified.

### 2026-10-10 — fresh adversarial verifier — VERDICT: verified

Runtime/acceptance `c9963d71add68b550d9f26a2b9e9d417f3daa437` survives fresh
falsification and sufficiency review against worker claim `f7801621` and verified
D5 authority `761a912a88823954e3424f7b003c15887e7c9034`. P1–P12 were written before
opening evidence; every result is HELD. Complete predictions, points and scoped
hunk ledger: `evidence/virgl-standard-draw/verifier/{prediction-results.json,verdict.md,coverage-audit.json}`.

- Authentication/carry — HELD. Independently authenticate all 752 original
  records, hot/cold receipts and exact source closures. The final frozen-head
  pristine clone is clean before/after the identical gate, with scrubbed env.
  All 266 compiler/constants/cache/resources files and the complete native link
  body (including active-uniform completeness) equal D5; its critic seal digests
  authenticate and unchanged HELD results carry. See `authentication.json` and
  `carry-forward.json` inside the critic directory.
- Wire, fetch, calls and pixels — HELD. Independent Python literal parsing
  agrees on all 80 packets/160 standard/legacy outcomes and rederives all 37
  hardware frames/10,296 full pixels in each original hot/cold and fresh full
  replay. Original bytes match queried native buffers/indices. Native count0/1
  uses one ordinary instance; larger counts use native instanced calls. Actual
  u32 index70003, ends1120096/80/64, native IDs, triangle/strip, A/B/A divisors,
 65535/u32-max normalization and false hints hold. Points:
  `worker-hot-audit.jsonl:1–3,9,34`, `worker-cold-audit.jsonl:1` and
  `acceptance-replay-audit.jsonl:1` in the critic directory. Real native
  MAX_ELEMENT_INDEX=4294967294 is kept distinct from injected test limits.
- Bounds/work/stale/reuse/cancel — HELD. Exact 65,536 work admits; one-above
  and cumulative overflow reject before the failing draw. All final-byte,
  index alignment/extent, sentinel, host limit, signed dimension and malformed
  snapshot attacks hold; false safe hints never admit short storage. Pending
  real GPU index reads reject revision changes, cancel/drain, and preserve old
  generation after public name reuse; every read/staging allocation is released.
  Points: `worker-hot-audit.jsonl:35–54`.
- Bounded novel attack — HELD. Seed0xe47c2a91, seven instances, divisors0/3/5,
  u32 indices65557..65560 and active R32_FLOAT IN1 predict ends1049008/68/64 and
  28 work before submission. Three independently chosen schedules match every
  predicted pixel. Exact ends admit, one-byte-short vertex/R32-instance/index
  ranges and literal u32-max count/instances reject before draw. Pending reset
  rejects busy, then cancellation drains the real read and reset succeeds.
  Promoted normal run: four frames/2,240 full pixels, fifteen rejection cases;
  points `promoted-final/independent-audit.jsonl:1–20` inside the critic seal.
- Sabotage — HELD. Real served native divisor2=>1 completes
  drawElementsInstanced and its fence, then fails the promoted physical oracle:
  x10,y0 expected[102,23,58,176], observed[110,23,58,176], max error104. Point
  `promoted-final/independent-audit.jsonl:21`; original mutation independently
  holds at `worker-hot-audit.jsonl:55`. The initial exact calibration reached
  GL1282 before pixels and is retained but does not count as sabotage proof;
  padding only its backing produced the required completed wrong draw.
  Harness-only corrections are explicit in `harness-corrections.json`.
- COVERAGE — HELD. All 20 changed runtime hunks/41 added lines are accounted:
  37 executed, four structural/comment lines, zero semantic gaps. Exact UTF16
  source offsets, hashes and V8 counts are in `coverage-audit.json`; each other
  hunk has an execution or narrow declarative/custody/diagnostic ledger. The
  added harness router's default browser path also reproduces the original
  three A/B/A native records and pixel digests (`retained-routing-audit.json`).

SUITE: promote `make verify-E6-T11d6-adversarial` with the independent seeded
R32/wide-index exact/short cases, huge-work literals, pending reset/cancel,
completed native mutation and independent Python oracle. No production runtime
code changed. The final runtime already has its pristine proof; no unrelated
suite or second cold clone is required. The isolated factory grants no positive
production caps, actual guest execution, full GLES/API, demo deploy or FPS/MIPS.

Exact commands from `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`:

```sh
python3 evidence/virgl-standard-draw/verifier/authenticate.py
VIRGL_STANDARD_DRAW_EVIDENCE_DIR=target/evidence/virgl-standard-draw-critic-replay make verify-E6-T11d6
python3 tools/virgl-command/standard-draw-adversarial-audit.py evidence/virgl-standard-draw/verifier/unpacked/hot --output evidence/virgl-standard-draw/verifier/worker-hot-audit
python3 tools/virgl-command/standard-draw-adversarial-audit.py evidence/virgl-standard-draw/verifier/unpacked/cold --output evidence/virgl-standard-draw/verifier/worker-cold-audit
python3 tools/virgl-command/standard-draw-adversarial-audit.py target/evidence/virgl-standard-draw-critic-replay --output evidence/virgl-standard-draw/verifier/acceptance-replay-audit
NODE_V8_COVERAGE=evidence/virgl-standard-draw/verifier/node-coverage node tools/verify-virgl-standard-draw.mjs --output evidence/virgl-standard-draw/verifier/node-wire --node-only true
VIRGL_STANDARD_DRAW_ADVERSARIAL_EVIDENCE_DIR=evidence/virgl-standard-draw/verifier/promoted-final make verify-E6-T11d6-adversarial
node tools/verify-virgl-standard-draw.mjs --output evidence/virgl-standard-draw/verifier/retained-routing --smoke true
python3 evidence/virgl-standard-draw/verifier/coverage_audit.py
python3 evidence/virgl-standard-draw/verifier/seal.py --verify
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Fresh critic seal: `evidence/virgl-standard-draw/verifier/{manifest.json,records.json,recording.tar.gz}`.
680 members, 2,161,812 archive bytes; SHA-256
archive `a0da501deed127a1f9359c2ce511606efd15135a65d6e8338d84f97a5fb05905`,
index `775ab1789688128b44ff3e6e3933509e67404d32eb39b4e290ed2ffb7f91b1ef`.
Original worker and carried D5 seals retain their separate authenticated digests.
