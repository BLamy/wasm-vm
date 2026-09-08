---
id: E5-T26h
epic: 5
title: Preserve desktop devices across whole-machine resume
priority: 526.55
status: verified
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

### 2026-09-07 — coordinator — rebuilt demo handoff

At bundle/metadata head `bd2ca26721a21d3ba8be5a58b7347cea40990421`, one built-page
Chromium pass recorded 126 passed, 0 failed, zero console/page/HTTP errors, and the
visible E5-T26h VERIFIED entry. `make web-dist` embeds the corrected runtime
WASM SHA-256 `95d1f68df359850d23b4c1b27a76baae393f89efe2cca99b68c2bfa23251c3e3`.
Command, inspected screenshot and artifact digests are retained in
`evidence/e5-t26h/browser-bundle-smoke/README.md`. T26f remains responsible for the
real desktop restore interaction; production publishing stays at the requested milestone.

### 2026-09-07 — fresh verifier sound remediation — VERDICT: verified

- Queue identity and PCM — HELD. At frozen runtime
  `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`, sound metadata is encoded and restored in actual
  control/event/TX/RX queue-index order. The independent 32-case matrix passes with and without RX
  and the desktop envelope: restore emits no old PCM, exact fresh seed-1701 PCM reaches the fresh
  sink, TX used advances 1 to 2 with status `0x8000`, and old sink/fresh clock ownership is
  preserved (`evidence/e5-t26h/verifier-sound-remediation/focused-native.log:17-150`).
- Version/refusal atomicity — HELD. Layout v2 wire bytes are exact; old unversioned,
  unknown 0/1/3/`u32::MAX`, and truncated markers refuse as sound tag 16 before mutation. A bounded
  novel valid-v2 contradiction (TX absent with nonzero cursor) also preserves the full target
  snapshot, sound handle, zero sink, and fresh clock
  (`evidence/e5-t26h/verifier-sound-remediation/novel-v2-atomicity.log:83-86`). Outer container-v1
  headless continuation remains valid.
- Sabotage/coverage — HELD. Reverting only save order to RX/TX in a temporary archive reproduces
  old seed-73 replay, TX used 1, and status `0xffffffff`; the promoted test fails all eight selected
  variants (`queue-order-sabotage.log:8-74`). All six sound tests and nine prior promoted H tests
  pass independently, and every runtime/test/Makefile hunk executes.
- Evidence/portability — HELD. Worker gate SHA-256
  `7b7aba1be129f036c2ffbfc4e5428dc3ed566497d0d8820fea73e045bdec2820` records 125 passing checks;
  related sound SHA-256 `449388e12b8fa769f739cf77d26d35744fb0910c76173deee448a06e35d09979`
  records 21 more. One scrubbed clean clone detached at exact `e8850241` passed
  `make verify-E5-T26h` and remained clean (`clean-exact-head.log:563`, SHA-256
  `8446b698a4bb27edb3dc533a7c8d295889395861ae3731f1f295e94473fa5921`). Full results and digests:
  `evidence/e5-t26h/verifier-sound-remediation/results.md`.
- Carry-forward — all unchanged console session-fence/stale-HELLO, serial/control, input, GPU,
  CPU/RAM, topology, atomicity, sparse-parser, RNG, and headless results remain HELD. No browser
  claim was added; E5-T26f owns that proof.

### 2026-09-07 — worker/coordinator — sound queue remediation implemented

Frozen source: `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`. Sound service metadata now
uses actual queue-index order control/event/TX/RX on save and restore. A section-local
layout-v2 word rejects the old unversioned sound composition before live mutation;
the outer container and headless snapshots remain version 1. Host sinks and clocks
are retained, not serialized or replaced.

`make verify-E5-T26h` passes, including the promoted actual-WAV playback matrix,
legacy/unknown/truncated layout atomic-refusal tests, headless continuation, and the
existing transport/codec/native/wasm gates. Record:
`evidence/e5-t26h/worker-audio-queue-order/gates.log`, SHA-256
`7b7aba1be129f036c2ffbfc4e5428dc3ed566497d0d8820fea73e045bdec2820`.
`cargo test -p wasm-vm-core --features gpu-trace --test virtio_snd_machine --test
virtio_snd_playback --test virtio_snd_capture` also passes; record
`evidence/e5-t26h/worker-audio-queue-order/related-sound-tests.log`, SHA-256
`449388e12b8fa769f739cf77d26d35744fb0910c76173deee448a06e35d09979`.
The recordings demonstrate no source-period replay, exact fresh PCM, TX used/status
completion, and zero live-state changes on incompatible sound layout rejection.
Independent review remains required. Browser acceptance still belongs to T26f.

### 2026-09-07 — fresh verifier late sound-queue audit — VERDICT: refuted

