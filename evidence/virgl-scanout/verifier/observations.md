# Independent observations — final

All S01–S22 predictions are HELD after the formal worker handoff at `ad88508e`.
The lifecycle verdict is recorded in `review.md`. Initial predictions and literal
oracle remain byte-for-byte unchanged.

| Prediction | Current result | Evidence point |
|---|---|---|
| S01 | HELD | Own ordinary constructor/VIRGL-off case; worker default/live 127/127 and three proof exports absent. |
| S02 | HELD | Own strict literal wire/full reply checks with complete response guards; worker native validation/failure tests. Exact renderer profile preserves the pre-existing looser ordinary-2D header contract. |
| S03 | HELD | Worker cropped/index/resource/global-lease tests; own bad context/ring/trailing/rect/reserved fields and unchanged binding/presenter state. |
| S04 | HELD | Worker wrong global generation and foreign/non-scanout lease cases; own context destruction, rejected global DMA and command/draw completion claims. |
| S05 | HELD | Own accepted capture followed by unref/2x3 numeric reuse: old exact frame survives; later FLUSH rejects until new SET_SCANOUT. |
| S06 | HELD | Independent GL oracle records real PBO/fence/collection; worker before/after-issue cancellation and allocation/wait failures; own final native object counters zero. |
| S07 | HELD | Own `capture A survives real GPU write B` records for delays 2,5,9; real later upload turns storage white while canvas still receives A, and ordinary mutable read fails. |
| S08 | HELD | Final same-source B2 regression retains one-head order, full-u64 fences and cursor/task progress; scanout portable/native ordering and own high-bit flush response checks. |
| S09 | HELD | Own native GL zero-timeout/post-signal oracle, Machine.run poll count unchanged, and early-readback served mutation caught; worker wait-failure/reset paths. |
| S10 | HELD | Own immutable six-pixel literal oracle against actual built Canvas2D readback, including alpha 85/170/255; live pre-teardown screenshot visually inspected. Worker additional actual WebGL2 canvas corners hold. |
| S11 | HELD | Guest RAM mutation and Wasm growth before deferred display; ordinary 2D raw borrowed callback is copied before memory growth. GPU readback bytes are new owned host memory. `enqueueOwned` intentionally transfers trusted host ownership; mutating that transferred buffer is outside its contract. |
| S12 | HELD | Own successful guest FLUSH with presenter pending=1/drawn=0 and retainedFrames=1; actual paint independently increments drawn and releases the ticket. |
| S13 | HELD | Own supersession and duplicate/stale callbacks; exactly one pending frame. Worker no-draw/throw backend records failed, never drawn. |
| S14 | HELD | Own disable/reset and old 3D callback during pending 2D; stale-delivery mutation causes premature draw and fails the exact assertion. |
| S15 | HELD | Own actual 3D→2D→3D with Wasm growth; worker differing 2D dimensions; own explicit new 2x3 blue renderer frame changes real canvas size. |
| S16 | HELD | Context-free retained generation survives context destruction and public unref; replacement 2x3 blue resource paints only after new binding. |
| S17 | HELD | Own 2D enqueue rejection, Promise/throwing presenter capability and non-Error transport exception produce diagnostics/poison/error as appropriate; reset releases uncertain snapshots. Accepted guest completion and actual paint remain distinct. |
| S18 | HELD | Native counters return zero after each rig; worker quotas/cancellation/disposal. Own 260-frame loops bound presenter and correlated retirement logs to 256. Controller's latest recovery copy is explicitly visible until rebind/clear. |
| S19 | HELD | Own 3x2 capture checks exact 24-byte readback/conversion/row move/controller copy/backend staging/ImageData/upload counts; worker correlated actual-presentation bytes also rehashed. Tall 2x3 replacement has row-move accounting for only the swapped rows. |
| S20 | HELD | Independently viewed actual worker and final cold desktop screenshots; immutable image/manifest/kernel and every served chunk rehashed, real guest retired instructions and 25/28 draws. Default deployed Wasm hash and partial graphics pip checked. |
| S21 | HELD | Final exact-head cold clone at `85962c49` passes the complete gate with clean before/after status, unchanged explicit inputs and all error arrays empty. `audit.json` independently checks 3,524 bindings/assertions. The earlier cold failure remains failed; `cold-observation.md` preserves the diagnosis and narrow harness-only correction. |
| S22 | HELD | `orientation.json`, `early-readback.json`, `stale-delivery.json`: actual served-source changes produce the expected literal-pixel, pre-signal-collection and premature stale-callback draw failures. |

The baseline has 3,118 assertions, 303 records (including 260 bounded callback
error records), 93 browser turns and zero console/page/request errors. The
instrumented native replay has 17 passing tests: six new worker tests, nine
unchanged submission regression tests, and two independent default-method and
canonical-authority tests. These native replays are labelled as worker tests,
not invented independent proof. Independent hostile inputs and native GL checks
come from the verifier-owned browser harness.

Calibration artifacts are retained. The first draft erroneously required no live
sync at mailbox completion, conflating a signaled retained frame ticket with an
uncompleted GPU operation. It rejected a valid retained ticket. The corrected
oracle requires actual signaled collection and separately verifies ticket deletion
at frame retirement; no product code changed, and both GL sabotage and delayed
presentation tests establish that the correction did not weaken readiness proof.

Coverage and narrow invariant/host-diagnostic waivers are fully listed in
`coverage-review.md`; no unrelated SMP, JIT, live Mesa, throughput or production
3D claim has been added. The full binding audit was performed by this independent verifier; no
implementer was used as a substitute critic. An additional fresh read-only
spot-check after the final handoff found no blocker; its bounded result is in
`supplemental-binding-check.md` and is supplemental only.

A native dependency audit found the verifier crate's initially resolved lock had
five newer transitive versions than the frozen workspace. The initial native log
is retained as calibration. The final verifier lock now carries the exact root
versions; `cargo test --locked` reran all 17 scoped tests, and final LLVM export
merges only the new profiles. No runtime source or worker evidence changed.
