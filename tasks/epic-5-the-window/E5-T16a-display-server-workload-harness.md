---
id: E5-T16a
epic: 5
title: Display-server finalist workload and guest metric harness
priority: 516.1
status: verified
depends_on: [E5-T07d, E5-T09e, E5-T13c, E5-T14c, E5-T15d]
estimate: S
risk: medium
capstone: false
---

## Goal

Provide one candidate-neutral, deterministic workload and capture envelope that can measure
display-server finalists inside the riscv64 emulator with the same phase boundaries and counters.

## Boundary

This slice owns the workload script, phase markers, result schema, and counter capture. It does
not choose a compositor, build a candidate image, or publish the final decision document.

## Deliverables

- A reproducible cold-start → idle → terminal launch → 100-character typing → 300 px drag →
  close workload, with explicit start/end markers for every phase.
- Capture of E4 guest instructions, T09 host upload bytes, peak guest RSS, idle wakeups/s, wall
  time, and cursorq traffic without substituting host-native measurements for guest results.
- A machine-readable JSON schema/result with the emulator commit, image manifest, renderer,
  browser/host scope, counters, errors, and phase timings.
- A deterministic fixture or harness self-test proving missing markers and counter failures are
  reported rather than silently converted to zeros.

## Acceptance criteria

- One exact command runs the workload against a supplied scratch image and emits all required
  fields for each phase; a missing field fails the command.
- The terminal phase types exactly 100 recorded characters, the drag phase covers exactly 300 px,
  and the close phase proves the application exits; phase order is checked in the result.
- Counter deltas are tied to the guest workload and include units, start/end values, and an
  explicit idle interval; no extrapolated or host-native finalist numbers are accepted.
- Repeating the same seeded harness self-test produces byte-identical JSON after volatile paths
  and timestamps are removed.

## Verification command

`make verify-E5-T16a`

## Adversarial verification

Run with a missing terminal marker, a stalled drag, a counter that wraps, and a candidate that
exits before idle. Each must fail with a named phase/error and never report a passing zero. Check
that the capture proves it ran inside the emulator and that no WebKit or independent-machine
result is included in the evidence scope.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Commits: `e6bc4d4aa53b053e4b99541c7d9272592fdf4f1c`, `07948a052b36e05a9dda62f204d5e9d2bd632442`.
- Exact submission gate: `make verify-E5-T16a` — JavaScript syntax, six contract tests, the
  driver/image-digest round trip, typed failure mutants, and the deterministic evidence recorder
  all passed.
- Evidence: [`evidence/e5-t16a/workload-harness-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t16a/workload-harness-2026-09-04.json),
  SHA-256 `0756765dd526d9a24aa7dea015061fa09af86fae03a9465f4269dae32c55c18b`.
- The frozen plan has six ordered markers, exactly 100 typing characters, a 300 px/30-step drag,
  and a 900 ms accepted idle floor. The normalized capture recomputes guest-instruction deltas,
  upload bytes, peak RSS, idle wakeups/s, and typing upload bytes from cumulative phase points;
  the harness owns the supplied image digest and requires guest-scoped metric sources.
- Claim: E5-T16b/c can now supply real labwc and weston emulator captures through one strict,
  comparable protocol. The fixture values are contract data only and are not finalist measurements;
  candidate selection and package availability remain E5-T16b–e. Independent machines, WebKit,
  and host rr are outside the requested/repository scope.

### 2026-09-04 — verifier — VERDICT: verified

- P1 frozen workload and phase lifecycle — HELD. Predicted exactly six phase records and markers
  in cold-start → idle → open-terminal → type-100 → drag-300 → close order, exactly 100 typing
  characters, 300 px on x in 30 steps, a ≥900 ms idle interval, and observed application exit.
  The clean `ff9f85c` gate passed 5/5 tests; the independent bounded matrix rejected marker reorder,
  99 characters, 299 px, 899 ms idle, and false close exit with `MARKER_SEQUENCE`,
  `WORKLOAD_SHAPE`, `IDLE_INTERVAL`, and `WORKLOAD_SHAPE` respectively (`tools/display-server-workload.mjs:162-260`).
- P2 guest counters and provenance — HELD. Predicted cumulative counters could only normalize when
  every start/end point was non-negative and monotonic, and that all five sources would equal the
  guest contracts. A counter wrap was rejected as `COUNTER_ORDER`; a host source was rejected as
  `SOURCE_CONTRACT`; the six-phase current-head gate also passed the added provenance self-test
  (`tools/display-server-workload.mjs:218-275,387-414`). Summary deltas are recomputed from the
  first/last and phase points, including idle wakeups/s and typing upload bytes (`:277-315`).
- P3 driver boundary and image ownership — HELD. Predicted malformed JSON and valid JSON followed
  by non-whitespace stdout would fail as typed `DRIVER_OUTPUT`, while tampered plan/source would
  fail as `PLAN_MISMATCH`/`SOURCE_CONTRACT`; all four did. A driver-supplied all-`b` image digest
  was replaced by the harness digest (`42042378…` on the `ff9f85c` attack and `8c5d53…` on the
  current-head recheck), exercising `tools/display-server-workload.mjs:417-510`. The later
  `07948a0` hardening was also attacked with a hung driver and returned typed `DRIVER_TIMEOUT`.
- P4 deterministic normalization — HELD. `make verify-E5-T16a` passed the recorder and produced
  `normalizedSha256=29e948f100ac652763c7ed7fbd06f20a50784449ffc08fb711818e58af641b67` and
  `planSha256=b0abe0eb129f072f7e12abacaa07bb3c4b7cc55eab0c663272c76897bb8612d0`; the independent
  attack used `stableStringify`/fixture validation and all normalization assertions held.
- P5 evidence, head applicability, and scope — HELD. Recomputed SHA-256 of the hardened
  `evidence/e5-t16a/workload-harness-2026-09-04.json` is
  `0756765dd526d9a24aa7dea015061fa09af86fae03a9465f4269dae32c55c18b`, matching the worker claim;
  its `gitHead=07948a052b36e05a9dda62f204d5e9d2bd632442` is the exact implementation head covered
  by the six-test gate and is an ancestor of verifier commit `c9893135aaec870c7d91e861e60176c0d79c4230`.
  The verifier's detached checks and bounded attacks exercised the added timeout/source-contract
  code, so no acceptance-bearing runtime hunk invalidates that evidence. Independent machines,
  WebKit, and host rr were not run, per explicit waiver and repository policy.
- COVERAGE: HELD. The implementation hunks in `e6bc4d4` were exercised by the clean gate and the
  bounded attack; the later `07948a0` timeout/source hunks were exercised by its six-test gate and
  timeout/source attacks. Schema/docs/verifier/generated-manifest hunks were inspected or directly
  checked; no acceptance-bearing changed hunk remained unexecuted. Fixture values remain contract
  test data, not finalist measurements.

Commands: `make verify-E5-T16a` at detached `ff9f85c` and detached `07948a0`; bounded inline Node
`runDriver`/`validateCapture` attack matrix for marker order, workload shape, counter wrap, idle
floor, source/plan tampering, malformed/extra stdout, image digest ownership, and current-head
timeout; `shasum -a 256 evidence/e5-t16a/workload-harness-2026-09-04.json`; and
`git diff --name-status e6bc4d4 ff9f85c`. No implementation code, tests, or
unrelated dirty file was modified by verification.
