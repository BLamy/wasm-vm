---
id: E6-T12e7
epic: 6
title: Validate and execute structured TGSI unsigned conditionals
priority: 525.0269907
status: verified
depends_on: [E6-T12e6b]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only the inventoried UIF, ELSE and ENDIF structured conditional family,
including validated optional branch labels. Define a finite nesting limit and
validate complete structure before upstream translation. UIF uses the TGSI
unsigned x-lane condition; it must not reinterpret the operand as a float test.
Carry declared/initialized lane facts through actual control-flow predecessors;
one branch's write cannot establish a value on the other branch. Check captured
dataflow before choosing a validator that would silently initialize or alter
undefined/conditionally defined lanes. No generic IF, CONT or loops are added.

Conditional numeric authority from finite-bank contracts must join soundly with
initialization and ordinary-output authority. An unexecuted branch cannot donate
facts; every potentially selected bank word stays within the enforced domain.

## Deterministic acceptance

`make verify-E6-T12e7` executes independently authored nested true/false/else
fixtures with distinguishable per-lane pixels, noncanonical integer true values,
and both sides of every tested branch. Require native/Wasm parity, complete
structural rejection tests and unchanged original-hash outcomes (12 accepted,
seven PRECISE rejected). Do not strip PRECISE to make captured control-flow tests.
Record exact-head and clean-clone evidence.

## Adversarial verification

Attack dangling/duplicate ELSE, unmatched delimiters, wrong labels, depth limits,
END inside unfinished control, y-only truthiness, joins with one-sided writes
and uninitialized predicate lanes. Sabotage branch polarity or lane-fact merging
and require a literal pixel or deterministic rejection oracle to fail.

## Execution notes

The dependency was independently verified at
`26ed74a31e0ee3c1d43b4e174c8096d67898d920`. This remains one atomic S/high
conditional-semantics boundary: grammar, unsigned execution and sound joins must
be implemented together. Use an eight-level bounded structure stack, with heap
snapshots rather than full profile copies on the fixed Wasm stack. Preserve the
existing instruction, source text, output and memory limits.

Both syntactic predecessors must establish each subsequently consumed lane; the
initial implementation does not infer predicate correlations or eliminate known-
condition branches. Canonical physical float shadows carry values across joins;
initialization and ordinary-output authority meet by intersection, while surviving
numeric bank dependencies combine by union. Validate optional branch targets
against their actual matching ELSE/ENDIF, and reject an unfinished structure at END.

Use two explicit closed profiles: raw-bits-v8 for unconditional structured stages,
raw-bits-v9 for structured stages requiring the existing finite-bank contract.
Both existing raw-bits-v7 and new raw-bits-v9 require their complete domain record;
no new profile may make that obligation optional. Preserve older full compiler
results and original captured hashes. The consumer change is limited to recognizing
these two compiler profiles under the existing unchanged bank-validation rules.

Read-only capture analysis found four original fragment bodies with 25 UIF,
23 ELSE and 25 ENDIF instructions, maximum depth seven. All four remain PRECISE
rejections. The 5a243fc7 body reads TEMP6 at instruction109 although the outer false
path does not define it; a6143f11 reads TEMP2 at instructions49/60 after a one-sided
write and TEMP15 at instruction169 after another. Authored witnesses must reject
these conservative initialization gaps. Do not initialize missing lanes to zero,
strip PRECISE, or claim full original-corpus admission; sound path-sensitive
handling of those original gaps belongs to the later full-corpus boundary.

Production negotiation stays off while this isolated compiler/shared-renderer
slice is proved. Positive hardware fixtures must use actual unmodified compiler
results and decoded commands. Preserve predecessor proof oracles with explicit
successor adapters, avoiding fabricated historical receipts. Record one final
frozen-source pristine-clone proof, then a separate adversarial verifier verdict.

## Verification log

### 2026-10-03 — worker — implemented

Runtime source: `242ad5705dbdfd07b269c3e5850857c893af41e7`.
Final frozen submission source: `e0bdfe31f959547a1794de5027187ef29abe3d42`.
The intervening commit changes only six Python evidence checkers: the fresh
critic found Python boolean/integer equality aliases in recorded results. No
shader, consumer runtime, fixture, native driver or Wasm recorder changed. The
original warm recording remains honestly bound to 242ad570; it is preliminary
history, not the final repaired-checker proof. The final pristine-clone recording
below is the authoritative complete submission, performed once after the repair.

Commands:

