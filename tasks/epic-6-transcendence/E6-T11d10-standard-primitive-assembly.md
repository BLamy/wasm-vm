---
id: E6-T11d10
epic: 6
title: Preserve original provoking vertices with bounded native primitive lists
priority: 525.0270390001
status: verified
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

### 2026-10-10 — worker — sealed native primitive-list submission

Runtime/physical freeze `3ad8f8f6e817799935c66168f26518a93c65ebe4`;
final offline-harness/cold-source head `dc28eaa0128177a5f742e8f2877fc7a6573d06fd`.
The only changes between those heads are the offline physical auditor's old
restart-vs-assembly error-label assertion and its receipt transport. Every
recorded browser source digest still equals the final frozen source. The original
hot `make verify-E6-T11d10` exited2 at that offline label assertion AFTER all
304 positive hardware cases and both completed-draw/fence faults were recorded;
it is not claimed as a passed full make invocation. The original acceptance log
and `harness-correction.json` retain this failure. The corrected direct offline
byte/pixel audit and receipt passed; the final pristine exact-head command passed
fully with no later correction or dirty checkout.

Commands:

```sh
VIRGL_STANDARD_ASSEMBLY_EVIDENCE_DIR=target/evidence/virgl-standard-assembly-final make verify-E6-T11d10
node --check tools/virgl-command/standard-assembly-pixels.mjs
python3 -m py_compile tools/virgl-command/standard-assembly-receipt.py
node tools/virgl-command/standard-assembly-pixels.mjs target/evidence/virgl-standard-assembly-final
python3 tools/virgl-command/standard-assembly-receipt.py target/evidence/virgl-standard-assembly-final
python3 tools/virgl-command/standard-assembly-cold.py --output target/evidence/virgl-standard-assembly-final-cold
python3 tools/virgl-command/standard-assembly-seal.py target/evidence/virgl-standard-assembly-final target/evidence/virgl-standard-assembly-final-cold evidence/virgl-standard-assembly/worker
```

Each hot/cold physical run has304 frames,177664 independently checked full pixels,
492 actual native draws and417 private GPU-buffer captures. The directly affected
default D9 boundary has189 frames/139008 pixels/377 draws/318 private buffers per
run. Its native restart-mapping fault still completes the native draw/fence and
fails its original oracle. All compiler/decoder/resources/cache and earlier
HELD D6/D7/D8/D9 evidence bytes remain identical to predecessor
`c378b55516f74a2da3612462104785fe6997fca1`; their immutable records are carried
under that original authority, never relabeled.

The new literal/native/pixel oracle composes original primitives in order and
checks per-vertex flat color from `(vertexID * 17 & 255)/256`, native vertex-ID
clip tags, smooth outputs, six modes, arrays/indices, three index widths, original
offsets/divisors/generics, marker/tail/empty streams and native FIRST/VAO/EBO
poisoning. Arrays with buffered attributes exercise the direct no-readback job
path. A retained original EBO on an array draw is restored before a private-buffer
yield. Four explicit factory gates reject unknown selection, missing/invalid
extension and legacy option acquisition without a native draw. Only bounded
native indices are assembled on the CPU; original shaders execute on the GPU.

Eight rejected jobs, four pending-source cases and11 ownership cases cover short
fetches/indices, exact source/read/draw work, real u32 sentinel, original revision
after collection, public-name reuse, pending cancellation, second native
allocation/upload failure and explicit disposal. The largest legal fan reaches
196602 native indices/786408 bytes from65536 source indices; 64 fans of1024
sources retain784896 bytes/64 buffers. Every CPU output charge is zero at a yield,
every read/native budget returns to zero, and private GPU storage remains owned
through final real completion/drain or explicit disposal.

Both actual served list-order and FIRST-restore regressions complete native
`drawElementsInstanced` and their real final fence, then fail the independent
original pixel oracle: at(3,2) expected[115,56,51,128], observed[99,56,51,128],
error16. Original uploads/native state, private physical GPU bytes, attributes,
full pixels, native calls/fences, disposal and V8 coverage are sealed. No
headless/software rendering is accepted. The unchanged actual compiler Wasm is
rebuilt with fixed16MiB memory in each selected acceptance.

Evidence of record: `evidence/virgl-standard-assembly/worker/manifest.json`,
`records.json`, `recording.tar.gz`: 10364 records,18592102 archive bytes.

