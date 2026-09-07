---
id: E5-T26e
epic: 5
title: Desktop restore reconciliation for agent, scanout, and viewport
priority: 526.5
status: in-progress
depends_on: [E5-T26d, E5-T23e, E5-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Compose the device sections into one restore transaction and reconcile host-facing state: agent
HELLO, canvas dimensions, scanout/cursor presentation, viewport changes, and input/audio repairs.

## Boundary

Own restore ordering and the host/guest reconciliation callbacks. Do not add new device payload
formats; consume the contracts from E5-T26a through E5-T26d and the existing agent/viewport work.

## Acceptance criteria

- A valid composite snapshot restores all component sections in dependency order, re-handshakes
  the agent, resizes or letterboxes the canvas through T22, and presents a full repair frame.
- A changed host window size produces a deterministic resize event/letterbox result without
  changing the snapshotted guest scanout dimensions.
- Any component refusal aborts atomically, clears transient reconciliation work, and leaves a
  clean cold-boot fallback rather than a half-restored desktop.

## Verification command

make verify-E5-T26e

## Adversarial verification

Drop the agent channel during restore, change viewport dimensions between save and load, and
force one component version refusal. Verify bounded retry/abort behavior and no stale host state.

## Verification log

### 2026-09-07 — worker — STARTED
- Activated on `codex/e5-t26e-restore-reconciliation` above verified T26d (`3a581ca2`).
- Risk: high. The implementation must compose existing snapshot sections in dependency order,
  reconcile host-facing agent/viewport/presentation state atomically, and leave a clean fallback
  after any component refusal or dropped agent channel.

### 2026-09-07 — worker — IMPLEMENTED
- Implementation commit: `74eb1eec3f19aeb510259f71b2f25eaac4e1dff9`.
- Added the no-std `DesktopRestoreCoordinator` and `DesktopRestoreBackend` callback contract. The
  coordinator parses the complete envelope before callbacks, requires GPU → input → sound → agent
  sections, stages the existing component codecs before a single commit point, computes native vs
  T22 letterbox disposition from the snapshotted guest scanout and current host viewport, requires
  an agent HELLO/reconnect stage and a full repair frame, and calls transient cleanup followed by
  cold-boot fallback on every refusal.
- Exact-head evidence: `evidence/e5-t26e/native-final.json`, SHA-256
  `bb329cca45cf2e20ae97a81277db033388432a1a352437e82bfaf8d50dcd7ad0`.
- Scrubbed command: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_TARGET_DIR
  -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26e` (exit 0). It passed 7 coordinator tests,
  9 envelope/quiesce tests, 6 GPU snapshot tests, 12 input snapshot tests, 6 sound snapshot tests,
  format, both clippy modes, and the no-default-features `wasm32-unknown-unknown` build.
- The deterministic coordinator suite covers a valid composite restore and full repair, changed
  host-window letterboxing without guest scanout mutation, agent-channel loss, component/version
  refusal, viewport refusal, malformed/missing sections, invalid host dimensions, and a missing
  repair frame. No browser reload/CRC claim is made here; E5-T26f owns that browser round-trip.

Claim: E5-T26e now provides the atomic cross-device restore boundary. Existing T26b–d adapters can
stage their validated state, T23d can re-handshake the agent, and T22b can apply the deterministic
native-pixel viewport plan before one host-visible commit. Any failed component, dropped channel,
changed/invalid viewport, or absent full repair clears transient work and selects a clean cold boot
without publishing a half-restored desktop.

### 2026-09-07 — verifier — VERDICT: refuted
- P1 ordering/reconciliation — HELD. Predicted GPU → input → sound → agent → viewport → commit;
  native and changed-host letterbox runs preserved the GPU-provided `1280x720` guest scanout.
  Observed in `evidence/e5-t26e/verifier/src/lib.rs:193-219`; all ordinary refusal, malformed,
  forward-version, invalid-dimension, agent-drop, and bounded-retry predictions also held at lines
  158-335. The six-test attack transcript is `evidence/e5-t26e/verifier/attack-harness.log:5-13`.
- P2 full repair before publication — FAILED. Predicted no live commit before repair success;
  observed `commit()` is called before `full_repair_frame` is checked
  (`crates/core/src/desktop_restore.rs:359-375`). The submitted backend sets `committed = true`
  before returning `full_repair_frame = false`, and its cold fallback never clears it
  (`crates/core/src/desktop_restore_tests.rs:123-142,271-294`). The independent reproducer returns
  `commit_refused` after `cold` while live state remains committed
  (`evidence/e5-t26e/verifier/src/lib.rs:358-374`; transcript line 7). Demand: make full-repair
  readiness part of staging or make publication infallible only after every prerequisite, with a
  verified rollback/cold-state postcondition.
- P3 success attestation — FAILED. Predicted success could not be reported without publication;
  observed a backend returning `Ok(full_repair_frame: true)` without publishing state yields an
  `Ok` report and no fallback (`evidence/e5-t26e/verifier/src/lib.rs:339-356`; transcript line 6).
  Demand: replace the forgeable post-commit Boolean/unchecked cleanup callbacks with a transaction
  contract whose success and fallback states are structurally verifiable.
- COVERAGE production composition — INSUFFICIENT. Exact-head `git grep` finds no production
  `DesktopRestoreBackend` implementation or coordinator call site; the gate runs coordinator mocks
  and component codecs separately (`evidence/e5-t26e/verifier/scrubbed-gate.log:8-87`). Demand: add
  a concrete native adapter/integration run that sends real GPU/input/sound/agent payloads through
  one detached transaction and proves refusal rollback. Browser CRC/reload remains E5-T26f scope.
- Evidence: worker JSON digest HELD at
  `bb329cca45cf2e20ae97a81277db033388432a1a352437e82bfaf8d50dcd7ad0`; the exact scrubbed gate
  passed both in-place (`scrubbed-gate.log:1-92`) and from a pristine archive of `7fd0fa6d`
  (`cold-exact-head-gate.log:164-257`). Full audit and hunk classifications:
  `evidence/e5-t26e/verifier/audit.md`.
- SUITE: no promotion while the semantic contract is refuted; the evidence-only six-test harness
  is retained as the reproducer.
