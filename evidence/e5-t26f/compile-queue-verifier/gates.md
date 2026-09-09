# Compile-queue observer — bounded pre-launch diff review

2026-09-08. **No material pre-launch blocker found.** Reviewed the complete
working diff/new files over activation `a56aef5cc2d5273cd0cb1e2075df23cbf390af89`
against the pre-evidence predictions in `preflight.md`. Pins below identify this
source, not a future release. Reported5 WASM/11 Node passes remain worker claims
until the exact-head gate recording is supplied; this review ran no tests/builds
or browser. No F verification/status change, L reopening or second clone.

## Prediction / source and test disposition

| Ledger | Source assessment and coverage of the submitted test code |
|---|---|
| P1 — inert read | The10-line `Machine::compile_queue_stats(&self)` copies existing CopyStats/len/cap from one borrow; no mutable operation, allocation, clock or profiling hook. The repeated-read WASM case starts with24 real pending jobs, compares full stats, profile, snapshot, digest and clock, mutates the detached returned JS object, then checks the next real pump's conservation. Appropriate observer-effect oracle, not a substitute for held execution parity. |
| P2 — faithful projection | The18-line shared WASM hunk maps all seven fields directly into a fresh nested object; both existing wrappers retain immutable `try_borrow()` and share the function. Tests cover exact keys/cap256/zeros without an executor for both wrappers, actual Linux backlog/depth24, high-water256/backpressure56/popped48, and a restore followed by actual stale cancellation24. Bare-metal guest execution separately yields positive compilation/retirement and unchanged repeated reads. No queue/pump/L-policy change. |
| P3 — accounting | Collector lines39–55 implement the preflight identities exactly, with signed depth and nonnegative derived incoming rejections, resident displacements and popped-unsubmitted jobs. Positive synthetic cases distinguish both backpressure classes, draining depth and lifetime drops with zero interval drops; discovery overflow/install-stale counters are deliberately nonzero and not subtracted from FIFO staging. |
| P4 — fail closed | Existing discovery checks supply same generation, fixed policy, fresh endpoint retirement and original T0/end/exit guards. New counters/submissions must be nonnegative safe integers; BigInt prevents intermediate rounding, final outputs are range-checked, cumulative/high-water regression and impossible sums refuse. Tests cover missing/malformed fields, both negative residuals, unsafe values, wrong head/policy, reset generation, cap/non-cap outcomes and CLI input/output preservation. |
| P5 — unchanged experiment | The new wrapper creates an exclusive output and a NEW profile, cold first then default4096/repack-off24/JIT1 reuse on61635. It scrubs inherited E5/Cargo/Rust flags, authenticates nested and any present top-level head, records raw SHA and eight source bindings, and rechecks sources before aggregation. The proper F driver, command/play5ms, original T0/end and cap are unchanged. Actual release/binding/PCM/browser outcome remain NEEDS EVIDENCE. |

These are source/coverage assessments, **not recorded execution dispositions**.
The frozen narrow gate and later new-cold record can close them incrementally.

## Accounting and provenance limits retained

- `compile-queue-observation.mjs:33–55` composes the held discovery collector,
  then checks `staged = signed resident-depth delta + drops + cancellations + pops`.
  Submissions come from existing Machine pause accounting, not installation or
  live compiled-block counts. `poppedUnsubmitted` is only pre-submission refusal;
  it does not distinguish byte/read/cache refusal or establish a bottleneck.
- `queueHighWater` is a monotone lifetime gauge, depth is a signed-change gauge,
  and `backpressureObservedLifetime` deliberately remains true when interval
  drops are zero. No per-generation reset is added. The real-WASM restore case
  explicitly expects old queue counters to survive discovery reset before
  cancellation; it does not equate lifetime queue totals with reset discovery N.
- JS production projection follows existing u64→Number convention. The collector
  rejects unsafe endpoint Numbers before arithmetic; this is bounded diagnostic
  accounting, not a new promise of exact JS u64 representation above2^53−1.
- Same-Machine ownership, no alternate FIFO consumer and completed-pump sampling
  come from the unchanged owned worker/driver flow plus bound recording, not from
  an algebraic identity authenticating arbitrary input. Sequential RPC samples
  are not the exact timed interaction window. Raw records remain authoritative.
- Collector success with elapsed≤2000 is still `acceptance:false/fVerified:false`.
  Exit1 is admitted only for the original exact cap assertion. No2593-loss,
  unique-PC, speedup/default, first-PCM or F-acceptance conclusion is introduced.

## Harness and test sufficiency

The six collector tests explicitly use synthetic numeric records. Their CLI
case exercises the actual helper and exact-byte digest/exclusive output path;
the five wrapper tests execute extracted control flow with explicit filesystem,
hash, child-process and collector stubs. They test the honest absent-top-level
success shape, mismatch/source-change refusal, environment isolation and failed
child retention, **not real hashing, Chromium or the actual profiler**.

Wrapper lines46–53 retain transcripts/exit before checking a closed child's
signal or changed HEAD, including failed cold and non-cap reuse. As with the
held L wrapper, process-creation `error` rejects before those writes: “all
failures retained” must mean closed-child attempts, not a tested spawn-error
guarantee. This unchanged limitation is not a new runtime blocker.

Make's new target is scoped to fmt/core+WASM clippy, five queue plus affected
discovery/capacity WASM fixtures, syntax and focused Node/worker-protocol tests.
It explicitly leaves actual browser timing separate. No new ignore, runtime
cfg(test) substitution, hot-path counter, RPC, profiling enablement, format,
image/helper/default or deadline change was found. Source pins for the proper
driver and queue implementation remain the held ones. Unrelated dirty E6/tools
and user-owned dist manifests were not reviewed or modified.

Next evidence is the recorded narrow gate, then frozen new build/new61635 cold
seal and one unchanged-policy reuse. No42bb seal rebinding, old L/F experiments,
new broad gates, runtime fix or extra instrumentation is requested.

## Inspected source pins

| File | SHA256 |
|---|---|
| `crates/core/src/lib.rs` | `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c` |
| `crates/wasm/src/lib.rs` | `d9b100a0b434688a34fdcd943e8f21f683c3c77e27d9fe6c240ee001399a38be` |
| `crates/wasm/tests/compile_queue_stats.rs` | `a0e0ba230cffd09e958da395385c04ccda2c1fd55c34aa678279751ab2541e56` |
| `tools/verify/e5-t26f-compile-queue-observation.mjs` | `fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc` |
| `tools/verify/e5-t26f-compile-queue-observation.test.mjs` | `81ec6c8af96c3bcb963355996d46575f1481068717c8686b36b84fab0bf1e886` |
| `tools/verify/e5-t26f-browser-compile-queue.mjs` | `cd2ef6a05280f0845792bcac48b63822a4fb877a2afff95e39bdb0236dd6d2ef` |
| `tools/verify/e5-t26f-browser-compile-queue.test.mjs` | `50a4a008d8399660a0cf1e329b4a27eb4ef3c3180310b16680297538b210241b` |
| `Makefile` | `5875ee8fc7a97dab8400dba507074312098699ee791feb3bbfbe3c4736cbadaf` |