- Sound queue identity — FAILED. Virtio-snd's wire order is control/event/TX/RX
  (`TX_QUEUE = 2`, `RX_QUEUE = 3`), but `save_resume` appends cursor metadata as
  control/event/RX/TX at `crates/core/src/lib.rs:2746-2754`. The shared decoder rebuilds tuple
  ordinal against transport queue index at `:183-228`, and sound restore assigns those results
  back as control/event/RX/TX at `:3017-3041`. This binds the saved TX cursor and live service to
  queue 3 instead of queue 2.
- Native reproduction — FAILED. With RX absent, whole-machine load rejects the valid playback
  topology as `BadComponentState { tag: 16 }`. With unused RX configured, restore proceeds but the
  fresh sink receives old seed-73 PCM instead of fresh seed-1701 PCM; the fresh TX used index stays
  `1` and its status stays `0xffffffff`. The independent command
  `cargo test -p wasm-vm-core --test desktop_machine_audio_resume -- --nocapture` exits 101 with
  0 passed / 4 failed across whole-machine-only and desktop-envelope variants. Evidence:
  `evidence/e5-t26h/verifier-audio-queue-order/native-audio-resume.log`, SHA-256
  `c80f4272d49e8660566bce2fe025e4401c395100d0e7cccd49b2887f6bf2f36e`; full analysis in
  `evidence/e5-t26h/verifier-audio-queue-order/results.md`.
- Scope — prior sound queue/cursor continuity is withdrawn. All unchanged console session-fence,
  stale-HELLO, serial/control, input, GPU, CPU/RAM, corruption/topology, atomicity, sparse-parser,
  headless, and clean-environment results remain HELD. Preserve sound cursors in queue-index order,
  retain the fresh host sink/clock, and prove no old PCM replay plus exact fresh TX completion in
  all four promoted fixture cases before reverification.

### 2026-09-07 — fresh verifier session fence — VERDICT: verified

- H1 old-session HELLO boundary — HELD. Predicted all pre-snapshot agent-TX descriptors would be
  completed once with used length zero but never forwarded to the fresh Channel, while a HELLO
  posted after `load_resume` and before the first guest step would remain usable. The promoted old
  HELLO regression and stronger empty/nonzero/wrapped/full/RAM-last/closed-port worker matrix pass
  (`evidence/e5-t26h/verifier-session-fence/clean-exact-head-native.log:92-116`). The fence executes
  after all restored sections and before guest execution (`crates/core/src/lib.rs:3227-3239`), and
  the drain never reads or stages payload bytes (`crates/core/src/dev/virtio/console.rs:1016-1040`).
- H2 malformed fence paths — HELD. The worker's valid-then-malformed descriptor case raises
  `NEEDS_RESET`, exposes no payload, remains blocked after repair/notify, and recovers only after
  reset (`crates/core/tests/desktop_machine_resume.rs:949-993`). The one bounded novel attack moved
  the failure to used-ring publication with a valid old HELLO and an out-of-RAM saved used address;
  it produced the same fail-closed behavior and post-reset recovery
  (`evidence/e5-t26h/verifier-session-fence/used-publish-attack.log:7-16`). This directly exercises
  the changed error/guard/reset paths at `crates/core/src/dev/virtio/console.rs:1033-1051,1061-1065,678-695`.
- H3 evidence, coverage, and carried results — HELD. Worker evidence hashes to the claimed
  `1978f7ac0284ab4b3d9127a84083920e1d7a0ca401bd7fc19fe2e5dbb5570349` and records 119 checks,
  including all seven worker integration tests and the nine unchanged promoted critic tests.
  Unready/empty, interrupting/non-interrupting completion, wrapped frontier, descriptor-pop error,
  used-publication error, service-block, reset, RAM-last, serial/control continuity, and fresh-target
  paths cover the new hunks. Earlier topology, every-section corruption/missing/duplicate,
  held-input, sound/RNG cursor, legacy atomicity/shared sparse parser, headless, sabotage, and
  no-same-state-oracle HELD results are carried forward where their boundaries are unchanged.
- H4 clean exact-head acceptance — HELD. One clean local clone detached at
  `2325c05f756f9a9746099051db9ab46866b874e8`, with compiler/Cargo env scrubbed, passed
  `make verify-E5-T26h`; it remained git-clean. Record SHA-256
  `92773b14effc7bad1c3c11481ae66a3a7d43efbedc32caba1bc5816db5dadaba`
  (`evidence/e5-t26h/verifier-session-fence/clean-exact-head-native.log:1-337`). Current upper-layer
  HEAD movement was ignored after confirming the three reviewed files were byte-identical to the
  frozen commit. No browser gate was run or required for H.
