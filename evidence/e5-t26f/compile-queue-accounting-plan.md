# Next bounded observation — compile-queue accounting

2026-09-08, read-only Luna source audit against L runtime
`42bb34d854aca091a3940191a8da3b7aff765cad`. No implementation, test run,
runtime/default change or performance verdict belongs to this audit.

Actual F screen in `../e5-t26l/browser-42bb34d8/` fails4727.945 ms. Discovery
nominations271→3524, FIFO depth0→53 and submissions95→702 are distinct layers.
The live compiled gauge94→104 is not an installation count: installs94→701.
Discovery generation stays5 and its stale/overflow/count-map-loss totals are0.

For this normal browser path with no independent FIFO consumer, reset or
saturation, FIFO conservation implies3200 staged nominations:
`3253 nomination delta - 53 FIFO-depth delta`. Compile-queue conservation is
`staged = resident-depth delta + backpressure-drop delta + cancellation delta + popped delta`.
Thus the2593 difference between staged3200 and submitted607 consists of changes
in pending depth, drops, cancellations and popped-but-unsubmitted work. It is
not2593 proven drops, missed unique PCs, or a causal latency measurement.

`crates/core/src/compile_queue.rs` already maintains admitted, dropped_backpressure,
cancelled_stale, popped and high-water counters, with live `len()`. A backpressure
drop adds a recount entry, but cancellation does not; `take_recount()` is mutating
and must never be used for observation. Admission-minus-drop is not a valid depth
identity because drops include rejected incoming jobs and displaced residents.
The pump's existing validation/decoded-cache paths can pop without submitting.

Despite an old comment, these queue counters are not folded into
`Machine::prof_report()` or WASM `getProfile()`/`jitStats()`. Existing `jitPause`
already reports attempts/submissions and per-run staging without enabling timers;
it does not expose the missing compile-queue conservation terms.

The next proposed observation is only an immutable projection of those already
maintained queue counters plus resident depth through existing `jitStats`, paired
with the current discovery/submission samples. No new RPC, hot-path counter,
profiling enablement, tuning, guest helper/image or deadline change is proposed.
Any such served-runtime increment needs its own newly authenticated cold seal.
This plan awaits L's final verdict and F's active-lane resumption before edits.
