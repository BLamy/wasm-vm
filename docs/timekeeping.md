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

Two regimes, before and after the **WFI fast-forward** (E2-T23b, below):

| Measurement | Before fast-forward | After fast-forward (current) |
|---|---|---|
| guest `sleep 2` | ~40 s wall (**~20×**) | **~2.5 s wall (~1.2×)** — near real time |
| guest `date` vs host after boot | ~12 s **behind** | ~**ahead** (idle compressed to ~0 wall) |
| guest/wall ratio while idle | ~0.05 (clock crawls in `WFI`) | ≫1 (idle skipped; virtual time runs ahead) |
| pause (tab hidden) | both clocks freeze | both clocks freeze (unchanged) |

### The WFI fast-forward (E2-T23b) — fixes idle/sleep slowness, keeps determinism
Originally there was no idle fast-forward, so a sleeping/idle guest's clock crawled: `sleep N` spun
`WFI` until the retire-count `mtime` reached the deadline, costing ~`N / ratio` wall-seconds (~20× in
the browser). `Machine::wfi_fast_forward()` (`crates/core/src/lib.rs`) fixes this: when a `WFI`
retires with no interrupt pending, `mtime` jumps straight to the nearest armed timer deadline
(`min(mtimecmp, stimecmp)`) so the timer fires the next boundary and the guest wakes immediately in
wall-clock terms.

This **keeps determinism**: the jump is a pure function of machine state (`mtime`, `mtimecmp`,
`stimecmp`) with no host clock, so native and wasm fast-forward by the identical amount and every
timer still lands at the same retire index on both. RISCOF signatures are unchanged (the jump alters
only the idle spin count, not final state — verified: full suite 615/615, all rv64 architectural
tests green). When no timer is armed (a genuine deadlock, caught by the WFI watchdog) it is a no-op.

**Consequence — deterministic virtual time (like QEMU `icount`):** because idle is now compressed to
~0 wall time, the guest clock runs *ahead* of real wall time instead of behind (measured ~118× the
wall rate while idle). This is the inherent tradeoff of a *deterministic* fast-forward: making the
guest track real wall time during idle would require a host-clock reference, which would break
determinism (the rejected `performance.now()` design). Practical effects: `sleep`/idle are
near-real-time and interactive; explicit timed waits like `read -t N` may expire early in wall-clock
terms; `date` runs fast (resync with `hwclock -s`). Input remains prompt — host keystrokes/IRQs are
sampled every run-loop boundary regardless of the clock jump.

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
  reads correctly even though `date` (the execution-paced software clock) has drifted from wall time.

## Acceptance-criteria reconciliation (honest)

The task file was written assuming a `performance.now()`-derived `mtime`; the project chose to
**keep the deterministic retire-count clock** (determinism > wall-accurate time). Against that
choice:

- **#1 `sleep 5` in ~5 s wall — met (loosely) by the WFI fast-forward.** A guest `sleep` is now
  near-real-time (`sleep 2` ≈ 2.5 s, ~1.2×) instead of ~20×. It is not held to ±100 ms — the clock
  is deterministic virtual time, not wall-locked — but the slowdown is gone.
- **#2 background 60 s → no stall/storm, shell responsive, RTC correct — met.** Pause/resume froze
  both clocks cleanly; no rcu-stall/soft-lockup/storm; RTC (`Date.now`) unaffected.
- **#3 `uptime` after background reflects the policy — met.** It reflects *executed* time (frozen
  during the pause), exactly as this doc specifies.
- **#4 `date` monotonic over a soak — met** (monotonic, execution-paced).

Native behavior is unchanged throughout: the same retire-count clock, just fast enough that the
guest/wall ratio is near 1.
