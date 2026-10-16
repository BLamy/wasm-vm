---
id: E6-T11d8
epic: 6
title: Execute bounded standard core line and triangle-fan draws
priority: 525.02703901
status: verified
depends_on: [E6-T11d7]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the host-selected standard async draw facet with ordinary Gallium
LINES, LINE_LOOP, LINE_STRIP and TRIANGLE_FAN (modes1,2,3,6). Select their matching
native WebGL2 primitive for all four existing ordinary/instanced array/index
entry points. Preserve actual-index fetch bounds, native IDs, constant/instance
attributes, aggregate work limits, delayed GPU reads and retained ownership.
Unsupported points/point size, quads/adjacency/patches, restart and base offsets
remain explicit errors. Legacy factories still admit only their triangles/strips.
This slice changes no shader, texture, resource, state or production capability
qualification. Native line width remains the existing one-pixel state.

## Deterministic acceptance

`make verify-E6-T11d8` binds literal independently mapped Gallium mode fields and
actual headed native hardware calls. Independently predict complete physical
pixels for axis-aligned one-pixel segments, open/closed loops, strips and a
triangle fan, using original input bytes and source geometry. Interior line pixels are
strict; fragment-center endpoints admit the GLES3 section3.5 bounded native
half-open alternatives, declared before comparison. No loop-edge interior or
fan-area pixel is waived by those endpoint alternatives. Include arrays,
byte/short/u32 wide indices, zero/one/positive instance counts, constant color
records, instance-fed values, nonzero binding offsets and three bounded schedules.
Make each native primitive distinguishable from the others: assert the loop's
closing segment and a fan region that the same vertices in strip order omit.

Prove incomplete primitive tails retain native no-geometry behavior while fetch
bounds/work budgets remain conservative; exact-end ranges admit and one byte
short rejects before draw. Exercise false min/max hints, stale pending index,
constant read cancellation/name reuse and A/B/A restoration through the already
verified ownership boundary. A served actual-mode corruption must complete the
native draw/fence and fail the named full-pixel oracle. Retain the full D6 gate (including affected legacy boundaries) and D7 physical
acceptance plus its actual generic sabotage and offline pixel audit once at the
frozen head. The D7 historical receipt pins an unchanged decoder, so authenticate
its original carry evidence without rewriting that receipt for this new mode
extension. Carry unchanged compiler, resource, cache and other state evidence,
then run one final pristine exact-head clone. Seal original wire/input/native state/pixels and per-hunk coverage.
A fresh critic alone may verify. No complete API, guest, production capset,
frame-rate, MIPS or demo deployment follows from the isolated facet.

## Adversarial verification

Predict the exact primitive and closing/fan coverage before inspecting evidence.
Invent one bounded seed with offset/wide-index geometry and another native
schedule. Attack exact end, short fetch, malformed mode packets, mode restoration,
work limits and delayed source lifetime. Sabotage the promoted mode oracle once.
Classify every changed hunk with recording or narrow waiver, and carry unrelated
HELD boundaries without re-litigation.

## Verification log

### 2026-10-10 — worker — implemented; awaiting fresh critic

The final runtime/harness freeze is `dff28ee8cb1c494a52a6fbb5af872ed377605f66`. Native Rust/device,
compiler, constant-domain, resource/cache ownership, native link/uniform bodies
and all preceding shader semantics are unchanged. The selected high-risk gate
is syntax/diff custody, the actual fixed16MiB Wasm compiler build, literal Node
and headed-browser mode/hostile packets, hardware bytes/calls/pixels, three
later-task schedules and lifetime attacks, the retained full D6/four legacy
gates, retained D7 physical/generic sabotage/audit, and one final pristine
exact-head clone. No unrelated Rust/workspace gate is substituted for these
physical checks. The isolated factory has no production demo import or device
negotiation change, so production web/dist and deployment remain in E6-T11d.

Exact commands from `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`:

```sh
VIRGL_STANDARD_TOPOLOGY_EVIDENCE_DIR=target/evidence/virgl-standard-topology-final make verify-E6-T11d8
python3 tools/virgl-command/standard-topology-cold.py --output target/evidence/virgl-standard-topology-final-cold
python3 tools/virgl-command/standard-topology-seal.py target/evidence/virgl-standard-topology-final target/evidence/virgl-standard-topology-final-cold evidence/virgl-standard-topology/worker
```

Both complete gates pass at the frozen head. Each proves87 physical frames and
50,176 full pixels; the literal Node and browser matrix each holds79 mode,
legacy, unsupported-field and malformed-tail packets. Array/index ordinary and
instanced native calls cover all four new primitives, u8/u16/wide-u32 storage,
zero/one/positive instances, original nonzero offsets and false zero min/max
hints. All vertex, constant and instance source bytes are independently compared
with actual retained GPU buffers. Every incomplete tail is bounded and charged:
mode1 count5 accepts its exact final record and rejects a one-byte-short unused
last vertex. Twelve short-tail/index and work-budget failures issue no draw.
A/B/A native state poisoning, queued index revision/cancellation and constant
name reuse preserve ownership, completion and cleanup. All87 frame predictions
are regenerated offline from authenticated original uploads and literal packets.

GLES3 section3.5 allows bounded native line-raster alternatives. Before comparing
physical results, the oracle declares only fragment-center endpoint presence
alternatives; all line interiors/outside pixels, the closing loop-edge interior
and the fan area remain strict. Native indexed/array pipelines differ at an
endpoint in self-validation, which changes no runtime or positive capability.
The three-vertex loop tail fixture is collinear, keeping its independent line
model explicitly axis aligned. No observed pixels become expected input.

The served actual native selection sabotage replaces LINE_LOOP with LINE_STRIP.
It completes `drawElementsInstanced` and its final real fence, then fails
`mode-2-wide-instanced-0 independent topology pixel oracle`: at pixel(2,3),
expected[85,56,51,128], observed[0,0,0,0],error128. Original/mutated source hashes,
all original packets, GPU uploads/buffers, native calls/array/generic state,
full pixels, fence events, exact-bound failures and V8 runtime coverage are
sealed. Retained D6 and D7 native sabotages also fail their original named
pixel oracles. Historical D7 decoder custody is authenticated and carried;
its original receipt is never rewritten for this new decoder admission.

Evidence of record:

- `evidence/virgl-standard-topology/worker/manifest.json`
- `evidence/virgl-standard-topology/worker/records.json`
- `evidence/virgl-standard-topology/worker/recording.tar.gz`
- 2716 authenticated records; archive7,148,693 bytes.
- Archive SHA256 `c192468202cec8d341e6074cc241d19d699cde78d58e7361b2e09d58da1ba8cf`.
- Record index SHA256 `387bbf495d4e22e397636147874974a08c01f7ffe0dee6828be8ddd1e637c8af`.
- Hot receipt SHA256 `be4ec4d73db916f827c3df748e2790f2efb6dd7742814b0ba7418f7c8e27fb32`.
- Cold report SHA256 `688211b47d03b0d6e1076655fdeb2efd92455697de4942a4cc0d2749bf43abff`.
- Cold receipt SHA256 `f7a52a5e7c72b9ae3653b5d7dd45d6344144269797da1ec83afca65d36a6e8f7`.
- Cold checkout: `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-topology-cold-_7wh_il7/wasm-vm`;
  source-head identity, scrubbed environment and clean before/after are sealed.

This claims only bounded standard core primitive assembly with unchanged fetch
and job ownership. It grants no points, restart, other formats/state/storage,
production capsets, full GLES/API, actual guest graphics, demo deployment or
MIPS/FPS. Only a fresh critic may set `verified`.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

