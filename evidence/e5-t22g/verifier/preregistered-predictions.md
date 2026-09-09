# E5-T22g verifier preregistration — 2026-09-06

Recorded after reading `AGENTS.md` and the complete task file, and before inspecting
the task-scoped diff or any worker evidence.

## Falsifiable predictions

- **P1 — exact submission identity.** The submitted checkout and every retained final
  evidence artifact will identify `20cd787d` or its implementation parent
  `9c7861d23bec091fa37f8da23cce830154dd1a83` exactly as documented; hashes in the
  task log will recompute byte-for-byte. A stale or mismatched runtime artifact fails.
- **P2 — default-off compiled execution, Chromium and Firefox.** In a real dedicated
  Worker, each browser's profiling-off phase will retire exactly 400,000 instructions,
  execute at least one compiled block/host entry and nonzero deterministic copy/byte
  work, while both independent timer-read delta and entry nanoseconds are exactly zero.
- **P3 — profiling-on control.** In each browser, enabling profiling will produce a
  strictly positive timer-read delta and nonnegative entry nanoseconds while retaining
  the same fixed retirement count; nanosecond zero alone cannot satisfy this prediction.
- **P4 — both installation orderings.** Enabling profiling before executor attachment and
  attaching the executor before enabling profiling will each yield positive timer-read
  deltas during compiled execution in both browsers.
- **P5 — disable/re-enable boundaries.** After a timed phase, disabling profiling will
  make the immediately following fixed-work phase add exactly zero timer reads and zero
  entry nanoseconds; re-enabling will make the next phase add strictly positive reads.
  A second independently inspected toggle boundary must show the same 0/positive pattern.
- **P6 — executor replacement.** Replacing the executor while profiling is off will keep
  the replacement off (zero read delta); replacing while profiling is on will arm the
  replacement (positive read delta), in both browsers.
- **P7 — fixed-work architectural parity.** Always-off and toggled/on control runs will
  each retire exactly 1,600,000 instructions and end with byte-identical architectural
  registers and RAM digests. Default-off must still show compiled execution.
- **P8 — diagnostic isolation.** The task diff will route the profiling state only into
  the browser-JIT entry-cost timer and executor installation/replacement plumbing. It
  will not alter or condition guest clocks, device timers, scheduler budgets, retirement,
  JIT translation/chaining/cache policy, or persisted formats. Repository searches and
  task-scoped hunks must expose no such routing.
- **P9 — forced-default-on sabotage.** A source mutation that forces the default gate on
  will make the profiling-off assertion fail in both Chromium and Firefox for the intended
  reason: positive timer-read delta (not setup, timeout, syntax, or unrelated failure).
- **P10 — demo and immutable desktop capture.** Final demo evidence will report 126 pass,
  0 fail, and zero page/console/HTTP errors. The unchanged v7 desktop capture will report
  seven modes, no profiler, consistent client/PID/mode/EDID/scanout/canvas state and one
  stable pixel digest. At least one mode remains above 2 seconds, and neither evidence nor
  task status will claim E5-T22c verified.
- **P11 — pristine exact-head cold clone.** The final transcript will show a pristine
  clone detached at the claimed exact implementation head, a scrubbed environment with
  only explicit trusted paths restored, successful acceptance, and tracked cleanliness
  both before and after. The recipe may create ignored outputs but no tracked mutation.
- **P12 — diff coverage and test independence.** Every behavioral implementation hunk
  will be exercised by immutable Worker/browser evidence or deterministic tests; purely
  declarative/logging/generated hunks may be explicitly waived. No acceptance oracle will
  derive expected timer/state values from the same implementation path under test, no
  relevant test will be ignored, and sabotage will mutate production behavior rather than
  merely the assertion.
- **P13 — bounded novel zero-time attack.** A timer source returning nanosecond zero must
  still increment independent read accounting when profiling is enabled, while disabled
  execution must increment neither field. If an injectable zero-time source is unavailable,
  an equivalent deterministic unit-level/accounting proof must establish this distinction.

## Verdict rule

Any contradicted product prediction is `refuted`. Missing proof without contradiction is
`needs-evidence`. Only if all behavioral predictions hold, every changed hunk is executed
or justified, and evidence identity/cleanliness is sound can the verdict be `verified`.
