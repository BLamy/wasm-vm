# E5-T26l — fresh verifier preflight

Pre-evidence ledger at activation head `b1024e77966d2f844c93cca5fc7a1bbe0925e166`, 2026-09-08. Read the full 85-line task, activation diff, baseline queue/discovery/pump source and the existing 619-line async-pipeline fixture. At inspection there is no worker diff in the three assigned core files; the L Make target/browser harness are still to come. This is task/source preflight, not approval of an unseen implementation or evidence.

**No material scope/acceptance blocker identified.** The task is coherent as a selection-only runtime boundary. All dependencies named by the task are currently verified. Preserve the existing `stage → cancel_stale → take_recount → refresh surviving scores → pop` sequence. The earlier broader proposal's pre-admission refresh and cancellation-reordering concerns do not become new L requirements. Freshness at incoming admission and starvation freedom are explicitly outside this claim.

## Falsifiable predictions before evidence

All execution dispositions below are **NEEDS EVIDENCE** until the frozen submission; none is a post-hoc caption.

| Prediction | Concrete state/oracle and intended coverage |
|---|---|
| P1 — bounded score-only mutation | Immediately around refresh, surviving request bytes, physical PCs, op lengths, terminators and generation stamps, resident order, depth/cap, stats and recount are identical. Only stored hotness changes to the existing discovery lookup. Visit count is bounded by resident count; empty refresh makes no lookup. No pop/re-push, sort, extra nomination, allocation proportional to guest history, or discovery mutation. Equal and saturated values preserve current tie semantics. |
| P2 — exact integration point | Bounded staging, post-staging stale cancellation and recount retain their current order and behavior. Refresh sees only remaining jobs and the **post-recount** lookup, including threshold fallback after a hit record is cleared. It runs before selection even if no nominations were newly staged. It does not move into the block-entry hot path, change admission comparisons or escape existing pump timing. |
| P3 — real cross-pump selection | A Machine guest actually leaves resident compile work after exhausting a host attempt budget, then accumulates interpreted hits on a still-pending later job. With no newly staged work, a later pump submits that newly hotter job before the former stored-score winner. Assert exact submitted PCs/order, not just positive compilation or counters. Compare the same fixed retirement boundaries against an independent interpreter Machine, including registers/PC and RAM/state digest. The staged-two-job standalone reproducer alone cannot satisfy this prediction. |
| P4 — stale and re-nomination safety | Old-generation resident and incoming requests are cancelled by the unchanged post-staging filter before refresh/pop. Same-PC fresh requests are not refreshed from an old request's priority or cleared by the refresh itself. Live-byte/generation refusal remains authoritative after ranking; reset/missing-hit/recount cases retain existing fallback and re-nomination semantics. No generation or byte check is replaced by a hotness check. |
| P5 — inert paths, bounds and progress | No executor, disabled JIT, exhausted attempts and empty work retain their no-work behavior. Zero new staging does not disable selection of an existing backlog when attempts remain. Browser-shaped aggregate attempts ≤8 and staged nominations ≤64 hold across internal/final pumps; queue cap256, decoded4096 and module24/default clocks/thresholds stay unchanged. Existing finite-burst backpressure/recount progresses without exceeding bounds. Refresh alone changes no bookkeeping counter; changed future selection may legitimately change later workload totals. |
| P6 — sensitivity and portability | Frozen affected native/differential, no_std WASM, real browser-JIT parity/cooperative-budget and harness recordings exercise changed hunks. Removing only the refresh call in an isolated copy makes the cross-pump selection assertion fail; stale protection still holds. One bounded novel case targets selection/recount interaction. One final exact-head scrubbed local clone reproduces the prescribed runtime proof; no repeated unrelated F/K experiments. |
| P7 — actual browser screen, honest result | Built demo reports126/0 and no non-favicon errors with L visible. A new cold checkpoint authenticates the new release rather than rebinding an old seal. The unchanged default-policy physical-play diagnostic supplies original T0/end, restored CRC, real key/cursor/focus observations, finite successful playback and fresh non-silent PCM. Report its actual cap outcome, including failure; no observer subtraction, default-tuning change, F verification or presumed speedup follows from L correctness. |

