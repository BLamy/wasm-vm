---
id: E9-T02
epic: 9
title: Define bounded session manifests and compatibility checks
priority: 524.902
status: implemented
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
