---
id: E5-T37b
epic: 5
title: Paced idle in the browser — the worker sleeps while the Replay desktop waits, and guest time keeps real time
priority: 0.387645
status: verified
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

### 2026-11-26 — verifier — VERDICT: needs-evidence

Fresh session; I did not implement this. Head `939f16b9a` (the claim's `423985d3d` plus two commits
that touch only this file and `evidence/`: `git diff 423985d3d..939f16b9a -- crates web tools` is
empty). My predictions were written before I opened any evidence or ran anything
(`evidence/e5-t37b/verifier/predictions.txt`); every file named below is in that directory.

The product was not contradicted: the browser criteria hold on my own loads and every item of
the attack list holds. Two things the acceptance says tests show are not shown, and one of those
tests fails when its body runs. Status `evidence-needed`; nothing promoted; the roadmap row stays
`partial`. Both demands are test-only, so the browser evidence and the items under "Held" need
not be redone if no runtime file changes.

**Needs evidence**

- P2, the wasm test — FAILED as proof. Predicted: `wasm-pack test --node crates/wasm --lib -- exported_paced`
  runs all of `exported_paced_idle_policy_is_strict_and_reports_a_waiting_guest`. Observed: 2 pass
  (`gates-verifier.log`), but the test returns at `crates/wasm/src/lib.rs:1796`
  (`if JsHostTimer::new().is_none() { return; }`). Node's global is neither a `Window` nor a
  `WorkerGlobalScope` (`lib.rs:1520-1531`), so there is no host clock: the shipped wasm in plain
  node answers `setGuestClock("paced-icount")` with `guest_clock_source_unavailable`
  (`shipped-wasm-node-plain.json`). Lines 1799-1829 never execute under the acceptance command;
  it shows the refusals and nothing of "ends its slice at the `wfi` and reports the wait once;
  without the opt-in, and in pure ICount, nothing is reported". With a host clock given to node
  and nothing else changed (`NODE_OPTIONS=--require=…/fake-worker-scope.cjs`, same test binary,
  same command) the test fails: `panicked at crates/wasm/src/lib.rs:1812:9: retired 5`
  (`wasm-test-with-host-timer.log`); the assertion wants 6 to 999 and the slice retires 5.
  The bound is wrong, not the product: the same seven-word guest through the shipped wasm's JS
  API gives retired 5, wait 26838.5 ms, second take 0; then retired 2 and the wait again; 5000
  retired and no wait without the opt-in; 5000 and no wait in pure ICount; and 17 of 17 malformed
  argument pairs refused (`shipped-wasm-probe.mjs`, `shipped-wasm-node-fake-worker-scope.json`).
  Demand: make the acceptance command execute the whole test (a host clock under node, or the
  behaviour half as its own test run where one exists), correct the bound, re-record that gate.
- COVERAGE `web/guest-clock.js:68` — NEVER EXECUTED. Predicted: the unit tests select the policy
  "in a fresh boot and after a restore", as the acceptance says. Observed: no test passes a
  `restoredClock` (the word "restor" does not occur in `web/tests/e5-t37b-paced-idle.test.mjs`);
  the Replay desktop's warm boot passes `undefined` there (`web/loader.js:1167`: only session and
  GPU checkpoints supply one); and the mutant that drops the clause this diff adds at line 68
  passes all 12 tests (`mutants.json`, G5). Run by hand the path behaves correctly
  (`restore-clock-probe.json`: a restored `icount` or `paced-icount` clock selects the paced clock
  and the policy, a restored `wall` clock or a moved `mtime` is refused before anything is
  touched). Demand: add those cases to the unit test, or delete the clause and reword the bullet
  if no boot can reach it.

**Notes for the worker — not refutations**

- The gate admits more than the measured boot. The real `startLinuxBoot` source, driven to its
  option checks (`gate-probe.json`), refuses "paced" with `persist` true/null/0/"false", without
  a whole image, in initramfs mode and under the wall clock, each before any fetch
  (`web/loader.js:422-430`; disk mode is refused by the check after it). It admits "paced" together with accelerated graphics, with `slirpNet`,
  and with the microphone. For accelerated graphics the Boundary's sentence "nothing but a
  controller call can deliver anything in between" does not hold by reading:
  `productionGpu?.pump()` runs straight after the take (`web/loader.js:1388-1389`) and completes
  guest GPU commands without voiding the ticket. No caller asks for it (`web/main.js:2312` is the
  only place "paced" is selected, with no `virgl`, `slirpNet: false`, `enableMic: false`), so I
  could not anchor a wrong execution and do not count it. Either refuse those combinations at
  the gate (a runtime change, which brings the browser gates with it) or add them to E5-T37c
  and reword the sentence to speak for the Replay desktop only.