Read AGENTS.md, the full task and scoped `64b24622..2d1303bf` diff before evidence
inspection. Predictions P1–P8 were written first in
`evidence/virgl-standard-topology/verifier/predictions.json`, SHA-256
`f5fc51d22dad4a8c1069cb2e7f108630c341bbc54831fcbc55ce0ea317887f33`.
This fresh critic did not implement or edit the runtime. Every prediction HELD;
no semantic refutation or evidence gap remains.

- P1 custody — HELD. All 2716 unique safe worker archive members, 24 reports,
  2626 physical blobs, 347 frozen source bindings, generated compiler artifacts,
  served closures, coverage and screenshots authenticate. Hot/cold receipts bind
  `dff28ee8`; final pristine acceptance exits 0, scrubs the named environment and
  is clean before/after. Point: worker seal `cold/report.json:1`, SHA-256
  `688211b47d03b0d6e1076655fdeb2efd92455697de4942a4cc0d2749bf43abff`.
  `authentication.json` records every digest and the sole current Makefile
  extension, a declarative promoted verifier target.
- P2 literal admission/native modes — HELD. The independent literal parser
  classifies 316 hot/cold Node/browser packet records. Standard admits modes 1..6;
  legacy admits modes 4/5 with one instance. Unsupported fields/modes and malformed
  tails expose no decoded prefix. All four native call families select the
  expected mode. Point: worker seal `hot/hardware/report.json:102416`,
  `/browserResult/result/frames/5`, SHA-256
  `8680cd502d31396c727860904807abc55907f56467f2db6a147d489bb60dc4ec`;
  actual `drawElementsInstanced(2,4,5125,12,4)`.
- P3 physical primitives — HELD. The fresh model imports no runtime or worker
  oracle. Original uploads, literal packets and source shader math predict all
  174 frames/100,352 full pixels. Only declared line endpoints and single outer
  fan boundaries admit color/clear; 99,142 pixels are strict. Loop closing (2,3)
  requires [85,56,51,128]; fan (3,10) requires the same color in a region strip order
  omits. Points: worker seal `hot/hardware/report.json:102416` and `:117093`,
  report digest above; pixel digests
  `737559f8b1faa56d11a438091a13ec216eb60696ba33d8ef5b2ef468b831a864` and
  `ae7358a6067e2f8b7c4bc146d11c08c64de3d10d67b24fc4395b5f2e6d619f42`.
  [GLES3 sections2.7.1/3.5](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)
  support the primitive/raster scope; no closing-edge interior or fan area is
  waived.
- P4 fetch/work — HELD. Independent actual u8/u16/wide-u32 reads override false
  zero hints. All GPU buffers equal original uploads; byte extents, generic
  words/divisors, zero/one/positive instances and incomplete counts 1/2/3/5 agree.
  All 24 hot/cold short-tail/index and 8-versus-7 rejections occur before draw.
  LINES count 5 charges and bounds its unused high vertex. Points: worker seal
  `hot/hardware/report.json:175122`, `/browserResult/result/frames/69`, and
  `:358088` short-tail rejection, same report digest above. All extents are in
  `original-audit.json`, SHA-256
  `0e1beee2d1dc73f290f53e6e099a98f792b910f5d27f6438e2a70c6813e6b3cc`.
- P5 state/lifetime — HELD. A/B/A restores mode and pixels after native poisoning.
  Pending constant/index batches retain two tickets: real index revision rejects
  stale-storage, cancellation rejects cancelled, public-name reuse draws using
  the original generation. All fences poll on later tasks and are deleted;
  reads/staging drain to 0. Points: worker seal `hot/hardware/report.json:155135`
  restored A, `:383298` stale and `:385092` cancellation, same digest above;
  `original-audit.json` `/lifetimes/0..5` authenticates the batch outcomes.
