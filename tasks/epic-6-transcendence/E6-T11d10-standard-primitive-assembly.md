---
id: E6-T11d10
epic: 6
title: Preserve original provoking vertices with bounded native primitive lists
priority: 525.0270390001
status: in-progress
depends_on: [E6-T11d9]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected standard async primitive-assembly boundary. Add a trusted
`primitiveAssembly: "lists"` host option, retaining the historical default native
facet and every legacy factory. Selected list assembly converts actual original
LINE_LOOP streams to independent native LINES and TRIANGLE_FAN streams to native
TRIANGLES, preserving original vertex IDs, winding and per-primitive last-vertex
outputs. Split only at exact enabled original restart values. Synthesized array
indices are the original `start + i`; no vertex rebasing or CPU shader execution.
Require the selected host's native provoking extension and restore LAST before
actual drawing, including unchanged modes. Unsupported hosts reject explicitly.
A state enum alone cannot qualify a graphics implementation.

Continue source bounds, instances/divisors/generics and complete-batch
revalidation. Keep original count/mode/indexed/type/offset/source work distinct
from native count/mode/indexed/type/offset. Zero emitted primitives still finish
normally with no pixels. Charge every original source word times effective
instances, including restart markers and tails; independently bound expanded
native work by <=3 times that source budget. Private native u32 bytes per job
are <=12 times the existing 65536-word source ceiling (786432), <=64 buffers,
and one bounded CPU output vector. Own before upload, detach before any yield,
and retain through final completion/drain or explicit disposal. Reuse the D9
ownership machinery; do not introduce another resource allocator or change
shader/compiler, resource/cache, Rust/device, production caps or imports.

## Deterministic acceptance

`make verify-E6-T11d10` uses actual headed hardware and fixed compiler Wasm.
Independently reparse literal original wire/uploads; derive native primitive
lists, original/native bounds and byte identities, actual GL arguments/state,
and full pixels. Original position records carry exact native vertex ID tags
and a clip-W guard. Per-vertex flat colors physically distinguish the expected
provoking vertex; smooth cases prove interpolation preservation. Cover six
supported modes, arrays/indices, u8/u16/wide-u32, original offsets, custom/fixed/
out-of-type/disabled restart, zero/one/two/four instance fields, incomplete/
repeated/all-restart segments, generic/divisor sources and native FIRST-state,
VAO/EBO poisoning with A/B/A contexts. Include culling/winding and opposing
2-point loop overdraw. Only independently declared GLES half-open endpoint and
outer triangle edge alternatives are permitted; interiors and loop closure are
strict and shared triangle edges cannot become clear holes.

Reach the maximum legal expanded fan and 64 private buffers under the source
ceiling; tighten work/read/draw limits, short vertex/index sources and real u32
sentinel inputs. Attack source changes after collection, original public-name
reuse, cancellation during later reads/final fence, partial native allocation/
upload failures and explicit disposal. Every retained read/native/CPU budget
must return to zero. Real served list-order corruption must complete its native
draw/fence and fail the original flat-vertex pixel oracle. A second served FIRST
restore fault must fail the same original oracle after a completed native draw.

Preserve unchanged historic acceptance/receipts under incremental policy, and
run the directly affected default D9 boundary once at freeze. Record exact
sources, original/private GPU bytes, native state/calls, fences, complete pixels
and changed-hunk V8 coverage. Run the final selected command in one pristine
exact-head clone with scrubbed environment and seal all evidence. A fresh critic
alone may verify. This boundary does not grant complete GLES/API, production
negotiation, guest acceleration or performance authority.

## Adversarial verification

Predict native lists, winding, original vertex IDs and per-primitive flat/smooth
colors before evidence. Independently seed one nonmonotonic wide/offset custom
restart stream and a later-fence schedule. Try a real native maximum, out-of-type
marker, tiny/empty segments and exact source ceiling; attack original revision,
name reuse, cancellation, partial allocation and disposal. Sabotage the promoted
oracle after a real native draw/fence. Authenticate cold/source identity and
classify each new runtime hunk. Carry unchanged earlier HELD evidence; do not
expand this claim into unrelated compiler arithmetic or API capability work.

## Verification log
