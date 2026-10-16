---
id: E6-T11d7
epic: 6
title: Fetch standard zero-stride attributes through owned GPU jobs
priority: 525.0270391
status: verified
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

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

Reviewed the whole task and scoped `67220bb5..c63127a4` diff before original
inspection. Falsifiable predictions P1–P10 were written first in
`evidence/virgl-standard-constant/verifier/predictions.json` (SHA-256
`0d221b9ae82d3b3edf2b1042e5b9e034b08be011cbbe8ac978c776844659c438`).
This critic did not implement the slice or edit runtime code. All predictions
HELD; no semantic refutation or evidence gap remains.

- P1–P4 bytes/defaults/native restoration/bounds — HELD. Independent literal-wire,
  upload, GPU-source and raster audit checks both complete originals:62 frames and
  25,000 full pixels. The four original constants are at32/56/88/128 with full
  ends36/64/100/144; their original words and missing lanes match native generic
  queries. Constants ignore positive/u32-max divisors, mixed arrays retain their
  own divisor, all16 arrays are disabled, native IDs remain location-1, and wide
  unsigned IDs are taken from original index bytes. All exact-end, three schedule,
  count0/1/positive-instance, A/B/A, aggregate56/55 and four short-record outcomes
  hold. Point: worker seal `cold/hardware/report.json:52116`,
  `/browserResult/result/frames/0`, SHA-256
  `2f124323ec283c3bb1edfe76c967d17fb25731ca07b5f4892adba8b3dbbe44af`;
  all frame/byte citations are in `original-audit.json` and `citations.json`.
- P5–P7 retained lifetime/cleanup/scheduling — HELD. Original cancellation,
  collected-revision, name reuse, CPU-only backing mutation, busy reset,
  partial real allocation, store and renderer disposal all retain/drain or
  explicitly invalidate their whole batch with zero remaining reads/staging.
  Real syncs poll at most once per later task, no finish/blocking poll, and every
  fence is deleted. The novel seed `0xa17c9e53` splits active widths
  `[2,4,1,3,4]` across GPU resources3..7, uses offsets36/44/40/12/48 and
  unsigned indices `0xb4d40000..0xb4d40003`. With five distinct native sources,
  only resource3 is uploaded after its8-byte record is collected while the
  other4 remain pending. Direct GPU readback authenticates the changed bytes;
  the job rejects `stale-storage`, never draws, drains all5 and completes its
  fence. This distinguishes the earlier-ticket recheck from stale later reads.
  Point: critic seal `physical/hardware/report.json:64337`,
  `/browserResult/result/suspensions/0`, SHA-256
  `ac8eff480807d1d636f1bcc61a9fee00bfe6c2c36d794ee3857cca4590c5b4f4`.
- P8 native sabotage — HELD. Both original generic mutations complete physical
  draws/fences then fail the independent raw-byte raster audit. The promoted
  oracle is sabotaged once through the actual served native `vertexAttrib4fv`
  site: drawElementsInstanced and its fence complete; at(0,0)
  expected[48,42,31,104] becomes[99,42,31,104], error51. The named
  `critic-seeded-exact promoted independent pixel oracle` rejects. This is a
  completed wrong-pixel draw, with no pre-draw GL-error substitute. Point:
  critic seal `physical/fault-generic/report.json:1492`, `/partial/frames/0`,
  SHA-256 `4e7745d6dddc73b7b4b0254ee863495ab8d2fcce823f755150f72919b39a6191`.
- P9 source/environment custody — HELD. All1123 worker archive/index members,
 350 original input/GPU/pixel blobs, served closures, precise coverage, screenshots,
  generated compiler artifacts and nested receipts authenticate. The original
  hot6b3f041d reports and failed receipt diagnostics remain intact; the repair
  changes only the receipt harness, and its physical closure equals the final
  cold39a9d14b bytes. Final exact-head cold acceptance exits0 and is pristine
  before/after with scrubbed env. Carry268 byte-identical compiler/decoder/
  resources/cache/constant-domain/native-link boundaries and the original full
  D6 plus four affected legacy gates. No second cold clone or unrelated workspace
  re-litigation is required by the incremental policy.
- P10 sufficiency — HELD. Authenticated original hardware and retained-D6 V8
  coverage reaches all74 added/changed runtime lines and every alphanumeric token
  in the diff. Every runtime hunk is exercised; no unexecuted runtime hunk remains.
  Harness/metadata/documentation classifications and custody are explicit in
  `coverage-audit.json` and `source-scope.json`. The critic added only promoted
  tests/oracles, narrow runner selection, gate metadata and these audit artifacts.

SUITE: promote `standard-constant-attributes-adversarial.mjs`, its independent
literal-wire/native-byte/full-pixel oracle and
`make verify-E6-T11d7-adversarial`. The final promoted gate records6 novel physical
frames plus3 unchanged default-route frames/5,700 full pixels, repeats every
bounded lifetime attack, and rejects its completed generic sabotage. Actual
headed Chrome/Metal M4 Max, fixed16 MiB compiler, zero console/page/request
errors; screenshot and precise coverage are sealed. Original D5/D6 HELD boundaries
carry only with their authenticated unchanged dependency bytes/digests.

Commands (all in `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`):

```sh
python3 evidence/virgl-standard-constant/verifier/authenticate.py
python3 evidence/virgl-standard-constant/verifier/audit_originals.py
python3 evidence/virgl-standard-constant/verifier/audit_coverage.py
VIRGL_STANDARD_CONSTANT_ADVERSARIAL_EVIDENCE_DIR=target/evidence/virgl-standard-constant-critic-final make verify-E6-T11d7-adversarial
node tools/virgl-command/standard-constant-adversarial-pixels.mjs target/evidence/virgl-standard-constant-critic-final
python3 evidence/virgl-standard-constant/verifier/seal_critic.py
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Critic evidence of record:
`evidence/virgl-standard-constant/verifier/{manifest.json,records.json,recording.tar.gz}`,
182 records/563,074 packed bytes. Archive SHA-256
`0e7c1966aba67f0276d371a2414f065c0396d65088310b253e54a6857911d231`;
index `d6d452707e41890f5a1726f8b66d7a956dd6a5caa69fa22dcfd70a0e45a1c6ba`;
final physical audit `8cadc4535b87c5af147d5c180eadf753aa72f63a20a750da74afdf169f761ffe`.
Worker submission `c63127a4954b6c61d23b2595149d8ab20116fdc6` and unchanged runtime
state SHA-256 `dd2049d9d27e591b0ad63ecd30fedcdcf8ae09e7b754d81b769a81497c7d7671`
remain the reviewed implementation. Scope is only the isolated standard async
constant-attribute fetch and owned-batch lifetime. This verdict grants no guest,
API, FPS/MIPS, production capability or live-deployment authority.

Promotion custody refinement: the recurring offline gate authenticates each
recording against its captured current source closure; the historical D7 runtime
freeze is confined to this critic's authentication and seal. Removing that
future-blocking harness assertion changes no runtime, original recording or
pixel result. The touched Node syntax and offline audit pass again; sealed
physical-audit digest remains unchanged. Incremental harness-only policy applies.
