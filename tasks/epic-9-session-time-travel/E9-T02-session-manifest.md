---
id: E9-T02
epic: 9
title: Define bounded session manifests and compatibility checks
priority: 524.902
status: verified
depends_on: [E9-T01]
estimate: S
risk: high
capstone: false
---

## Goal

Identify exactly which machine, assets and replay policy a saved session needs.

## Boundary

The versioned session/event/checkpoint index codec and compatibility admission; no execution or UI. Preserve historical data when a build cannot replay it.

## Acceptance criteria

- [x] Bind immutable VM/Wasm build, base-image/kernel identities, RAM/hart/device topology, event policy, checkpoint format and GPU profile when applicable.
- [x] Represent instruction positions and sequence numbers without JavaScript precision loss; preserve exact values across the 2^53 boundary.
- [x] Reject unknown required versions, inconsistent lengths/digests and foreign build/image/profile combinations with typed errors; keep the original session intact. Define retained runtime assets or an honest unavailable state after updates.

## Deterministic acceptance

`make verify-E9-T02`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Mutate each identity independently, use oversized/duplicate sections and counters above 2^53. A misleading compatible verdict or destructive automatic migration refutes the claim.

## Verification log

### 2026-10-17 — worker — started

E9-T01 is verified. This high-risk S slice implements bounded, lossless metadata/event/index
codecs and read-only compatibility admission in the shared no_std storage library.
Execution, storage publication and UI remain separate successor boundaries. The user
authorized continuing through the entire epic; branches remain stacked and unmerged.


### 2026-10-17 — worker — submitted for independent verification

Frozen code head: `eb5a2484f1f7ff4d68ab2ccc7881b12fe65eae06` (task diff begins after
`653b95b570d1c61facbcabcd3be2cfb07ae44f82`). Claim: the shared no_std session codec binds
VM/Wasm/base/kernel/initramfs/RAM/hart/device/GPU identities and the complete replay
policy before admission; it preserves exact decimal-string transition/sequence/retirement
values above 2^53. Bounded manifest/event/chunk decoding refuses malformed, duplicate,
unknown-required, inconsistent-length/digest and foreign metadata with typed results.
Admission and retained-runtime availability are read-only; unavailable historical builds or
asset bytes do not trigger a migration or deletion. Exact metadata must declare device and
clock capture sources and admission separately checks installed capture adapters. This is
metadata compatibility, not a runtime replay qualification.

