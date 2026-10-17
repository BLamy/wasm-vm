---
id: E9-T01
epic: 9
title: Freeze the full-system session replay contract
priority: 524.901
status: verified
depends_on: [E0-T16, E3-T12d]
estimate: S
risk: low
capstone: false
---

## Goal

Define local session time travel for the existing full-system RV64 Linux VM, starting with one hart. Inventory every host-to-guest source and assign each to a recording task or an explicit unsupported-mode gate.

## Boundary

Documentation and pinned workload/measurement definitions only. Distinguish a saved checkpoint, visual preview, exact replay position and a new live branch. Reuse existing snapshot and GPU work rather than assuming instruction traces are a complete session recording.

## Acceptance criteria

- [x] A source-to-owner matrix covers UART, keyboard/tablet/mouse, resize, clock/lifecycle rebases, timers, entropy, block/network completions, DMA, file transfers, audio input and GPU readbacks/completions.
- [x] Freeze the event boundary, schema/version policy, one-hart scope and explicit refusal for unrecorded devices or execution modes; compare every matrix row with actual current adapters.
- [x] Pin software and accelerated desktop fixtures, reference environment, expected state witnesses and numeric recording/storage/seek budgets before implementation or performance tuning. Separate preview latency from actual restored-state readiness.

## Deterministic acceptance

`make verify-E9-T01` checks the frozen contract, source anchors/digests, owner tasks,
asset/workload pins and numeric budgets. The [contract](../../docs/design/session-replay.md)
and [machine-readable definitions](../../docs/design/session-replay-contract.json) are the
handoff to T02 and the capture slices. This direct check makes no guest runtime,
performance or acceleration qualification claim.

## Adversarial verification

Find one real guest-visible input absent from the matrix, or a claimed supported mode without an assigned capture path. An inventory of browser DOM events alone is insufficient.

## Verification log

### 2026-10-17 — worker — started

The user explicitly selected Epic 9 after the backlog review. Its priority band is now
524.901–524.924, ahead of the optional userspace runtime; other task statuses are unchanged.
E0-T16 and E3-T12d are verified. This low-risk S slice changes documentation and the
deterministic contract checker only; it makes no runtime replay claim.

The original checkout has unrelated uncommitted work. This isolated checkout starts at
`ec178d579aed126c30eae1ee608e62557b276c08` and imports only the existing Epic 9 plan.


### 2026-10-17 — worker — contract submission

Implementation/evidence head: `2a7ab8a8fcf738498330d6e12fba3beb379c8e9a`; current trunk boundary:
`05fa92c82288a4de217eac7345ba2766737a8c16`. The initial isolated source was older
than current trunk; it was rebased before submission and the source inventory was
re-audited. Only the final receipt below is submitted. The original dirty checkout
was not changed.

Commands at the frozen implementation:

- `make --no-print-directory verify-E9-T01 > evidence/e9-t01/worker/acceptance.json`
- `python3 -B -m py_compile tools/verify/e9-session-contract.py`
- `python3 tools/check_task_policy.py > evidence/e9-t01/worker/task-policy.log`
- `git diff --check`

Evidence: `evidence/e9-t01/worker/acceptance.json` (SHA-256
`280dc04f70fe5c85d4c912f31eae329f526d747ecca9b132d2519f73a3238f39`),
`assets.json`, `commands.txt`, `task-policy.log` and `SHA256SUMS` in the same directory.
The asset receipt independently streams the SHA-256/length of all six advertised
payloads found in local checkouts; it records each exact asset path and identity.

Claim: the direct result checks 23 named guest-affecting sources against 32 current
source files, assigns each to capture or an explicit gate, freezes lossless event
coordinates/version/bounds and pins software plus production accelerated assets,
stimulus/state witnesses, reference environment and numeric future budgets. Existing
GPU worker/renderer/clock checkpoint successors replace the cancelled E6-T11 dependency.
The GPU reconstruction journal is explicitly not a whole-session replay engine.
The probe C file is a pinned future guest workload definition, not compiled/executed
runtime evidence. GPU/clock/microphone session recording remains unqualified.

Risk: low, documentation/fixture definitions and direct checker only. No emulator,
wasm surface, browser flow or production output changes; Rust/workspace/browser/deploy
gates and guest instruction recording do not apply to this definition-only claim.
The final task/queue/evidence commit changes metadata only; the acceptance receipt
binds all contract/checker/Makefile content and audited source digests. Fresh review
must judge the direct result and attempt the task's missing-input inventory check.

### 2026-10-17 — verifier — predictions before evidence

Read the complete task, AGENTS.md and the scoped diff against
`05fa92c82288a4de217eac7345ba2766737a8c16` before opening the worker receipts.
This is a fresh low-risk direct-result review; no runtime replay claim is under test.

- P1: The recorded acceptance result will identify implementation head
  `2a7ab8a8fcf738498330d6e12fba3beb379c8e9a`, 23 source rows, 32 audited files and
  two pending fixture qualifications. Its content/source digests will match this
  checkout; rerunning `make verify-E9-T01` will differ only in the metadata commit.
- P2: Every guest-affecting external input found by inspecting the current Wasm,
  clock, storage/network/audio and production GPU adapters will have an explicit
  source row and capture owner or refusal gate, including observations that never
  originate in a DOM input handler.
- P3: The contract will distinguish checkpoints, previews, exact replay and live
  branches, bind non-retiring transitions and observation order losslessly, and
  refuse unrecorded modes/devices before guest mutation. No planned profile will
  be presented as already admitted runtime replay.
