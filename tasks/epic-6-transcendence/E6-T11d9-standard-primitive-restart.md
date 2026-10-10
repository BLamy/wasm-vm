---
id: E6-T11d9
epic: 6
title: Normalize owned standard index streams for primitive restart
priority: 525.027039001
status: implemented
depends_on: [E6-T11d8]
estimate: S
risk: high
capstone: false
---

## Boundary

One standard async indexed-primitive boundary: accept explicit indexed restart
and preserve disabled restart even when an original u8/u16 vertex equals its
native fixed sentinel. Parse original owned GPU index bytes; exclude only the
wire restart value when enabled, map it to native u32 fixed restart, and widen
other original indices without changing native vertex IDs. Preserve native
limits, all original fetch bounds/work budgets, generics/divisors, offset sums
and complete-batch revalidation before the real draw. Do not execute shaders
on the CPU. Legacy factories still reject restart and their original sentinel.
Reject nonindexed restart, unsupported base offsets and out-of-native-limit
nonrestart indices. No new primitive, shader, vertex/storage format, production
capability or API authority.

A bounded private native u32 index buffer is allowed only when required. Own it
through the job's final completion/drain or explicit disposal and release it
on every failure. Total normalized index bytes per job are <=4 times the
existing total source-index work budget (<=262144), with <=64 buffers and one
job. Account CPU and GPU scratch explicitly. Retained source resource identity
and original offsets remain distinct from native normalized offset0/typeu32.
Already compatible original streams should preserve the existing native path.
Zero valid indices (all restart) produce no pixels, preserve charged source
work, and use explicit no-vertex bounds/reporting. Do not confuse restart words
with actual maximum vertices or trust min/max hints.

## Deterministic acceptance

`make verify-E6-T11d9` runs literal original flags/index sizes in Node and the
headed hardware browser. Independently reconstruct actual GPU source and any
normalized GPU buffers, native modes/types/offsets/vertex IDs and full pixels. The independent original
position record carries an exact ID tag; a native shader comparison guards clip W.
Use constant per-instance flat colors so the index proof does not grant a
separate provoking-vertex qualification. Binary instance tile spacing keeps
triangle boundaries independent of subpixel quantization.
Cover each supported line/triangle mode, enabled native/custom restart values,
u8/u16/u32 originals, ordinary/instanced draws, leading/trailing/repeated/all
restart, incomplete segments and high actual nonrestart vertices. Disabled
restart must render u8 vertex255 and u16 vertex65535 instead of dropping them.
All-restart and degenerate segments produce no geometry while budgets remain
conservative. Include mixed generic/instance attributes and three schedules.

Prove exact normalized byte/work limits and tightening/short bounds; reject
out-of-native-range real vertices and invalid nonindexed flags before draw.
Change/cancel/reuse original source while reads are pending, poison native
index bindings and restore A/B/A, force partial native normalization allocation
failure and dispose with pending ownership. All read and native scratch budgets
return to zero. An actual served restart mapping/type mutation completes its
GPU draw/fence and fails the independent primitive pixel oracle. Authenticate
unchanged D7/D8/D6 carry under incremental policy; rerun only their directly
affected physical boundaries once at freeze, then one final pristine exact-head
clone. Seal original wire/upload/physical GPU-normalized bytes/native calls,
full pixels and hunk coverage. A fresh critic alone may verify; no production,
complete GLES/API, actual guest or performance claim follows.

## Adversarial verification

Predict original versus normalized values and per-segment geometry first.
Invent one independently seeded custom restart with offset/wide-index stream
and another later-task schedule; try a nonrestart native sentinel and all-restart
case. Attack resource revision after read collection, cancellation, name reuse,
allocation exhaustion and scratch accounting. Sabotage the promoted oracle
once. Classify every new hunk against recordings and carry only unchanged
code/dependency/evidence digests. Do not re-litigate unrelated shader arithmetic.

## Verification log

### 2026-10-10 — worker — activated after verified topology

Dependency E6-T11d8 is independently verified at
`bef7040804a1c71ad37112e35adcfebefbc4be21`. The original negative readiness
record `evidence/virgl-production-readiness/standard-restart-gap.json` contains
18 literal indexed restart packets: all six supported modes, original restart
values255/65535/u32max and two instances. Both original decoders reject them.
Its recorded `2d1303bf` decoder/state/compiler bytes remain identical through
the fresh D8 verdict; every source digest was rechecked before activation.

Pinned Mesa26.2.2 `virgl_screen.c`320..321 uses one bit for both custom and fixed
primitive restart. Its `virgl_encode.c`982..1010 sends the full original restart
value when enabled and zero when disabled. WebGL2's primary specification
section PRIMITIVE_RESTART_FIXED_INDEX always enables each native type's maximum
sentinel. Fixed-only admission cannot justify Mesa's production cap bit. This
ordered S boundary normalizes actual retained indices as needed; it does not
grant production qualification. The explicit production graphics request keeps
this chain ahead of unrelated queue work.

Primary references: Mesa26.2.2 release source and
https://registry.khronos.org/webgl/specs/latest/2.0/ .


### 2026-10-10 — worker — implemented; awaiting fresh critic