## Source anchors and sufficiency notes

- `crates/core/src/lib.rs:4084–4094` owns inert returns and the pump timer; `:4100–4129` owns staging, cancellation, recount and selection. A refresh inserted only inside the staging loop would miss P3. Both periodic and final pumps reuse this boundary; aggregate budgets are initialized once per cooperative scope at `:3728–3743` and attempts charged at `:4194–4197`.
- `crates/core/src/compile_queue.rs:109–149` owns existing backpressure/cancellation; `:154–171` compares stored scores using strict `>` and removes the winner without reordering remaining jobs. Existing overflow uses `swap_remove`: preserve that deterministic resident-vector order, not an invented universal chronological-order guarantee.
- `crates/core/src/dispatch.rs:591–613` clears hit records on re-nomination/invalidation; `:618–626,732–735` provides saturating queued-hit accounting and threshold fallback. Refresh should copy the current value, not silently retain `max(old,current)` after a reset. Planned bounded novel variant: a formerly highest stored score loses its hit record through existing re-nomination while generation remains unchanged; another resident must win using the resulting current scores, with payload/order/counters untouched.
- `crates/core/src/lib.rs:4136–4169` still reads live bytes and checks generation/bytes before installation. A test that merely accepts both historical encodings cannot alone demonstrate rejection at the changed pending-job boundary. The task appropriately demands that boundary's deterministic fixture plus held/affected real-executor parity evidence.
- Existing `async_compile_pipeline.rs` deliberately uses a stalled recording executor. That is legitimate for observing **Machine selection while execution remains interpreted**, but is not proof of compiled execution; P6's actual WASM parity is separate. No new public introspection/profiling API or guest command is needed for these assertions.

The task's one browser screen measures this candidate; it does not establish a statistically stable benefit. A negative F cap does not by itself refute score-refresh correctness. Conversely, even a fast diagnostic alone does not verify F. Existing F functional/architecture, K, and unchanged dependency HELD records carry forward; only changed selection and its affected integration are reopened.

## Initial source pins

These mechanically checked hashes identify the **pre-implementation baseline**, not future frozen code. Unrelated pre-existing E6/tooling and two dirty dist-manifest changes are outside this review. No evidence recordings were opened, tests/builds/browsers run, or implementation/status/queue/commits changed in this preflight.

| File | SHA-256 |
|---|---|
| `tasks/epic-5-the-window/E5-T26l-live-compile-priority.md` | `28b1f223da11031e5a01108cf79ab3e7f70eaee6c2d323bdc40043cc82e07b70` |
| `crates/core/src/compile_queue.rs` | `bcf1649fa2c9b6fb7ecc0eff13702ec6e806603b12c222ef2cf7c9836ebbae7b` |
| `crates/core/src/lib.rs` | `7f8c72c28cd51afaf44834fd809e9781ea6c27c6d8f6f2f97f1452bb77f9791a` |
| `crates/core/src/dispatch.rs` | `5e6ccdd33f9dc9c948dde6e8daa4b69d8f008330169cdecbdfb3356b3d6dc04d` |
| `crates/core/tests/async_compile_pipeline.rs` | `fae3bcf2bda807e48272417ad67da386e46c28972f3a67fa1d8013dca0cd3479` |

## Incremental orchestration source preflight — 2026-09-08

Read the new 71-line wrapper, all five control-flow test cases, Make target diff and single roadmap entry. No tests, gates or browser recordings were run/read for this increment. Runtime worker changes remain outside this orchestration-only inspection.

### R1 — success-record head contract mismatch (source-confirmed blocker)

**P7's positive-result orchestration is FAILED at the inspected source.** `tools/verify/e5-t26l-browser-priority.mjs:61–64` chooses `diagnostic-iteration.json` for child exit 0, then unconditionally requires `raw.head === head`. The unchanged proper F producer writes that success record at `tools/verify/e5-t26f-browser-roundtrip.mjs:1947–1949` with schema/acceptance/browser/milestones/errors, **no top-level head**. Its serializer at line52 does not add one. The authenticated current head is instead present through `milestones.run.binding.head` (binding producer at line182). Failure records do have top-level head (`:1121–1128`). Consequently, a legitimate successful timing/coherence result would be rejected at the wrapper's head assertion before collection; cap-failure records do not have this mismatch.

