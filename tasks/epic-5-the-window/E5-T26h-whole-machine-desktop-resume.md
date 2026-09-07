---
id: E5-T26h
epic: 5
title: Preserve desktop devices across whole-machine resume
priority: 526.55
status: implemented
depends_on: [E5-T26e]
estimate: S
risk: high
capstone: false
---

## Goal

Make the existing whole-machine snapshot preserve the desktop devices needed by
the live Linux drivers in restored RAM. A new host must resume without reboot or
device reprobe and must still require a fresh application HELLO.

## Boundary

Own the composition of existing GPU/input/sound codecs with their MMIO register
state and service queue cursors in `Machine::save_resume` / `load_resume`. Include
the console lifecycle and queues needed to carry the new host HELLO. Preserve
injected host sinks and clocks, drop stale host-session bytes, and reconcile held
input using the existing release policy. Do not change instruction semantics.

## Acceptance criteria

- A deterministic machine fixture with active desktop devices resumes into a
  fresh machine with matching MMIO state, ring positions, GPU resources and
  usable keyboard/tablet/mouse/sound/console paths. Consumed descriptors are not
  replayed and pending descriptors continue exactly once.
- A stale application HELLO is not accepted after resume; a new HELLO carried
  through the preserved console transport enables desktop reconciliation.
- Missing required desktop state and malformed payloads are rejected before
  applying a partial desktop restore; existing headless snapshot compatibility
  remains explicit and covered.
- Existing desktop codec, resume determinism, coherence and block-quiesce tests
  pass, including the wasm32 build. The browser proof remains T26f's responsibility.

## Verification command

cargo test -p wasm-vm-core --test desktop_machine_resume

## Adversarial verification

Seed nonzero and wrapped ring cursors; save with held pointer/key state and a
pending sound/console request. Compare actual used-ring entries before and after
resume. Corrupt each new section, remove one required device, and vary device
assembly. Require typed refusal and unchanged live state on rejection. Sabotage
one preserved cursor and prove the regression test detects duplicate completion.
Check a headless snapshot independently. No new browser or host-rr requirement.

## Verification log

### 2026-09-07 — worker — remediation implemented, awaiting fresh critic

Frozen remediation: `611e0f34952106bbafef828c304d697d20c34da3` (over the
recorded refutation at `daac0b99`). Exact-head command `make verify-E5-T26h`
passed 116 test executions, strict fmt/clippy, the no-default-features wasm32
core build, and the wasm wrapper check. Evidence:
`evidence/e5-t26h/worker-remediation-gates.log`, SHA-256
`07d8a5beb3e2f9ea8ddac8b5e18f380cc4e4cfbed7d538951c06b7b97b2d26ef`.

All eight unchanged promoted critic tests pass. Restored console transmit rings
are re-armed from their saved cursors, completing already-notified pending work
once while dropping old host queues and requiring a fresh HELLO. All fallible
legacy section decoders now run before any desktop commit; sparse RAM validation
shares the decode parser without allocating an extra RAM-sized buffer. Added
serial/agent transmit evidence, 25 malformed-payload cases, and two missing-slot
cases assert byte-identical target state and no GPU callback on refusal. The
guest continuation hash remains `9865e79b681ad970` at one retired instruction.
The previous six held attack categories remain carried forward. Browser evidence
is still T26f's responsibility, not a claim of this native submission.

### 2026-09-07 — worker — implemented, awaiting fresh critic

Implementation: `4ed9eaa5299338e513783722808576960919604b` (Luna implementation,
coordinator integration). Command: `make verify-E5-T26h`, exit 0; 106 checks pass,
including strict core clippy, native resume/coherence/quiesce/component tests,
no-default-features wasm build, and wasm wrapper check. Recorded log:
`evidence/e5-t26h/worker-gates.log`, SHA-256
`d406f8521396d4e5ad9fe787b2458122bfef149ebc99a03b7fd6d429833ba79f`.

The fresh-target fixture starts with different RAM, no configured queues, and no
GPU resource. Restore installs DRIVER_OK, source queue cursors, and resource bytes;
new keyboard/GPU/sound/console descriptors complete after the recorded cursors.
GPU repair and the next actual guest flush use the new host sink, never the old
sink. A fully opened source console restores with no accepted application HELLO,
and its close/open control traffic uses the preserved receive ring. The recorded
guest continuation hash is `9865e79b681ad970` for one retired fixture instruction;
the existing CPU continuation matrix separately checks trace equivalence across
multiple snapshot points. Malformed/missing GPU sections leave a distinct target
unchanged, and the no-desktop headless case remains supported. Existing component
codec corruption/release/XRUN tests are carried in the same gate. Browser behavior
is not claimed here: T26f owns that recording. A fresh critic must still execute
the task's scoped adversarial attacks before setting verified.

