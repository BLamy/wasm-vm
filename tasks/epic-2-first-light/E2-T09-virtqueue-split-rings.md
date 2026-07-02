---
id: E2-T09
epic: 2
title: Virtqueue implementation — split rings, descriptor chain walking, used-ring notify
priority: 209
status: pending
depends_on: [E2-T08]
estimate: M
capstone: false
---

## Goal
A correct, hostile-guest-proof split-virtqueue implementation: descriptor table walking,
available-ring consumption, used-ring publication, and interrupt suppression flags — the
single ring engine every virtio device in the roadmap will reuse.

## Context
Spec 1.2 §2.7. Descriptor table: 16-byte entries `{ addr: le64, len: le32, flags: le16,
next: le16 }`, flags NEXT=1, WRITE=2 (device-writable), INDIRECT=4 (only if
`VIRTIO_F_INDIRECT_DESC` negotiated — decide: implement or don't offer; document).
Available ring: `{ flags: le16, idx: le16, ring: [le16; qsz] }` — idx is free-running
mod 2^16, *not* mod qsz. Used ring: `{ flags, idx, ring: [{ id: le32, len: le32 }; qsz] }`
where `len` is bytes *written by the device* (blk drivers check this). Processing order per
buffer: read avail idx, walk the chain (guest RAM reads through the bus, honoring physical
addresses), execute, write used element, then increment used idx, then assert interrupt
unless `avail.flags & NO_INTERRUPT`. Enforce: chain length ≤ queue size (loop detection),
descriptor `addr/len` fully inside DRAM, device-readable vs -writable segments respected.
Do not implement `VIRTIO_F_EVENT_IDX` in Epic 2 — don't offer it. Since we're
single-threaded WASM, "barriers" are ordering discipline in code, but write them as if the
JIT/SMP future is real (methods named for the fence points).

## Deliverables
- `crates/core/src/devices/virtio/queue.rs`: `Virtqueue` with
  `pop() -> Option<DescriptorChain>` and `push_used(head, written_len)`; chain exposes
  readable/writable segment iterators that bounds-check against the bus.
- Exhaustive unit tests using a synthetic guest-memory image: normal chains, max-length
  chains, wrap-around at idx 65535→0, NO_INTERRUPT suppression.
- Malformed-ring tests: self-loop, next out of range, addr beyond DRAM, len overflowing
  addr, avail idx jumping ahead by > qsz.

## Acceptance criteria
- [ ] All malformed-ring tests complete without panic/hang; device signals NEEDS_RESET (via
      a transport callback) on protocol violations, matching documented policy.
- [ ] idx wrap at 2^16 handled (test drives > 65536 buffers through a size-8 queue).
- [ ] used.idx is only incremented after the used element is fully written (asserted by
      test hooks ordering).
- [ ] Interrupt suppressed when NO_INTERRUPT set, delivered on next unsuppressed push.
- [ ] Green on native and `wasm32`.

## Adversarial verification
This is the top target for hostile-guest attacks. Write a fuzzer that generates random
descriptor tables/rings (valid ~50% of the time) and drives 10^5 pop/push cycles against a
null device — any panic, infinite loop (guard with instruction budget), or out-of-bounds
host access refutes. Cross-check semantics against QEMU's `virtio_queue_pop`: specifically
the treatment of a zero-length descriptor and of a chain whose readable segment follows a
writable one (spec says drivers won't, but device must not crash). After E2-T19 exists,
run `dd` stress and verify used `len` fields match what ext4 expects (a wrong written-len
shows up as blk request retries in dmesg — grep for it; presence refutes).

## Verification log
(empty)