- Archive SHA256 `51ff1c7fa589480cdc626d715771364164aa3540086dbc9ea443986503d84177`.
- Index SHA256 `54312872d7bb67b194478a04e5e12039b49d582fa15b9e4c59c1ad766a5a0331`.
- Hot receipt SHA256 `9269b5f25ad79161b3e4b422c886ae9c797da85a90dcf25e444ef85e09e3a831`.
- Cold report SHA256 `209334cc2defe2244a6d4190ac30aa71af2aa3a9ea0806c7d3326dc1afa311ac`.
- Cold receipt SHA256 `ef7256c612aebff7fadc2a83b72f735613012df64b1e90107bae14913a8b0f1c`.
- Pristine clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-assembly-cold-gz31qqsh/wasm-vm`.

This claims only the explicitly selected, bounded native primitive-list boundary.
The historical native facet remains separate. Points, other API families,
complete qualification, typed production capabilities, actual guest graphics,
demo deployment and performance remain outstanding. This isolated module is not
reachable from the production demo; its demo/guest gates belong to E6-T11d.
Only a fresh critic may verify.

### 2026-10-10 — fresh verifier — VERDICT: verified

VERDICT: verified

Worker submission `391643b02e5b59018da3cae9f650122cc7d83172` was read with
AGENTS.md, the complete task and scoped diff before evidence. Predictions were
written to `evidence/virgl-standard-assembly/verifier/predictions.json` before
opening the seal; independent seed `795804360` was chosen then. This session
made no implementation edit and grants only the selected list boundary.

- **P1 selection/default — HELD.** Four actual factory gates return the predicted
  errors before any native draw. The exact-source default D9 retention run
  remains native. Its 189 frames/139008 pixels/377 draws/318 private captures,
  compiler/resources/cache/decoder and all earlier D6–D9 seals retain their
  existing authority at `c378b55516f74a2da3612462104785fe6997fca1`.
- **P2 original/native identity — HELD.** The critic reparses literal packets
  and original uploads independently, then compares actual original GPU bytes,
  emitted original-ID u32 lists and native draw arguments. Each hot/cold run
  independently holds304 frames/177664 pixels/492 native draws/417 private
  buffers. `hot-audit.json:378` (frame14) proves loop closure/ordered pairs;
  `hot-audit.json:2006` (frame71) proves wide fan triples. Tiny/all-restart tails
  remain empty; array indices retain start+i. Oracle inputs never include the
  worker's predicted model or observed pixel values.
- **P3/P4 physical state/pixels — HELD.** At every selected native draw,
  convention is LAST, including unchanged modes. Full flat/smooth, culling,
  opposing two-point loop composition, instancing/divisors/generics and A/B/A
  poisoned state hold. Shared triangle edges cannot become clear holes;
  only declared half-open endpoints and outer edges allow alternatives.
  Original GPU position ID tags and flat `(ID*17&255)/256` outputs exercise
  original IDs, without CPU shader execution in the runtime.
- **P5 work/storage bounds — HELD.** `hot-audit.json:8253` (frame295) has
  65536 original words and196602 native words/786408 bytes; frame296 and its
  ownership events retain784896 bytes/64 buffers. Count×effective instances
  includes markers/tails. All eight short-source/work/read/native-limit
  rejections have their specific errors and expected preceding draw count.
- **P6 lifetime — HELD.** Every recorded private upload is owned before upload;
  every deletion follows actual ready fence completion/drain or explicit
  disposal. CPU charge is zero at yields, and all read/native/CPU counters
  return to zero. Source-after-collection mutation is anchored to the literal
  original18-byte physical read; stale source rejects, public-name reuse keeps
  the retained generation, and cancellation/partial allocation/upload never
  execute a failed suffix. Frame252 (`hot-audit.json:7084`) and critic frame6
  (`independent-audit.json:235`) prove restoration of an actual retained EBO on
  an array draw before a private-buffer yield.
- **P7 custody/cold — HELD.** `authentication.json` independently reopens all
  10364 records against both digests. Runtime/browser source hashes are
  identical across physical freeze and final cold head, and267 compiler/
  decoder/resource/cache boundary files stay identical. The original hot full
  make is honestly **failed**, exit2: sealed `hot/acceptance.log:81` contains
  the stale restart-label assertion. Only its narrow offline label/receipt
  correction passes. The pristine `dc28eaa0128177a5f742e8f2877fc7a6573d06fd`
  clone's full make passes with scrubbed environment and empty before/after
  status (`cold/acceptance.log:83`), with no later runtime correction.
- **P8 regression sensitivity — HELD.** Both fresh served faults complete
  `drawElementsInstanced`; their authenticated V8 records execute final fence
  creation at mutation-source.mjs:1248, actual zero-timeout polls at:1284 and
  ready completion at:1289. Actual list-order GPU bytes are wrong; FIRST keeps
  correct bytes but records0x8e4d. The critic's original oracle independently
  rejects both at(3,2): expected[115,56,51,128], observed[99,56,51,128], error16.
  See `fault-list-order-audit.json` and `fault-provoking-audit.json`, including
  source digests and exact fence offsets/counts. Expected process exit1 remains
  recorded as a failed physical regression, never a passed rendering run.
- **P9 coverage — HELD.** `coverage-audit.json` binds all14 new runtime hunks
  to exact-source V8 ranges:49 added executable lines hit,5 braces/structural
  lines waived. Default D9 covers native fallbacks. Declarative empty legacy
  option/metadata arms are waived explicitly; the expanded-count guard's
  failure arm is algebraically unreachable under the bounded original stream.
  There is no dead or unproven claimed runtime hunk.
- **P10 bounded independent attack — HELD.** Critic seed795804360 uses
  base67463, exact custom marker15785786, nonmonotonic wide original IDs,
  original index offset28 and independent buffer/source offsets. Predicted
  loop/fan words precede GPU inspection in `novel-plan.json`. Eight physical
  frames/7168 full pixels hold flat/smooth/opposite-winding culling, later
  read/fence schedules, FIRST poison, retained array EBO and cancellation at
  the final fence (`independent-audit.json:7–260`).

**SUITE:** promoted the newly seeded hardware test, independent literal-byte/
ordered-pixel oracle and reusable offline auditor. This adds deterministic proof
for the selected boundary, with served native faults demonstrating sensitivity.
The verifier's initial offline accounting assertions incorrectly counted already
retired A/B/A allocations, then classified a completed cancellation read drain
as disposal. Only the critic harness was corrected; original failures are kept
in `audit-harness-correction.json` and initial audit records. No GPU/runtime run
was repaired or reclassified. Final audits pass; no product refutation arose.

Commands (all local; no push, merge or deployment):

```sh
python3 evidence/virgl-standard-assembly/verifier/authenticate.py
node tools/verify-virgl-standard-assembly.mjs --output evidence/virgl-standard-assembly/verifier/independent --adversarial true
node tools/verify-virgl-standard-assembly.mjs --output evidence/virgl-standard-assembly/verifier/fault-list-order --smoke true --mutation list-order # expected exit1
node tools/verify-virgl-standard-assembly.mjs --output evidence/virgl-standard-assembly/verifier/fault-provoking --smoke true --mutation provoking # expected exit1
node tools/virgl-command/standard-assembly-adversarial-audit.mjs evidence/virgl-standard-assembly/verifier/unpacked/hot evidence/virgl-standard-assembly/verifier/hot-audit.json
node tools/virgl-command/standard-assembly-adversarial-audit.mjs evidence/virgl-standard-assembly/verifier/unpacked/cold evidence/virgl-standard-assembly/verifier/cold-audit.json
node tools/virgl-command/standard-assembly-adversarial-audit.mjs evidence/virgl-standard-assembly/verifier/independent evidence/virgl-standard-assembly/verifier/independent-audit.json critic
node tools/virgl-command/standard-assembly-adversarial-audit.mjs evidence/virgl-standard-assembly/verifier/fault-list-order evidence/virgl-standard-assembly/verifier/fault-list-order-audit.json fault
node tools/virgl-command/standard-assembly-adversarial-audit.mjs evidence/virgl-standard-assembly/verifier/fault-provoking evidence/virgl-standard-assembly/verifier/fault-provoking-audit.json fault
python3 evidence/virgl-standard-assembly/verifier/coverage_audit.py
# Syntax checks and exact command statuses: verifier/checks.json.
python3 tools/check_task_policy.py
python3 tools/build_queue.py
python3 evidence/virgl-standard-assembly/verifier/seal.py
```

Evidence: `evidence/virgl-standard-assembly/verifier/{verdict.json,manifest.json,
records.json,recording.tar.gz}`. The critic seal includes selected top-level
records and this session's actual three GPU runs, source snapshots, original hot
failure/correction and cold completion; it excludes unrelated scratch archives.
Digests and concrete source/record points are in verdict.json and the index.
Complete API/profile qualification, points, production caps, guest rendering,
deployment and performance remain outside this verdict.

Critic seal: 169 records, 917447 archive bytes.
Archive SHA256 `3cc7d41e5ab953fa134ed31d94379397a94b059d03b5b9eb3b69274cc95c3424`; index SHA256
`0fcd46f302ed397441ff0e5fb0d1af456a15077eea2d0b67426e35c77ad08c4d`. Every selected critic record was reopened
after packing before this verdict commit.