- P6 sensitivity — HELD. Both original real mode mutations complete draw/fence
  and fail independent strict closing coverage. The promoted oracle is sabotaged
  once at the served selector: `drawElementsInstanced(3,4,5125,28,4)` and 3 real
  signaled/deleted fences complete, then (3,4) expects [33,43,35,128], observes
  [0,0,0,0], error 128. The named `critic-mode-2-wide promoted independent topology
  pixel oracle` rejects. Point: critic seal `physical/fault-mode/report.json:1276`,
  `/partial/frames/0`, SHA-256
  `a0becb6871704572f356b8878f628217c64fed6bd140f2ea79706f7f41083f9f`.
- P7 coverage/carry — HELD. Frozen V8 coverage executes every changed runtime
  token: decoder lines 363/365 (263 hits), state line 20 initialization (1), selector line 936 (114).
  Every hunk is executed or narrowly classified in `coverage-audit.json`, SHA-256
  `34796c8f10a18cbab4c6228c1a00832729b2d278b92342522a165c996d1703ee`.
  Unchanged compiler/resource/cache/constant-domain sources and original D7
  worker/critic archives authenticate against `64b24622`. Full D6 (37 frames/
  10,296 pixels, four legacy gates, divisor sabotage) and D7 (31 frames/12,500
  pixels, generic sabotage, offline audit) remain proven per hot/cold run.
  Historical D7 decoder custody is carried without rewriting its receipt. No
  portability/isolation finding requires another cold clone or unrelated gate.
- P8 bounded novel attack — HELD. Seed `0x25df967b` uses nonmonotonic u32 IDs
  [82186,82178,82182,82180], unused high tail 82194, binding/source prefixes 52/56/48,
  index offset 28, rectangle 3.5..12.5 (fan 3..12), per-fence delays 1..6 and command
  step 2. All primitive/call families, byte/short indices, incomplete tails,
  exact/short/work limits, malformed atomic tails, nonempty/indexed-start errors,
  A/B/A and stale/cancel/reuse/CPU-only backing outcomes hold. Native line width 1,
  viewport, scissor and color writes are queried directly. Point: critic seal
  `physical/hardware/report.json:74296`, `/browserResult/result/frames/0`, SHA-256
  `d4f8c5baeb0e6c85ccdcb02cede1c506832b2fa2251864a529e7a950ef85470f`.

SUITE: promote `standard-core-topologies-adversarial.mjs`, its independent
literal-wire/byte/raster model, offline capture audit and
`make verify-E6-T11d8-adversarial`. Final promoted acceptance passes 44 physical
frames/24,576 pixels, 70 independently classified Node and browser records,
24 rejection jobs and 4 delayed lifetime cases. Its completed real mode sabotage
fails. Headed Chrome 155/Metal M4 Max has a nonempty hardware identity, actual
fixed16 MiB compiler, zero console/page/request errors and GL_NO_ERROR for every
draw/capture/cleanup. Screenshots, native fence/state events and coverage are
sealed.

Commands in `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`:

```sh
python3 evidence/virgl-standard-topology/verifier/authenticate.py
node evidence/virgl-standard-topology/verifier/audit_originals.mjs
python3 evidence/virgl-standard-topology/verifier/audit_coverage.py
VIRGL_STANDARD_TOPOLOGY_ADVERSARIAL_EVIDENCE_DIR=target/evidence/virgl-standard-topology-critic-final make verify-E6-T11d8-adversarial
python3 evidence/virgl-standard-topology/verifier/write_verdict.py
python3 evidence/virgl-standard-topology/verifier/seal_critic.py
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Fresh evidence: `evidence/virgl-standard-topology/verifier/{manifest.json,records.json,recording.tar.gz,verdict.json}`;
498 records, 1,339,524 archive bytes, SHA-256
`2a7eaca7ad6b474ca29dc7d4977ec97507d69ec5c9d9a61b26b89c930e6fdd24`,
index `d5daecd5bd4d655978b0e7925d9e2e5cc08fb8fce46676d3a39291473a700c12`.

Only isolated bounded standard core primitive assembly is verified. Guest
graphics, complete API/capsets, production negotiation/deployment and FPS/MIPS
remain later acceptance boundaries. Runtime and worker evidence are unchanged.
