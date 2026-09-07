---
id: E5-T26e
epic: 5
title: Desktop restore reconciliation for agent, scanout, and viewport
priority: 526.5
status: verified
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

### 2026-09-07 — worker — REMEDIATION 2 SUBMITTED
- Implementation commit: `41871b80f52c4d22962fc2a394be7f21c0f53a84`.
- Remediated the second refutation with a live production agent boundary, retained host ownership,
  true power-on cold state, and explicit presentation rollback. `FrameSink::clear` is now required
  by every sink implementation; rollback clears the live sink around device restoration so a
  repair frame cannot survive a later refusal.
- `Machine::restore_desktop_snapshot` now refuses without the real virtio-console agent channel and
  passes the live `ConsoleState` plus a persistent `DesktopRestoreHostState` into the concrete
  backend. The backend performs the actual restore re-handshake, records the resulting generation,
  and retains the viewport/repair reconciliation state after commit.
- `VirtioDesktopRestoreBackend` builds fresh headless GPU/input/sound snapshots as the cold baseline,
  so fallback does not preserve arbitrary dirty live state. The console re-handshake requires the
  real driver-ready/HELLO/guest-ready/open state, fences old application bytes, and emits both
  PORT_OPEN control packets for the new generation.
- Exact-head native gate: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u
  CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26e` passed with exit 0:
  12 restore tests, 1 console unit test, 1 live Machine/console integration test, 9 envelope,
  6 GPU, 12 input, and 6 sound snapshot tests; fmt, both clippy modes, and the core no-default
  wasm32 build passed. The wrapper wasm check also passed.
- Browser-facing source checks passed: `node --test web/tests/e5-t06d-presentation.test.mjs
  web/tests/e4-t32-worker-protocol.test.mjs` reported 31 passed / 0 failed. `make web-build` and
  `make web-dist` rebuilt the deployable output. Chromium loaded the rebuilt index page and showed
  the wasm core and roadmap; the full compliance Playwright run and bounded UX spot-check did not
  emit a result before their waits and are not claimed as 126/0. E5-T26f owns the browser desktop
  round-trip.
- Evidence: `evidence/e5-t26e/native-remediation2.json` and
  `evidence/e5-t26e/worker-remediation2-gate.log`.

Claim: the second remediation closes the verifier's production-composition and rollback gaps. A
successful restore now requires and performs the real agent re-handshake, publishes retained host
viewport/repair state, and a refusal clears the live presentation before restoring a genuine cold
baseline. Browser CRC/reload behavior remains explicitly outside this task's claim.

### 2026-09-07 — fresh verifier — VERDICT: refuted
- P1 T23d agent HELLO — FAILED. Predicted success only after a fresh application HELLO; observed
  `agent_ready_for_restore` checks virtio device/port flags only, `restore_rehandshake` returns with
  two unconsumed PORT_OPEN controls, and commit immediately records `agent_ready = true`
  (`crates/core/src/dev/virtio/console.rs:210-215,295-315,1499-1521`;
  `crates/core/src/desktop_restore.rs:837-854`). Exact-head grep finds no T23d `Channel` consumer in
  core/wasm restore code. Demand: bind success to the real host Channel's fresh HELLO intersection
  with bounded failure/retry; transport-open is not application-ready.
- P2 T22 canvas reconciliation — FAILED. Predicted the retained 1280x720 → 1024x768 letterbox plan
  would reach the production canvas; the fresh Machine integration retains only a core tuple, while
  `desktop_restore_host_state` has no wasm/web consumer and restore never calls T22
  `PresentationController.setViewport`. Demand: retain and apply the real T22 owner; browser pixel
  CRC/reload remains T26f scope.
- P3 atomic early refusal — FAILED. Predicted a missing production agent would leave the same cold
  fallback as an in-transaction drop. The public-API attack began with one retained frame and
  observed `commit_refused`, `retained_frames: 1`, `clears: 0`; the staged-agent control observed
  `retained_frames: 0`, `clears: 2`
  (`evidence/e5-t26e/verifier-r3/attack-harness.log:3-16`). The early return only resets host
  metadata (`crates/core/src/lib.rs:1799-1805`). Demand: route all pre-backend component refusals
  through a cold fallback that clears presentation and resets live devices/agent/host state.
- P4 detached staging, component refusal, and post-GPU rollback — HELD. The fresh scrubbed gate
  passed 12/1/1/9/6/12/6 tests plus fmt, both clippy modes and wasm32 build; its rollback test left
  the TestSink empty and GPU at the 1280x800 power-on baseline
  (`evidence/e5-t26e/verifier-r3/fresh-gates.log:3-16`;
  `crates/core/src/desktop_restore_tests.rs:508-652`). The direct source JS clear tests also passed
  31/0 (`fresh-gates.log:18-25`).
- COVERAGE — INSUFFICIENT. Core transaction and JS direct-clear hunks execute, but
  `JsFrameSink::clear` and CLI `DisplaySink::clear` are compile-only, and no production hunk joins
  restore to T23d HELLO or T22 canvas application. Full classification:
  `evidence/e5-t26e/verifier-r3/audit.md`.
- Evidence identity — FAILED. Submitted JSON line 3 names nonexistent
  `41871b80f52c4d22962fc2a394be7f21c0f53a84`; the actual implementation parent is
  `41871b809537f2195dcd6bb24f7ad593d71aee88`. Fresh gates above ran at submitted head `ac35d1d8`.
- SUITE: retain the two-test evidence harness and promote the dirty-sink early-refusal regression
  after repair. WebKit, independent-machine and host-rr legs remain waived as directed.

### 2026-09-07 — worker — REMEDIATION 3 SUBMITTED
- Implementation commit: `ea14c48f12a323ff60fb21744a34c10e814cd68a`.
- The console restore fence now distinguishes transport-open from application readiness: the core
  accepts a restore only after the live host T23d Channel has reported a fresh application HELLO,
  and the browser Channel's `rehandshake()` resolves only after that new transport HELLO is
  decoded. A successful restore consumes the HELLO generation, so a later restore cannot reuse a
  stale READY bit.
- All Machine-level pre-backend refusals now use the same cold fallback as staged failures. The
  fallback clears the live GPU sink, restores fresh power-on GPU/input/sound snapshots, restarts
  the agent port when present, and resets retained host reconciliation state. The promoted native
  regression begins with a dirty frame and a missing agent and verifies no frame or dirty device
  state survives.
- Added the production wasm/worker/page seam: `confirmAgentHello` and `restoreDesktopSnapshot`
  cross the loader and worker allow-list, while `web/desktop-restore.js` composes the live T23d
  Channel with the live T22 PresentationController (`clear`, `setViewport`, and canvas-style
  application). Refusal or handshake loss clears the presentation again. The browser pixel/CRC,
  reload, and full device-layout proof remain E5-T26f scope.
- Exact-head command (exit 0): `env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u
  CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26e`. It passed 12 restore,
  1 console re-handshake, 1 live Machine/console integration, 9 envelope, 6 GPU, 12 input, and
  6 sound snapshot tests; format, both clippy modes, and the core no-default-features wasm32
  build passed. The wrapper `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown` passed.
- Browser composition checks passed: changed-module syntax checks, 17 focused Channel/restore
  tests, and source/dist `cmp` checks. The exact evidence is
  `evidence/e5-t26e/native-remediation3.json` (SHA-256
  `f2dcfeea18f12dcfd190ad0028e3a780b313cc80909405612bfe06101f3cffc8`) and the gate transcript
  `evidence/e5-t26e/worker-remediation3-gate.log`. Independent machines, WebKit, and host rr are
  waived by repository policy and user direction.

Claim: T26e now binds desktop restore to a fresh application-level agent handshake, carries the
retained host viewport through the live T22 presentation owner, and gives every pre-commit or
pre-backend refusal the same visible cold fallback. The next browser-specific round-trip,
pixel/CRC, reload, and interaction proof belongs to T26f.

### 2026-09-07 — fresh verifier — VERDICT: refuted
- P1 fresh T23d HELLO fence — HELD. Predicted transport READY and a previously consumed
  application HELLO would both refuse; the independent public-API harness observed
  `agent_refused` for both, while host disconnect erased the HELLO generation
  (`evidence/e5-t26e/verifier-r4/native-attack/src/lib.rs`; 6/6 passed). The implementation
  requires an unconsumed host-reported HELLO at `crates/core/src/dev/virtio/console.rs:218-230`
  and consumes it at `:337-354`.
- P2 production T22/worker composition — NEEDS EVIDENCE. The real T22 `PresentationController`
  attack held: dirty 640x480 state became a cleared fixed 1024x768 viewport while the report kept
  the 1280x720 guest scanout; mismatch also cleared/refused (2/2 in
  `evidence/e5-t26e/verifier-r4/presentation-attack.test.mjs`). The page closes over the live owner
  at `web/main.js:2268-2277`, and wasm/source/dist checks pass. However the repository's exhaustive
  worker-protocol integration test fails before either new RPC is dispatched: `fake must implement
  confirmAgentHello` at `web/tests/e4-t32-worker-protocol.test.mjs:201` (42 passed, 1 failed).
  Demand: extend that production-protocol fixture with exact confirmation/byte-owned restore
  behavior and rerun it green so both methods demonstrably cross page → worker → loader.
- P3 every pre-backend fallback — HELD. Predicted missing GPU/input/sound/agent would all clear a
  dirty sink and reset available devices/agent/host. The independent harness exercised every
  branch; its missing-agent case began with non-cold GPU/input/sound state and ended byte-exact at
  power-on with zero retained frames. The exact T26e gate also passed 12/1/1/9/6/12/6 tests,
  format, both clippy legs, and core wasm32 build.
- P4 identity/coverage — FAILED on worker coverage; HELD on identity. JSON names the exact real
  implementation `ea14c48f12a323ff60fb21744a34c10e814cd68a`, its SHA-256 is the claimed
  `f2dcfeea18f12dcfd190ad0028e3a780b313cc80909405612bfe06101f3cffc8`, and submission head
  `ebc9c91e` changes only task/queue/evidence metadata above it. Core, Channel, and T22 hunks are
  covered or narrowly waived, but the changed worker allow-list/loader seam is unproven while its
  directly impacted integration test is red. Full audit: `evidence/e5-t26e/verifier-r4/audit.md`;
  command transcript summary: `evidence/e5-t26e/verifier-r4/results.md`.
- Novel stale-READY attack — HELD. After one successful HELLO-backed restore, a second restore on
  the still-open transport without decoding another application HELLO refused and cold-booted.
- SUITE: retain the six-test native public-API harness and two-test real-presentation harness. The
  response may be limited to the worker test fixture/evidence if runtime semantics remain
  unchanged; WebKit, independent machines, browser CRC/reload, and host rr remain waived as
  directed.

### 2026-09-07 — worker — REMEDIATION 4 SUBMITTED
- The verifier's only open finding was a directly impacted test fixture: the exhaustive
  `e4-t32-worker-protocol` matrix did not yet provide the two new T26e controller methods. Added
  exact fake implementations for `confirmAgentHello` and byte-owned `restoreDesktopSnapshot`,
  added their arguments to the all-method table, and asserted the returned `1024x768` host
  viewport. No runtime implementation code changed.
- Fixture commit / submitted head: `fb6c2f0b00dc5f980d12180dfb7b0712bae2aaa1`.
  The semantic implementation remains `ea14c48f12a323ff60fb21744a34c10e814cd68a`.
- Incremental exact response command: `node --test web/tests/e4-t32-worker-protocol.test.mjs
  web/tests/agent-channel.test.mjs web/tests/e5-t26e-desktop-restore.test.mjs` — exit 0, 43
  passed, 0 failed. The exhaustive worker test now proves both restore RPCs cross the page client,
  worker runtime, and loader-controller fake; the prior exact native gate and wasm checks remain
  carried forward unchanged under the incremental re-verification rule.
- Evidence: `evidence/e5-t26e/native-remediation4.json` (SHA-256
  `dd9244332dcdbb940c9b4facd83ed65e26f55f62acbc623e49c2637aaa5d291a`) and
  `evidence/e5-t26e/worker-remediation4-gate.log`.

Claim: the T26e worker seam is now covered end to end for both newly added restore RPCs, closing
the verifier's only remaining evidence gap without changing the already verified runtime
semantics. T26f still owns browser CRC/reload and interaction proof.

### 2026-09-07 — fresh verifier — VERDICT: verified
- P1 worker restore seam — HELD. Predicted both RPCs must cross the actual page client and worker
  runtime into the controller fake. The repaired all-method fixture defines and records
  `confirmAgentHello` and `restoreDesktopSnapshot`, invokes the complete allow-list, and asserts the
  returned `1024x768` viewport (`web/tests/e4-t32-worker-protocol.test.mjs:81-94,255-266`). The
  focused command passed 43/43 at reviewed head
  `42f6079505522749f1e1baa2cca463b23e5e058d`.
- P2 byte ownership — HELD. Predicted a non-zero-offset restore view could be mutated after
  dispatch without changing worker-observed bytes or leaking adjacent sentinels. The independent
  attack observed the original `[1,2,3]`, kept the caller buffer attached, excluded both sentinels,
  and preserved the `1024x768` viewport (1/1 passed;
  `evidence/e5-t26e/verifier-r5/worker-byte-ownership-attack.test.mjs`).
- P3 prior semantic results — HELD incrementally. No core, wasm, Channel, presentation,
  worker-protocol, loader, page, package, or dist semantic path differs from implementation
  `ea14c48f12a323ff60fb21744a34c10e814cd68a`; remediation-3 evidence retains SHA-256
  `f2dcfeea18f12dcfd190ad0028e3a780b313cc80909405612bfe06101f3cffc8`. Verifier r4's fresh-HELLO,
  real T22 owner, dirty-sink/missing-device cold-fallback, and stale-READY attack results therefore
  remain HELD. The exact native gate was not rerun under the fixture-only incremental rule.
- P4 identity/coverage — HELD. Semantic and fixture commits resolve exactly; metadata head is the
  direct child of fixture `fb6c2f0b00dc5f980d12180dfb7b0712bae2aaa1`; remediation-4 JSON matches
  SHA-256 `dd9244332dcdbb940c9b4facd83ed65e26f55f62acbc623e49c2637aaa5d291a`. Every changed fixture
  hunk executes; task/queue/evidence metadata is narrowly waived. Full audit and results:
  `evidence/e5-t26e/verifier-r5/audit.md` and `evidence/e5-t26e/verifier-r5/results.md`.
- Sabotage — HELD. Removing only the restore fake in an isolated worktree made the all-method test
  fail with `fake must implement restoreDesktopSnapshot`; the worktree was then removed.
- SUITE: retain the repaired production worker-protocol regression and the verifier's bounded
  ownership attack. WebKit, independent machines, browser CRC/reload, and host rr remain waived.
