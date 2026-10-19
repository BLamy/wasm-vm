---
id: E9-T14
epic: 9
title: Replay recorded sessions and detect the first divergence
priority: 524.914
status: in-progress
depends_on: [E9-T05, E9-T10, E9-T11, E9-T12, E9-T13]
estimate: S
risk: high
capstone: false
---

## Goal

Re-execute a recorded software VM from its starting checkpoint using only recorded external inputs.

## Boundary

The replay driver, intent matching, exact event consumption and state-digest comparison. Runtime JIT artifacts may be rebuilt; observable guest behavior must remain identical.

## Acceptance criteria

- [ ] Original and replayed CPU/RAM/device/disk digests match at selected event positions in native and built-browser runs, with interpreter and JIT.
- [ ] Replay completion and trace exhaustion stop at the declared end; switching to live execution requires an explicit separate branch action.
- [ ] Report the first missing/extra/misordered event or digest mismatch with its exact position; retain the recording and do not conceal drift by loading a later checkpoint.

## Deterministic acceptance

`make verify-E9-T14`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Corrupt one event or omit one DMA payload, then vary execution quanta and host schedules. Require a precise divergence instead of an apparently successful replay.

## Verification log

### 2026-10-18 — worker — implemented, awaiting independent verifier

Frozen runtime source is `eea72017457812cda98db0f04ccf5ff1b0e4d9a7`.
The implementation starts a pinned 256 MiB, single-hart Alpine Linux machine from
its initial checkpoint, records host input and device/network observations in a
durable exact event tape, and re-executes it without live providers. At four
selected witnesses, replay compares the complete CPU, RAM, device and disk
digest. The built-browser recording contains 47 events and stops at guest
transition `272100000`; interpreter quantum 7 and JIT quantum 4096 reach the
same digest within each run. The JIT path retired over 12 million guest
instructions. Changed input diverges at transition 0, ordinal 2, sequence 2;
omitted DMA diverges at transition `272000000`, sequence 46. End-of-trace and
live-input refusals are asserted rather than silently branching to execution.
The native tests additionally exercise offline guest network delivery,
reordered callbacks, varied quanta, trace exhaustion and source windows larger
than 256 events.

Evidence of record:

- `make verify-E9-T14` on the frozen source: `/Volumes/e9-build-scratch/e9-t14-final-head-eea720174/report.json` (`status: passed`). Its built-browser report, screenshot and trace are under `browser/`; the suite is `127 passed, 0 failed` with zero console errors. The report authenticates the carried full native workspace and wasm workspace logs from source-identical `6119833b311457eb26c59fa2fa2401aaac1b07f6`, plus rerun native replay attacks, RISC-V, cross-target, Clippy, browser, syntax, documentation and contract gates.
- Fresh sparse checkout matching this repository's sparse boundary, with `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all `CARGO_*` overrides scrubbed: `E9_REPLAY_EVIDENCE_DIR=/Volumes/e9-build-scratch/e9-t14-cold-proof-eea make verify-E9-T14`. Its receipt is `/Volumes/e9-build-scratch/e9-t14-cold-proof-eea/report.json`, SHA-256 `d4c06f71af04c15e60d7354b98d8b55514c8624de935bd7a14676bb33a3f7b9e`, `status: passed` at the frozen head. It ran full native and wasm workspace suites, all seven replay attacks, cross-target and contract gates, then a fresh browser capture at `/Volumes/e9-build-scratch/e9-t14-cold-proof-eea/browser/report.json` (SHA-256 `4d9bfb6b5437d43d572d6f21ac0aedf0d283fa0230df0e4f1bba24f403e31863`): `127/0`, zero console errors, 47 events, interpreter/JIT digest `381c6c14f713d561fc41ef64e8fdbe2f263db27f7e46f749affb7a98aa9cc669`. The browser trace ZIP SHA-256 is `b8687728648da640db654c7c051e99e147be34eb40a6139b7283873a06798890`.
- `make ci` stops at five pre-existing `zicsr-stub` dead-code Clippy diagnostics, reproduced on untouched parent `c52ab64ba390f13b82190aea4977df08c8f91616` in `/Volumes/e9-build-scratch/e9-t14-baseline-zicsr.log`. The acceptance runner checks the exact known diagnostics, then runs every remaining prescribed gate separately; the cold receipt records the sole exit-2 gate and the exit-0 replacements. This is a baseline exception, not a claim that `make ci` itself passed.
- `bash tools/deploy-cloudflare.sh` published production deployment `7e0b0ed3` to <https://wasm-vm.pages.dev/>. The deploy log is `/Volumes/e9-build-scratch/e9-t14-deploy.log` (SHA-256 `72afcbdf5e1e4cac738d2d13fd24984b678fd0bd80c65ca1b15f53b814b9a178`). `/Volumes/e9-build-scratch/e9-t14-public-assets.json` (SHA-256 `1138e7477e3d4bcf6a60bd2d45d0d5987668b588ef72a4ce5121ab0f1eb2cb7a`) proves seven public app/JS/wasm assets byte-identical to the tested build. The public Playwright report `/Volumes/e9-build-scratch/e9-t14-public-browser/report.json` (SHA-256 `afcd62d16c28b8e5cc8b061778e5ddd8dbf7a5450fdfe6aca9992dc2f6a230a7`) records `127/0`, 47 events, interpreter/JIT digest `5adfe13d28c43a29fa875abbef628fcd08e1df78a9b692ef418e19e30805ae73`, both sabotage divergences, a durable reopen, and zero console errors except the explicitly permitted `/favicon.ico` 404. The initial strict-console failure is retained as `report-first.json`; its URL was independently isolated before the exception was applied.