- What the unit tests do and do not show. 31 one-line mutants of copies of the four files
  against the 12 tests (`mutants.mjs`, `mutants.json`): 24 killed, 7 survive. All nine
  `idle-sleep.js` mutants are killed; the one where the timer fires and never resumes is killed
  by the file hanging, not failing ("the defaults use the realm's timers" awaits with no
  timeout). The loader tests match source text and evaluate the two gate expressions; they do
  not run the tick. Survivors: `sleepIdle` leaving `tickScheduled` false, `sleepIdle` without its
  first-line guard (both indistinguishable on any admitted boot — see Coverage), `sleepIdle`
  dropping the ticket, the sleep resuming into `schedule` instead of `tick` (the run loop stalls
  after the first sleep — a browser load would show it at once, no unit test does), the
  lifecycle built without the policy, the wrap applied to every boot, and G5 above. The browser
  runs are what carry the loader's behaviour.

**Held** (carry forward while the named files and the bundle are unchanged)

- O1-O3 evidence is for the claimed head. `gates.log` names `423985d3d`; `web/dist/{loader,guest-clock,idle-sleep,main,roadmap}.js`
  are byte-identical to their sources and `web/dist` is clean against HEAD; `:8125` serves the
  same sha256 for those files and for `pkg/wasm_vm_wasm_bg.wasm`, which exports
  `wasmlinux_setPacedIdlePolicy` and `wasmlinux_takeIdleWaitMs`; the four result files start
  08:33-08:38Z, after the commit (08:30Z), and the claim's table and pooled medians (267.85 ms
  and 354.45 ms) are a faithful copy of them.
- P1 `node --test tests/e5-t37b-paced-idle.test.mjs`: 12 pass (`unit-e5-t37b.log`). P3 fmt, clippy
  and build: rc 0 (`gates-verifier.log`; clippy and build answered from a warm cache).
- P4 full web unit suite: 611 tests, 583 pass, 28 fail; the names equal `web-unit-failing-before.txt`.
  Ten of the 28 are loader and clock tests, the code this task changed, so I did not take the
  list on trust: in a sparse shared clone the eleven test files that hold them give the same 17
  failures at `6669dc702` and at `939f16b9a`.
- P5-P8 browser, my own fresh loads on `:8125` (Chrome 158.0.8127.88 headless), one a side:

  | | paced | `&pace=0` | paced, cold boot (`&noSnapshot`) | paced, wake removed (attack) |
  |---|---:|---:|---:|---:|
  | idle: worker inside run slices, % of wall | 9.5 | 99.8 | 10.9 | 9.6 |
  | idle: guest seconds per real second | 0.98 | 11.51 | 0.96 | 0.98 |
  | idle: sleeps / ended early by a host call, per 30 s | 584 / 109 | 0 / 0 | 668 / 212 | 530 / 0 |
  | idle: clock | paced-icount | icount | paced-icount | paced-icount |
  | idle: CPU time of the renderer process, OS-reported | 4.01 s in 27.3 s | 29.77 s in 28.4 s | 4.46 s in 27.3 s | 4.01 s in 27.3 s |
  | click result, median (min - max), n = 8, ms | 272.4 (263.3 - 608.8) | 360.4 (335.9 - 623) | 327.2 (306.7 - 664.6) | 281.1 (267.5 - 576.6) |
  | key echo, median, n = 8, ms | 49.6 | 46.5 | 42.4 | 79.9 |
  | desktop ready after | 3.6 s | 3.7 s | 31.2 s | 3.7 s |

  Every criterion holds on the first two columns: at most 30% and 0.8-1.2 s/s paced, at least 90%
  and 3 s/s unpaced, paced click median 24% lower, key echo 3.1 ms apart. The harness's median
  of eight is the fifth sample; the conventional one gives 270.6 / 359.9 ms and 49.2 / 46.5 ms.
  Zero disk waits in every load (`fetchWaits` 0), which is the premise of the gate. One console
  error a side, a 404: the server has no `/favicon.ico`, and the demo-page run, which records
  URLs, shows that one and no other. Background load was steady and the same on both sides (about
  4.2 of 16 cores: mediaanalysisd, a Spotify renderer, and another session's native boot; in
  each `cpu-*.summary.json`), and the numbers agree with the worker's, so I did not re-run.
- P10 the idle result does not rest on the loader's own counters: `ps` gives the renderer
  process that owns the worker 14.7% of a core over the idle window paced and 105% unpaced
  (`cpu-v-*.summary.json`).
- P9 demo page on the bundle: 127 passed, 0 failed, no page, console or HTTP errors
  (`demo-suite.json`, my own run); the row is in the bundle as `partial`.
