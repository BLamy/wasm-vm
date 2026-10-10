---
id: E6-T11d7
epic: 6
title: Fetch standard zero-stride attributes through owned GPU jobs
priority: 525.0270391
status: implemented
depends_on: [E6-T11d6]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the explicit standard async vertex-fetch facet with Gallium constant
attributes (vertex buffer stride zero). Fetch one R32/RG32/RGB32/RGBA32_FLOAT
record at buffer offset plus element source offset from actual retained GPU
storage. Set the native generic attribute and disable its array, preserving
missing lane defaults 0,0,0,1. A constant record remains constant for every
vertex and instance, regardless of its wire divisor. Restore generic values and
array enablement on every draw/context switch. Do not use CPU backing as the
fetch oracle or evaluate guest shaders on the CPU. Legacy factories still
reject active zero stride; nonzero fetch and D6 calls/budgets retain their boundary.

Batch the bounded constant reads and optional index read under existing opaque
storage tickets. A maximum of 16 active attributes plus one index read is allowed;
prove aggregate staging bytes against the existing job limit before beginning.
All tickets retain their resource generation/content revision until final draw,
and all are validated in the same task immediately before the native draw.
If an earlier collected source changes while another read is pending, reject.
Cancel, allocation-limit failure, reset/disposal and stale state must drain or
explicitly invalidate every read and release all staging/retained ownership.
Keep zero-timeout, once-per-later-task fence polls and no synchronous finish/read
escape. Record original component words, full byte end, resource identity and
native generic values/array state in bounded deterministic draw records.

No new primitive/restart/format/shader/storage/device/API authority is granted.
The standard facet remains isolated from production negotiation and the demo.

## Deterministic acceptance

`make verify-E6-T11d7` executes the actual fixed 16 MiB compiler and headed hardware
queued draws. Independently predict original GPU input bytes, float lane defaults,
native generic values and full pixels for all four component widths, nonzero
buffer and element offsets, mixed ordinary/constant/instanced attributes,
arrays/indexed wide indices, and a draw with every active attribute disabled.
Exercise zero/large/u32-max divisors, wire count0/1 and positive instances, A/B/A
restoration after native generic/divisor/array poisoning, and at least three
bounded later-task schedules.

Prove exact-end acceptance/one-byte-short rejection, staging-budget admission
and one-byte-below rejection before native draw. Change actual GPU source content
after one read is collected but another remains pending: the final draw must
reject and every fence drain. Cancel a multi-read job; retire/reuse a public
constant-buffer name; force bounded ticket exhaustion after a first real GPU
copy. Validate cleanup and no pending reads/staging. Mutating CPU backing without
GPU upload must not change constant values. A real native generic-value mutation
must fail its named independent pixel oracle.

Carry unchanged compiler/constants/sampler/resource/cache proof. Run the affected
legacy async gate and the retained full D6 standard draw gate once at the frozen
head, then the new acceptance in one final pristine exact-head clone. Seal original
packets, inputs, physical read snapshots, generic/array queries, full pixels,
native calls/fences, source identities and coverage. A fresh critic alone may
verify. No guest/API/performance or live-deployment claim follows from this slice.

## Adversarial verification

Predict first/last byte and generic missing-lane defaults before inspection.
Invent one independently seeded bounded mix with differing component widths,
constant offsets and actual wide indices, plus an exact-end/one-byte-short
countercase. Attack an already-collected source while a different read is pending,
resource name reuse, cancellation and partial read-allocation failure. Poison
native generic values/arrays/divisors across A/B/A and sabotage the promoted
pixel oracle once. Hold every changed hunk against recording or narrow waiver;
carry unrelated HELD boundaries forward without re-litigation.

## Verification log

### 2026-10-10 — worker — implemented; awaiting fresh critic

Runtime/physical fixtures freeze at `6b3f041dfb9715d938382d5fdbe89eb7f7a2431a`.
Final custody/acceptance freeze is `39a9d14b7052c60ca11416bdba4e6eb78a38b1dd`; the only intervening
file is `tools/virgl-command/standard-constant-receipt.py`. Original physical
closures and recording heads remain explicit, byte-identical and authenticated.
The final pristine exact-head clone executes the complete default gate and ends
clean. This is an isolated JS renderer slice: native Rust/device, compiler,
decoder, storage, cache and native link/uniform ownership bytes are unchanged.
The selected high-risk gate is syntax/diff custody, the actual fixed-memory Wasm
compiler build, physical native draws/bytes/pixels, repeated deterministic later
task schedules and lifetime attacks, retained complete D6/affected legacy gates,
and one final pristine exact-head run. No unrelated Rust/workspace suite is
substituted for this physical acceptance, and no demo device is changed.

