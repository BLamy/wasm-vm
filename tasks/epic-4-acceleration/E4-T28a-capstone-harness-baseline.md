---
id: E4-T28a
epic: 4
title: Capstone harness, baseline provenance, and deploy-artifact contract
priority: 429.1
status: pending
depends_on: [E4-T24, E4-T26, E4-T27, E4-T29, E4-T30, E4-T31, E4-T32, E4-T33]
estimate: S
risk: high
capstone: false
---

## Goal

Create the reproducible measurement boundary shared by the Level-4 capstone slices: pin the
candidate commit and build flags, identify the ledgered Level-3 denominators, capture browser and
header controls, and emit a schema-validated result envelope with content-hashed deploy artifacts.

## Context

The parent names `tools/capstone_e4.sh` and a signed-off JSON but currently has no executable
harness. Ratios are only meaningful if the denominator commit, guest binary, browser build, cold
profile, and artifact identity are explicit and cannot be silently replaced by a warmed or cached
run. This slice owns that bookkeeping; it does not claim any performance threshold.

## Deliverables

- `tools/capstone_e4.sh` native preparation/self-test entry point.
- `docs/perf/capstone-e4.md` documenting fresh-clone/profile setup, controls, and result schema.
- A result schema/helper that records commit, build flags, baseline references, browser headers,
  guest artifact hashes, and deploy `web/dist` identities without secrets or host-specific paths.

## Acceptance criteria

- `bash tools/capstone_e4.sh --self-test` passes from a clean checkout and rejects a missing or
  mismatched baseline reference, an uncommitted candidate, and a deploy manifest with a bad digest.
- The self-test emits a deterministic schema-valid fixture containing the candidate commit, exact
  baseline commit/ledger row references, JIT/interpreter controls, fresh-profile requirements, and
  the content hashes of the served and deploy manifests.
- Documentation names the exact commands used by E4-T28b–E4-T28f and does not rely on CI, an
  untracked cache, or an undocumented machine.

## Adversarial verification

Use a scratch clone with `RUSTFLAGS`, `CARGO_*`, `RUST_LOG`, and benchmark cache variables scrubbed.
Tamper the denominator score, baseline commit, build flag, and one artifact byte independently;
each must fail before a ratio can be reported. Re-run with a warmed browser profile and confirm the
harness requires the documented fresh-profile path. Check that secrets, absolute user paths, and
uncommitted files never enter the result JSON.

## Verification log