The ostensibly positive test (`browser-priority.test.mjs:84–89`) cannot catch it: its shared `readFile` stub at lines23–25 fabricates a top-level head for both record shapes, and its collector is also stubbed. This is a producer/consumer mismatch, not a performance hypothesis or reason to alter the proper F driver.

**Narrow requested correction:** in the L wrapper, authenticate the actual success record's existing nested binding head, retain head consistency checks for any top-level field, and ensure the emitted observation carries the checked head without rewriting the raw child record. Adapt the positive case to the producer's real shape (nested bound head, absent top-level head), with mismatch refusal. The held collector returns `record.head`, so merely deleting the top-level assertion would lose the aggregate's head binding rather than fully close R1. No browser rerun is needed to expose this source mismatch; correct it before the new screen.

### Remaining scoped source findings

- Freshness/isolation is correctly wired: exclusive outer directory creation precedes `mkdtemp`; no checkpoint input is consumed; all inherited `E5_*`/`CARGO_*` and the two named Rust variables are removed before explicit child configuration. Cold uses a new headless profile at port61634 and must exit0 before reuse. Invocation stays outside each protected child directory. This is source inspection, not pristine-environment execution evidence.
- The expected close-event paths write child log/exit before checking signals or post-child head equality; failed cold blocks reuse and failed collection cannot emit `observation.json`. Source digests are rechecked before aggregate publication. The separate Node spawn-error rejection at lines46–48 precedes those writes; do not describe close-path retention as a guarantee of log/exit artifacts for process-creation failures.
- The unchanged real `discoveryObservation` checks fixed resident/play5ms/JIT1/repack-off24/decoded4096 selection, no overrides, endpoint progress and original T0/end. It accepts exit1 only for the exact original cap assertion and keeps `acceptance:false/fVerified:false`; this limit also applies to any positive result after R1 closes. Its sequential RPC counters are not an exact frozen interaction window. The five wrapper tests cover orchestration using explicit FS/child/hash/collector stubs, not actual policy, SHA or browser correctness; the Make target separately names the held real collector tests.
- Make includes affected core/integration/digest work, no_std build, actual browser-JIT WASM parity (including the existing eight-attempt/64-staging cooperative test), and focused JS plumbing. The composite adds build → demo → new cold/reuse, explicitly not F acceptance. The roadmap addition remains in-progress. No cancellation-order/default/clock/driver change is introduced by these orchestration hunks.

Only R1 blocks this inspected orchestration's complete claimed success/failure handling. P1–P6 and actual P7 execution remain pending frozen evidence; prior F/K HELD carry unchanged.

### Inspected orchestration pins

These are working-source pins for this incremental review, not a frozen submission or a gate claim.

| File | SHA-256 |
|---|---|
| `tools/verify/e5-t26l-browser-priority.mjs` | `6512eebee35648bf6d8a348fe67bad8205a1d68faa04aef2f04d7ad5d8eb94a1` |
| `tools/verify/e5-t26l-browser-priority.test.mjs` | `0aec8e75b416f5683faa02d543ee8df9a151865b1321a5143cacdaeb4be0ecc3` |
| `Makefile` | `8e0c226b847b8f6128b36879cecc3d5d8aaa33d1d9364e14fdcf1574b70595e3` |
| `web/roadmap.js` | `51cc57a8c83c129b9fe09b4678be3ad10382d42e0e51ec65e9675f9bcfe54525` |
| `tools/verify/e5-t26f-browser-roundtrip.mjs` | `bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219` |
| `tools/verify/e5-t26f-discovery-observation.mjs` | `4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04` |

## R1 closure and three-file core source review — 2026-09-08

**R1 source-CLOSED; no material pre-build blocker found in this increment.** Earlier working-source pins/finding are historical; the revised source pins below supersede them for this review. Frozen test recordings, sabotage, novel attack, portability and browser evidence remain pending, so this is not an execution verdict.

