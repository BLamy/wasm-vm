---
id: E7-T11
epic: 7
title: Layer G checkpoint — snapshot/restore across a live box64 process
priority: 711
status: pending
depends_on: [E7-T05]
estimate: M
capstone: false
---

## Goal
Prove the determinism/record-replay layer (Layer G) survives Babel's hardest state: a
**full-machine snapshot taken while box64 is mid-translation, then restored, resumes the x86_64
program correctly**. box64 holds large runtime-generated code caches and JIT metadata entirely
in guest RAM, so if the snapshot format (E6-T16) and restore are honest, no special handling is
needed — this task verifies that and closes any gap before Layer G's Level 8 capstone.

## Context
A machine snapshot captures guest RAM and device state; box64's translated code and internal
structures live in that RAM, so they should snapshot transparently — *if* nothing box64
depends on is outside the captured state (host time, entropy, fds mediated by the kernel). This
is exactly the nondeterminism inventory Layer G must own. Take snapshots at adversarial moments
(mid-block-translation, mid-syscall) and confirm bit-identical resume. Feed findings into the
E8 record/replay work: any box64 state that *doesn't* restore cleanly is a nondeterminism source
E8 must capture.

## Deliverables
- A test: start an x86_64 workload under box64, snapshot mid-run (including a snapshot taken
  during heavy dynarec activity), restore, and assert the workload completes with the correct
  result post-restore.
- A nondeterminism inventory for box64 under Layer G (what's in RAM vs what leaks to the host),
  handed to E8-T03/T04.

## Acceptance criteria
- [ ] Snapshot-during-box64-run → restore → the x86_64 program finishes with the same correct
      output as an uninterrupted run; verified across snapshots taken at several points.
- [ ] No box64-specific state is lost across restore (its code cache/metadata ride in RAM);
      any exception is documented in the nondeterminism inventory with a mitigation.

## Adversarial verification
Snapshot at the worst moment — during a `BOX64_DYNAREC_LOG`-confirmed block translation and
during an in-flight syscall — restore, and demand correct completion; a wrong result or crash
refutes. Take two snapshots of the same run at the same instruction count and diff them (via the
E6-T16 integrity hashes) — nondeterminism between supposedly identical points refutes and must
be logged as an E8 capture target. Confirm restore doesn't rely on any host state warmed by the
original run (fresh process, restore-only).

## Verification log
(empty)
