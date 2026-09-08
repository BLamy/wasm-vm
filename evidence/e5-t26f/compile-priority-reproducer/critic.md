# Compile-priority reproducer — independent bounded review

Scope: public `BlockDiscovery`/`CompileQueue` composition and candidate design only. No Machine/browser causality, E4 acceptance violation, F improvement, runtime implementation or task verdict is claimed.

## Predictions recorded before opening the run log and provenance

- P1: the actual decoder/discovery APIs nominate two same-generation requests at the unchanged native threshold; after staging, 1,000 additional observations of the later PC increase its live priority without another nomination.
- P2: both `CompileJob.hotness` values remain the staging-time value. `pop_hottest` therefore returns the earlier resident first, despite the later PC's higher discovery value. There is no refresh/re-push or private-state mutation in the reproducer.
- P3: both requests remain generation/byte-valid; queue overflow, cancellation, recount and guest execution are absent. Thus the result establishes priority staleness in this composition, not a real Machine schedule or browser cause.
- P4: recorded source and log digests match the actual files; the source-level conclusion survives inspection of the real pump's staging, budgets, cancellation and validation boundaries. Any environment/provenance limitation is reported rather than promoted to pristine-build proof.

## Evidence disposition

**P1–P3 HELD for the stated composition.** `src/main.rs:10–36` uses the real decoder and public discovery/staging APIs, not copied queue logic. `run.log:5–12` records native threshold 64, capacity 256, generation 1, two jobs stored at 64, then live values 64/1064 and pop order earlier/later. The exact assertions at `src/main.rs:47–75` check 1,000 deduplicated observations, no re-nomination, no cancellation/backpressure/recount, and both matching-byte `install_check` results. Exit 0 supports those assertions, not merely the printed conclusion. The provided matching bytes are the fixture's original decoded word: this is **not** a read of live guest RAM or actual execution of that word.

The mechanism agrees with real source: `dispatch.rs:618–626` continues counting queued hits; `:732–735` returns threshold plus saturating extra hits; `lib.rs:4107–4110` copies that value into each newly staged job; `compile_queue.rs:154–171` compares stored values, without consulting discovery. No private mutation or refresh/re-push is used. Importantly, an ordinary two-job Machine pump with sufficient attempt budget would pop both in that same synchronous call (`lib.rs:4123–4129`), before the reproducer's later observations. Runtime relevance requires jobs actually surviving across pumps/slices; this record does not establish that occurrence, its frequency, or its cost in F. Native threshold 64 is not a claim about the browser's configured threshold.

**P4 HELD with explicit recording limits.** All 11 `sourcePins`, the standalone lock and log digest were mechanically checked. The four relevant core source files also match their Git blobs at recorded head `690e23245b4b376c55c0b830f7690c8a0f72059e`; current documentation-only head movement does not change these bytes. The recording reports unchanged pre/post pins, exit 0, no signal/error and Rust 1.96.0. `record.mjs:23–25` inherits its environment and the original offline invocation did not use `--locked`; the newly resolved standalone lock is retained. This is not scrubbed-environment/pristine-build proof, nor does it need that expanded claim. I did not rerun Cargo, the binary, a browser, or broad gates.

## Candidate scope and concrete risks

**Coherent candidate for a controlled runtime screen; no promised F fix.** Refresh only already-resident job scores from the existing discovery lookup, after stale cancellation and before priority-sensitive admission/pop. Preserve request bytes, generation and metadata; discovery nomination policy, caps, thresholds, attempt/staging budgets, guest time, executor chaining and byte validation stay unchanged. This ranks only staged residents, not every hot PC still behind the bounded discovery FIFO.

