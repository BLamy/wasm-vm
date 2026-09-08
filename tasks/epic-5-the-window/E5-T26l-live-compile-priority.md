---
id: E5-T26l
epic: 5
title: Refresh live priority when selecting pending JIT compilation jobs
priority: 526.597
status: in-progress
depends_on: [E4-T21, E5-T22g, E5-T26k]
estimate: S
risk: high
capstone: false
---

## Goal

Test a bounded compilation-selection candidate for F's remaining latency. The
actual public-type reproducer in `evidence/e5-t26f/compile-priority-reproducer/`
shows a pending job retaining priority64 after its live discovery hotness rises
to1064. Daybreak accepted that limited source-level claim, not browser causality
or an E4 violation. Actual cross-pump integration and a new browser screen are
required before promoting this candidate. F's original2-second gate is unchanged.

## Boundary

Own only bounded in-place refresh of resident compile-job hotness from the
existing read-only discovery lookup, immediately before compile selection, and
the associated deterministic evidence. Preserve the existing order of bounded
FIFO staging, stale cancellation and recount; refresh only the surviving jobs
after those operations and before `pop_hottest`. Do not move cancellation ahead
of staging or invent a new stale-incoming admission policy. This does not claim
globally current priority at incoming-job admission or starvation freedom.

Keep request bytes/generation/metadata, byte validation, discovery nomination and
anti-storm rules, bounds/thresholds, eight-attempt and64-staging browser budgets,
decoded capacity4096, module cap24, chaining, guest/device clocks, snapshot formats,
image/helper and F's proper browser driver unchanged. No new runtime tuning API,
hot-path instrumentation, profiling switch, guest command or acceptance override.

## Acceptance criteria

- Refresh changes only each surviving resident job's stored priority. It visits
  at most the bounded resident count in place, preserving payloads, queue order,
  counters and recount; equal/saturated priorities keep existing tie semantics.
- A real Machine workload retains a compile backlog across an exhausted host
  budget, accrues later interpreted hits, then selects the newly hotter resident
  on a later pump. Cover zero newly staged nominations; public-type composition
  alone is not sufficient. Compare fixed-retirement registers/RAM digest with
  the unchanged interpreter path.
- Empty/disabled/zero-budget paths stay inert. Existing finite-burst progress,
  backpressure/recount, stale resident and stale incoming cancellation, fresh
  same-PC re-nomination, and live-byte/generation refusal remain correct. Refresh
  must not install stale bytes or clear fresh discovery state.
- Native affected-core tests, guest/digest differentials, no_std wasm build and
  actual browser-JIT WASM parity/cooperative-budget tests pass. Record one final
  scrubbed-environment pristine-clone runtime proof and the exact tested head.
- Build the demo, record126 passed/0 failed and zero non-favicon errors with this
  task visible, then create a new authenticated cold resident checkpoint. Run
  the unchanged default-policy F restore/physical-play diagnostic and report its
  original T0/end, CRC, actual input, fresh PCM and timing outcome. Do not rebind
  the earlier seal, subtract observer time or mark F verified from this screen.

## Verification command

make verify-E5-T26l

## Adversarial verification

Exercise late-hot/equal/saturated scores, absent/recount-reset hit records, full
small-cap backpressure and same-PC requests spanning a generation change. Prove
the real cross-pump backlog selection and unchanged aggregate submission/staging
bounds, including no new FIFO work. Independently sabotage the refresh call and
require the cross-pump regression to fail; stale-byte protection must still hold.
One bounded novel attack should target this queue/selection boundary. Inspect
every changed hunk and preserve the original F failure if its own cap still fails.

## Verification log

### 2026-09-08 — coordinator — bounded runtime candidate, not an assumed F fix

PR363 retains the independently reviewed source-level priority reproducer and
new discovery/latency records. At runtime head `690e2324`, F fails4591.175 ms with
zero since-reset discovery overflow/exhaustion/stale counts; the separate latency
probe first observes fresh PCM at3818.160 ms and fails4726.940 ms overall. Those
negative results and unchanged architecture/functional HELD evidence carry.
This task owns the separate core scheduling boundary; F leaves the active lane
until this candidate has deterministic integration and browser evidence.
