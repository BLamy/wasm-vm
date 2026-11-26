---
id: E5-T37b
epic: 5
title: Paced idle in the browser — the worker sleeps while the Replay desktop waits, and guest time keeps real time
priority: 0.387645
status: in-progress
depends_on: [E5-T37a]
estimate: S
risk: medium
capstone: false
---

## Boundary

The host half of the split of E5-T37: `crates/wasm` (two exported methods), `web/idle-sleep.js`
(new), `web/guest-clock.js`, `web/loader.js`, `web/main.js` (the Replay desktop's boot options),
`tools/perf/desktop-latency.mjs` (the idle scenario reports what this task claims) and the
roadmap row. The core's behaviour is E5-T37a's and is not changed here.

Why: under the retire-count clock an idle guest's `wfi` jumps guest time to the next timer, so
an idle Replay desktop runs 9–12 guest seconds per real second, its periodic work (the session
monitor, Chrome's timers, kernel workers) runs that many times too often, and the worker never
leaves its run loop: one host core pegged for as long as the tab is open, and a third of the
guest's capacity gone before the user touches anything.

What changes:

1. **wasm.** `setPacedIdlePolicy(yieldToHost, maxBusyLagMs)` and `takeIdleWaitMs()` export
   E5-T37a's `set_paced_idle_policy` / `take_idle_wait_nanos`. Strict: `yieldToHost` must be a
   boolean; the lag is absent (`undefined`/`null`: unbounded) or a finite number of
   milliseconds from 0 to 3,600,000. `takeIdleWaitMs` is 0 when no wait is reported.
2. **Clock policy.** `interactiveClock: "paced"` (beside the two keyboard-triggered policies):
   after the divider selection and any restore, and before the first slice, the lifecycle
   selects `paced-icount` — refusing if guest time, timebase or divider moved — and sets the
   idle policy to yield with a 50 ms busy-lag bound. It needs no accelerated graphics. It fails
   closed on a module without the two methods.
3. **Loader.** After each run slice the loader takes the reported wait. If there is one, and no
   disk read or persist completed in the same tick, it arms one sleep of that length (at least
   1.5 ms, at most 50 ms) instead of scheduling the next slice. Every controller method — input,
   resize, paste, commands, pause, stop — ends an armed sleep before it runs, so anything the
   host delivers is seen by the next slice at once. A sleep that nothing ends is at most 50 ms.
4. **Replay desktop.** Boots with `interactiveClock: "paced"`; `?pace=0` restores the unpaced
   clock for comparison. Other guests are unchanged.

Not in this task: the guest image (monitor loop, Node startup snapshot, hardware cursor), other
guests, and the devices that keep a wait from being reported (see Follow-ups).

Risk is medium: an opt-in host scheduling feature for one guest, with a query switch back. Its
failure modes are a guest that is late by at most the 50 ms cap, or one that does not sleep.

## Deterministic acceptance

- `cd web && node --test tests/e5-t37b-paced-idle.test.mjs` passes: the sleeper arms only for a
  wait worth a timer, clamps to the cap, resumes once, a wake cancels and suppresses a stale
  callback; the lifecycle selects `paced-icount` and the policy for `"paced"` only, in a fresh
  boot and after a restore, and fails closed; the Replay desktop asks for it and `?pace=0` does
  not; the loader admits it without accelerated graphics.
- `wasm-pack test --node crates/wasm --lib -- exported_paced` passes: refused arguments change
  nothing; a guest that arms a timer and idles ends its slice at the `wfi` and reports the wait
  once; without the opt-in, and in pure ICount, nothing is reported.
- `cargo fmt --check`, `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`,
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; the web unit suite
  (`cd web && node --test tests/*.test.mjs`) fails no test that passed before the change.
- Browser, the committed bundle (`bash tools/serve-dist.sh 8125`), warm Replay desktop, each
  side at least two fresh page loads, interleaved (`bash evidence/e5-t37b/run-browser.sh 1 2`):
  `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --scenarios click,type,idle --n 8 --idle-s 30`
  and the same with `--query '&pace=0'`.
  - Idle, paced: the worker is inside run slices for at most 30% of wall time and guest time
    advances between 0.8 and 1.2 seconds per real second. Unpaced control: at least 90% and at
    least 3.
  - Click result latency, median: paced is not slower than unpaced.
  - Key echo latency, median: paced is within 15 ms of unpaced.

  Idle is sampled last, about 90 s after the desktop appears, and that is part of the
  criterion, not a convenience: Chrome schedules start-up work 10–60 s after launch on guest
  time. Under the unpaced clock that is over within a few real seconds; under the paced clock
  it takes its real time, so the first minute after the desktop appears is not idle (measured
  with idle sampled first: 30% of wall time in run slices, guest time 0.82 s/s — recorded in
  `evidence/e5-t37b/early-idle/`).
- The demo page on the same bundle: zero console errors, the suite reaches its full count with
  0 failed, the roadmap row for this task shows `verified` once it is.

## Adversarial verification

Medium risk. Attack list: an input, paste or resize that arrives while the worker sleeps and is
not seen until the cap; a sleep armed while another tick is already scheduled (two ticks); a
stale timer callback ending a later sleep; a sleep taken after a completed disk read or
persist; pause/stop/quota-pause during a sleep; a boot restored from the warm snapshot versus a
cold boot; a module without the bindings; `?pace=0`; guests other than the Replay desktop
(must be byte-for-byte the previous behaviour: the policy is never selected). One bounded novel
attack of the verifier's choice.

## Follow-ups (filed separately)

- E5-T37c: devices that keep a wait from being reported or that the browser path does not
  exercise.
- E5-T40: `cargo clippy --all-targets` for `crates/core` alone and for clones without
  `evidence/`.

## Verification log