- A1-A9 the attack list, by running the loader's own text — the block from `tickScheduled` to the
  first `schedule()`, the real `stop`/`pause`/`resume` bodies and the real controller wrap —
  against a scripted machine, a fake task queue and fake timers (`run-loop-harness.mjs`,
  `run-loop-harness.json`). A host call during a sleep clears the timer and posts one tick in
  the same turn, and a status read does too; a timer end resumes into exactly one tick; a stale
  callback does nothing; pause during a sleep runs no slice and resume, even twice, leaves one
  tick; stop during a sleep resolves `stopped` with no slice and no error after it; without the
  policy the wait is never taken and the controller is not wrapped; a delivery during a tick's
  await voids the wait that tick took. 300 seeds of 120 random steps (35,661 steps, 6,109
  sleeps, 1,239 wakes, 3,254 stale callbacks fired): never two pending ticks, never a stall,
  never a slice while paused or stopped. The harness notices eight of ten mutants I gave it,
  among them three the unit tests miss (`run-loop-harness-vs-mutants.json`). Quota pause cannot
  be set on an admitted boot (`usePersist` is false when `persist === false`,
  `web/loader.js:654`). Warm and cold boots: columns 1 and 3. A module without the bindings: the
  lifecycle throws before the divider is touched (worker's test; mutant G3 killed) and
  `web/loader.js:1166-1169` rethrows. `?pace=0`: column 2. Other guests: "paced" is selected in
  one place, and with `idleYield` false the tick ends in `schedule()` as before; they gain three
  fields in `schedulerStats()` and nothing else.
- NOVEL ATTACK: is the evidence sensitive to the wake? I served the committed bundle through a
  proxy that rewrites one line of `/loader.js` in memory so the controller wrap no longer calls
  `wakeIdle()` (`sabotage-proxy.mjs`; the checkout was not touched) and ran the paced benchmark:
  column 4. Predicted: key echo rises by more than 15 ms and no sleep ends early. Observed: 0
  wakes; key echo 79.9 ms by the harness's median and 65.5 ms by the conventional one, four of
  the eight samples at 80-94 ms — over the criterion's 61.5 ms either way, while the click
  median alone (281 ms) would have passed. The key-echo criterion is what proves the wake, and
  at n = 8 it does so with a margin of one sample.

**Coverage** of the "What the recorded runs executed" paragraph against the diff: it is accurate
for `web/` and for the two bindings. Unexecuted by any test or browser run:
`crates/wasm/src/lib.rs:1799-1829` and `web/guest-clock.js:68` (needs-evidence, above); the
`reentrant()`, `refuse_unrecorded_mutation` and `refuse_capture_mutation` error returns of the
two bindings (waived: the same plumbing every other setter has); the `true` branch of
`sleepIdle`'s first line, `web/loader.js:1301`, and the throw at `web/guest-clock.js:132`
(waived: defensive — `stopped` and `paused` are tested at `web/loader.js:1462` on every chunked
boot with nothing asynchronous after it, and a clock other than the two is refused by the
validation and the restored-clock check; 120 seeds of 120 random steps without the guard showed
no difference); the task files (waived: text).

**Suite**: nothing promoted, the verdict is not `verified`. `run-loop-harness.mjs` is the
candidate for the next round: it pins what the regex tests cannot.

**Not checked**: a second pair of loads a side (the criterion asks the worker for two; I ran
one and judged the worker's two as well); an unpaced cold boot, so I do not know what the paced
clock costs in time to desktop; a background or throttled tab, where a worker timer may run
later than the 50 ms cap; any browser but headless Chrome 158; the live site; the whole
`wasm-pack test --lib` set (only `exported_paced`); a cold `cargo clippy`; the core, which is
E5-T37a's and unchanged.

Commands: `cd web && node --test tests/e5-t37b-paced-idle.test.mjs`;
`cargo fmt --check`; `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`;
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`;
`wasm-pack test --node crates/wasm --lib -- exported_paced`, and the same under
`NODE_OPTIONS=--require=evidence/e5-t37b/verifier/fake-worker-scope.cjs`;
`node evidence/e5-t37b/verifier/shipped-wasm-probe.mjs web/dist/pkg [--fake-worker-scope]`;
`cd web && node --test --test-timeout=120000 tests/*.test.mjs`, and eleven of its files in a
sparse clone at `6669dc702` and at `939f16b9a`;
`evidence/e5-t37b/verifier/run-with-cpu.sh v-paced ''`, `… v-unpaced '&pace=0'`,
`… v-paced-cold '&noSnapshot'` (each is
`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --scenarios click,type,idle --n 8 --idle-s 30`
with a `ps` sampler beside it); `node evidence/e5-t37b/verifier/sabotage-proxy.mjs 8137 /loader.js <find> <replace>`
then `… run-with-cpu.sh v-sabotage-nowake '' http://127.0.0.1:8137`;
`node evidence/e5-t37b/verifier/mutants.mjs .`; `node evidence/e5-t37b/verifier/run-loop-harness.mjs web 300`;
`node evidence/e5-t37b/verifier/harness-vs-mutants.mjs .`; `node evidence/e5-t37b/verifier/gate-probe.mjs web`;
`node evidence/e5-t37b/verifier/restore-clock-probe.mjs web`;
`E5_DEMO_TASK=E5-T37b E5_DEMO_OUT=evidence/e5-t37b/verifier node evidence/e5-t37b/demo-suite.mjs`.

### 2026-11-26 — worker — round 2, evidence only (head `8fa4ce62e`)

Answer to the `needs-evidence` verdict above. Commits `d443a3837` (two tests and the follow-up
note) and `8fa4ce62e` (the regenerated build id). No runtime source changed: `git diff 939f16b9a..8fa4ce62e -- web crates ':!web/dist' ':!web/tests' ':!web/tasks.json' ':!web/gpu-checkpoint-build.js'`
shows `crates/wasm/src/lib.rs` only, inside the `#[cfg(target_arch = "wasm32")]` test.

- **Finding 1 — the wasm test's behaviour half never ran.** Node has neither a `Window` nor a
  `WorkerGlobalScope`, so `JsHostTimer::new()` was `None` and the test returned before
  selecting the paced clock. The test now gives its realm a host clock for its own duration
  (node's monotonic `performance` under the name the module looks for — the shim the verifier
  preloaded, installed and removed by the test itself, so the neighbouring test of the refusal
  without a host clock still runs in such a realm) and asserts that one is present instead of
  returning. The bound was wrong, as the verifier found: the first slice retires exactly 5
  (four argument-loading instructions and the `wfi`; the SBI call is served by the built-in
  SBI and is not a guest retirement). It is now `assert_eq!(…, 5.0)`. Checked that the half
  executes: with the expectation changed to 6 the test fails at that line with
  `left: 5.0, right: 6.0`; restored, `wasm-pack test --node crates/wasm --lib -- exported_paced`
  is 2 of 2 and the whole `--lib` set 17 of 17, with no environment variable.
- **Finding 2 — `web/guest-clock.js:68` executed by nothing.** New unit test "after a restore
  the paced policy is selected on top of the restored clock, or the restore is refused": a
  retire-count checkpoint with and without a divider request (exact call sequences, restored
  time untouched), a checkpoint taken under the paced clock (restored as paced, rebased, only
  the idle policy set — the clause the diff added), seven refusals before the machine is
  touched (a wall checkpoint; time, divider or timebase that is not the machine's; `null`; a
  paced checkpoint with no policy or under `wall-on-keyboard`), and `paced-on-keyboard`
  accepting the same paced checkpoint without setting an idle policy. The file is 13 tests.
- **The verifier's notes.** What the gate admits beyond the measured boot (accelerated
  graphics, `slirpNet`, the microphone) is added to E5-T37c as item 5 rather than changed
  here: narrowing the gate is a runtime change and no caller selects such a boot. The loader
  tests being source-text pins is accepted as stated; the browser runs carry the loader's
  behaviour, and the verifier's `run-loop-harness.mjs` is theirs to promote.

**The shipped wasm's bytes changed** although only test code did: the test sits above
non-test code in `crates/wasm/src/lib.rs`, panic locations carry line numbers, and 14 added
lines moved them (same size, 2,695,302 bytes). So the gates and the browser evidence were taken
again at `8fa4ce62e` rather than carried; round 1's are kept in `evidence/e5-t37b/round-1/`.

**Gates** (`bash evidence/e5-t37b/gates.sh`, log sha256 `e8054f82531e…`, at `8fa4ce62e`):
fmt, clippy and the wasm32 build exit 0; `exported_paced` 2 pass; `--lib` 17 pass; the unit
file 13 pass; web suite 612 tests with the same 28 failing names as before the task (`diff`
of the lists empty).

**Browser, the committed bundle at `8fa4ce62e`** (`bash evidence/e5-t37b/run-browser.sh 1 2`):

| | paced (default) | unpaced (`?pace=0`) |
|---|---:|---:|
| idle: worker inside run slices, % of wall | 10.2 / 9.9 | 99.8 / 99.8 |
| idle: guest seconds per real second | 0.97 / 0.97 | 11.91 / 11.92 |
| idle: sleeps per 30 s | 595 / 592 | 0 / 0 |
| idle: of those, ended early by a host call | 112 / 109 | 0 / 0 |
| click result, median ms (n = 8 each) | 267.7 / 270.6 | 339.6 / 369.7 |
| key echo, median ms (n = 8 each) | 45.4 / 48.8 | 41.1 / 46.1 |

Pooled (16 clicks a side): median 266 ms paced against 347 ms unpaced,
23% lower. Every criterion holds. Demo page: 127 passed,
0 failed of 127; no page, console or HTTP errors.

### 2026-11-26 — verifier (round 2) — VERDICT: verified

Fresh session: I did not implement this and I am not the round-1 verifier. Head `600ceeb11` (the
claim's `8fa4ce62e` plus one commit that touches only this file and `evidence/`). My predictions
were written before I opened either changed test or any round-2 result
(`evidence/e5-t37b/verifier-r2/predictions.txt`); every file named below is in that directory
unless its path says otherwise.

Both demands of round 1 are met, nothing the worker changed since is runtime code, the evidence
is for the new bundle, and my own attack found no contradiction. Status `verified`; the roadmap
row is flipped; one test is promoted.

**Premise — what changed since the head round 1 examined (`939f16b9a`)**

- R1 HELD. Predicted: outside generated files, the diff under `crates/`, `web/` and `tools/` is
  two files and every `lib.rs` hunk is inside one test function. Observed: four hunks at old
  lines 1796-1829 of `crates/wasm/src/lib.rs`, all inside
  `exported_paced_idle_policy_is_strict_and_reports_a_waiting_guest` (module `guest_clock_tests`,
  which ends at line 1985), and `web/tests/e5-t37b-paced-idle.test.mjs` (+47 lines, one new
  test). `tools/` is untouched.
- R2 HELD. Predicted: the shipped wasm at the two commits has the same length and an identical
  Code section, and differs only in panic-location line numbers, all moved by one constant.
  Observed (`wasm-diff.py`, `wasm-diff.json`): 2,695,302 bytes both; all thirteen sections have
  the same bounds; Type, Import, Function, Table, Memory, Global, Export, Elem, DataCount, Code
  (2,449,023 bytes, 2,438 functions) and both custom sections are byte-identical. 48 bytes
  differ, all in Data: 46 little-endian words, each the `line` field of a
  `core::panic::Location` whose file is `crates/wasm/src/lib.rs`, each new = old + 14, old lines
  2150 to 5523 (all below the test), and each names the same source line in the old file and in
  the new one. No instruction changed. As a cross-check by behaviour, thirteen guests (204,994
  run slices) through both binaries under a scripted host clock produce identical output
  (`boundary-probe.json`, `boundary-probe-939f16b9a.json`).
- R3 HELD. The JS glue `pkg/wasm_vm_wasm.js` is identical; between the two heads `web/dist`
  differs in the wasm, `gpu-checkpoint-build.js` (its two hashes), `sw.js` (the cache version
  string) and `tasks.json`.
- So round 1's `Held` list is carried, not redone: the files it rests on (`web/loader.js`,
  `web/guest-clock.js`, `web/idle-sleep.js`, `web/main.js`, `tools/perf/desktop-latency.mjs`,
  the wasm's code) are unchanged. Carried: P5-P8 (that verifier's own paced, unpaced and
  cold-boot loads), P10 (OS-reported CPU), A1-A9 (the attack list through the loader's own run
  loop), the wake-removal attack, and the coverage waivers. Not carried, because their inputs
  changed, and re-run here or by the worker at the new head: P1 (the unit file, now 13 tests),
  P3 (fmt, clippy, build), P4 (the web suite), P9 (the demo page) and O1-O3 (evidence for the
  head).

**Finding 1 — the wasm test: met**

- F1a/F1b HELD. Predicted: no return before the behaviour half; the host clock is supplied by
  the test itself. Observed, `crates/wasm/src/lib.rs:1800-1807`: when the realm has no host clock
  the test installs `globalThis.WorkerGlobalScope` (a class whose `Symbol.hasInstance` accepts
  the global) through `js_sys::eval`, then `assert!(JsHostTimer::new().is_some())`. Nothing is
  preloaded.
- F1d HELD. Predicted: exactly 5 retired, a wait reported once, then 2; the whole budget and no
  wait without the opt-in and in pure ICount; equality on the 5. Observed: `assert_eq!(…, 5.0)`
  at 1822, wait in (20,000, 26,843.6] ms at 1824, second take 0 at 1825, 2 retired and a wait at
  1827-1828, 5,000 and 0 at 1832-1833 and again at 1838-1839. The shipped wasm, driven by me
  under a frozen host clock, gives 5 retired, 26,843.5456 ms (all of the 2^28 ticks), 0 on the
  second take, then 2 (`boundary-probe.json`, guest A).
- F1f HELD. `wasm-pack test --node crates/wasm --lib -- exported_paced`: 2 passed, rc 0;
  `wasm-pack test --node crates/wasm --lib`: 17 passed, rc 0; `NODE_OPTIONS` and `RUSTFLAGS`
  unset (`wasm-tests.log`).
- F1e HELD — the behaviour half executes and its assertions bite. Six mutations, one at a time,
  in a scratch clone, same command (`wasm-sabotage.py`, `wasm-sabotage.json`, a log each); every
  one ends `1 passed; 1 failed` in the idle test:

  | mutation | panics at | with |
  |---|---|---|
  | test expects 6 retired | `lib.rs:1822` | left 5.0, right 6.0 |
  | binding: `takeIdleWaitMs` always 0 | `lib.rs:1824` | wait 0 ms |
  | binding: wait in seconds, not ms | `lib.rs:1824` | wait 26.842498 ms |
  | binding: policy always passes `false` to the core | `lib.rs:1816` | `paced_idle_yield()` false |
  | binding: policy always passes `true` | `lib.rs:1832` | left 2.0, right 5000.0 |
  | test: stays paced for the last block | `lib.rs:1837` (one line removed) | left 2.0, right 5000.0 |

- F1c HELD, and my prediction was wrong on one point. Predicted: the shim is gone when the test
  returns, and a neighbouring test would fail if it were not. Observed, with
  `assert!(JsHostTimer::new().is_none())` added as the first line of both neighbours in the
  clone: 17 pass, and the run order (paced_selection, paced_idle, clock_selection) puts one
  neighbour before the idle test and one after, so the realm has no host clock in both
  positions (P-A). With the removal deleted as well, the neighbour that runs after fails on the
  probe (P-B): the probe can see a leak and the removal is what prevents one. But without my
  probes the neighbours do not notice: removal deleted, 17 pass (P-C), because both branch on
  `JsHostTimer::new().is_some()` (`lib.rs:1717`, `1867`) and accept either realm. What notices a
  leak is the idle test's own last assertion (`lib.rs:1842`; with the delete replaced by a no-op
  the test fails there, P-D). No demand: the acceptance does not speak of the neighbours and the
  test checks its own cleanup. A panic inside the behaviour half skips the cleanup, so on a run
  that is already failing the later tests see a host clock.

**Finding 2 — `web/guest-clock.js:68`: met**

- F2a/F2b HELD. Predicted: a paced checkpoint under "paced" is accepted with the calls
  restore-as-paced, rebase, idle policy and no second clock selection; mismatches are refused
  before the machine is touched. Observed, `web/tests/e5-t37b-paced-idle.test.mjs:179-224`:
  the paced checkpoint gives exactly `setICountDivider 64`, `setGuestClock paced-icount`,
  `rebaseGuestClock`, `setPacedIdlePolicy true 50`; seven refusals (a wall checkpoint; `mtime`,
  `clockDiv` or `timebaseHz` not the machine's; `null`; a paced checkpoint with no policy and
  under `wall-on-keyboard`), each with the expected message and zero calls on the machine;
  `paced-on-keyboard` accepts the same paced checkpoint and sets no idle policy.
- F2d HELD. `cd web && node --test tests/e5-t37b-paced-idle.test.mjs`: 13 tests, 13 pass
  (`unit-e5-t37b.log`).
- F2c HELD. Nineteen one-line mutants of lines 66-134 on a scratch copy
  (`guest-clock-mutants.mjs`, `guest-clock-mutants.json`): 18 killed, all by the new test. On
  the clause itself and the two lines that use it: dropping `|| interactiveClock === "paced"`
  (round 1's G5, which survived the 12 tests), mapping "paced" to "wall", dropping
  "paced-on-keyboard", letting `wall-on-keyboard` or no policy accept a paced checkpoint, not
  comparing the mode at all, and refusing every mode but the boot's — seven of seven killed, in
  both directions. Around it: the `mtime`, `clockDiv`, `timebaseHz` and `null` checks, the
  rebase, the restore selecting the checkpoint's mode, the second selection, the policy value
  and `idleYield` — eleven of twelve. The survivor removes the mode from the check after the
  restore at line 112, a line from `2a8e9598b`, not from this task's diff; not raised.

**Evidence at the new head: held**

- E1. `evidence/e5-t37b/gates.log` begins `head 8fa4ce62e…; crates/web changes outside the
  commit: 0`, sha256 `e8054f82531e…`; every rc 0; 2, 17 and 13 pass; the web suite 612 tests
  with the 28 failing names of `web-unit-failing-before.txt`. Mine at `600ceeb11`: fmt, clippy
  and the wasm32 build rc 0 (`gates-verifier.log`); the whole web suite with the promoted test
  present, 621 tests, 593 pass, 28 fail, the same 28 names (`web-unit-suite.txt`).
- E2. `8fa4ce62e` was committed at 09:16:51Z; `gates.log` was written at 09:25:46Z; the four
  loads start at 09:25:50Z, 09:27:23Z, 09:28:55Z and 09:30:28Z and the last ends at 09:31:55Z;
  `demo-suite.json` is from 09:32:03Z; the claim commit is 09:32:11Z. Each load is a warm boot
  ("desktop ready after 3.6 s" in each log), `missing` is empty, and the one console error a
  side is the favicon 404 round 1 identified.
- E3. `git diff 8fa4ce62e 600ceeb11 -- web` is empty and `web/dist` is clean against HEAD;
  `:8125` serves the bytes of HEAD for `loader.js`, `guest-clock.js`, `idle-sleep.js`,
  `main.js`, `roadmap.js`, `app.html`, `sw.js`, `gpu-checkpoint-build.js`,
  `pkg/wasm_vm_wasm.js` and `pkg/wasm_vm_wasm_bg.wasm` (sha256 `19cd4d2d…`, the one
  `gpu-checkpoint-build.js` names).
- E4. The worker's table is a faithful copy of the four files. Recomputed from their raw
  samples (`worker-browser-check.txt`):

  | | paced 1 / 2 | `&pace=0` 1 / 2 |
  |---|---:|---:|
  | idle: worker inside run slices, % of wall | 10.2 / 9.9 | 99.8 / 99.8 |
  | idle: guest seconds per real second | 0.97 / 0.97 | 11.91 / 11.92 |
  | idle: sleeps / ended early, per 30 s | 595 / 112, 592 / 109 | 0 / 0 |
  | click result, harness median (fifth of eight), ms | 267.7 / 270.6 | 339.6 / 369.7 |
  | click result, conventional median, ms | 265.9 / 266.2 | 337.6 / 362.3 |
  | key echo, harness median, ms | 45.4 / 48.8 | 41.1 / 46.1 |
  | key echo, conventional median, ms | 44.6 / 48.0 | 40.2 / 46.0 |

  Pooled over both loads: click 265.9 ms against 347.2 ms (23.4% lower), key echo 46.8 ms
  against 44.2 ms. Every criterion holds for each pair and for each paced load against each
  unpaced load (largest key-echo difference 7.7 ms), by either median.
- I ran no browser load of my own: the premise check leaves no doubt about the shipped wasm.
  The browser result rests on the worker's four loads at this bundle and on the round-1
  verifier's own loads at the previous one.

**Novel attack — boundary values at the wasm-to-sleeper seam: nothing found**

Round 1 probed one guest, with its timer 26.8 s away. I drove the shipped wasm at HEAD in node
with a host clock I step by hand, fed every reported wait to the real `web/idle-sleep.js` with
fake timers, and looped as the loader does: thirteen guests whose timer is 1 tick ahead, already
due, never armed, at `u64::MAX`, at `0xffff_ffff_ffff_f000`, at 2^63, just under and exactly at
the 1.5 ms minimum, exactly at and one tick over the 50 ms cap, and 26.8 s and 214.7 s away
(`boundary-probe.mjs`, `boundary-probe.json`). Predictions N1-N5 written beforehand; a wait that
is not a finite nonnegative number, a sleep outside 1.5-50 ms or longer than the wait, a wait
past the guest's deadline, or a timer seen due early or more than 50 ms late would have been a
finding. Observed, zero violations in 204,994 slices:

- 1 tick ahead: wait 0.0001 ms, not slept on, due at the next slice. Already due: no wait.
- 12,288 ticks (1.2288 ms): 62 waits from 1.2288 down to 0.0089 ms, none slept on, seen due
  0.011 ms after the deadline. 15,000 ticks: wait 1.5, one sleep of 1.5 ms, seen due on time.
- 500,000 ticks: wait 50, one sleep of 50 ms. 500,001: wait 50.0001, a sleep of 50, then a
  wait of 0.0001 not slept on.
- 26.8 s: 537 sleeps that sum to 26,843.5456 ms, the last 43.5456 ms; 214.7 s: 4,295 sleeps
  that sum to 214,747.9552 ms. Guest time per host time 1.0000 in both; never late.
- `0xffff_ffff_ffff_f000` and 2^63: the wait saturates at 18,446,744,073,709.55 ms (`u64::MAX`
  ns), finite, and every sleep is 50 ms.
- A cost, not a contradiction of this task: with no timer armed, and with the deadline set to
  `u64::MAX` (SBI's "never"), no wait is reported at all, so the run loop spins as it did before
  this task — 100,001 slices in 2 s of host time here, zero sleeps. The Replay desktop's idle
  does not show it (10% in run slices), since it always has a timer pending, and the core's
  answer is E5-T37a's. A guest that parks with its timer disarmed and waits for a device
  interrupt alone would get no idle sleep; that belongs with the cases E5-T37c measures.

**Coverage.** Round 2's diff is test code. The wasm test's new lines all execute under the
acceptance command (the six mutations land on 1816-1838, P-D on 1842); the `shimmed == false`
path, a realm that already has a host clock, is not taken under node (waived: it is the same
body without the two `eval` calls). Round 1's two unexecuted hunks,
`crates/wasm/src/lib.rs:1799-1829` (now 1808-1843) and `web/guest-clock.js:68`, are now executed
and mutation-checked. Its waivers stand.

**Suite**

- Promoted: `web/tests/e5-t37b-run-loop.test.mjs` (9 tests, about 2 s,
  `cd web && node --test tests/e5-t37b-run-loop.test.mjs`), round 1's `run-loop-harness.mjs`
  as a `node:test` file that depends on nothing under `evidence/`. It runs the loader's own
  text — the run loop, the real `stop`/`pause`/`resume`, the real controller wrap — against a
  scripted machine, a hand-drained task queue and hand-fired timers: the eight scenarios of the
  attack list and 200 seeded random walks of 120 steps, holding at most one pending tick, no
  stall, no slice while paused or stopped, no sleep on a wait taken before a delivery, and
  every sleep within 1.5-50 ms. It cannot hang: the scripted machine refuses more than 2,000
  slices, every promise from the loop is awaited with a 2 s deadline, each test has a 30 s
  timeout. Sabotage check on a scratch copy (`run-loop-test-vs-mutants.mjs`,
  `run-loop-test-vs-mutants.json`): 14 of 16 mutants noticed, none hung, slowest 4.1 s — round
  1's ten (the same eight noticed, among them the three the source-text tests miss) and six of
  mine (`stop()` that never settles, a sleeper that resumes synchronously, a sleep and a tick
  together, a tick that ignores the machine's wait, a host call that always reschedules, a
  sleep without the cap). The two it does not notice are the two round 1 waived: `sleepIdle`
  without its first-line guard or without setting `tickScheduled` is indistinguishable while a
  tick awaits nothing after its slice. Why keep it: the worker's loader tests match source
  text, and no other test runs the tick.
- Discarded as tests, kept as evidence: `boundary-probe.mjs` (needs the built bundle and a
  faked global; the wasm test and the sleeper's unit test now pin both sides of that seam), the
  two mutant scripts and `wasm-sabotage.py` (one-time checks of tests, not tests), `wasm-diff.py`
  (a comparison of two commits).

**Notes — not findings**

- E5-T37c could take a sixth case from the attack above: a guest whose timer is disarmed
  (`u64::MAX`, or none) reports no wait and gets no idle sleep.
- The two wasm tests beside the idle test accept a realm with or without a host clock, so
  under node they show the refusal only because the idle test cleans up after itself (F1c).

**Not checked**: a browser load of my own; any browser but the headless Chrome 158 the worker
and round 1 used; a background or throttled tab; the live site (nothing was deployed); a
release rebuild of the wasm from source before this commit (the commit hook rebuilds the
bundle; see the addendum below); a cold `cargo clippy`; `cargo clippy --all-targets` (E5-T40);
the core, which is E5-T37a's and unchanged; E5-T37c's cases.

Commands: `wasm-pack test --node crates/wasm --lib -- exported_paced`;
`wasm-pack test --node crates/wasm --lib`;
`python3 evidence/e5-t37b/verifier-r2/wasm-sabotage.py <scratch clone> evidence/e5-t37b/verifier-r2`
(the clone: `git clone --shared --no-checkout`, sparse without `evidence/`, `web/dist/`,
`releases/`, plus `evidence/e5-t26p/baseline-semantic.stdout`, which a wasm integration test
includes);
`python3 evidence/e5-t37b/verifier-r2/wasm-diff.py <wasm at 939f16b9a> <wasm at 600ceeb11> <lib.rs at 939f16b9a> crates/wasm/src/lib.rs`;
`cd web && node --test tests/e5-t37b-paced-idle.test.mjs`;
`node evidence/e5-t37b/verifier-r2/guest-clock-mutants.mjs . <scratch>`;
`node evidence/e5-t37b/verifier-r2/boundary-probe.mjs web/dist/pkg web [<wasm at 939f16b9a>]`;
`cd web && node --test tests/e5-t37b-run-loop.test.mjs`;
`node evidence/e5-t37b/verifier-r2/run-loop-test-vs-mutants.mjs . <scratch>`;
`cargo fmt --check`; `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`;
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`;
`cd web && node --test --test-timeout=120000 tests/*.test.mjs`;
`curl` of ten files from `:8125` against `git show HEAD:web/dist/…`.

**Addendum, after the flip (head `57579bfaf`).** The commit hook rebuilt the bundle from source
for that commit. `web/dist` changed in `roadmap.js` (the row), `sw.js` (the cache version string)
and `tasks.json` only: the release wasm the hook built is byte-for-byte the committed one
(sha256 `19cd4d2d…`; build id `87a1d434…` unchanged). That is the rebuild listed under "Not
checked" above, and it shows the measured wasm is what the sources build to. The demo page on
that committed bundle (`node evidence/e5-t37b/verifier-r2/demo-row.mjs`; `demo-row.json`,
`demo-row.png`; Chrome 158.0.8127.88 headless, one load): 127 passed, 0 failed of 127; no page,
console or HTTP errors; the row "Replay desktop keeps real time while idle and lets its worker
sleep" has the pip class `cap-pip verified`, and the bundle's `tasks.json` lists E5-T37b as
`verified`. The capability panel is kept hidden in `app.html` (`#legacy-roadmap`), so "shows"
means the status the page binds to the row — what `evidence/e5-t37b/demo-suite.mjs` reads too.
The last acceptance bullet holds.

### 2026-11-26 — worker — deployed

`bash tools/deploy-cloudflare.sh` at `68e138982` published the verified bundle to
<https://wasm-vm.pages.dev> (Pages deployment `ffe968ed`). One fresh load of the live site
(`node tools/perf/desktop-latency.mjs --url https://wasm-vm.pages.dev --app /app.html --scenarios click,type,idle --n 6 --idle-s 30`,
`evidence/e5-t37b/live/`): clock `paced-icount`; idle 9.8% of wall time in run slices, guest
time 0.98 s/s, 600 sleeps in 30 s; click result median 268 ms (n = 6, first click 593 ms);
key echo median 44 ms.

