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

### 2026-09-07 — worker — REMEDIATION SUBMITTED
- Remediated the refutation at implementation commit `58a1f46364a46985bf7750a1b3e2c8b4f4f9b139`.
  Full-repair readiness is now a detached pre-commit operation returning an opaque typed
  preparation token; `commit` no longer returns a forgeable `full_repair_frame` Boolean.
- Added `VirtioDesktopRestoreBackend`, which decodes actual T26b GPU, T26c input, and T26d sound
  payloads in detached device instances, counts the GPU repair sink event before publication,
  commits with rollback snapshots, and resets devices plus agent/viewport host state on fallback.
  `Machine::restore_desktop_snapshot` is the native production composition call site.
- The concrete native proof exercises success, changed-host letterboxing, malformed GPU/input/sound
  payloads, agent and viewport refusal, missing pre-commit repair, and an injected failure after
  GPU publication. Every refusal checks all three device snapshots and host state against the cold
  baseline.
- Exact-head command (exit 0): `env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u
  CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26e`.
  It passes 10 coordinator tests, 9 envelope/quiesce tests, 6 GPU snapshot tests, 12 input
  snapshot tests, 6 sound snapshot tests, both clippy modes, format, and the no-default-features
  `wasm32-unknown-unknown` build.
- Evidence: `evidence/e5-t26e/native-final.json` SHA-256
  `81401c4d4037fa2c463b69a1c7c4e26d7ddc00deba20e7da925101c1ee77c253`; gate transcript summary:
  `evidence/e5-t26e/worker-remediation-gate.log`.

Claim: no live device or host publication is possible until detached T26b–d codecs and the full
repair frame are ready. Successful publication returns an opaque commit proof and the concrete
adapter's native integration test verifies the published GPU/input/sound/agent/viewport state;
all tested refusals restore the cold baseline. Browser pixel/CRC and reload proof remains E5-T26f.

### 2026-09-07 — fresh verifier — VERDICT: refuted
- P1 pre-commit repair/token remediation — HELD. Predicted repair preparation before commit and no
  safe external token construction; observed coordinator ordering at
  `crates/core/src/desktop_restore.rs:411-428`, repair refusal in the 10-test exact-head gate, and
  E0451 for both private token shapes (`evidence/e5-t26e/verifier-r2/opaque-probe.log:3-6`).
- P2 production agent/viewport composition — FAILED. Predicted a production success must require
  and re-handshake the real T23e agent transport and retain the T22 viewport/repair state. The
  Machine method checks only GPU/input/sound and drops its local backend
  (`crates/core/src/lib.rs:1771-1795`); a Machine with no virtio-console returned `Ok` with
  `agent_rehandshake=true`, a live GPU frame, non-empty input, Running sound, and one XRUN
  (`evidence/e5-t26e/verifier-r2/attack-harness.log:7`). Demand: compose the real agent Channel/
  console reconnect and a retained host viewport/repair owner; refuse rather than attest success
  when either production dependency is absent.
- P3 rollback after GPU publication — FAILED. Predicted a failure after GPU publication would leave
  no stale host frame and an actual cold baseline. Device bytes rolled back, but the live sink kept
  one restored 4x2 frame with no clearing/cold publication
  (`evidence/e5-t26e/verifier-r2/attack-harness.log:5`; publication precedes the injected failure at
  `crates/core/src/desktop_restore.rs:757-760`, while rollback restores only device snapshots at
  `:600-603`). A separately dirty 640x480 scanout 99 was captured as “cold” and restored unchanged
  (`attack-harness.log:6`; constructor at `desktop_restore.rs:520-544`). Demand: make presentation
  publication transactional or explicitly publish the cold frame/clear on rollback, and obtain a
  real cold baseline rather than snapshotting arbitrary live state at call time.
- P4 real payload and hostile-input attacks — HELD. The external run used a real GPU resource, a
  non-empty T26c keyboard frame, and a Running T26d sound stream; it observed two pending input
  events, Running sound, and one XRUN (`attack-harness.log:7`). Forward-version and trailing-byte
  GPU/input/sound payloads all refused atomically (`attack-harness.log:8-13`); the exact gate also
  held malformed envelope, missing section, invalid size, agent/viewport/repair refusal, and
  component refusal.
- COVERAGE — INSUFFICIENT FOR THE CLAIM. The Makefile, coordinator, tokens, adapter success/refusal,
  post-GPU rollback, and all four Machine composition outcomes were executed; impossible-through-
  coordinator guard branches are waived. There is no changed production hunk that performs T23e
  HELLO/reconnect or retains/applies T22 host viewport state, so those acceptance claims cannot be
  covered. Full classifications: `evidence/e5-t26e/verifier-r2/audit.md`.
- P5 scrubbed/pristine exact-head gate — HELD. In-place and `git archive` cold runs of submitted head
  `8c931481` both passed 10/9/6/12/6 relevant tests, format, both clippy modes, and wasm32 build
  (`evidence/e5-t26e/verifier-r2/gates.log:4-21`). Worker evidence digest
  `81401c4d4037fa2c463b69a1c7c4e26d7ddc00deba20e7da925101c1ee77c253` also matched.
- SUITE: retain the evidence-only five-test public-API harness as the reproducer; no implementation
  test promotion while the production semantics remain refuted.
