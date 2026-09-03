---
id: E4-T28f
epic: 4
title: Level-4 same-head cold-start capstone sign-off
priority: 429.6
status: in-progress
depends_on: [E4-T28a, E4-T28b, E4-T28c, E4-T28d, E4-T28e, E4-T25, E4-T26, E4-T27]
estimate: S
risk: high
capstone: true
---

## Goal

Assemble the verified slice results into the one-build Level-4 capstone: a fresh clone and fresh
browser profile reproduce interactive Node, CoreMark uplift, cold boot, gcc interactivity, full
compliance, and lockstep evidence under the same exact commit and documented controls.

## Context

The parent headline combines several different clocks, artifacts, and adversarial surfaces. The
final sign-off is intentionally separate so a green Node run cannot be mistaken for a green
compliance or cold-start run. This is the only child allowed to promote the Level-4 capstone.

## Deliverables

- `tools/capstone_e4.sh --final` orchestration and `docs/demos/level-4.md` cold-start procedure.
- A signed-off `evidence/e4-t28/capstone-*.json` and screenshot/demo record with all four benchmark
  numbers, ratios, compliance/lockstep summaries, browser/hardware/header capture, Bun gap/result,
  and one exact commit/build/artifact identity.
- A `capstone: level4` ledger entry with no untracked or warmed inputs.

## Acceptance criteria

- `bash tools/capstone_e4.sh --final` from a pristine clone and fresh browser profile reruns the
  documented gates, invokes the E4-T28b–E4-T28e browser proofs, and emits one result JSON whose
  candidate commit equals the compliance, lockstep, and benchmark commit.
- The final result meets every parent gate: Node echo p95 `< 100 ms`, Node HTTP throughput `≥ 10x`
  its Level-3 baseline, browser CoreMark `≥ 10x`, boot median `< 5.0 s`, gcc guest time `≤ 20 s`
  with echo p95 `< 100 ms`, and green E4-T26 plus E4-T25 lockstep.
- The verifier can recompute every ratio/checksum from committed inputs, sees zero unreported
  console/request failures, and finds no WebKit or independent-machine claim; those legs remain
  outside the directed proof by user direction.

## Adversarial verification

Follow only `docs/demos/level-4.md` from a new clone/profile. Recompute the Level-3 denominator,
clear all site data, run the three-sample median, cross-check guest and host clocks, type throughout
gcc, poison a cache/artifact, and confirm a same-commit mismatch fails the orchestration. Run the
final browser path offline only where the documented workload permits it and disclose any configured
Firefox result. A best-of-three, warmed cache, split build, omitted Bun gap, or uncited claim refutes
the capstone.

## Verification log