Exact commands from `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`:

```sh
VIRGL_STANDARD_CONSTANT_EVIDENCE_DIR=target/evidence/virgl-standard-constant-final make verify-E6-T11d7
python3 -m py_compile tools/virgl-command/standard-constant-receipt.py
python3 tools/virgl-command/standard-constant-receipt.py target/evidence/virgl-standard-constant-final
python3 tools/virgl-command/standard-constant-cold.py --output target/evidence/virgl-standard-constant-frozen-cold
python3 tools/virgl-command/standard-constant-seal.py target/evidence/virgl-standard-constant-final target/evidence/virgl-standard-constant-frozen-cold evidence/virgl-standard-constant/worker
```

The initial hot gate's physical tests all pass, but its custody check counts
native `gl_InstanceID`/`gl_VertexID` entries (location -1) among the sixteen
attribute slots. It rejects after the completed-runtime marker. The repair
counts only located attributes and preserves the original failure diagnostics;
it checks both recorded and final source closures rather than rewriting any
packet, source, state or pixels. `hot/harness-only-repair.json` records this
harness-only repair; the original log stays in the seal. Narrow custody rechecks
pass, unchanged HELD runtime/retained runs carry. An earlier clean checkout at
`bab5d931` was diagnostic and is not the final exact-head proof. The authoritative
final clone at `39a9d14b7052c60ca11416bdba4e6eb78a38b1dd` runs the default complete gate successfully.

Both final original closures demonstrate31 physical frames/12,500 full pixels,
all four component widths/missing lanes, nonzero buffer+element offsets,
constant/array/instance mixtures, ordinary count0/1 and positive instances,
byte/short/u32 high indices, all sixteen generic attributes with arrays disabled,
and A/B/A restoration after generic/array/divisor poison under three later-task
schedules. Four exact-final-byte records admit; four one-byte-short records,
aggregate staging one byte below56, partial real ticket allocation, and legacy
zero stride reject before draw (seven negative cases). Exact56 bytes admits.
Native GPU snapshots equal the original uploads. CPU backing mutation does not
alter constant values. Public buffer name reuse retains the original generation.

All four constant tickets plus the index ticket remain owned after collection.
One real constant is collected while four later reads remain delayed; an actual
GPU source upload then causes stale-storage before draw and every read drains.
Cancellation and reset-while-busy followed by cancellation drain the whole batch.
A one-ticket store performs its first actual GPU copy before its second allocation
fails, drains it, and issues the completion fence. Store disposal and renderer
disposal explicitly invalidate all five tickets without claiming completion.
Every final read/staging/ownership budget is zero. No finish or blocking poll is
used and each native sync poll occurs once per later host task.

A served actual `vertexAttrib4fv` mutation adds0.5 to the native X value. It
completes drawElementsInstanced and its fence; at x0,y0 expected[57,61,21,116]
becomes[121,61,21,116] (error64). Its named independent full-pixel oracle rejects.
The offline original-byte/native-generic oracle independently repeats all31
frames/12,500 pixels and this intended failure. Each retained full D6 gate
passes37 frames/10,296 pixels,80 literal packet cases, its real native divisor
mutation, and the four directly affected old decoder/draw/async/float gates.

Evidence of record:
`evidence/virgl-standard-constant/worker/{manifest.json,records.json,recording.tar.gz}`.
The deterministic archive contains1123 records/4,224,807 packed bytes.
SHA-256:

- Archive: `598acb64caacea419f099a5fc1bb25fe763c4ce8dfb3eb8c0a76126acea28aca`.
- Record index: `36217166ebf678e6dd701ec7ec66f042891963be7638dc2c77a920903694d65a`.
- Hot receipt: `165c29196418fc6dc9f64e7367f39852da1103cfad31b004d4c6db71ce794f6e`.
- Cold report: `112b203cfe4848075fa9704ed6fb6a5b17d9a6373b2fbec3f02dccf7067838d0`.
- Cold receipt: `a37b11e92e561d2575df2cba7f39a7c4b0dd80e91357f7ebfbc630faec25dcf1`.

Ephemeral originals: `target/evidence/virgl-standard-constant-final` and
`target/evidence/virgl-standard-constant-frozen-cold`. Final pristine checkout:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-constant-cold-ndlapq7h/wasm-vm`.
Scope is the isolated host-selected standard async vertex fetch and owned batch
lifetime. It grants no positive production capabilities, complete API, actual
guest rendering, FPS/MIPS or demo deployment. A fresh adversarial critic alone
may verify; prior HELD results carry only where code, dependencies and digests
are unchanged.

