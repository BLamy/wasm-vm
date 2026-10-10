---
id: E6-T11d8
epic: 6
title: Execute bounded standard core line and triangle-fan draws
priority: 525.02703901
status: implemented
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