- SUITE: retained the nine promoted tests unchanged. The temporary used-publication variant was
  discarded after recording because the permanent malformed-DMA test already locks the same
  stable protocol-reset/session-fence policy. Predictions and full result notes are in
  `evidence/e5-t26h/verifier-session-fence/`; prediction SHA-256
  `87c846fd7f19199abc9a98d64806d78aef4843e85100b8e0273515390e0acfee`, novel-attack SHA-256
  `3e869801070444326666378b9b26c44b8dc50234b892163abad87bebaf9fa3ee`.

### 2026-09-07 — worker — session fence implemented, awaiting fresh critic

Frozen implementation: `2325c05f756f9a9746099051db9ab46866b874e8`.
Exact-head command `make verify-E5-T26h` passed 119 test executions, fmt,
warnings-denied clippy, no_std wasm32 build and wrapper check. Evidence:
`evidence/e5-t26h/worker-session-fence-gates.log`, SHA-256
`1978f7ac0284ab4b3d9127a84083920e1d7a0ca401bd7fc19fe2e5dbb5570349`.

The nine promoted critic tests are unchanged and pass. Restore now completes
saved agent TX descriptors without delivering old application bytes, after all
RAM sections are installed and before guest execution; control and serial work
continue normally. Wrapped saved frontiers, reordered RAM sections, closed-port
pending data, fresh HELLO posted before the first new guest step, and malformed
DMA/reset recovery are exercised. Bad DMA blocks agent TX until transport reset
instead of rebuilding a cursor at zero and replaying old bytes. Earlier atomic
refusal, queue continuity and codec predictions remain held; the guest trace
continuation hash remains `9865e79b681ad970`. No browser success is claimed by this
native submission, and the concurrently running older browser candidate is not
evidence for this new session fence.

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

### 2026-09-07 — fresh verifier remediation — VERDICT: refuted

- R1 prior refutations — HELD. Both unchanged promoted regressions pass at frozen
  `611e0f34952106bbafef828c304d697d20c34da3`: the pre-save control-transmit request advances
  exactly once, and malformed CPU refusal leaves GPU resource 77 absent. The focused run passes all
  five worker integration tests plus the original eight critic tests
  (`evidence/e5-t26h/verifier-remediation/focused-regressions.log`, SHA-256
  `21918cf2f591ff07089bc7e62231ec51ce742a2e364726c1ef5889eb3f0e5da9`).
- R2/R3 console pending continuity vs fresh HELLO — FAILED. Predicted that re-arming a pending
  agent-transmit descriptor could not let bytes from the old application session attest the new
  host. A complete valid T23d HELLO frame was posted and notified before save; after resume the new
  `AGENT_TRANSMIT_QUEUE` probe delivered those old bytes, `confirm_virtio_console_agent_hello()`
  accepted them, and `agent_ready_for_restore()` became true
  (`evidence/e5-t26h/verifier-remediation/stale-pending-hello-attack.log:7-17`, SHA-256
  `bf6bf7034b5da0f6bccec9fcd20b4a3fdec76f35af7c99667aa8be5d890490d6`). The regression is
  `crates/core/tests/desktop_machine_resume_verifier.rs:587-679`; the cause is the unconditional
  agent-ring re-arm at `crates/core/src/dev/virtio/console.rs:409-421` immediately after clearing
  buffered host bytes and HELLO counters. Preserve control-transmit and serial-transmit continuity,
  and complete/reconcile the old agent descriptor exactly once, but discard its pre-resume
  application-session TX payload before `stage_agent_output` can forward it into the fresh Channel;
  only a HELLO generated after resume may arm desktop restore.
- R4/R5 legacy prevalidation and shared sparse parser — HELD. CPU, RAM, CLINT, PLIC, UART, RTC,
  clock, blk, and net malformed/trailing/semantic payloads refuse before live state or GPU callback;
  missing blk/net slots refuse atomically. The RAM matrix exercises truncated/wrong-length and
  oversized zero runs, while the unchanged sparse round-trip, random-input, truncation/flip, and
  allocation-bound checks pass in the hash-matched worker record.
- R6 evidence/coverage — HELD for the remediation hunks. Worker record
  `worker-remediation-gates.log` hashes to
  `07d8a5beb3e2f9ea8ddac8b5e18f380cc4e4cfbed7d538951c06b7b97b2d26ef` and contains 116 passing
  checks with strict fmt/clippy and wasm32 builds. Port-0 and agent transmit probes exercise two
  re-arm branches, the prior control regression exercises the third, and the legacy matrix covers
  every new prevalidation arm. All earlier unchanged HELD results remain carried forward.
- SUITE: promoted `pending_old_session_agent_hello_cannot_attest_the_resumed_host` in the existing
  critic target. Exact-head clean-copy proof is deferred until correctness is frozen again; the
  earlier portability result remains unchanged. No browser claim or browser gate was added.
