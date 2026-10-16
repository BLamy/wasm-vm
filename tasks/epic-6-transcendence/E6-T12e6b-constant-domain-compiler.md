---
id: E6-T12e6b
epic: 6
title: Derive conditional finite constant authority in the owned compiler
priority: 525.02699062
status: verified
depends_on: [E6-T12e6a]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit numeric use of raw CONST-derived finite values only with a compiler-derived
constant-bank contract enforced by E6-T12e6a. Cover direct CONST, exact MOV/swizzles
and permitted raw UCMP provenance across the complete ordinary arithmetic family.
Keep PRECISE, indirect addressing and control flow gated. No caller flag, asserted
domain or source rewrite may select or suppress the contract.

Distinguish numeric access, ordinary-output authority and finite-bank dependency
in compact facts. Conditional CONST is not an original-IN shortcut, a computed
float shadow or a raw-output proof. Mixed UCMP must preserve synchronized raw
payload and numeric snapshots; any possibly selected conditional-only arm blocks
ordinary output authority until an actual numeric operation computes a result.
Known selectors retain only the selected fact. Bitwise/integer writes invalidate
stale numeric authority unless existing known-bit proof independently suffices.
Preserve pre-write aliases and partial-lane distinctions.

Keep every old successful full result exact by trying unconditional validation
first. An internal retry may follow only the typed missing-numeric-authority
failure, must establish actual CONST-dependent numeric consumption, and must
revalidate the entire immutable shader. Failed retries retain the original
public error; no partial IR, metadata or response-buffer state may leak. Preserve
112-byte instructions, 12-byte facts, bounded IR/storage and fixed Wasm limits.
Single/pair translation must emit identical applicable stage obligations.

## Numerical contract

Use GLSL ES3.00 rev6 section8.3's finite bit reinterpretation guarantee and
section4.5.1's ordinary-operation latitude. Finite includes subnormal encodings;
raw-u32 storage and selection preserve their bits. Numeric operations may flush
subnormals where the specification permits, but no arbitrary result or raw payload
loss is allowed. Do not claim NaN/Inf reinterpretation, payload preservation after
arithmetic, exact computed zero signs or PRECISE authority. Ordinary source
admission gains no invented magnitude, divisor or interpolation-weight guards.

## Deterministic acceptance

`make verify-E6-T12e6b` requires native ASan/UBSan, full native/Wasm results and real
compiler -> decoded SET_CONSTANT_BUFFER -> shared sync/async renderer draws.
Positive integration cases use no metadata or GLSL injection. Independently
check exact normal arithmetic, documented reciprocal/root enclosures, and finite
subnormal controls whose allowed flush/preserved outcomes are derived explicitly.
Export original raw constant byte planes in the same programs.

Cover CONST0/45, consumed masks, swizzles, all numeric source positions, typed
negation, scalar replication, aliases, MOV chains and known/dynamic UCMP arms.
Bind every intentional historical admission to an exact promoted body and adjacent
negative replacement; preserve other full results and all19 originals (12 accepted,
7 rejected). Reuse predecessor oracles with explicit compatibility adapters as
needed, without weakening them or fabricating old full-gate receipts. Record
exact-head evidence, current-bank async schedules, one final pristine clone and
fresh adversarial verification.

## Adversarial verification

Attack IN/CONST confusion, unknown raw TEMP, raw subnormal output, unsafe synthesized
encodings, stale shadows after partial overwrites, mixed UCMP chains, unsafe
unselected arms, missing/stripped contract, wrong constant index, shortened/current
banks and async-yield reuse. Preserve existing raw-only UCMP and known-selector
full GLSL/metadata without added shadows or restrictions. Sabotage contract
emission or a numeric constant index and require an independent guard or GPU
oracle failure. A malformed/PRECISE suffix after a retry-triggering instruction
must still fail and recover cleanly.

## Execution notes

