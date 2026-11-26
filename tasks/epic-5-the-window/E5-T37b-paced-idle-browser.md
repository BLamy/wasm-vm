---
id: E5-T37b
epic: 5
title: Paced idle in the browser — the worker sleeps while the Replay desktop waits, and guest time keeps real time
priority: 0.387645
status: implemented
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
3. **Loader.** Straight after each run slice the loader takes the reported wait, with a ticket.
   If there is one it arms one sleep of that length (at least 1.5 ms, at most 50 ms) instead of
   scheduling the next slice. Every controller method — input, resize, paste, commands, pause,
   stop — voids the ticket and ends an armed sleep before it runs, so anything the host
   delivers is seen by the next slice at once. A sleep that nothing ends is at most 50 ms.
   The policy is admitted only for a whole-image, non-persistent boot: such a boot's tick
   awaits no chunk fetch and no persist between the run slice and the sleep, so nothing but a
   controller call can deliver anything in between. Other boots are refused at validation.
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
  not; the loader admits it without accelerated graphics, and only for a whole-image,
  non-persistent boot; a delivery voids a wait taken but not yet slept on.
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
stale timer callback ending a later sleep; a boot with persistence or without the whole image
asking for the policy; pause/stop/quota-pause during a sleep; a boot restored from the warm snapshot versus a
cold boot; a module without the bindings; `?pace=0`; guests other than the Replay desktop
(must be byte-for-byte the previous behaviour: the policy is never selected). One bounded novel
attack of the verifier's choice.

## Follow-ups (filed separately)

- E5-T37c: devices that keep a wait from being reported or that the browser path does not
  exercise.
- E5-T40: `cargo clippy --all-targets` for `crates/core` alone and for clones without
  `evidence/`.

## Verification log

### 2026-11-26 — worker — claim (head `423985d3d`)

Commits on `codex/paced-idle-browser`: `3214330d5` (bindings, clock policy, loader sleep, Replay
desktop option, benchmark fields), `d0fa60058` (roadmap row; idle sampled last), `4e1adc7c8`
(the policy is admitted only for a whole-image, non-persistent boot), `38d7839f3` (the sleep
resumes into the tick directly), and three regenerated build-id commits.
`crates/core` is untouched.

**Gates** (`bash evidence/e5-t37b/gates.sh`, log `evidence/e5-t37b/gates.log`, sha256
`8ea5c844124f…`, at `423985d3d`): `cargo fmt --check`;
`cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`;
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`;
`wasm-pack test --node crates/wasm --lib -- exported_paced` (2 pass) and the whole `--lib` set
(17 pass); `node --test tests/e5-t37b-paced-idle.test.mjs` (12 pass). All exit 0. The web unit
suite: 611 tests, 583 pass, 28 fail — the same 28 names as at the parent of this task
(`web-unit-failing-before.txt`, taken with this task's files stashed; stale source-pinning
tests, E5-T38's territory), `diff` of the two lists empty. One earlier run of the full suite
also failed `tests/audio-ring.test.mjs`'s concurrent producer/consumer test, and one run hung
in that file; it is untouched since E5-T20b and passes 3 of 3 alone.

**Browser, the committed bundle at `423985d3d`** (`bash tools/serve-dist.sh 8125`; Chrome
158.0.8127.88 headless, M4 Max; `bash evidence/e5-t37b/run-browser.sh 1 2`: fresh page
load per run, paced and `&pace=0` interleaved, click and type first, idle last):

| | paced (default) | unpaced (`?pace=0`) |
|---|---:|---:|
| idle: worker inside run slices, % of wall | 9.9 / 9.9 | 99.8 / 99.8 |
| idle: guest seconds per real second | 0.97 / 0.97 | 11.78 / 11.82 |
| idle: instructions retired, M/s | 10.4 / 10.5 | 120.5 / 121.1 |
| idle: sleeps per 30 s | 601 / 599 | 0 / 0 |
| idle: of those, ended early by a host call | 108 / 108 | 0 / 0 |
| click result, median ms (n = 8 each) | 266 / 270.4 | 371.6 / 340.6 |
| click result, min – max ms | 252 / 261.7 – 599.8 / 530.7 | 305.8 / 312.6 – 578.9 / 611.6 |
| key echo, median ms (n = 8 each) | 45 / 47.7 | 43.5 / 47.3 |

Pooled over both loads (16 clicks a side): median 268 ms paced against 354 ms
unpaced, 24% lower. Every criterion holds: idle at most 30% and 0.8–1.2 s/s
paced, at least 90% and 3 s/s unpaced; paced click median not slower; key echo within 15 ms.
The largest click on every load is the first of the session on both sides (cold code paths;
under the paced clock Chrome's delayed start-up work is still running then).

Evidence: `evidence/e5-t37b/browser-{paced,unpaced}-{1,2}.{json,log,png}`. Two earlier
sets with the same result on earlier bundles of this task are kept in
`evidence/e5-t37b/earlier-bundle/` (three interleaved pairs: paced click median 261 / 270 /
265 ms, unpaced 353 / 330 / 337 ms; idle 10% against 99.8%), and the first measurement, with
idle sampled FIRST, in `evidence/e5-t37b/early-idle/` (30% of wall time in run slices, guest
time 0.82 s/s). That one is why the criterion samples idle last: per guest second the paced and
unpaced guests do the same work after start-up (20 guest seconds from uptime ~6 s: 2.51 s
against 2.48 s of guest CPU by `/proc/stat`, the same threads waking the same number of times),
but those 20 guest seconds are 20 real seconds under the paced clock and under 2 under the
other.

**Demo page on the same bundle** (`E5_DEMO_TASK=E5-T37b E5_DEMO_OUT=evidence/e5-t37b node
evidence/e5-t37b/demo-suite.mjs`): 127 passed, 0 failed of
127; no page errors, no console errors, no HTTP errors (`demo-suite.json`, screenshot
`demo-suite.png`). The roadmap row "Replay desktop keeps real time while idle and lets its worker
sleep" is in the bundle as `partial`; it is to be flipped when this task is verified.

**What the recorded runs executed.** The bindings and the clock selection (every paced load:
`clockMode` `paced-icount`, sleeps counted, so `setPacedIdlePolicy` and `takeIdleWaitMs` ran);
the sleep and its timer resume (about 590 sleeps per 30 s idle); a host call ending a sleep and
voiding the ticket (about 110 per 30 s idle — the page's own status polling — and every pointer
and key event of the click and type scenarios); the refusal branch of `sleep` for short or
absent waits (the busy slices of the click scenario); `?pace=0` (policy not selected: no
sleeps, clock `icount`). Not executed in a browser run, covered by the unit tests only: the
refusals of the two validation gates and of the lifecycle (a module without the bindings, time
moving on selection), a stale timer callback after a wake, and a delivery between the take and
the sleep (it needs a controller call to land inside a tick's `await`; the Replay desktop's
tick has none after its run slice).

**Not claimed.** Other guests (the policy is refused for boots with persistence or without the
whole image, and nothing else selects it); the first minute after the desktop appears, which is
not idle under the paced clock; networking, audio and RTC-alarm sessions (E5-T37c).