### 2026-09-07 — coordinator — in progress

Extracted from the concrete T26f resume failure at `683fb09d`. Luna owns the
implementation; a fresh Daybreak Blue session will verify the frozen diff and
deterministic evidence before T26f resumes. Existing unrelated workspace edits
and the source image are preserved.

### 2026-09-07 — fresh verifier — VERDICT: refuted

- P1 worker evidence integrity — HELD. `worker-gates.log` hashes to the claimed
  `d406f8521396d4e5ad9fe787b2458122bfef149ebc99a03b7fd6d429833ba79f` and records
  106 passing checks, zero failures/ignored tests, wasm32 core build, and wasm wrapper check.
- P2/P5 pending queue continuity — FAILED for console; HELD for nonzero/wrapped RNG and sound.
  Predicted a control-transmit descriptor kicked before save would advance the restored used index
  from 1 to 2 exactly once. It remained `Ok(1)` (`evidence/e5-t26h/verifier/attacks.log:8-13`;
  regression assertion `crates/core/tests/desktop_machine_resume_verifier.rs:478-540`). The frozen
  codec omits kick state and explicitly clears every kick at
  `crates/core/src/dev/virtio/console.rs:357-367,395`; the guest already notified, so this request
  has no deterministic retry. Preserve/re-arm guest-originated pending console transport work while
  continuing to drop stale host-session bytes and HELLO, then rerun the regression.
- P10 refusal atomicity — FAILED. Predicted malformed CPU payload refusal would leave a fresh
  target without source GPU resource 77. `load_resume` returned the expected typed CPU error but
  resource 77 was installed (`evidence/e5-t26h/verifier/attacks.log:15-17`; regression assertion
  `crates/core/tests/desktop_machine_resume_verifier.rs:314-354`). The detached desktop validation
  at `crates/core/src/lib.rs:2826-2909` is followed by live desktop commits beginning at
  `crates/core/src/lib.rs:2910`, before CPU validation/application in the later pass. Prevalidate all
  fallible whole-machine sections (or stage/rollback the desktop commit) before changing live
  desktop state, then rerun the regression.
- P3/P4/P7/P8 — HELD. All seven new sections rejected component corruption, invalid ring metadata,
  omission, and duplication with their typed tag and byte-identical target state; topology mismatch
  refused atomically in both directions; alternate assembly order and headless restore passed.
  Held keyboard/tablet/mouse state reconciled, and the fresh fixture used distinct RAM and empty
  device shadows. See `evidence/e5-t26h/verifier/attacks.log:18-22`.
- P6 sabotage — HELD. In a temporary archive copy of frozen `4ed9eaa5`, decrementing the serialized
  `last_avail` cursor made the worker continuity test observe used index 3 rather than 2
  (`evidence/e5-t26h/verifier/cursor-sabotage.log:8-20`). The unsabotaged scrubbed-environment clean
  copy passed the direct 3-test acceptance target (`clean-copy-acceptance.log:79-86`).
- COVERAGE/SUITE: retained the bounded eight-test critic target
  `crates/core/tests/desktop_machine_resume_verifier.rs`; six attacks pass and the two failures above
  are promoted regression demands. Existing unchanged codec HELLO, release, corruption, XRUN,
  coherence, and quiesce checks are carried forward from the hash-matched 106-check worker log.

Frozen implementation: `4ed9eaa5299338e513783722808576960919604b`; the reviewed H implementation
paths are byte-identical at browser-only upper-layer HEAD
`719c6212a5e028523ef70376c864c6411fdf5b48` (apart from this new verifier test).
Verifier evidence digests: `attacks.log`
`103c12a5c80af59dc69401ce4a94fdddf8c32fd2a4cd2b485f4b0d4c94ebd8ae`;
`clean-copy-acceptance.log`
`3c34620f610e5f9080ff7facea0e3b120de1eea1f4216b1f90111928bc6a1f08`;
`cursor-sabotage.log`
`f242c074df7fcb6e3bd986f27d4514b3d9f6f6708c1760978dce04d19325098d`.