The consumer dependency was independently verified at
`9497f3da026092db1eb53e8d6187bceff214656a`. This slice changes only the owned
compiler's conditional authority boundary; TEX remains fragment-only and the
existing renderer/decoder contracts remain intact. Runtime authority fits the
existing fact/instruction/IR layouts. An ordinary first attempt preserves every
existing successful stage result; only an internally typed missing-numeric-
authority failure permits one complete conditional retry.

The exact historical migration inventory predicts 105 distinct formerly rejected
bodies across five case files. Preserve those exact bodies as new positives and
replace their historical negative positions with explicitly recorded adjacent
absolute-modifier rejections; two generated numeric rejection-pair references
follow those replacements. All other full results, recovery anchors and original
captured bodies remain fixed. Successor compatibility receipts independently
account for this boundary without changing old validators' historical claims.

New positive hardware proof uses actual compiler-produced contracts through
ordinary decoded packets and the shared sync/async renderer, with no injected
metadata or GLSL. Compact indexed bitplane atlases reconstruct all numeric and
raw constant words; independent per-pixel geometry/orientation checks bind the
atlas itself. E6a's broader consumer workload runs once as an explicitly named
regression. Fault runs are separate, narrowly scoped recordings. Production guest
negotiation and original Mesa workload execution remain gated.

## Verification log

### 2026-10-03 — worker — implemented

Frozen source: `d3565d11c2133aacbaa628ffa82342b5d308ab10` (runtime implementation
`f81c83b7444e3e5d8d7e52d9daa04adf1a209fc2`, followed only by two compatibility
receipt schema/inventory fixes). The authoritative final recording is the one
pristine-clone run, not a rewritten preliminary receipt.

Commands:

- `VIRGL_CONSTANT_COMPILER_EVIDENCE_DIR=evidence/virgl-constant-compiler/worker EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc make verify-E6-T12e6b`
  recorded the preliminary f81c run. All native/Wasm, GPU and actual compiler fault
  leaves passed; the final compatibility adapter stopped on the raw predecessor's
  absent `operationDefinitions`. Read-only follow-up also found the old-head
  compiler file inventory missed the new native test driver. The two wrappers
  were corrected without changing runtime, inputs, historical oracles or results.
  This directory remains explicitly preliminary; it contains no successful full
  receipt and has not been relabelled with the final head.
- `python3 -m py_compile tools/virgl-constant-compiler/shader_compat.py tools/virgl-constant-compiler/legacy_compat.py`
  and `git diff --check` passed for the evidence-only repairs. Detached raw extra-
  table and modified integer-table controls were rejected by the fixed assertions.
- `python3 tools/virgl-constant-compiler/cold.py --output evidence/virgl-constant-compiler/cold-clone`
  passed `make verify-E6-T12e6b` in the scrubbed, pristine final-head clone.
  `report.json` records empty before/after checkout status, exit 0, all 103 copied
  acceptance files and their hashes; `acceptance/receipt.json` binds 340 sources
  and 101 evidence records. This is the final risk-tier submission.
- `python3 tools/check_task_policy.py` and `python3 tools/build_queue.py` precede
  the worker status commit. No CPU Rust runtime or production browser path changed.

Final evidence under `evidence/virgl-constant-compiler/cold-clone/`:

| Record | SHA-256 |
| --- | --- |
| `report.json` | `b2eaf6b831051c118dbeb55b36b48736ece6b6b608e6fa859d5daef6dffbf97e` |
| `acceptance/receipt.json` | `e1777763c18addfb174eb113be8362b8bec5238ef496c0d4e9baba387c07c63b` |
| `acceptance/native/native-report.json` | `4888a39ad6de35d31cdc6466d10895d6634d232a8042cf669572e5525bd0a014` |
| `acceptance/wasm/report.json` | `ca5c1cad81d06d3744486a6c3ef6f7f7ac622feb1ee1c8f1a6fd4e592159b871` |
| `acceptance/hardware/browser.png` | `e3288280252e789176035712cefd800dc5086b39a825350434a4b0849cddd55c` |

