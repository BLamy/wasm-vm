# F compile-queue observation — source preflight

2026-09-08, source head `18b620b7213f966c05e4fbed95eea0c16827362e`.
**No material blocker to the proposed read-only projection.** This is a
pre-implementation prediction ledger, not an implementation approval, gate result
or F verdict. L's final verified boundary/reports remain unchanged HELD.

## Conservation: supported, with explicit assumptions

Let interval deltas be: N successful discovery nominations, D discovery FIFO
depth, Q compile-queue resident depth, B backpressure drops, C stale cancellations,
P popped jobs, A admitted jobs, U validated submitted members. Let S be requests
staged from discovery into the compile queue. Depth deltas are **signed**.

For the same Machine, coherent endpoint snapshots, no discovery reset, no other
FIFO consumer and no saturated/imprecise counters:

    S = ΔN − ΔD
    S = ΔQ + ΔB + ΔC + ΔP
    S − ΔU = ΔQ + ΔB + ΔC + (ΔP − ΔU)

The plan's held values give S=3253−53=3200 and S−ΔU=3200−607=2593.
They do **not** reveal2593 known losses, unique PCs or a timing cause.

Source anchors:

- `dispatch.rs:650–673`: nominated increments only after successful FIFO insertion.
  FIFO overflow/excluded/count-map refusals are not additional subtractions from N.
  Bounded staging drains that FIFO (`:697–700`, `lib.rs:4100–4110`). The public
  alternate drain exists at `lib.rs:1048–1050`, but is not the browser stats route.
- `compile_queue.rs:109–140`: an ordinary insertion increments A/depth; a rejected
  incoming job increments B only; replacing a resident increments both A and B
  without increasing depth. Therefore **A−B is not depth**. If desired, existing
  counters already derive incoming rejections=S−ΔA and resident evictions=
  ΔA−ΔQ−ΔC−ΔP, whose sum must equal ΔB. No new split counters are needed.
- `compile_queue.rs:143–181`: cancellation decrements depth/increments C; pop
  decrements depth/increments P. Cancellation does not append recount. Refresh
  changes none of these quantities. `take_recount()` at185–188 mutates state and
  is not an observation API, despite the broader historical field comment.
- `lib.rs:4129–4169,4192–4203`: popped requests may fail live-memory reads,
  generation/byte validation, or decoded-cache lookup before submission.
  `jitSubmittedMembers` comes from `pause.total_submitted_blocks`
  (`wasm/src/lib.rs:711–715`), not the executor's install count. Thus ΔP−ΔU
  measures popped-but-unsubmitted work at completed-pump endpoints, **not**
  compilation failures after submission or a proven decoded-cache-miss count.

## Minimal observation boundary

Expose a copied `CompileQueueStats` plus actual `len()` through an immutable
Machine getter and the existing shared `jit_stats_object(&Machine)`. The latter
already feeds both bare/Linux wrappers under `try_borrow()` and the existing
worker protocol's `jitStats` method. Return bounded scalar data, including the
live resident depth; do not drain/recount/refresh/pop, sample clocks, enable
profiling, change formats or add a separate RPC. An actual cap readout is harmless
if included, but does not need a new policy/configuration knob.

The subsequently proposed nested `compileQueue` fields fit this boundary exactly:
`admitted`, `droppedBackpressure`, `cancelledStale`, `popped`, `queueHighWater`,
`queueDepth`, `capacity`, copied from existing stats/len/cap. F activation commit
`a56aef5cc2d5273cd0cb1e2075df23cbf390af89` is metadata, not a reviewed projection
implementation. New cold61635 after the observer build is the stated next proof;
no42bb reuse or second cold clone is requested.

Counters here accumulate with the queue/Machine, **not per discovery generation**.
Discovery reset clears its FIFO/counters and advances generation
(`dispatch.rs:575–586`), while Machine cache resize/restore does not replace the
compile queue (`lib.rs:1007–1023,3270–3280`). Preserve these lifetimes; do not
reset existing queue counters to manufacture a conservation result. Record both
raw endpoints, same-generation/configuration ownership, monotone cumulative
counters and safe integer arithmetic; refuse derived accounting across resets,
unsafe values or inconsistent sums. Do not require monotone depth, which is a
gauge. Sequential RPC observations remain outside an exact frozen F work window.

## Falsifiable predictions for the forthcoming diff/evidence

All execution dispositions are **NEEDS EVIDENCE**; no new recording inspected.

| Prediction | Scoped falsification |
|---|---|
| P1 — inert read | Repeated getters without guest execution return identical actual stats/depth and leave queue payload/order/recount, discovery, guest state and profiler enablement unchanged; no-executor/empty is a real zero state, not missing-field fallback. |
| P2 — faithful projection | Both real WASM wrapper paths project the same getter through existing jitStats. Nonzero admission/drop/cancel/pop and a nonempty depth are exercised; high-water is a gauge, not a cumulative event delta. No hot-path/pump/L-selection changes. |
| P3 — accounting semantics | Rejected incoming and displaced-resident cases remain distinct under the formulas above. A draining queue permits negative ΔQ. A popped refusal is not counted as submitted/installed. Exact sums hold on same-lifetime endpoints. |
| P4 — fail-closed collection | Missing/unsafe/regressing cumulative fields, reset/generation mismatch or impossible residuals retain raw evidence and refuse derived claims; none silently becomes zero. Intermediate arithmetic must also remain safe. No per-PC or causal label is inferred from totals. |
| P5 — unchanged F experiment | Existing original T0/end, physical play5ms, fresh PCM and exact cap-failure handling remain untouched. A changed served observer build receives a NEW authenticated cold seal, never the invalidated42bb seal. Neither positive counters nor collection exit0 verify F. |

Future narrow getter/projection/collector tests can supply these checks; no new
profiling/API instrumentation, old L/K rerun, full clone or browser launch is
requested by this source preflight. Source inspection confirms the plan's old
reporting comment is inaccurate: current `prof_report()` and `jitStats()` do not
yet expose compile-queue counters. No implementation/status/queue changes here.

## Inspected pins

| File | SHA256 |
|---|---|
| `evidence/e5-t26f/compile-queue-accounting-plan.md` | `de2bdcc78c0e35b7555df8ab3d56c37e6c278a5c3d86c94dd7f359dd9860447a` |
| `crates/core/src/compile_queue.rs` | `678d51e6c333e076caeb99f3960fac52a0886941cc85ebf6638062878c751b15` |
| `crates/core/src/lib.rs` | `17f721bbb7cab06d3cc41a960fffa65777b6a2fb1c44b469b627a72a26db3898` |
| `crates/core/src/dispatch.rs` | `5e6ccdd33f9dc9c948dde6e8daa4b69d8f008330169cdecbdfb3356b3d6dc04d` |
| `crates/core/src/prof/pause.rs` | `af8bb1b97f45a7522001797bb875e6c10ede2b52947a7aec475e253b6a9e0f7e` |
| `crates/wasm/src/lib.rs` | `bd19b54e044ca5497d4624fe299ce561f9b676de6467b1f112a3bba58fd5f77a` |