The independent verifier must interrogate these receipts against the implementation
diff and the task's adversarial criteria before changing the status to `verified`.

### 2026-10-18 — independent verifier — post-completion boundary

VERDICT: refuted

- P1 post-completion host effect — FAILED. Predicted that, without a separate branch
  action, boundary delivery could not change guest state after `Completed`. A fresh
  standalone Rust check completed four real guest transitions at the declared end,
  then staged `WriteRam` at that same transition. Staging returned `Ok(0)` and RAM
  remained zero; `deliver_session_boundary` returned `Ok(())`, changed RAM to
  `0x12345678`, advanced the event sequence from 0 to 1, and changed the complete
  resume digest. The invariant fails at
  `/Volumes/e9-daybreak-verifier/e9-t14-refutation/harness/src/lib.rs:89`; observed
  returns and state are in `independent-check.log:6-14` (SHA-256
  `d171bf8ad71206c848c14770c64366c2d0e9a0ec7c13afec5a26cffaae89b051`).
  `ReplayDriver` installs the limit at `crates/core/src/session_replay.rs:437` and
  reports `Completed` at `:708`, but the changed limit fences only instruction
  dispatch (`crates/core/src/session_clock.rs:641-646,675-684`); delivery applies
  RAM writes at `:538-574` without an end check. Require a refusal of unbranched
  host effect delivery, or an enforced explicit branch action, and re-record.
- P2 guest-instruction fence — HELD for this fixture. Direct
  `run_session_until(5, 8)` before and after the effect kept transition and retired
  count at 4; a second driver run returned `Exhausted`
  (`independent-check.log:7,9`). This finding is guest-state mutation through
  delivery, not instruction execution past the end.
- SUITE: no promoted test while refuted. This narrow confirmation did not run the
  remaining high-risk charter. The interrupted review's saved harness and output
  were not opened or used.

Commands: `CARGO_TARGET_DIR=/Volumes/e9-daybreak-verifier/e9-t14-refutation/target cargo test --offline --manifest-path /Volumes/e9-daybreak-verifier/e9-t14-refutation/harness/Cargo.toml completed_replay_refuses_unbranched_ram_delivery -- --nocapture` (exit 101 from the assertion). Prediction, exact command, source/evidence digests, and assessment: `/Volumes/e9-daybreak-verifier/e9-t14-refutation/assessment.md` (SHA-256 `1abce89156a77bec4773883fca5d5ccebce642a8c45a430387f395bc2d2ef81f`).
