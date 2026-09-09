---
id: E4-T28a
epic: 4
title: Capstone harness, baseline provenance, and deploy-artifact contract
priority: 429.1
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- **Candidate identity and cleanliness — HELD.** Prediction: a clean checkout would report one
  full candidate commit and reject an uncommitted candidate before emitting a measurement envelope.
  The exact implementation head is `2bfe75d804986a3096394c92cc0a8a58686c0986`. A fresh local clone
  passed `bash tools/capstone_e4.sh --self-test` with `candidate.working_tree="clean"`, and the
  strict `bash tools/capstone_e4.sh --prepare` path also passed. The self-test's temporary Git
  fixture rejected an uncommitted candidate; no absolute checkout path or environment value entered
  the envelope.
- **Baseline provenance — HELD.** Prediction: changing a denominator score, baseline commit,
  build flag, removing a row, or breaking the ledger chain would fail before a result can be
  emitted. `bench/capstone-baselines.json` pins the exact dhrystone/coremark/boot/gcc rows at ledger
  entries 0/1/2/3, their complete configs, row digests, and source commits (including the ledger's
  explicit `unknown` gcc commit rather than inventing one). The temporary self-test exercised and
  rejected all four baseline mutations plus a missing-row mutation.
- **Deploy/artifact integrity — HELD.** Prediction: a changed manifest digest or changed local
  artifact byte would be rejected before the envelope is accepted. The temporary deploy-manifest
  fixture rejected both a declared bad SHA-256 and changed artifact bytes. The live clean-clone
  evidence binds the served manifest to SHA-256
  `46b0201e3565d5c391f53eb4b8bc467f167ddeae735dcb5b4005f346b3c3a223` and the deploy manifest to
  the same digest; all local relative artifacts were checked against their declared size and SHA.
- **Controls and schema — HELD.** Prediction: the result would carry the shipping Chromium JIT
  controls, the explicit `?jit=0` interpreter arm, fresh-profile/no-warmup requirements, required
  COOP/COEP values, release build flags, and content hashes without a performance claim. The
  emitted `e4-level4-capstone-result-v1` fixture contains all of these fields, with contract SHA
  `4fc45cbb02b235dbf5c62243c2abcdb24a87e906abc8b423fd729c55abf7a60a`, ledger SHA
  `e99f8d9915449eb8a4c41eca27d4075c2b60ef6dbb818b6b94e727180ffa523d`, and header SHA
  `cacb06e044da4b8b80636c2d6355f2c7bbc45b2a5a04901c99ba76cc5e31ff6`. A warmed-profile mutation
  was rejected by the schema validator.
- **Coverage — HELD.** The exact shell entry point executed the Python validator, live ledger,
  baseline contract, served/deploy manifests, local artifact bytes, header file, and all temporary
  adversarial fixtures. The documentation is a declarative deliverable and is covered by review;
  no browser/runtime source changed in this slice, so no browser build or independent-machine /
  WebKit claim is required.
- **SUITE:** promoted `bash tools/capstone_e4.sh --self-test` as the repeatable verifier and
  `evidence/e4-t28a/capstone-harness-self-test.json` as the deterministic fixture. The fixture is
  8,237 bytes with SHA-256
  `f5fc0e8484bcf4839386dec47204444dd14cdebf28c963350fbdf8a27b014ec1`; it records candidate
  `2bfe75d804986a3096394c92cc0a8a58686c0986` and nine accepted/rejected checks. No performance or
  Level-4 capstone threshold is claimed by E4-T28a.

Commands: `python3 -m py_compile tools/capstone_e4.py`; `bash -n tools/capstone_e4.sh`;
`git diff --check`; `bash tools/capstone_e4.sh --self-test`; a fresh local clone's exact
`bash tools/capstone_e4.sh --self-test`; and that clone's strict
`bash tools/capstone_e4.sh --prepare`. User-directed scope excludes WebKit and independent-machine
legs.
