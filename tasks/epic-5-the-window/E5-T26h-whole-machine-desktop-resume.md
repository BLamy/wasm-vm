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
