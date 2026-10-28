---
id: E9-T22s
epic: 9
title: Attribute the original cold desktop's first virtio block I/O error
priority: 524.92202985
status: in-progress
depends_on: [E9-T22o]
estimate: S
risk: high
capstone: false
---

## Goal

Identify the first guest-visible rejected virtio-blk request in the unchanged
Omarchy cold recording, before deciding whether a disk defect is implicated in
the later compositor failure.

## Boundary

Diagnostic observation only. Authenticate an original saved checkpoint before
the guest's first vda/EXT4 I/O error, then replay that exact guest in a private
offline owner. Instrument only the request/result observation path, without
changing request validation, completion, guest state, source image, clock,
cadence, renderer, frozen workload, or production replay policy. Do not infer
that the disk error caused Hyprland's later backend crash. The E9-T22o exact
25.2B no-frame frontier and post-input crash report remain intact.

## Acceptance criteria

- [ ] Independently authenticate the source checkpoint, RAM ancestry, device
  and disk state, physical renderer, pending queues, and source code/asset
  receipts before executing any guest instruction.
- [ ] At the first rejected virtio-blk request, record the exact transition and
  guest witness digest, type, sector, requested byte length, disk capacity and
  checked range, backend result or pre-backend refusal, COW sector count
  before/after, and whether the descriptor was parked or completed `S_IOERR`.
  Tie that event to the first kernel vda/EXT4 error in the serial stream; never
  equate a `WouldBlock` park with an I/O error.
- [ ] Prove the diagnostic did not change the architectural run: compare exact
  state and guest-output witnesses with the original recorded checkpoint(s),
  retain zero browser/guest egress and unchanged source-graph digest, and
  classify the failure as a concrete runtime or guest-side path. If no first
  rejection can be reproduced from the authenticated prefix, report an exact
  witness divergence rather than guessing a cause.

## Deterministic acceptance

`make verify-E9-T22s` against the pinned E9-T22r recovered graph and complete
offline base cache, producing a bounded browser report, request trace, source
and output digests, and a negative input-integrity test. A fresh Daybreak Blue
verifier must examine the trace and the changed diagnostic path at the exact
code head before this task reaches `verified`.

## Adversarial verification

Attempt a 1 MiB transfer at the session maximum, an out-of-range write, a COW
capacity park, an unavailable base chunk, and a malformed descriptor. Distinguish
each from the actual first rejected request using the status byte, used-ring
commit and backend return. Corrupt an unrequested base chunk and one RAM delta;
refuse both before execution. Check that instrumentation cannot repair or mask
the observed error and that the original guest witness still matches.

## Verification log

### 2026-10-28 — worker — prerequisite opened

E9-T22o was independently verified at report SHA-256
`5cb0ab6386e534f5d7711d57ca2544a4efa721ff82e87204e1ba810f249e737b`.
Its unchanged guest had no qualifying first frame by 25.2B. Only after
diagnostic input did trusted journal records show Hyprland PID 341 failing
`CBackend::create()`; the source guest console also preserves a vda write I/O
error at sector 24,928,880 and an EXT4 write error for inode 177851. The
request length and backend outcome are absent from that evidence. This slice
must identify the exact first block rejection before a semantic fix or a
first-frame allowance can be selected.
