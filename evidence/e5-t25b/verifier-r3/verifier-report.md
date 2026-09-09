VERDICT: needs-evidence

- **P1/P4 stationary and wrong-way semantics — HELD.** Predicted stationary, sub-100px, and
  wrong-direction geometry would reject while exactly 100px in either requested direction would
  pass. The focused repository suite passed 6/6, and 13 verifier probes produced every predicted
  outcome (`focused-checks.log`; `displacement-attacks.mjs`). No stationary semantic defect remains
  in the helper.
- **P2/P3 browser integration and retained geometry — NEEDS EVIDENCE.** Predicted each real drag
  would read pre/post Foot titlebar geometry, call `assertWindowMoved` before summarization and
  aggregation, and retain both geometries plus signed/absolute displacement. Unique-order source
  audit confirms exactly that dataflow (`source-audit.mjs`), but the only current-head headed run
  timed out at `desktopReady` before Foot launch or any drag (`browser-attempt.log`). The integration
  is not contradicted, but it is unexecuted.
- **P5 release/source/dist — HELD with a bounded audit caveat.** Hostile-env syntax checks, 6/6
  tests, release audit, three direct source/dist comparisons, and diff whitespace checks passed.
  The release audit regexes check call/retention token presence; they do not prove full ordering, so
  `source-audit.mjs` separately checks unique call-site order and aggregation placement.
- **P6 retained artifact — HELD, but producer-stale for the fix.** JSON SHA-256
  `8cd005bf639b7638548c18b38a0bb32938b2494b179797aa875ddc5bd70060f7` and PNG SHA-256
  `d81ba53cbe4146e0be05be40bbbd6c53d9f082910bb7595d32958301b718a059` matched. An independent
  audit held across all 473 raw records, five 300-request runs, pointer deltas `303/302/302/302/302`,
  present samples `93/94/92/97/97`, monotone sequence/timestamp/counter and attribution invariants,
  aggregate CV `11.321151210004228%`, null-sink rejection, and 286–405px horizontal damage ranges
  (`retained-artifact-audit.mjs`). Its producer is `a14bf545`; current runtime differences are the
  browser runner, release audit, helper source/dist, and regression test. It proves unchanged raw
  baseline behavior and indirect movement, not execution of the new geometry assertion.
- **P7 readiness delta — STATICALLY HELD, RUNTIME UNCOVERED.** The only post-fix source delta is
  Foot readiness `60_000 -> timeoutMs`; displacement and aggregation are unchanged. The bounded
  attempt failed earlier at line 112 after exactly 240000ms, so changed line 129 did not execute.
- **P8 headed/stress legs — ENVIRONMENT-LIMITED.** Exact command and timeout are recorded in
  `browser-attempt.log`; no output artifact exists and no post-fix browser coverage is claimed.
  DPR 2, busy guest, and 4x throttle were not attempted after baseline readiness failed.
- **P9 sufficiency — NEEDS EVIDENCE.** Deterministic helper proof plus static producer coverage is
  insufficient under `AGENTS.md`'s changed-hunk rule because the task-critical browser integration
  remains unexecuted, and the pure analyzer still accepts plausible stationary FPS if that guard is
  bypassed. Demand one successful exact-head headed baseline retaining checked pre/post geometry and
  >=100px correctly directed displacement for all five real drags. This is a proof gap, not a
  semantic refutation.
- **COVERAGE/SUITE.** Detailed classifications are in `coverage.md`. Retain the worker's promoted
  stationary/wrong-way test and verifier scripts as deterministic sabotage/static/raw-artifact
  checks. No implementation or repository test files were modified.

Commands: hostile-env Node syntax/tests/release audit; r2 analyzer matrix; verifier displacement,
source, and retained-artifact audits; direct source/dist `cmp`; `git diff --check`; bounded exact-head
headed Chrome baseline with `E5_T25B_TIMEOUT_MS=240000`.