- **Generation/order:** cancelling residents first must not be the only stale check. `dispatch.rs:600–613` deliberately leaves stale requests in discovery's FIFO, and `queued_hotness` is keyed only by physical PC, not request generation. A stale incoming request must not consume/displace live capacity or acquire a fresh same-PC score merely because cancellation moved before staging. Retain a defined stale-incoming disposition and counter accounting; no stale cancellation should clear fresh same-PC discovery state through recount (`compile_queue.rs:140–149`). This is a candidate hazard, not a newly proven production failure.
- **Determinism and borrowing:** refresh scores in place using an immutable borrow of discovery disjoint from the mutable queue; no callback may execute guests, mutate discovery, install, or re-enter the pump. Do not pop/re-push to refresh: that changes admission/recount counters and ordering. Keep the existing strict comparisons/tie semantics (`compile_queue.rs:123–138,154–171`). Note that overflow already uses `swap_remove`; the existing tie order is current resident-vector order, not universally original chronological order after overflow. Do not silently add a new sorting/aging rule.
- **Bounded work and liveness:** refresh the surviving resident set even when no new nominations are staged but attempts remain (`lib.rs:4084–4106`); otherwise the backlog case is missed. Keep the scan within the existing measured pump boundary, not per guest entry, and retain early no-executor/no-attempt returns. With the current cap, the scan is bounded by resident count and lookup cost. Preserve drop-and-recount and eviction re-nomination (`lib.rs:4116–4120,4178–4180`); a read-only refresh must not reset queued hits. Missing hits deliberately fall back to the threshold, and addition saturates (`dispatch.rs:591–596,732–735`). Hot-first scheduling does not promise starvation freedom under an endless hotter stream; do not add an unrelated fairness policy or promise one.

## Minimum affected tests for an eventual patch

1. The real composition above must switch the first pop to the later, now-hotter resident after refresh; unchanged equal scores must preserve the existing tie behavior. Include saturated equal priorities without wrapping.
2. Full small-cap queue: refresh before an incoming intermediate-priority job, proving a live-hot resident is retained, the correct cold job is dropped, and exact recount/admitted/drop/depth counters remain consistent. Include the equal-priority incoming branch.
3. Mixed old/current generations, including stale incoming FIFO work and the same physical PC re-nominated in a new generation: cancellation cannot evict, boost, recount-clear or install the live request incorrectly.
4. A bounded Machine backlog survives an exhausted attempt budget, accrues subsequent interpreted hits, then is selected by refreshed scores on a later pump, including zero newly staged nominations. Preserve aggregate attempts/staging and empty/disabled no-op behavior. This exercises the integration missing from the standalone composition without asserting browser causality.
5. Preserve exact request metadata and live-byte/generation refusal after refresh (`lib.rs:4136–4169`); cover missing-hit/re-nomination behavior and eventual progress after a finite backpressure burst. No new API, profiling surface or unrelated suite is required by this design review.

Disposition is closed: the limited reproducer claim survives; runtime improvement remains untested. Prior F/architecture HELD results carry unchanged and F's two-second failure is not waived. Only this critic note was written; no source/status/queue edits or commits.

## Mechanically checked SHA-256 citations

Paths are repository-relative. All provenance source pins were checked; key independently cited artifacts follow.

| Artifact | SHA-256 |
|---|---|
| `evidence/e5-t26f/compile-priority-reproducer/src/main.rs` | `c7877d375a7007d01b6abc0dae014375cc36a7e208fce5e97451716d727c0876` |
| `evidence/e5-t26f/compile-priority-reproducer/record.mjs` | `4c9618fe811ddfcf88e79c26f8173aab755b32a9cfd299d02fcc0b3cf2b3a3e8` |
| `evidence/e5-t26f/compile-priority-reproducer/Cargo.lock` | `8c953b33a93cca3e8e0433fe40ad2d7d1ab5f855933042d51e054be400f0a6cf` |
| `evidence/e5-t26f/compile-priority-reproducer/run.log` | `8a331da2c715d27b6b9ac41f60fa1e0abfe3b1a566dfc4ad918d7815d107bf93` |
| `evidence/e5-t26f/compile-priority-reproducer/provenance.json` | `becf8e4dbdea1739c1291edeaefb2fc0c3ded3703bf0ff82b1cadc8549bfb21b` |
| `crates/core/src/compile_queue.rs` | `bcf1649fa2c9b6fb7ecc0eff13702ec6e806603b12c222ef2cf7c9836ebbae7b` |
| `crates/core/src/dispatch.rs` | `5e6ccdd33f9dc9c948dde6e8daa4b69d8f008330169cdecbdfb3356b3d6dc04d` |
| `crates/core/src/lib.rs` | `7f8c72c28cd51afaf44834fd809e9781ea6c27c6d8f6f2f97f1452bb77f9791a` |