Runtime and browser harness freeze:
`31e4b3ff907d36f54689513796927acc16b5fd62`. Final recording/receipt head:
`ef30bcccb02f006a72da6c4796134b9c780a828d`; the sole intervening change
is the receipt parser. Native Rust/device, shader/compiler, resource/cache,
constant-domain and link/uniform boundaries remain unchanged. The selected
high-risk submission is syntax/diff custody, actual fixed16MiB compiler build,
literal Node/browser packets, native hardware bytes/calls/pixels, varied later
schedules and lifetime/failure attacks, full affected D6/four legacy browser
gates, direct D7/D8 physical acceptance plus native sabotages/offline audits,
and one final pristine exact-head clone. These isolated factory changes expose
no production demo import or negotiation; deployment stays in E6-T11d.

Exact commands from the managed checkout:

```sh
VIRGL_STANDARD_RESTART_EVIDENCE_DIR=target/evidence/virgl-standard-restart-final make verify-E6-T11d9
python3 tools/virgl-command/standard-restart-receipt.py target/evidence/virgl-standard-restart-final
python3 tools/virgl-command/standard-restart-cold.py --output target/evidence/virgl-standard-restart-final-cold
python3 tools/virgl-command/standard-restart-seal.py target/evidence/virgl-standard-restart-final target/evidence/virgl-standard-restart-final-cold evidence/virgl-standard-restart/worker
```

The first hot command passes every compiler, wire, GPU and independent byte/pixel
gate, then its receipt parser raises `KeyError: bytes` on the deliberately
forced second `createBuffer`-null event. It is not a runtime refutation. The
original log and report heads remain unchanged. The narrow receipt-only repair
recognizes that non-byte event and explicitly authenticates unchanged physical
sources across only this receipt-file delta; the direct receipt command passes.
No old report is relabeled and no unrelated gate is restarted for this repair.
The final pristine clone runs the complete corrected default command once at
`ef30bcccb02f006a72da6c4796134b9c780a828d`, passes, and stays clean with
scrubbed environment. Hot physical source-head identity31e4 and final cold
source-head identityef30 are both recorded in their actual receipts.

Each original hot/cold hardware run proves189 frames/139008 pixels,377 actual
native draws and318 physical normalized EBO captures. Each Node and browser
matrix proves292 literal flag/indexed/mode/legacy/hostile packets. All six core
modes cover custom/fixed/out-of-original-type restart, original u8/u16/wide-u32,
zero/one/two/four instance fields, mixed generic/array/divisor records, original
nonzero offsets, leading/trailing/repeated/all restart and incomplete segments.
Native vertex IDs are checked by the original position's exact ID tag and a
native shader comparison guarding clip W. Per-instance flat colors stay
constant; this does not grant per-vertex provoking-state qualification. Binary
instance tiles preserve exact fixture geometry. All-restart has explicit
null/empty actual fetch reporting, native no-geometry behavior and charged
source work. Disabled restart renders vertex255/65535 as actual vertices.

Eight rejection jobs and four suspended original-index attacks cover short
position/constant/index storage, work/read limits, real nonrestartu32max,
revision after index collection while a constant remains pending, cancellation
and public-name reuse. Eleven private ownership scenarios reach exactly
262144 native bytes/64 buffers and tightened work/read/draw limits. The actual
second buffer creation/upload errors occur after a successful first draw;
only that prefix draws, the final fence drains, and all scratch/read budgets
return to zero. Cancellation holds native storage through a subsequent source
read or final fence. Explicit disposal invalidates pending tickets and deletes
every owned native buffer. A/B/A mode/context/native EBO poisoning restores
actual bindings. CPU scratch is charged at native upload and is zero at every
yield. The retained D6 negative for legal u8/u16 maxima now tests a genuine
one-byte-short source; its original historical evidence is carried unchanged.

The served actual mapping fault retains the original custom marker instead of
nativeu32max. Its `drawElementsInstanced` and final real fence complete, then
`mode-2-custom-0 independent restart pixel oracle` fails: pixel(2,3) expected
[85,56,51,128], observed[0,0,0,0],error128. Physical normalized GPU bytes show
the wrong original marker. Original/mutated source hashes, all literal packets,
original GPU uploads/buffers, private native EBO bytes, attributes/generics,
full pixels, real fence events, cleanup counters and V8 coverage are sealed.
D6 divisor, D7 generic and D8 mode sabotages also fail their original oracles.

Evidence of record: `evidence/virgl-standard-restart/worker/manifest.json`,
`records.json`, `recording.tar.gz`:6862 records,14118238 archive bytes.

- Archive SHA256 `bc713cc04fc443130c36a98abcd87586d4df52fad6ff2ffea16416b7ed618764`.
- Index SHA256 `3508f8a5acec1ed9ee54ed54e3ab886f37d9ee4083fd3ad3b8c08f74fa4ce779`.
- Hot receipt SHA256 `ce10ae383776b80c94366ebc167e8e41d6e40ffdf6294e77167e89269da2417a`.
- Cold report SHA256 `99f3be9267d5ad3947aced666fb3ec7ce62ccc0fd3b8602dc9bd02c22090cdd8`.
- Cold receipt SHA256 `8914cdf8ecad9443310a7077752a48761f93e76f12bfdc6c8630185e18eacdde`.
- Cold checkout `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-restart-cold-r_4c3bae/wasm-vm`.

This claims only bounded index-stream lowering under the standard async facet.
Points, other storage/state/shader API families, provoking-state qualification,
production capsets, actual guest rendering, demo deployment and MIPS/FPS remain
outside its authority. Only a fresh critic may verify.
