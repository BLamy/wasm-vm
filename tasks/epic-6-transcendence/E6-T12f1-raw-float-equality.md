---
id: E6-T12f1
epic: 6
title: Implement raw FSEQ and FSNE masks without changing precision semantics
priority: 525.0269911
status: evidence-needed
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

### 2026-10-03 — fresh verifier — VERDICT: needs-evidence

Predictions preceded evidence inspection in
`evidence/virgl-raw-equality/verifier/predictions.md`. Reviewed the full E9-to-worker
diff at `cdc9ebd14407976a2ea2fb5a5a2cf634078c2726`; implementation and worker
harness were not edited by this critic. The final authoritative cold recording
is `a7be954c1f3bea9dd1e96522e890fa012197c6fe`, not the earlier warm harness.

- F1 / P9 maxima — NEEDS EVIDENCE. Predicted a typed reconstruction of actual
  maximum GLSL58,201; full receipt accepts `true`, `1` and `58201.0` after the
  altered native report's SHA/length is propagated into its Wasm cross-link.
  `verifier/propagated-attacks.json:7`, `:23`, `:39`, SHA-256
  `6bbd0e2a798c3b22174fc8ec8722205feab34bd0a275ef0abad3ce721284f009`.
  `tools/virgl-raw-equality/native_receipt.py:54–66` never reconstructs the
  separate `recordedMaxima`; `receipt.py:134` copies it. Reconstruct and compare
  all three maxima as exact bounded JSON integers.
- F2 / P9 source/coverage closure — NEEDS EVIDENCE. Predicted mandatory inventories
  and source/summary correspondence. Full receipt instead accepts empty native
  or coverage-source inventories, mismatched coverage summary and invented
  coverage-source digest. `verifier/propagated-attacks.json:55`, `:71`, `:87`,
  `:103`, same SHA above. Native-only wrong byte/path attacks also pass at
  `verifier/receipt-attacks.json:1024`, `:1115`, SHA-256
  `6bb33e2a808997107bd3771cae2c7610b9fa8c10ab908fb2652d9a33f48d994d`.
  Code: `native_receipt.py:62–65`. Require exact compiler/harness inventories
  and both covered implementation sources, frozen bytes/digests and matching
  LLVM filenames/summaries. Actual pristine bindings currently match.
- F3 / P4,P9 consumer ledger — NEEDS EVIDENCE. Predicted rejection of omitted
  acceptance checks, missing sources and noninteger getter count. Full receipt
  accepts checks0 or2,503 after removing every forbidden13/unknown14 case,
  sources[], gettersFalse or0.0. `verifier/receipt-attacks.json:1341`, `:1354`,
  `:1367`, `:1380`, `:1393`, SHA above; code `receipt.py:115–122`. Derive and
  validate the complete ordered expected ledger, source inventory, schema and
  typed counters, including recorded getter avoidance. Rerun the touched
  consumer harness and these promoted negative checks.
- P1–P8,P10 runtime results — HELD. Untouched final cold receipt regenerates
  exactly. Independently checked all75 copied artifacts against the clean clone,
  all175 source/73 record bindings and all15 loaded local validator dependencies.
  Compared all4,012 retained stages/264 pairs: exactly8 migrations; all4,004
  others and all19 original full results remain exact at12/19; successor GPU
  probe prefixes remain byte-exact. Frozen native/Wasm totals, bounds, recovery,
  all640 words/all8 actual migrated bodies and all5 real-source faults hold.
  `verifier/recording-audit.json` SHA-256
  `886ab3a3c2a7efe6cc9c20c44bd7856b05004a289d58fbc415064ff71e28a6af`.
- P2,P3,P7,P10 novel attacks — HELD. 3,088 public CLI admission/alias checks under
  four independent seeds pass; a new identical signaling-NaN witness catches the
  actual known-fact compiler fault before GPU. `verifier/known-facts/report.json`
  SHA-256 `7b7c1446e930467863c6994d725a67a60ba3d0cdf66e489cd53d47529cacc0e7`.
  A fresh realGPU recording reconstructs2,112 complete words across16 both-stage
  kernels, unknown self comparisons and both aliases, with zero browser errors.
  `verifier/seeded-gpu-authoritative/report.json` SHA-256
  `96b1c3c741c717ce07923ad3c2f50815cf80870f76b2f9661bc2ee79dd93de6d`;
  screenshot inspected. Actual consumer checks/getter avoidance remain HELD;
  its ledger sufficiency is the F3 gap.
- P8 coverage — HELD for product hunks. Frozen LLVM re-export is byte-identical;
  all25 changed executable C lines execute, including124 known-equality calls.
  The consumer membership expression executes (module1/map callback7).
  WAIVED: four nonexecutable C comment/blank/declaration lines, header/mask/static
  declarations, documentation, task decomposition and declarative metadata;
  their consumers/layouts/direct results are exercised. Receipt sufficiency is
  still F1–F3. Carry unchanged E9 HELD results forward.
- SUITE: promoted critic scripts/records are bound in `verifier/manifest.json`;
  `verifier/commands.json` records exact final commands. Full verdict and demands
  are in `verifier/verdict.md`. Receipt attack scripts offer `--expect-rejected`
  for the repaired negative gate. No product claim was contradicted; repair only
  the affected proof harness and rerun its missing proof/checks. Do not restart
  unrelated runtime/workspace gates or the already-held final pristine clone.

### 2026-10-03 — worker — proof-only response freeze

Respond to F1–F3 without changing the compiler, metadata consumer, fixtures or
historical recordings. Native audit now reconstructs all three bounded maxima,
requires the complete ordered source inventory, and matches both actual LLVM
filenames and source byte/digest/summary records. The consumer auditor derives
all 2,535 ordered checks independently of the parser, enforces the closed schema
and exact sources, and binds typed V8 counters to both real modules, the exact
parse-call schedule and the unique throwing getter's zero execution count.
Promote the critic's native/full forgeries, including correctly propagated Wasm
cross-links, into `tools/virgl-raw-equality/receipt_attacks.py`.

Prechecks: Python compilation, shell syntax and `git diff --check` pass; the new
maxima and complete consumer ledger reconstruct the held final recording
exactly. Record the affected F1 submission at the frozen proof-source head so
all existing exact-source/cross-link guards remain active; preserve the initial
positive receipt and seal the negative checks in the final receipt. The already
held pristine-clone, product-hunk coverage and novel attacks carry forward;
no second cold clone or unrelated workspace gate is requested. Status remains
evidence-needed until this missing proof is recorded and independently reviewed.
