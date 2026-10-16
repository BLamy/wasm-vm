VERDICT: verified

Fresh critic `/root/constant_transport_verifier` inspected the diff and attacked
the frozen worker claim. A separate read-only helper independently checked the
packet/compiler/framebuffer/source/cold bindings. Neither session implemented
the runtime or changed the worker harness. Predictions were recorded beforehand
in `predictions.md` (SHA-256
`2e81d7560fe828ad9e60f2cca6d1695374c8c96366a2146ca302aa972335edae`).

Frozen runtime/harness: `81cd3a4c403176be4b0191fa00ed37f4fd1e1e35`.
Worker claim: `68186f6edf63a6f3c0e2160892a2bc5b868ab8f8`.
Final independent audit: `final-audit.json`, SHA-256
`07fde5d83336cd29e7c4b271bab7bfd1be9b70aa1bff6e4afca0c8bfd4b9bacf`.
Its `artifactDigests` bind the exact scripts, raw reports, coverage and screenshots
cited below. No refutation or remaining evidence gap was found.

- **P01–P03 HELD — raw boundary and application semantics.** Worker decoder
  evidence contains the literal 748-byte/184-word and 764-byte/188-word packets,
  exact accepted words and rejection codes. Independent four-seed sweep passed
  1,046 cases: 80 accepted and 966 rejected, including both stages, slot/stage
  neighbors, 32-word compatibility, signed zero, finite subnormals/maxima,
  non-finites at indices 0/3/31/179/180/183, every aligned truncation and detached
  caller storage. Malformed tails apply zero commands; valid short prefixes
  preceding semantic draw failure truthfully report one applied command.
  Citations: `decoder-attacks.json#/stats`, `#/cases`, `#/detachedOwnership`;
  worker `hardware/report.json#/acceptance/rigs/0/attacks`; independent
  `normal/report.json#/acceptance/rigs/0/criticRejections` and raw submissions.
- **P04 HELD — bounded ownership.** Every observed upload has a whole vec4 prefix
  of at most 184 words, only base index 0, and the selected native program owner.
  Inspected stored data remain under the 23,552-byte logical bound. The unchanged
  16-subcontext quota bounds 2 stages × 184 words × 4 bytes; JavaScript overhead
  is explicitly excluded. System-UBO and other quotas are unchanged. All 432
  worker native objects are released, along with all renderer/resource budgets.
  Citations: `final-audit.json#/workerNativeObjectsReleased`; frozen
  `decoder.mjs:12`, `state.mjs:6`, `state.mjs:470`; worker rig `glEvents` and
  `finalBudgets`/`finalResourceBudgets`/`glObjects`.
- **P05 HELD — compiler identity.** All 19 original full results equal held E3,
  with 12 accepted and 7 rejected; each of the 8 exact hardware strings matches
  native transcript, Wasm output and actual `shaderSource` consumption in full.
  C frontend/profile/vendor and legal CONST0..45 address boundary are unchanged.
  Citations: `binding-worker-audit.json#/checks/1` and
  `binding-cold-acceptance-audit.json#/checks/1`; detailed audit in
  `binding-findings.md` B2.
- **P06–P07 HELD — four distinct extents.** Actual Metal results are
  declared/active/upload 46/46/46 for high and low reads, 47/47/46 for both ordered
  declarations, and 46/0/0 for wholly inactive arrays. Inactive VS/FS/both make no
  upload to that stage and draw without its constants. Actual low-read shaders
  retain 46; the 32-word input therefore fails under the expressly conservative
  rule. Shorter/absent reflection wrappers are labelled validation, not actual
  optimization observations. Citations: `final-audit.json#/summary/reflection`;
  worker `validationRigs` named `vs-shorter`, `fs-shorter`, `vs-absent`,
  `fs-absent`; `binding-worker-audit.json#/checks/3` full-frame reconstruction.
- **P08 HELD — matching stage component boundary.** Real limits are 4096/4096.
  The independent pass-through limit matrix rejects 183 and accepts 184 for
  high arrays, rejects 187 and accepts 188 for ordered arrays, separately in VS
  and FS. Each accepted exact neighbor performs an independently checked draw.
  Unsafe integer, null, undefined and negative-zero host limits reject both
  stages; the worker covers negative/fraction/string/NaN/infinity as well.
  Actual linking precedes every accepted reflection. Citations:
  `normal/report.json#/acceptance/rigs/1` through `#/acceptance/rigs/8`,
  `#/acceptance/faults`; worker `hostUniformComponents` and validation rigs.
- **P09 HELD — reflection rollback.** Fifteen worker reflection faults fail with
  unchanged publication and accounting and no native leak; late FS failures
  delete the exact VS UBO just allocated and the linked program. Five independent
  metadata faults (count 0/48/fraction, wrong encoding/type) also reach late FS
  failure and release that UBO. Valid recovery draws succeed. Citations:
  `final-audit.json#/summary/rollback`; `normal/report.json#/acceptance/rigs/9`
  through `#/acceptance/rigs/13`, including event IDs and pre/post snapshots.
- **P10 HELD — retained host padding.** Two independent four-word poisons in
  both VS/FS element 46 survive restores unchanged. Runtime events contain only
  base-index legal-prefix uploads; both full framebuffers remain correct.
  Citations: `final-audit.json#/summary/padding`; worker order rig `padding`,
  `draws`, `glEvents`; `binding-worker-audit.json#/checks/3`.