```sh
VIRGL_STRUCTURED_CONDITIONALS_EVIDENCE_DIR=evidence/virgl-structured-conditionals/worker EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc make verify-E6-T12e7
python3 tools/virgl-structured-conditionals/cold.py --output evidence/virgl-structured-conditionals/cold-clone
python3 -m py_compile tools/virgl-structured-conditionals/*.py
python3 tools/check_task_policy.py
python3 tools/build_queue.py
git diff --check
```

The cold command runs the same deterministic acceptance from a fresh detached
checkout with compiler, Rust/Cargo, Node and Python overrides scrubbed. Its
checkout was clean before and after. This isolated C/Wasm compiler and shared
renderer boundary uses the pinned source guard, ASan/UBSan native driver, actual
fixed-memory Wasm, hardware Chrome/ANGLE Metal, full retained-result checks and
compiled fault artifacts; no unrelated Rust workspace or production demo claim
is substituted for those checks. Production negotiation remains off and there
are no web/dist or deployment changes in this slice.

Evidence root: `evidence/virgl-structured-conditionals/cold-clone/`.
The report binds 126 acceptance files (202,717,058 bytes) and the acceptance
receipt binds 362 source files. Key SHA-256 digests:

- `report.json`: `1895f2a1ed8908d0862e6ce15d3955f90c91bbc2d6a3b418cd1bb1cc0d06c643`.
- `acceptance/receipt.json`: `e009cdbc56f728247f02cd69da53fb8789d71b07e6514f4144f6ea6d720be865`.
- `acceptance/native/native-report.json`: `2c1e5ff6bdc2ee4963eda5ef663fad5d758d572098e128554675f260650bb065`.
- `acceptance/wasm/report.json`: `37c902ab70deb1ed4e60e252c513a68c3a0c2efef2e009edcca5f7f525b18ddd`.
- `acceptance/hardware/browser.png`: `4fb89f66fb3cd67fbee56c48eb70be6f33fee5191b9a828e1cb5589410725391`.

The recording demonstrates unsigned x-lane branch selection (including
noncanonical true words), complete delimiter/label/depth validation, conservative
predecessor initialization, physical float shadows and preserved conditional
bank obligations. It includes 790,883 sanitized native calls across 3,466 singles
and 236 pairs; all 3,151 prior singles and 221 prior pairs remain complete-result
identical. All 19 original hashes retain 12 accepted/seven PRECISE rejected.
The native workload includes 12,360 truncations, 324 hostile requests, 4,096
mutations across four seeds, every profile/stage recovery and 26 actual forced
allocation failures. The flow arena is 52,516 bytes beneath its 53,248-byte cap;
IR/instruction/profile layouts stay unchanged. Native serialized maxima are
63,369/109,235 bytes. Wasm records 16,557 calls, all native counterparts, ownership,
64 maximal-text stress calls and 33 real heap-pressure calls, recovering the full
malloc capacity while keeping one 16 MiB memory buffer and the 256 KiB stack.

Actual decoded-command GPU execution checks 39 draws, 1,088 complete raw words
and 159,744 pixels with zero mismatches, 60 fences, 90 withheld polls and six
short-bank rejections, then proves cleanup. The separate literal TGSI interpreters
and authored color tables check both branch directions. Two actual copied C
faults are built and executed natively and as Wasm: inverted polarity yields 48
word mismatches in the GPU oracle; unioning predecessor initialization admits
two otherwise rejected one-sided predicate cases and is detected without unsafe
GPU dispatch. Closed profile tests cover 50 exact public results, mandatory v7/v9
domains, forbidden v8 domains, and unknown v10 rejection. All retained shader,
constant-bank, decoder/resource/state/draw and async lifecycle leaf oracles pass
through explicit successor adapters without fabricating old full-gate receipts.

The runtime coverage recording exercises every added executable C region and
both outcomes of all added reachable branches. The exhaustive control-opcode
switch labels at raw_bits.c:201–203 are unreachable after the destination-free
control return; the verifier must classify this explicitly. The fresh critic's
17,904 independent cases, source sabotage and repaired typed-evidence attacks
are separate artifacts under `verifier/`, awaiting its final verdict. No desktop
FPS, guest GPU enablement, full original-corpus support, or 300-MIPS claim is made.


### 2026-10-03 — fresh verifier — VERDICT: verified

Worker submission: `a3f25a8adceec96493a351fe8811a330cb19ec37`.
Verified frozen source: `e0bdfe31f959547a1794de5027187ef29abe3d42`.
Predictions were written before inspecting recordings in
`evidence/virgl-structured-conditionals/verifier/predictions.md`. This verifier
made no implementation edits. The worker submission adds only evidence and task
metadata after the frozen source; every final cold-manifest file is tracked.