The wrapper now requires `raw.milestones.run.binding.head` to equal the frozen head, checks top-level `head` whenever the raw object owns that property, and places the checked head **after** the collector spread in the aggregate (`browser-priority.mjs:63–70`). It neither assigns into the raw record nor rewrites its file. This closes both the success-record rejection and the missing aggregate-head issue. The revised five-case test source uses the actual success head shape (nested, no top-level field), asserts the emitted head, and refuses nested/top-level mismatches in both success and failure paths. Its filesystem/child/collector seams remain explicit mocks; the reported five passes were not independently rerun or treated as browser evidence here.

### Changed-hunk assessment

- **Queue method/doc:** `compile_queue.rs:152–159` adds a crate-private in-place loop and one lookup/assignment per resident; it cannot change payloads, order, allocation, queue counters or recount. The actual caller takes only an immutable discovery lookup through a disjoint borrow. The method is present for the real non-stub build and its unit tests, with no new tuning API or runtime instrumentation. The updated job documentation correctly distinguishes admission-time stored scores from refreshed selection scores.
- **Pump call:** `lib.rs:4121–4124` is exactly after existing staging/cancellation/recount and before the existing pop loop. It is outside the staging loop, so backlog-only pumps are included. The call remains inside the prior timer and after inert guards, with attempt/staging accounting, batch grouping, request validation and executor handling unchanged. A single refresh suffices for this pop sequence because no guest execution occurs between these synchronous selections.
- **Five new queue fixtures:** the source asserts exact visit order/count and unchanged payload/allocation/counters/recount; empty and equal/saturated ordering; actual missing/recount-reset lookup fallback; stale resident/incoming cancellation before fresh same-PC refresh and byte-check refusal; and preservation of the established full-cap admission-before-cancellation result. The last fixture intentionally retains the old behavior where stale incoming work first displaces a colder resident and is then cancelled: it does not smuggle in the previously rejected admission-policy change.
- **Three new Machine fixtures:** `async_compile_pipeline.rs:623–804` uses actual guest instructions/discovery/pumps with the existing stalled recording executor, not direct private-queue setup. The late-hot fixture asserts exact first eight submitted PCs, 32 initial staged nominations, 1,000 extra interpreted hits, then zero new staging/eight attempts and the late-hot PC as the next first submission. The stale fixture leaves 24 resident plus eight FIFO requests, changes live same-PC code, then asserts nine staged/one fresh submission and continued dedup. The inert fixture begins with real backlog before disabling/removing/zero-budgeting the executor. Each advance checks an independent interpreter Machine at the same exact retirement count, registers/PC, full-RAM digest and trap/interrupt counts. These are suitable source-level oracles for P3/P4/P5, not yet authenticated passing recordings.

### Remaining proof scope

P1/P2 source structure holds; P3–P5 have relevant new deterministic assertions, while execution dispositions remain **NEEDS EVIDENCE**. Existing finite-burst/backpressure and real-WASM parity/budget gates are still necessary affected proof, not replaced by the stalled executor. Removing the one pump refresh call must specifically fail the late-hot first-submission assertion, while stale safety remains intact. The worker now covers the initial proposed missing-hit/recount variant, so it will not be double-counted as the verifier's independent novel attack; choose a distinct bounded arrangement at the frozen head. No additional requirement, API, policy, F timing relaxation or unrelated rerun is introduced.

### Revised source pins

| File | SHA-256 |
|---|---|
| `tools/verify/e5-t26l-browser-priority.mjs` | `0a717118522b09c5a5de5b38b27e1896692ce52876a9115edfcbba1be0158af4` |
| `tools/verify/e5-t26l-browser-priority.test.mjs` | `a0553f2d5e5a2db0d82318ef231e746c5d7b54a6229a0f57def9506f92e4a005` |
| `crates/core/src/compile_queue.rs` | `678d51e6c333e076caeb99f3960fac52a0886941cc85ebf6638062878c751b15` |
| `crates/core/src/lib.rs` | `17f721bbb7cab06d3cc41a960fffa65777b6a2fb1c44b469b627a72a26db3898` |
| `crates/core/tests/async_compile_pipeline.rs` | `e7365969e28368b91604de175cb17be42193911663a066c1a273a52b3fa8f941` |
