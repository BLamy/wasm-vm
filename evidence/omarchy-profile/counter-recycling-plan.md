# T03k — fixed local control/candidate input trial

Implementer: Luna for core/WASM and browser adapter; coordinator for recorder.
Fresh critic: Daybreak Blue. Predictions K1–K8 are in the task file before runs.
No diagnostic-only production deployment or claimed responsiveness fix.

Run once, from a frozen committed build:

`node tools/verify/omarchy-recycling-ab.mjs evidence/omarchy-profile/counter-recycling-ab-r1`

The runner starts control then candidate, separate owned fresh headed Chrome
processes, with the same pinned R3 pair/base and WASM. It requires confirmed
closure before proceeding. Only the local recycling selector differs; default
JIT threshold512, count capacity65536, divider64, decoded4096, repack-off24,
no admission observer/profiling/timing. Actual JIT/clock reports are checked.

Each arm has an absolute300s navigation/startup budget through real desktop
readiness, shipped restore, mapped/active Foot, focus and policy proof. Physical
typing is capped60s; read-only nonce lookup has120s from Enter, including queue
time and post-Enter focus checks. A single20s capture allowance includes fresh
presentation and actual final PNG, followed by30s owned cleanup. Time is not
borrowed between phases. A startup failure means input was not tested; a failed
arm is retained, not retried. A positive nonce without fresh pixels is not a pass.

The outer runner also caps pre-navigation recorder setup at120s and watches
the fixed530s navigation-through-cleanup lifecycle without rearming it. On
expiry it kills only this arm's explicitly owned process groups, allows at
most5s to confirm closure, and aborts the batch; it does not start another arm
or convert the interruption into acceptance. The5s confirmation is not guest
execution or an extension to any product deadline.

The coordinator will inspect both actual screenshots. Neither lower refusal
counts nor additional compilation proves a GUI fix. No matched speedup may be
claimed if control never qualifies. No code/default/deployment promotion is
authorized by this experimental result alone.

## Local checks and limitations before freeze

Direct anchor: `cargo test -p wasm-vm-core --lib --features trace cold_counter_recycling`.
Affected native/WASM library tests, scoped clippy/fmt, actual WASM API, browser
adapter and recorder guards, and built ISA smoke are recorded in
`counter-recycling-gates/`. A final exact-head scratch clone proves the narrow
native acceptance and wrapper test; reused unchanged HELD results remain in T03j.

The previous T03j broad remaining integration run was deliberately interrupted
with SIGINT after the critic confirmed it supplied no missing observer proof.
Its partial log is retained; it is not a complete pass. Known broad `make ci`
macOS platform errors and the old stdout scanner failure are not claimed fixed.

During recorder iteration, a new missing `inputTrial:false` harness-fixture
binding was fixed. The old100ms real-time presentation self-test was sensitive
to the heavily loaded host, so its existing scheduling function now accepts
a deterministic clock used only by that self-test. The HTTP-only fixture
budget is120s, not a desktop deadline. An unprivileged rerun then passed23/24
checks and failed to bind localhost (EPERM); the final run needs local-server
permission. These are harness/environment iteration outcomes, not GUI evidence.
