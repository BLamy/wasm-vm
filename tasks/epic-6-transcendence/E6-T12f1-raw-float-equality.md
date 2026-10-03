---
id: E6-T12f1
epic: 6
title: Implement raw FSEQ and FSNE masks without changing precision semantics
priority: 525.0269911
status: implemented
depends_on: [E6-T12e9]
estimate: S
risk: high
capstone: false
---

## Boundary

Add only undecorated FSEQ/FSNE. Compare raw binary32 encodings with ordered equality
and unordered inequality: both zero signs are equal; any NaN makes FSEQ false and
FSNE true. Results are exactly zero or all-ones. Preserve consumed-lane checks,
RHS snapshots, unknown NaN self-comparisons and computed numeric raw snapshots.
No lazy input, PRECISE, source-modifier, destination-mask grammar or output-authority relaxation.

Use explicit 64-bit opcode masks. Pure equality may use closed unconditional
profile13 only after the existing loop, indirect, structured and finite-bank
obligations have selected their profiles. Raw comparisons never manufacture a
numeric-bank dependency. The consumer recognizes the exact new profile and
forbids every domain/access/count record on its unconditional shape.

Keep all original bodies/results at 12/19. Exactly eight former negative integer/
float fixture cases named still-unsupported-FSEQ/FSNE in both stages now succeed;
bind each unchanged body hash and old/new full result explicitly. The two raw
reject-mixed-FSEQ cases remain unsafe direct-output rejections. Other retained
full results remain exact. Historical fixtures/validators stay unchanged; use
explicit successor recorders for the two old leaves whose obsolete expectations
would stop before GPU probes. Keep their independent GPU probe bodies/oracles
source-bound, and never claim those historical whole gates passed.

## Deterministic acceptance

`make verify-E6-T12f1` records native sanitizer/Wasm parity, raw equality hardware
words in both stages, all eight unchanged migrated bodies as GPU positives,
computed-shadow/alias/partial-lane cases, mixed profile7–13 obligations and
immutable-bank behavior. Independently classify exceptional words without
floating conversion. Preserve measured storage/runtime caps, recover after
errors/allocation pressure, run exact-source recording and final pristine clone.

## Adversarial verification

Attack signed-zero order, signaling/quiet NaNs and payloads, same-word NaN,
subnormal versus zero, infinities, source aliases and unwritten selected lanes.
Sabotage NaN handling, zero equivalence, FSNE complement and all-ones masks in
actual compiler source; require independent GPU failures. A known-fact admission
fault must be caught before unsafe GPU submission. Audit the eight expectation
migrations and genuine unknown-v14/forbidden metadata cases.

## Execution notes

Begin after verified E9 `80813f4e45202cec3769d51b4f7d2b421034df01`.
Use its final cold native report as the bound full-result baseline. Add opcodes
33/34 and a separate raw integer equality helper; retain the old ordered-mask
helper and all old successful emitted GLSL verbatim. Fold only fully known
operands; never fold unknown self-comparisons without a non-NaN proof. Computed
float shadows already publish a raw snapshot, which the predicates consume.

The only expected retained-result migrations are the integerCases/floatCases
`still-unsupported-{FSEQ,FSNE}-{vertex,fragment}` entries (eight). Pin their body
hashes and old results in an explicit migration manifest, then prove the new
results independently. Every other one of the 4,012 stages and all 264 pairs
must remain exact, as must all original 12/19 outcomes. Historical integer/float
browser modules assert the old negative expectations, so successor leaf recorders
must name the migrations while retaining the unchanged independent GPU probes;
no historical fixture rewrite or guard monkeypatch is permitted.

Keep IR/profile/flow at the measured E9 26,352/7,616/52,644 bytes unless a justified
measured change remains within the caps. New equality anchors should be small.
Record 179-instruction and 16KiB stress separately, typed LLVM/V8 counters and
strict receipts. Final source freezes before the complete recorded submission.

## Verification log

### 2026-10-03 — worker — activation

Prioritize the six graphics-semantic slices before the desktop publication task
to continue the user’s explicit guest-GPU implementation request. The earlier
E5.5-T03az verdict verified a negative trial, not desktop release admission.
E9 is independently verified at `80813f4e45202cec3769d51b4f7d2b421034df01`;
no other task occupies the active lane.

### 2026-10-03 — worker — recorded submission

Runtime implementation: `e535914881f6a6f1c623513f3531ad83ddcca34b`.
Final source freeze: `a7be954c1f3bea9dd1e96522e890fa012197c6fe`.
The intervening changes correct recording/audit plumbing only; compiler and
consumer runtime bytes have not changed since the implementation commit.

Commands:

- `EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_RAW_EQUALITY_EVIDENCE_DIR=target/evidence/raw-equality-worker-final make verify-E6-T12f1`
  passed at `0e165928553aed9d261cff0d4ba27b513876569b`; copied to
  `evidence/virgl-raw-equality/worker/`.
- `python3 tools/virgl-raw-equality/cold.py --output evidence/virgl-raw-equality/cold-clone`
  passed at final source freeze `a7be954c1f3bea9dd1e96522e890fa012197c6fe`.
  This final authoritative recording runs the complete acceptance from a
  pristine detached clone with scrubbed Rust/Cargo/Node/Python/compiler/Git
  overrides. The clone is retained at
  `/private/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-raw-equality-cold-bj_u2niy/wasm-vm`.
  Its checkout is clean before and after the complete run.
- `python3 tools/check_task_policy.py` and `git diff --check` passed.

Final evidence digests (SHA-256):

- `cold-clone/report.json`: `dc7de94e200cae79eacd702b34e8f3f393aa47015d7a33a16d25f05043a7fb1b`.
- `cold-clone/acceptance/receipt.json`: `f92373e057bd0a41b12a92e21b4a8ae372d397ef7571e84edbdcdd79ea11ddd7`.
- `cold-clone/acceptance/native/native-report.json`: `cb4d4367911bba46789f3d32ecc166e24bba412c8ad9e27db20e03e3a39f5751`.
- `cold-clone/acceptance/gpu/report.json`: `216cd2aa04cd5a128fcffabb9b1e1221534fe3d5547bbe7031f8c067425e3b48`.
- Earlier warm receipt: `506ac8a83c60415c3c9c752e0a2c037c21e719040a0c18b28560b2d6e3112a85`.

The final recording demonstrates raw ordered FSEQ/unordered FSNE through
independent encoding classification and real hardware output: 640 complete
words across 32 vertex/fragment kernels, including unknown/self comparisons,
signed zeros, signaling/quiet NaNs and payloads, subnormals, infinities,
computed raw snapshots, partial consumed lanes, aliases, all mixed profile
obligations and the certified counted loop. All eight unchanged historical
negative bodies are independently rendered as new positives. The explicit
migration manifest binds each old full result and body SHA; all other 4,004
retained stages, all 264 retained pairs and all 19 original bodies/results remain
exact at the E9 boundary (12 originals accepted). Historical integer/float
whole gates are not claimed: successor leaves retain their independent hardware
probe/oracle regions byte for byte and check 704/768 words and 17,856/37,696
interpolation pixels with both framebuffer orientations.

Native ASan/UBSan records 602,100 API calls: 4,152 stages, 298 pairs, 4,096
mutations under four new seeds, 324 hostile inputs, 2,353 truncations and 16
actual allocation failures, recovering through all 14 profiles. Typed LLVM
counters include 124 executions of the new known-fact equality predicate.
IR/profile/flow remain 26,352/7,616/52,644 bytes; instruction/source/lane sizes
remain 112/24/12 bytes. Wasm records 14,241 calls, owned request/result copies,
64 maximal-text/instruction stress calls and 33 real allocation-pressure calls,
with the same 16MiB buffer throughout. Its 4KiB capacity observations show no
lost requested chunks and full recovery; they do not claim a byte-granular leak
proof. Consumer V8 records 2,535 checks including the exact new profile,
forbidden domain/access/count shapes and genuine unknown-v14; getter invocation
count is zero. All browser recordings have zero console/page/request errors.

Five uniquely pinned actual compiler-source faults have complete native/Wasm
parity recordings. NaN-guard removal, zero-sign mishandling, FSNE complement
reversal and one-bit masks reach an independent physical GPU word failure;
incorrect known-NaN folding rejects the four safe selection witnesses before
unsafe GPU submission. Source inventories, serialized input/output streams,
artifact digests, typed LLVM/V8 counters and sealed actual fault Wasm bytes are
checked by the final receipt.

The first cold attempt exposed macOS's `/var` versus `/private/var` aliases in
the new fault recorder. Its exact failing command/head/log are preserved in
`evidence/virgl-raw-equality/portability-repro/`. The final source canonicalizes
both clone and fault artifact paths; the complete pristine acceptance then
passed. This is the portability exception to the single-final-cold-run rule.

Scope remains the isolated host shader compiler and metadata consumer. No demo
import or guest capability negotiation changes; production virgl/capsets and
Guest Renderer stay disabled. This proof does not close PRECISE/dataflow gaps,
claim all 19 originals, establish guest desktop acceleration or demonstrate
300 MIPS. Status is implemented pending a fresh adversarial verifier.

