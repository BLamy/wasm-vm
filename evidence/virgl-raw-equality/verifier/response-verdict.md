VERDICT: verified

Fresh incremental review of worker submission
`7c606fa45e1589d56244388ef66d479556d2745e`, using proof source
`02d39991b1589deff0c74ec3d62770eb09a407a8`. Predictions were written before opening
the response recording in `response-predictions.md` (SHA-256
`548ff72d7584fff848ca45d4f49c2b35b8bd464946dc5795814c1c831b587d20`).
The diff from `93829bad` changes only task documentation and five proof harness
files; compiler, consumer runtime, fixtures and historical evidence are unchanged.

- R1 / F1 maxima — HELD. Predicted exact typed reconstruction and rejection of
  missing/extra/bool/float/wrong maxima even with valid Wasm cross-links. Observed
  standalone/pair/GLSL maxima **63,369 / 109,235 / 58,201 bytes**, independently
  reconstructed from every checked result. Every native maximum mutation and
  all four propagated GLSL variants reject at the maximum predicate.
  Points: `proof-response/native/native-report.json:331634` (SHA-256
  `5d64c34e653153be853bfb906d869dabc608faa81ab18b83dd0a6bc372ed9459`);
  `response-audit.json:243`–264; source `tools/virgl-raw-equality/native_receipt.py:20`.
  Demand satisfied: all three values are reconstructed, typed and bounded.
- R2 / F2 sources and summaries — HELD. Predicted complete ordered source
  inventories and exact summary agreement with actual LLVM observations.
  Empty/duplicate/reordered inventories, wrong paths/digests/lengths/summaries,
  and bool/float counters reject; propagated full mutations also reject at the
  intended source predicate. Independently re-exported the recorded instrumented
  binary plus native.profdata: coverage.json is byte-exact, SHA-256
  `e4174ffe453c7ff717a22a5dc00932cbe3407869dd4b870b6696d2b086e2a9b0`.
  Points: `response-audit.json:27` (re-export command/digest), :159–236
  (native attacks), :271–296 (propagated attacks); source
  `tools/virgl-raw-equality/native_receipt.py:31` and :37.
  Demand satisfied: no source or coverage-summary omission is admitted.
- R3–R4 / F3 consumer — HELD. Predicted a complete independent ledger, exact
  source inventory, typed V8 counts and the genuine throwing getter's source
  range. Independently derived **2,535 complete ordered checks**, **2,545 parse
  calls**, and getter offsets **1830–1874, integer count 0**. All metadata/result/
  stage/name/order/omission/schema/source/getter/V8 mutations reject. The novel
  coordinated attack removes one forbidden13 check and decrements the parse
  counter to match; it still rejects at the complete ledger proof.
  Points: `response-audit.json:17`–25, :299–509; source
  `tools/virgl-raw-equality/consumer_receipt.py:56`, :75 and :109.
  Consumer report SHA-256
  `db5d5c07d91a90cbf367bc6e769f8172d5137e98d788da9ebb31dfb589589776`.
  Demand satisfied: all original F3 omissions and type tricks are rejected.
- R5 sensitivity — HELD. Predicted the new predicates are the cause of rejection.
  **64/64 independent forgeries reject**; disabling each of seven predicates
  only in memory allows its targeted forgery to escape. Restored final clean
  control passes. The actual promoted worker gate also fails with maxima
  validation disabled: `promoted proof forgery escaped:
  recordedMaxima-singleResultBytes-bool`; it writes no false passing receipt.
  Points: `response-audit.json:510`–544;
  `response-test-sabotage.json:11`–13 (SHA-256
  `d8c1b0533db36b4c851ca0ccb165c83cc3f9eed1aa043a480bf9249819091b72`).
  Demand satisfied: promoted tests detect the removed proof guard.
- R6 closure and changed hunks — HELD. The full final receipt independently
  regenerates exactly, SHA-256
  `3ab15d401d6e870d082905397cfb57c3356567975f518c34467760fcc16a19ca`.
  All **177 source bindings**, **75 record bindings**, and **16 actually imported
  local validators** match; the new consumer auditor is included. The 38 promoted
  negatives bind the saved initial positive receipt, and the final receipt seals
  both. Initial positive SHA-256
  `0f69b58575820ee2ed81f56c44918721248ee935d55bcd1db71409c12b6cabcd`;
  negative SHA-256
  `1a77143b724280a07df2dff58229cfb2e04956d6346c18538208a5cecde18630`.
  Independent tracing directly executes 128 changed Python physical lines;
  19 blanks/comments/docstrings/literal continuations are explicitly waived.
  No executable audit hunk is unproven. The 38 named recorded failures exercise
  the promoted matrix; the independent sabotage executes its escaped-forgery
  assertion. Recipe lines34/36/37 execute, demonstrated by both exact seals and
  acceptance.log:119/121/124; line35 is a comment.
  Points: `response-audit.json:38`–58 and :546;
  `response-coverage.json` (SHA-256
  `811d91796373dc833da02d9a40de56b674abfe1528b704e20705cb5346d1757e`);
  `proof-response/acceptance.log:121`; source
  `tools/verify-virgl-raw-equality.sh:34`.
  Demand satisfied: complete source/artifact closure and executable-hunk coverage.

Every `response-audit.json` point above binds the same artifact SHA-256:
`543725027f839427bd6e095ab07fab195f4cc9a893123618a0d1831503259b87`.
Paths beginning `proof-response/` resolve under `evidence/virgl-raw-equality/`;
other response artifacts resolve under `evidence/virgl-raw-equality/verifier/`.
Exact commands and digests are preserved with this review.

Carry forward the original review's HELD results from `93829bad` and
`verifier/verdict.md`: IEEE masks, snapshots/definedness/output authority,
closed profile13 and stronger profile obligations, all4,004 unchanged stages,
all264 retained pairs, all19 originals at12/19, exactly eight unchanged-body
migrations, byte-exact retained GPU probes, bounded layouts/recovery,
typed changed-runtime-line LLVM/V8 coverage, native/Wasm source faults and
four independent hardware failures, known-NaN rejection before GPU,
3,088 independent known-fact calls and 2,112 novel physical GPU words.
The final exact pristine clone remains at `a7be954c`; cold report SHA-256
`dc7de94e200cae79eacd702b34e8f3f393aa47015d7a33a16d25f05043a7fb1b` and
receipt `f92373e057bd0a41b12a92e21b4a8ae372d397ef7571e84edbdcdd79ea11ddd7`
are unchanged. No second clone or unrelated gate is necessary. Runtime files
remain byte-exact to `e5359148`, including bridge.c SHA-256
`4d99a3fa2f1fdde15448a935baf4276bf0196b6c4543e693500ebc48b55f2df5` and
raw_bits.c `9b36cfb3c5c5ae53fe14ffa7705870bd980b4b44e185140f7da7007a8f37ceaf`.

SUITE: keep the worker's permanent 38-case negative receipt gate and this fresh
64-case critic, source/record/LLVM reconstruction, coverage table and sensitivity
records. Guest acceleration remains disabled; full guest graphics, all19,
PRECISE/modifier/noncontiguous-mask expansion and 300 MIPS are not claimed.