- P1/P3/P10 structure and initialization — HELD. An independently authored model
  agreed with 17,904 actual public-bridge calls: 16,384 exhaustive incoming/true/
  false/lane masks, 1,500 nested ASTs from seed `b39d0271`, and 20 structural,
  label, depth and uninitialized-predicate attacks. See
  `verifier/independent-summary.json` and its digest-bound complete
  `independent-results.jsonl.gz`; this model imports no worker fixture or oracle.
- P2/P4 unsigned selection and authority — HELD. The final native/Wasm results,
  literal GPU word interpreter and independent rational color checks preserve
  x-lane unsigned truth, noncanonical true words, y-only false, explicit y
  swizzles, nested arms, float shadows, output-authority intersection and finite
  bank dependencies. The final hardware report at
  `cold-clone/acceptance/hardware/report.json:1` records 39 draws, 1,088 words and
  159,744 pixels without mismatches; its screenshot was inspected. All 50 closed
  profile checks retain mandatory v7/v9 domains and reject domains on v8.
- P5/P6 bounds, recovery and compatibility — HELD. Recomputed native and Wasm
  receipts prove 790,883/16,557 calls, 26 injected allocation failures, 33 real
  Wasm pressure calls, complete recovery, a 52,516-byte heap flow arena and fixed
  16 MiB Wasm memory. All 3,151 historical singles, 221 pairs and 19 original
  hashes remain unchanged, with twelve accepted and seven PRECISE rejected.
  Explicit successor adapters retain the old independent renderer oracles.
  Production graphics remains disabled; no guest desktop or performance claim
  is verified by this task.
- P7 oracle sensitivity — HELD. Three fresh one-sided-predicate witnesses reject
  on the healthy compiler and become accepted after an isolated `&=` to `|=`
  initialization-join sabotage (`verifier/sabotage-results.json`). Separately,
  the actual compiled polarity fault produces 48 GPU word mismatches in
  `cold-clone/acceptance/sabotage-branch-polarity/report.json:1`. The worker
  source-fault suite runs both compiler mutations as native and Wasm; positive
  shaders and metadata are not patched.
- P8 evidence integrity — HELD after repair. Initial Python boolean/integer
  aliases were proof gaps, not semantic refutations. Six receipt-only repairs
  leave runtime and fixtures unchanged. At the final frozen helper digests,
  27 independent controls accept eight clean records and reject nineteen typed,
  missing-coverage, changed-pixel and resealed-coverage corruptions. See
  `verifier/repaired-receipt-results.json` and
  `verifier/final-coverage-type-results.json`. The initial extra-results file was
  overwritten by a worker rerun; `verifier/preliminary.md` and
  `worker-rerun-extra-results.json` explicitly preserve that provenance, and
  neither is substituted for the independent post-repair controls.
- P9 changed-code coverage — HELD. The final LLVM export reproduces all 96
  changed C branch counters from the held recording. Every reachable added
  executable region and both outcomes of its branches ran. Explicit waiver:
  `raw_bits.c:201–203` are exhaustive switch labels made unreachable by the
  earlier destination-free control-opcode return, which ran 736,990 times.
  Comments, declarations, enum/prototype additions and static layout assertions
  are non-runtime lines checked by the native/Wasm builds. See
  `verifier/coverage-audit.json` and `verifier/final-coverage-continuity.json`.
- Final pristine proof — HELD. `verifier/final-cold-audit.json` independently
  hashes all 126 acceptance files (202,717,058 bytes), compares their preserved
  clone copies, checks the clone is still clean, and recomputes the entire
  receipt using that clone's own modules and actual build paths. Its result is
  type-exactly identical to the saved receipt. Final receipt SHA-256:
  `e009cdbc56f728247f02cd69da53fb8789d71b07e6514f4144f6ea6d720be865`.
  The original warm source remains historical; it was not relabeled.
- SUITE: retain the independent deterministic model, compressed complete
  transcript, sabotage witnesses, typed-tamper recipes and coverage audits as
  reproducible verifier artifacts. The existing `make verify-E6-T12e7` remains
  the permanent full acceptance target with the repaired proof validators.

Verifier commands: `python3 evidence/virgl-structured-conditionals/verifier/independent_audit.py`;
`python3 evidence/virgl-structured-conditionals/verifier/sabotage_audit.py`;
`python3 evidence/virgl-structured-conditionals/verifier/repaired_receipt_audit.py`;
`python3 evidence/virgl-structured-conditionals/verifier/final_coverage_type_audit.py`;
`python3 evidence/virgl-structured-conditionals/verifier/final_cold_audit.py`;
`python3 evidence/virgl-structured-conditionals/verifier/final_coverage_continuity.py`;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`; `git diff --check`.
