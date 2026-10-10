---
id: E6-T11d9
epic: 6
title: Normalize owned standard index streams for primitive restart
priority: 525.027039001
status: in-progress
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

