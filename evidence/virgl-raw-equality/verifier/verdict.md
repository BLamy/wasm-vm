VERDICT: needs-evidence

Fresh critic of worker submission `cdc9ebd14407976a2ea2fb5a5a2cf634078c2726`;
runtime frozen at `e535914881f6a6f1c623513f3531ad83ddcca34b`, authoritative final
recording frozen at `a7be954c1f3bea9dd1e96522e890fa012197c6fe`.
Predictions preceded evidence inspection in `predictions.md`.
No product implementation or worker harness was changed by this verifier.

- F1 / P9 — NEEDS EVIDENCE: maxima are neither typed nor reconstructed. Predicted
  the full auditor would reject `stageGlslBytes: true`, `1`, or `58201.0` against
  actual maximum58,201. It accepts all three when the altered native report's
  SHA/length is propagated faithfully into the Wasm native-report cross-link.
  The unchanged transcript/profile still holds58,201. Citation:
  `propagated-attacks.json:7` (Boolean), `:23` (wrong integer), `:39` (float);
  digest `6bbd0e2a798c3b22174fc8ec8722205feab34bd0a275ef0abad3ce721284f009`.
  Native-only attacks also accept Boolean/float/wrong integers for all three
  maxima in `receipt-attacks.json`. Code point:
  `tools/virgl-raw-equality/native_receipt.py:54` validates transcript observations
  but never reconstructs `recordedMaxima`; `receipt.py:134` copies it. Demand:
  reconstruct the three maxima from the complete actual serialized results,
  require exact JSON integer values and enforce their existing caps.
- F2 / P9 — NEEDS EVIDENCE: native/source coverage inventory is not closed.
  Predicted omitting mandatory recorded sources or inventing a coverage source
  would reject. The full auditor accepts `sources: []`,
  `coverage.sources: []`, a coverage summary with line coverage0 despite its
  unchanged real export, and a digest consisting of64 zeroes. Citation:
  `propagated-attacks.json:55`, `:71`, `:87`, `:103`, same digest as F1. Additional
  wrong source byte length and invented source path are accepted by the native
  auditor at `receipt-attacks.json:1024` and `:1115`; digest
  `6bb33e2a808997107bd3771cae2c7610b9fa8c10ab908fb2652d9a33f48d994d`.
  Code point: `native_receipt.py:62` iterates an optional inventory and `:64`
  calls typed primitives without checking source/summary correspondence.
  Demand: require the exact mandatory compiler/harness inventory and both
  implementation coverage sources, check their frozen bytes/digests, and match
  their filenames/summaries to the actual LLVM export. The pristine recording's
  current sources and summaries independently match; this finding is about
  proof acceptance, not a stale or incorrect actual recording.
- F3 / P4,P9 — NEEDS EVIDENCE: the consumer ledger can omit its acceptance tests.
  Predicted the full auditor would reject an empty check list, removal of all
  forbidden13/unknown14 checks, missing recorded sources and noninteger getter
  counts. Instead it accepts checks0 or2,503 (instead of2,535), sources[], and
  gettersFalse/0.0, while normalizing the final receipt getter count to0.
  Citation: `receipt-attacks.json:1341`, `:1354`, `:1367`, `:1380`, `:1393`, digest
  above. Code point: `receipt.py:115–122`; its V8 comparison uses only a lower
  bound against the attacker-supplied list length, and it never reconstructs
  the mandatory checks or verifies consumer source bindings. Demand: derive the
  complete ordered expected metadata/check ledger from the checked native
  results and literal consumer attacks; require the closed schema, exact sources
  and typed counters, including actual getter-avoidance observations. Record the
  touched consumer harness and rerun these promoted negative checks.

HELD results for incremental re-verification:

- P1 / actual binding integrity: final cold report/receipt digests match the
  worker claim. Independently checked all75 copied cold artifacts against the
  retained clean clone and reconstructed all175 source/73 record bindings.
  All15 actual imported local Python validator dependencies are bound. The full
  untouched frozen receipt regenerates exactly. `recording-audit.json` digest:
  `886ab3a3c2a7efe6cc9c20c44bd7856b05004a289d58fbc415064ff71e28a6af`.
- P2,P3,P10 / masks, aliases and facts: 3,088 independently authored public CLI
  checks under four new seeds pass, including both opcodes/stages and both
  destination aliases, known/unknown self comparisons, conservative direct
  output authority and complete facts derived from masking. A new identical
  signaling-NaN witness catches the real known-fact source fault before GPU use.
  `known-facts/report.json` digest:
  `7b7c1446e930467863c6994d725a67a60ba3d0cdf66e489cd53d47529cacc0e7`.
  The fresh hardware attack separately passes2,112 complete words across16
  vertex/fragment kernels, with all32 bits reconstructed, both source aliases,
  unknown self comparisons, four new seeds and zero console/page/request errors.
  `seeded-gpu-authoritative/report.json` digest:
  `96b1c3c741c717ce07923ad3c2f50815cf80870f76b2f9661bc2ee79dd93de6d`.
  Screenshot inspected. The worker's640 complete words, all8 migrated GPU bodies,
  modifier/PRECISE/mask/consumed-lane rejection and mixed7–13 precedence remain
  HELD through the full frozen receipt; the critic independently reconstructs192
  direct predicate words from physical feedback/pixels.
- P4 / runtime consumer: actual healthy ledger and V8 capture retain2,535 checks,
  2,545 parse calls and zero getter calls. Genuine unknown14 and every forbidden13
  domain/access/count shape reject. Only ledger sufficiency is unproven in F3.
- P5 / compatibility: independently compared every stage/pair to the bound E9
  baseline: all4,004 other stages, all264 pairs and all19 original bodies/results
  are exact; exactly8 named immutable negative bodies migrate to13; originals
  remain12/19. Both successor GPU probe prefixes are byte-exact. Historical whole
  gates are never claimed. Carry unchanged E9 HELD results forward.
- P6 / runtime bounds/recovery: the reconstructed frozen receipts preserve
  602,100 native/14,241 Wasm calls,16 native allocation faults, all14-profile
  recovery,64 maximal Wasm stress calls and33 real pressure calls. Actual layouts
  remain26,352/7,616/52,644 bytes; observed maxima are63,369/109,235/58,201.
  Fixed16MiB memory and available requested4KiB chunk capacity hold. No
  byte-granular leak claim is made.
- P7 / source sabotage: all five uniquely pinned actual faults retain complete
  native/Wasm parity; all four emitted faults fail independent realGPU words.
  Known-NaN admission fault rejects all four safe selection witnesses before GPU.
  These fault reports and the critic's new signaling-NaN control remain HELD.
- P8 / runtime coverage: re-exported frozen LLVM counters are byte-identical.
  All25 changed executable C lines execute (4 bridge/21 raw), including124
  known-equality executions. WAIVED: four comment/blank/function declaration
  lines; header enum/mask/type declarations and static assertion have no separate
  runtime behavior and their consumers/layouts execute. The new consumer
  membership expression executes (module1/map callback7). Documentation, task
  decomposition, Make target and declarative fixture metadata are waived as
  nonruntime changes with direct result checks; acceptance/receipt sufficiency
  remains blocked only by F1–F3.

SUITE: preserve the critic's known-fact/alias seeds, whole-word hardware oracle,
source/coverage reconstruction and source-fault control here. Receipt attack
scripts have `--expect-rejected` to become deterministic negative regression
checks after repair. No unrelated workspace, guest graphics, PRECISE, all19,
performance, deployment or second pristine-clone run is requested. Rerun only
the missing proof and the touched recording/auditing harness; carry these HELD
runtime/dependency/digest results forward unless their boundary changes.

`commands.json` records successful final commands and harness-only precheck
corrections. `manifest.json` binds the complete promoted verifier artifacts.
