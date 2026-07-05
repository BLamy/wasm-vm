# Browser timekeeping (E2-T23)

Guest time in the browser comes from **two independent clocks that are never derived from each
other**. Understanding which is which explains every observable behavior below.

## The two clocks

| Clock | Source | Truth it carries | Where the guest reads it |
|---|---|---|---|
| **`mtime` / clocksource** | **retired-instruction count** (`clint`, `clock_div = 10`, 10 MHz DTB timebase) | monotonic-since-boot, **execution-paced** | CLINT `mtime`, the `time` CSR, `CLOCK_MONOTONIC`, `/proc/uptime`, timer deadlines (`sleep`, scheduler tick) |
| **goldfish RTC** | **`Date.now()`** (`JsWallClock`, E2-T16) | true wall-clock time | read once at boot to seed the system clock; on demand via `hwclock` |

`mtime` advances **one tick per `clock_div` retired instructions** — it is a deterministic
retire-count clock, *not* a host clock. This is deliberate: native and wasm retire the same
instructions, so a timer interrupt lands at the same retire index on both (the property the
Level-1 / RISCOF suites assert, and what snapshot-replay depends on). The host wall clock lives
only in the goldfish RTC, behind the `WallClock` trait, so `crates/core` stays host-clock-free
(the determinism gate enforces this).

**We never derive one clock from the other.** `mtime` is not scaled from `Date.now()`, and the
RTC is not scaled from `mtime`. They measure different things.

## Consequence: the guest software clock drifts behind wall time

Linux seeds its system clock from the RTC **once at boot** (correct wall time at that instant),
then advances it using the **clocksource** — which is `mtime`, i.e. execution-paced. So after
boot the guest's `date` runs **behind** real wall time by however much wall time exceeded guest
execution time. This is expected, not a bug. To realign, the guest reads the RTC again
(`hwclock -s`); a real deployment would run NTP or periodic `hwclock -s`.

## Measured behavior (headless Chromium under Playwright — `web/tests/timekeeping.spec.js`)

Numbers are environment-dependent (they scale with interpreter speed); the *shape* is the point.

| Measurement | Observed | Meaning |
|---|---|---|
| `date` drift behind host, just after boot | **~12 s** | boot's wall time far exceeded guest execution time |
| foreground guest/wall ratio, at the idle prompt | **~0.05** | at the near-idle prompt the guest is mostly in `WFI`, retiring little, so its clock advances at ~5% of wall (higher under CPU-bound load) |
| guest `sleep 2` | **~40 s wall (~20×)** | a timer sleep spins `WFI` until retire-count `mtime` reaches the deadline; **there is no WFI fast-forward**, so idle guest-seconds cost ~20× wall here |
| pause 12.4 s wall (tab hidden) | uptime **+0.30 s**, date **+0 s** | both guest clocks **froze** with execution — no jump, no catch-up |

### The `sleep` slowness is the one real limitation
Because there is no idle fast-forward, a sleeping/idle guest's clock crawls, so `sleep N` costs
roughly `N / ratio` wall-seconds (~20× at idle in this environment). Native builds run near the
calibrated rate (~100 MIPS ≈ 10 MHz × `clock_div`), so native `sleep` is close to real-time; the
browser interpreter is ~20× slower, which is where the gap comes from. **Recommended follow-up:**
a *deterministic* WFI fast-forward (tickless idle) — when the hart executes `WFI` with only a
timer wakeup armed, advance `mtime` straight to the nearest armed deadline instead of spinning.
This keeps native and wasm in lock-step (both fast-forward by the same state-derived amount, so
the interrupt still lands at the same retire index) while making `sleep`/idle near-real-time. It
is out of scope here (a core run-loop change needing RISCOF re-verification) but is the clean fix.

## Suspend / background policy

`main.js` idles the executor on `document.visibilitychange` (hidden → `pause()`, visible →
`resume()`), implemented in `web/loader.js` as a flag that stops/starts the `setTimeout` run loop.

Because `mtime` is a **retire-count** clock, this is trivially safe:

- Pausing stops retiring instructions → **guest monotonic time freezes** and continues seamlessly
  on resume. The "one giant `mtime` jump on foreground" that a `performance.now()`-derived clock
  would produce (clock-skew warnings, RCU stalls, a burst of catch-up timer interrupts) **cannot
  occur** — there is no accumulated wall-time debt to reconcile.
- No slew clamp, catch-up budget, or `notify_resumed()` reconciliation is needed. The measured
  resume delivered zero stalls/lockups and a responsive shell (verified in the spec).
- The goldfish RTC keeps true wall time across the gap (it is `Date.now()`), so on resume the RTC
  reads correctly even though `date` (the execution-paced software clock) is still behind.

## Acceptance-criteria reconciliation (honest)

The task file was written assuming a `performance.now()`-derived `mtime`; the project chose to
**keep the deterministic retire-count clock** (determinism > wall-accurate time). Against that
choice:

- **#1 `sleep 5` in 5 s ±100 ms wall — NOT met by design.** Sleep is execution-paced (~20× at idle
  here). Documented, not promised. The WFI fast-forward above is the path to meeting it.
- **#2 background 60 s → no stall/storm, shell responsive, RTC correct — met.** Pause/resume froze
  both clocks cleanly; no rcu-stall/soft-lockup/storm; RTC (`Date.now`) unaffected.
- **#3 `uptime` after background reflects the policy — met.** It reflects *executed* time (frozen
  during the pause), exactly as this doc specifies.
- **#4 `date` monotonic over a soak — met** (monotonic, execution-paced).

Native behavior is unchanged throughout: the same retire-count clock, just fast enough that the
guest/wall ratio is near 1.