- P4: Both fixture manifests and advertised payload identities will agree with
  independently hashed local assets; stimulus, expected witnesses, reference host,
  fixed work and numeric budgets will be concrete enough to constrain successor
  measurements, with preview and actual restored-state latency separately bounded.

### 2026-10-17 — verifier — VERDICT: verified

VERDICT: verified

- P1 — HELD. All four files in `evidence/e9-t01/worker/SHA256SUMS:1-4`
  match independently recomputed hashes, including acceptance SHA-256
  `280dc04f70fe5c85d4c912f31eae329f526d747ecca9b132d2519f73a3238f39`.
  The recorded result identifies the frozen implementation, 23 rows, 32 source
  files and two pending profiles (`acceptance.json:448-497`). The direct rerun at
  metadata head `86ee25b213c246f19ecb4977ebd6feaad65488c6` passes and is identical
  after removing only `source_commit`; all five proof-file hashes and all source
  hashes still match. The submission diff after `2a7ab8a8` contains only the task,
  queue and receipts. No stale source evidence found.
- P2 — HELD. Compared all 23 matrix rows (`docs/design/session-replay.md:103-125`)
  with the actual exported input/control methods, assembly and provider seams,
  rather than accepting symbol existence as completeness proof. UART refills
  (`crates/wasm/src/lib.rs:3711`), evdev frame/drop behavior (`:3919`, `:3998`,
  `:4011`, `:4036`), display changes (`:3220`), agent admission (`:3253`, `:3338`),
  file-transfer readiness/cancel/persist controls
  (`crates/wasm/src/browser_file_transfer.rs:263-391`), and storage acknowledgements
  (`crates/wasm/src/lib.rs:4259-4283`, `:4604`) have named capture owners.
  The attempted missing-input search specifically checked non-DOM observations:
  RTC polling and time-setting samples (`crates/core/src/dev/rtc.rs:155-216`),
  paced idle and external pending state (`crates/core/src/lib.rs:4453-4495`),
  SLIRP host time (`crates/wasm/src/lib.rs:3040`), relay close/error/send outcomes
  (`crates/wasm/src/ws_transport.rs:38-125`), entropy DMA
  (`crates/core/src/dev/virtio/rng.rs:170-184`), audio ring/clock/sink observations
  (`crates/wasm/src/lib.rs:1977`, `:2082`, `:2166`;
  `crates/core/src/dev/virtio/snd/mod.rs:1482`, `:1927-1946`), physical GPU queries,
  synchronous errors and scatter/mailbox completions
  (`web/renderer/virgl-command/queries.mjs:62-70`,
  `crates/wasm/src/virgl_host.rs:262`,
  `crates/wasm/src/virgl_linux.rs:205-350`), plus generated key releases/drains
  (`web/loader.js:1210-1230`). Each maps to the clock, timers, network, entropy,
  audio, GPU or checkpoint row. No guest-visible source absent from the matrix,
  or admitted mode lacking a capture/gate, was found.
- P3 — HELD. The four operations are distinct at
  `docs/design/session-replay.md:45-55`; non-retiring transitions, observation
  ordinals, paused controls, exact stops and callback staging are defined at
  `:63-94`. Version/refusal policy, decimal wide counters, bounded payloads and
  coherent pending-state publication are explicit at `:135-159`. Admission at
  `:19-36` refuses incomplete/unrecorded modes before mutation; the initial profile
  and accelerated candidate are explicitly planned/pending, including paced-clock,
  microphone and 3D gates. These are definition claims, not claims that current
  live callbacks already obey the future recording boundary.
- P4 — HELD. Both pinned manifests exactly match the current production JSON;
  independently streamed SHA-256 and length checks also match all six asset
  records (`evidence/e9-t01/worker/assets.json:5-57`). The production pair is
  204,057,731 bytes with SHA-256
  `3583ea9927d142e33c9b1de5963d89bd1f0b1022df7047c8a8b02d7f734a01bd`.
  The chunked-image descriptor and renderer build-source pin match their current
  definitions; predecessor status checks pass. Direct `sw_vers`, `sysctl`,
  Chrome plist, `rustc --version` and `node --version` readings match the frozen
  reference. Literal before/after bytes, shell stimulus, response bytes, input
  transition schedule, LCG seek selection, five alternating equal-work pairs and
  witnesses are concrete (`docs/design/session-replay-contract.json:723-808`;
  `docs/design/session-replay.md:167-228`). Seven numeric metrics per profile
  separately bound preview and actual state readiness. The pinned C probe declares
  exact red RGBA/error observations and explicitly leaves guest compilation and
  acceleration qualification to T17/T18; its source identity is not runtime proof.
- COVERAGE — The Make target and checker happy path execute in the direct rerun.
  Contract, workload, fixture and task-plan hunks were inspected as declarative
  output; the queue is regenerated under task policy. Runtime execution of the
  future probe and decoder/capture/error paths is waived for this definition-only
  low-risk slice, which changes none of those runtime paths. Checker rejection
  branches are defensive tooling and do not require a sabotage run at this tier.
  No requested acceptance behavior remains unexercised or unreviewed.
- SUITE — Retain `make verify-E9-T01` as the permanent source/fixture drift check.
  No duplicate test or runtime fixture is promoted for documentation-only claims.

Commands: read-only scoped diff and adapter inspection; independent receipt and
asset streaming hash comparison; `make --no-print-directory verify-E9-T01` with
structural comparison against the worker receipt; reference-host/version reads;
`python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`;
`git diff --check`. No cold clone, sabotage, runtime/browser regression or deployment
is required by this low-risk boundary.