- **P11 HELD — high data reach real geometry and color.** The helper independently
  reconstructs all 44 worker and cold framebuffers (45,056 pixels per run) from
  raw commands and original TGSI, without using generated GLSL or reported
  expected colors/rectangles. My independent asymmetric fixtures check another
  19,456 pixels, including different VS and FS owners' values. Citations:
  `binding-worker-audit.json#/checks/3`,
  `binding-cold-acceptance-audit.json#/checks/3`,
  `normal/report.json#/acceptance/oracle`, `#/acceptance/rigs/*/criticFrames`.
- **P12 HELD — completeness precedes index work.** Full→180 and full→empty
  replacements store precisely the new array; prelinked draw-alone rejection
  preserves snapshots/budgets and emits no index read/staging or draw. Short
  state never inherits the old suffix. Async rejection may create the existing
  submission-drain fence after its planning serial advances; that fence is not
  an index-staging fence and is polled/deleted. No zero-fence claim is made.
  Citations: `final-audit.json#/summary/incomplete`;
  `normal/report.json#/acceptance/rigs/0/criticRejections` and final two async
  rigs' `incomplete/events`; frozen `state.mjs:522` before index planning.
- **P13–P14 HELD — owner and generation isolation.** Worker A/B/A context and
  subcontext sequences use identical numeric shader handles; low/high poison
  disappears on restore. Both numeric-ID reuse paths start with empty constants
  and reject until uploaded. Independent asymmetric A/A→B/B→A/B→B/A sequences
  survive short state in the other owner, poisoning, subcontext switches and
  recreated context 22. Citations: worker primary `lifecycle`, `poison`, `draws`;
  independent `normal/report.json#/acceptance/rigs/0`, especially
  `criticFrames`, `criticPoison`, `criticRejections`, raw submissions.
- **P15–P16 HELD — novel detached-input and scheduling attack.** The worker's
  four varied step schedules preserve mutated caller inputs and short/empty
  rejection. Independent seeds `6da0c389` and `db81295b`, step budgets 4 and 7,
  detach each actual caller buffer after begin; both asymmetric outputs remain
  correct, short VS rejects before index staging, and full recovery succeeds.
  All resources drain. Citations: `final-audit.json#/summary/async`;
  `normal/report.json` final two rigs' `detachedSubmissions`, `incomplete`,
  `criticFrames`, `glObjects` and final budgets.
- **P17 HELD — two sensitive output controls.** Worker truncation to 180 words
  compiles/links and fails the first expected colored pixel as blue. My separate
  served-source FS CONST45→CONST5 upload alias compiles, links and draws, then
  fails at (4,12): expected [96,128,159,159], observed [191,223,255,159]. Exact
  untouched and served source hashes are recorded, and source files stay intact.
  Citations: worker `sabotage/report.json`; independent
  `alias-sabotage/report.json#/sabotage`,
  `#/acceptance/rigs/0/criticFrames/0/failure`, `#/acceptance/rigs/0/glEvents`.
- **P18 HELD — execution coverage.** Source-bound V8 ranges account for all
  20 added executable runtime lines. The inactive-array condition's second
  operand is exercised by worker inactive/fault cases; the existing non-drawing
  inspection spread is covered by the state regression. All zero-count ranges
  in an individual capture intersecting changed lines are corroborated by a
  positive count in another applicable capture. No changed executable runtime
  hunk is waived. Citations: `coverage-audit.json#/files`,
  `#/executableAddedLines`; worker/cold state/draw/async/flat regression receipts.
- **P19–P20 HELD — exact head, cold clone and scope.** The binding helper checked
  431 source bindings, 32 worker records, 35 cold copies against the retained
  clone, 13 claim digests, clean frozen clone status and hostile environment
  scrubbing. Claim changes after the frozen head are only evidence/task metadata.
  Production remains disabled and no web/crates/activation boundary changes.
  No desktop MIPS/FPS or real Mesa acceleration claim is accepted. Citations:
  `binding-findings.md` B1/B5/B6, `binding-cold-claim-audit.json`, and
  `binding-worker-audit.json#/checks/4`.

## Diff coverage classification

- `decoder.mjs` limit and every added executable `state.mjs` line: executed,
  per the precise coverage map above. Two comments and one closing delimiter:
  waived as non-executable structure.
- Existing decoder acceptance additions and the new raw/native/hardware suites:
  executed by worker and pristine acceptance, with independent transcript,
  packet and output checks. New authored fixture strings are all translated by
  both compilers and actually compiled/linked for the claimed hardware paths.
- Gate/Make target, receipt and pristine-clone harness: executed by the frozen
  acceptance/cold logs. Generic diagnostic reporting, browser launch overrides
  and timeout cleanup are proof plumbing, not claimed transport behavior; their
  unused environment-failure branches receive no product correctness credit.
- README/contract/decision/task/queue changes: waived as declarative documentation
  and lifecycle bookkeeping. Their concrete runtime claims agree with the
  recorded extents, bounds and disabled production boundary.

## Suite disposition

Promote the committed deterministic decoder sweep and independent hardware
attacks as repeatable verifier harnesses. `README.md` gives the exact commands,
including recurring 183/184 and 187/188 stage-limit neighbors and the separate
alias sensitivity control. Binding and coverage scripts remain reproducible
audits of this immutable submission. No runtime fix was needed.