Recorded acceptance: `make verify-E9-T02` on this clean head, and the identical command
from a pristine full clone with `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all `CARGO_*`
overrides removed. Clone command, exact clone path/head and scrub list are recorded in
`evidence/e9-t02/worker/cold/clone.json`; it used `git clone --no-local --no-hardlinks
--single-branch --depth 1 --branch codex/e9-session-manifest` against this local repository,
with no object alternates. Both runs passed all eight recorded commands: task policy,
workspace format, isolated Wasm format, affected-library lint, 115 native storage tests,
no_std wasm32 storage build, Wasm lint and nine shared cases executing in Node. Exact
argument vectors, exit codes, durations, source hashes and log digests are in:

- `evidence/e9-t02/worker/warm/report.json`
- `evidence/e9-t02/worker/cold/recording/report.json`
- `evidence/e9-t02/worker/SHA256SUMS`

The independently specified JSON asset oracles are rehashed in each run. The golden
begin/end sequences are `9007199254740993` / `9007199254740994`, with transition
`9007199254741094` at the event. Mutations independently cover each identity, capture
omissions, duplicate/oversized sections, unknown versions, corrupt/truncated chunks,
sequence/position overflow, GPU pair bindings and absent retained assets. The shared
native/Wasm cases and their literal fixtures are permanent artifacts.

Risk-tier scope: the full affected storage wall and wasm32 codec boundary, with adversarial
parser/identity attacks and the final pristine-clone proof. No guest architectural, JIT or
concurrency behavior changes here, so a guest instruction trace would not exercise this
boundary. Deterministic native/Wasm assertions are the recorded evidence. No production
VM/Wasm exports, UI or browser behavior are introduced; the isolated test-only harness
uses the workspace dependency versions and committed production browser bytes remain
unchanged. Browser/deployment gates apply to the successor runtime/UI integrations.

Fresh verifier: `/root/verify_e9_t02` is independently auditing the diff, recording prior
predictions, attacking admission and checking execution coverage. This worker entry does
not set `verified`.

### 2026-10-17 — verifier — VERDICT: verified

VERDICT: verified

Fresh session `/root/verify_e9_t02` read the whole task and frozen diff before evidence,
then committed the prior predictions and results in `evidence/e9-t02/verifier/`.
Code head remains `eb5a2484f1f7ff4d68ab2ccc7881b12fe65eae06`; worker submission was
`e5ea3379e423b8e8757410b017a56ef4fa4a0acd`. No implementation edits were made.

- **P1/P5/P6 HELD — identities, capture and preservation.** Each immutable machine and
  policy identity is refused independently; retained exact runtime/assets produce the
  proper Available/Unavailable state. Every device field, GPU renderer/profile and an
  asset whose digest matches but byte length differs received independent mutations.
  Canonical original bytes remain unchanged. See shared native/Wasm corpus and
  `verifier/promoted-tests.log:17-35`, `verifier/promotion-report.json`.
- **P2/P3/P4 HELD — exact counters and bounded integrity.** Both sides of 2^53 and u64
  limits stay exact; unknown versions/fields, duplicated/oversized sections, corrupt or
  truncated payloads, sequence/phase/witness regression, count/endpoints and arithmetic
  overflow are refused with typed errors. JS JSON/BigInt independently preserves the
  fixture byte digest `71e97341111e6704982bd3bb5d39a4de95a1c1dc2cd5fe95ada1f75d75ee2def`
  (`verifier/js-oracle.json`). Eight promoted critic tests pass with zero ignored cases
  at `verifier/promoted-tests.log:42`; the nine shared native/Wasm cases are unchanged.
- **P7 HELD — evidence/environment.** All 23 committed worker artifact hashes and all
  16 warm/cold source hashes match. The single pristine clone was independently inspected:
  clean exact code head, no object alternates, matching source/evidence bytes. Its scrubbed
  acceptance passed eight gates, 106+9 native tests and nine Wasm/Node tests
  (`worker/cold/recording/storage-native.log:152,167`, `wasm-node.log:50`). See
  `verifier/warm-audit.json` and `verifier/cold-audit.json`. No production browser/Wasm
  artifacts or test-only runtime behavior changed.
- **P8 HELD — bounded novel attack.** Duplicate same/contradictory payload discriminants,
  duplicate payload bytes and a foreign required payload field all return Malformed,
  preserving input bytes (`verifier/promoted-tests.log:14-20`). Authenticated same-transition
  phase regression and excessive/duplicate sequence/count attacks also fail closed.
- **P9 HELD — sabotage.** In a scratch copy only, forcing GPU identity equality true makes
  the existing `gpu_checkpoint_binding` test fail at `cases.rs:704:5`, observed Ok versus
  expected IdentityMismatch("GPU"), exit 101 (`verifier/sabotage.log:53-56`, SHA-256
  `d4dbac430b55c33abdf398657568bc1f5c45dfa12d8bc7a3f572ff596b67df57`).
- **P10 HELD — coverage.** LLVM measures 546/550 lines and 784/811 regions for the unchanged
  codec. Every remaining unique source region is explicitly waived at four locations:
  impossible secondary hex failure (:129), concrete infallible serializer error conversion
  (:412), and bounded sums that cannot overflow u64 (:643/:681). Every changed hunk is
  executed or justified in `verifier/coverage-ledger.md`; exact binary/profile/export
  digests and commands are in `verifier/coverage-receipt.json`, with per-line counts in
  `verifier/final-coverage.txt`. Large artifacts remain locally under
  `target/evidence/e9-t02-verifier`.

SUITE: promote `crates/storage/tests/session_manifest_critic.rs` (eight deterministic
regressions). Preserve the shared literal golden fixtures, nine native/Wasm cases and
`make verify-E9-T02`. Promoted test format, affected-test Clippy and native execution all
pass (`verifier/promotion-report.json`). As only tests/evidence/metadata changed after the
frozen runtime, incremental harness checks suffice; the final cold proof was not repeated.
The complete prediction-by-prediction result is `verifier/verdict.md`.
