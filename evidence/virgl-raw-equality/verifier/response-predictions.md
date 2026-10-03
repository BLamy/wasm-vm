# Incremental F1–F3 verifier predictions — 2026-10-03

Written after orienting on the complete proof-only diff
`93829baddc66a06fe66b175a98f0717b73e09654..02d39991b1589deff0c74ec3d62770eb09a407a8`,
before reading the response recording or its receipt. The review is limited to
the three recorded proof gaps. No status change or commit is authorized yet.

- R1 / F1 — The clean exact-head native and full receipts regenerate. All three
  `recordedMaxima` are exact nonnegative integers reconstructed from every
  transcript-checked standalone/pair result and successful stage GLSL. Removing,
  adding, increasing, decreasing or changing a maximum to bool/float rejects.
  Full-auditor mutations also reject after honestly propagating the modified
  native report's byte length and SHA-256 into the Wasm cross-link. Rejection
  occurs at the maxima proof, rather than a stale cross-link.
- R2 / F2 — Native source inventory is complete and ordered, matches actual
  compiler/harness bytes, and is committed at the recording's source head.
  Coverage inventories contain exactly bridge.c and raw_bits.c, using actual
  LLVM filenames, source bytes/digests and the export's summaries. Omission,
  duplication, reordering, invented paths/digests/lengths and changed summaries
  reject. Boolean or float counts remain invalid. A source-summary mutation
  cannot escape by propagating a truthful Wasm report binding.
- R3 / F3 — The independent consumer reconstruction matches all 2,535 ordered
  name/stage/metadata/result observations, including every forbidden13 field
  shape, genuine unknown14 and owned13 observation. Omission, reorder, duplicate,
  wrong name/stage/result/metadata and bool-as-number mutations reject. The closed
  report schema and exact two-file consumer source inventory reject omissions
  and extra fields. Getter count accepts only the integer zero. A coordinated
  removal of one forbidden13 check and corresponding decrement of the V8 parse
  counter also rejects at the ledger proof, despite satisfying count accounting.
- R4 / Consumer coverage — Both actual V8 module inventories are present and
  unique. All counters and offsets are bounded nonnegative integers. The unique
  parseConstantDomain counter equals the complete source schedule (ledger plus
  accessor, repeated unknown14 and loop checks), and the unique real throwing
  getter has the exact source offsets and integer zero count. Omitting either
  module, falsifying parse schedule, changing getter offsets/count, or using
  bool/float coverage primitives rejects without changing compiler semantics.
- R5 / Promoted test sensitivity — Every original F1–F3 exploit rejects in the
  promoted negative gate, and untouched full controls pass both before and
  after it. Disabling each new proof predicate in an ephemeral in-memory verifier
  makes its corresponding forgery escape, demonstrating the tests exercise the
  intended predicate. No tracked worker source is modified for this sabotage.
- R6 / Source and artifact closure — The response has the frozen proof-source
  head, binds every actually imported local validator (including the new
  consumer auditor and negative gate), and seals positive and negative evidence
  with typed byte lengths and SHA-256 values. The final receipt independently
  reproduces. Changed harness paths are exercised by positive reconstruction or
  specific promoted failures; declarations and CLI plumbing receive explicit
  reasoning where counters are unnecessary.

Carry forward all HELD results from the original verifier commit `93829bad`:
runtime masks/authority/profile13 obligations, all retained compatibility,
physical GPU words and source sabotages, changed runtime-line coverage, bounded
recovery, independent known-fact and 2,112-word seeded hardware attack, original
exact final pristine clone at a7be954c, and unchanged E9 results. The source,
dependency boundary and authoritative evidence for those claims have not changed.
No second cold clone or unrelated historical/workspace gate is required.