The ASan/UBSan recording performs 526,760 public compiler calls over 3,151 cases,
221 pairs, 19 originals (12 accepted/7 rejected), 9,401 truncations, 4,096 mutations
and all 12 injected allocation failures with recovery. It accounts for precisely
105 historical admissions and adjacent negative replacements; remaining complete
results stay exact. Native layout remains 112-byte instructions, 12-byte facts,
26,232-byte IR and 7,608-byte profile. Actual Wasm performs 17,738 calls, including
64 maximal-text stress calls and 24 allocator-pressure attempts in the unchanged
16 MiB memory/256 KiB stack. Full result parity includes all new and retained cases.

The real headed Chrome/ANGLE Metal recording uses unmodified positive compiler
results through decoded constant commands and the shared renderer: 27 draws,
1,152 independently reconstructed words, 110,592 checked pixels, zero mismatches,
44 real async fences and 66 withheld signaled polls. Six short-bank rejections and
A/B/A updates bind current immutable banks. Separate decoder-bypass proof rejects
both invalid banks. A compiled missing-contract fault fails before native shader
allocation; a compiled numeric-index fault yields 35 numerical mismatches while
raw constant and orientation pages remain exact. Screenshot inspected directly.
The final receipt also checks six retained shader GPU suites, unchanged consumer,
decoder, resource, state, draw, async, pair and constant behavior plus source-bound
historical fault evidence without fabricating predecessor full-gate claims.

This demonstrates conditional finite-constant compilation and its existing draw-
time enforcement. It does not establish PRECISE, indirect addressing, structured
control flow, captured Mesa execution, guest desktop FPS or MIPS. Production guest
GPU negotiation remains off, and the live demo's partial capability claim is
unchanged. Numerical subnormal/reciprocal checks use the stated allowed outcomes;
no exact computed-zero-sign or NaN/Inf arithmetic promise is made. Defensive JSON-
overflow branches are not claimed as executed. Fresh adversarial verification is
required before this task can become verified.


### 2026-10-03 — fresh verifier — VERDICT: verified

Predictions were recorded in `verifier/predictions.json` before opening worker
recordings. Reviewed the task and runtime diff from verified parent `9497f3da`
to `f81c83b7`; carried HELD predictions across only the two evidence-adapter fixes
at final source `d3565d11c2133aacbaa628ffa82342b5d308ab10`. The worker claim is
submission `5dc8bbe01df31d7b0672d1ae55e6dd076da7fca2`. No implementation edits were
made by this verifier, and the preliminary failed top-level receipt remains
explicitly preliminary.

- **P1/P5 — HELD, exact compatibility and native/Wasm obligations.** Independently
  reconstructed the native stream and serialized results, including all 19
  originals, 2,699 retained cases/203 pairs, 452 new cases/18 pairs, exactly 105
  promoted historical bodies/adjacent negatives, and two pair substitutions.
  Actual Wasm full outputs and owned results match; 24 allocator-pressure calls
  restore capacity. Final `cold-clone/acceptance/native/native.log:3409` records
  526,760 calls, and `cold-clone/acceptance/wasm/report.json` records 17,738 calls.
  `verifier/final-cold-audit.json` binds the independent full receipt recomputation.
- **P2/P3/P4/P10 — HELD, authority, aliases, retry and independent attacks.** The
  verifier's 800 pre-predicted arm/selector/output-or-numeric/partial-write cases
  pass 2,400 calls under independent shuffled seeds `8319bb27`, `562dee19`,
  `c7a5026b`; `verifier/independent-calls.jsonl` retains every full result and
  `independent-report.json` binds source/binary/input/log hashes. The same oracle
  catches a copied-source fault granting ordinary output permission to a
  conditional-only origin. Eight further standalone extent cases and all 16
  pair combinations preserve exact stage/name/count obligations for extents
  1/46/47 (`verifier/extent-report.json`). Recorded allocator failures at final
  `native/native.log:3393` through `:3404`, malformed/PRECISE suffix cases and
  exact recoveries show rollback without partial response. The unknown-domain
  and raw-clobber witnesses are at `native/native.log:3200` and `:3346`.
