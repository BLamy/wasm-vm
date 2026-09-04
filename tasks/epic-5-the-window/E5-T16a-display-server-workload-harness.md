---
id: E5-T16a
epic: 5
title: Display-server finalist workload and guest metric harness
priority: 516.1
status: implemented
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

- Commit: `e6bc4d4aa53b053e4b99541c7d9272592fdf4f1c`.
- Exact submission gate: `make verify-E5-T16a` — JavaScript syntax, five contract tests, the
  driver/image-digest round trip, typed failure mutants, and the deterministic evidence recorder
  all passed.
- Evidence: [`evidence/e5-t16a/workload-harness-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t16a/workload-harness-2026-09-04.json),
  SHA-256 `e35a0ba843213c73dcee79603f8b7c7293fcf1285bc411003ffd629598a34aeb`.
- The frozen plan has six ordered markers, exactly 100 typing characters, a 300 px/30-step drag,
  and a 900 ms accepted idle floor. The normalized capture recomputes guest-instruction deltas,
  upload bytes, peak RSS, idle wakeups/s, and typing upload bytes from cumulative phase points;
  the harness owns the supplied image digest and requires guest-scoped metric sources.
- Claim: E5-T16b/c can now supply real labwc and weston emulator captures through one strict,
  comparable protocol. The fixture values are contract data only and are not finalist measurements;
  candidate selection and package availability remain E5-T16b–e. Independent machines, WebKit,
  and host rr are outside the requested/repository scope.