- **P6/P7 — HELD, real compiler/shared-renderer proof and current banks.** Verified
  exact compiler GLSL/metadata against actual shaderSource, linked native objects,
  independently framed packets, uniform readbacks and every framebuffer byte.
  Final hardware has 27 draws, 1,152 words, 110,592 pixels, zero mismatches,
  44 fences/66 delayed completed polls and six short-bank rejections. Subnormal
  raw words stay exact while numeric results obey the explicitly derived
  preserved/flush set; ordinary and reciprocal/root oracles remain independent.
  The missing-contract compiled fault rejects before allocation; the wrong-index
  compiled fault produces 35 word mismatches with exact raw/orientation pages.
  `verifier/browser-audit.json` cites all four bound reports and eight additional
  receipt-tamper probes that all reject. Inspected the recorded screenshot;
  it agrees with the measured atlas/coupled workload. Six predecessor GPU oracle
  suites and the named consumer/legacy regressions pass unchanged comparisons.
- **P8 — HELD, changed-hunk coverage and fixed bounds.** Every added executable
  compiler C line has nonzero LLVM counts, including retry allocation failure,
  failed full revalidation, selected-arm pruning, emitted obligations and failed
  pair cleanup. `verifier/changed-line-coverage.json` classifies each added line,
  final adapter hunk, and explicit non-runtime waivers. The successful-retry
  no-bank check is an invariant guard, and unreachable JSON-overflow arms remain
  defensive under earlier GLSL/result bounds; they are not claimed executed.
  Final `native/native.log:1` proves 112-byte instructions, 12-byte facts,
  26,232-byte IR and 7,608-byte profiles. Wasm retains one 16 MiB buffer and its
  prescribed 256 KiB stack setting throughout the recorded workload.
- **P9 — HELD, final exact-head provenance and cold isolation.** Recomputed the
  entire receipt using the preserved clone's own module, native binaries and
  original command paths, without path rewriting. It equals the recorded receipt
  (`e1777763c18addfb174eb113be8362b8bec5238ef496c0d4e9baba387c07c63b`). Independently
  hashed all 103 copied artifacts (185,528,347 bytes), checked all 340 source
  bindings against the frozen Git source, and confirmed the clone remains clean.
  Cold report digest is
  `b2eaf6b831051c118dbeb55b36b48736ece6b6b608e6fa859d5daef6dffbf97e`.
  `verifier/final-cold-audit.json` and `final-cold-receipt-replay.log` retain the
  audit. The two adapter findings were evidence-only, repaired, and exercised by
  this final run; all unchanged HELD results were carried forward.

**SUITE:** retain `make verify-E6-T12e6b`, its independently checked exact migration
corpus, rational/bitplane oracles and compiled faults; retain the verifier's
public-API matrix, extent corpus, source fault and receipt-tamper scripts as
reproducible adversarial evidence. `verifier/evidence-digests.json` binds every
committed verifier artifact. No production guest graphics, PRECISE, captured Mesa
execution or throughput claim is added. No remaining finding or proof gap.

Verifier commands: `python3 evidence/virgl-constant-compiler/verifier/independent_attack.py`;
`python3 evidence/virgl-constant-compiler/verifier/extent_attack.py`;
`python3 evidence/virgl-constant-compiler/verifier/browser_audit.py`;
`python3 evidence/virgl-constant-compiler/verifier/final_cold_audit.py`;
independent `native_receipt.verify` / `wasm_receipt.verify` calls; LLVM changed-line
coverage audit; then `python3 tools/check_task_policy.py` and
`python3 tools/build_queue.py`.
