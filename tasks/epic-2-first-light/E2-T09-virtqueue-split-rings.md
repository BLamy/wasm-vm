---
id: E2-T09
epic: 2
title: Virtqueue implementation — split rings, descriptor chain walking, used-ring notify
priority: 209
status: verified
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

### 2026-07-05 — worker — implemented

**What landed.** `crates/core/src/dev/virtio/queue.rs` (dev/ is the codebase convention):
`Virtqueue` (built from the T08 transport QueueState; size must be a nonzero power of two
≤ max), `pop() -> Result<Option<DescriptorChain>, Violation>`, split fence-point used
publication — `write_used_element` THEN `publish_used_idx` (named for the §2.7.13 ordering;
`push_used` composes them), `interrupt_needed()` honoring avail.flags NO_INTERRUPT.
`DescriptorChain` exposes readable()/writable() segment iterators + writable_len(); every
segment is bounds-checked against DRAM through the bus. Policy documented in the module
docs: INDIRECT not offered → Violation; EVENT_IDX not offered; readable-after-writable →
Violation (mirrors QEMU "Incorrect order for descriptors"); zero-length descriptors
tolerated with unchecked addr (no byte touched — QEMU maps them empty). Violation → the
transport's new `protocol_violation()` (NEEDS_RESET + config-change, the documented T08
policy).

**Evidence (native 8/8, wasm mirror 1/1):**
- normal chain pop/used publication with driver-order segments + counts;
- fence ordering asserted via the split methods (element visible, idx unchanged, then idx);
- **2^16 wrap: 70,000 buffers through a size-8 queue** (used.idx == 70000 mod 65536);
- NO_INTERRUPT suppression + delivery when clear;
- **full malformed matrix**: self-loop→ChainTooLong, next/head ≥ qsz→BadDescIndex, addr
  past DRAM & addr+len wrapping 2^64→BadAddress, avail.idx jump > qsz→AvailIdxJump,
  INDIRECT→Indirect, readable-after-writable→BadOrder, size 0/6/512→BadQueueSize;
- zero-length + max-length (== qsz) chains;
- **charter fuzzer**: 10^5 rounds, ~50% hostile tables (random addr/len/flags/next) vs
  ~50% valid random chains — no panic, no hang (pop is ≤ qsz hops by construction), no OOB
  (all access via the checked bus); sanity: >1000 pops AND >1000 rejections. (Round-1
  self-catch: the fuzz driver itself had an AvailIdxJump bug — fresh queue vs cumulative
  seq — fixed in the driver, not the engine.)
- Gates: fmt, clippy ±--all-features, both wasm legs 0 FAILED.
- Deferred honestly: QEMU virtio_queue_pop semantics were mirrored from its documented
  behavior (zero-len, order error) — the critic should verify against the actual source;
  dd/ext4 written-len stress → E2-T19 per the charter.

### 2026-07-05 — verifier (cold critic) — REFUTED → fixed (QEMU zero-len parity)

**The refutation:** the landed docs/tests/log claimed "zero-length descriptors are
tolerated (QEMU maps them empty)" — the critic fetched hw/virtio/virtio.c and falsified
it: `virtqueue_map_desc` errors "zero sized buffers are not allowed" and marks the device
broken. Not Linux-observable (blk never submits zero-len SG), but the justification
asserted the opposite of QEMU's real behavior in three places. **Fix: true QEMU parity —
`Violation::ZeroLenBuffer`**, test flipped to `zero_length_descriptor_rejected_like_qemu`,
docs corrected.

**Everything else CONFIRMED by the critic:**
- QEMU differential all-match: BadOrder ≙ "Incorrect order" (same NEEDS_RESET+config class
  via virtio_error), chain guard boundary identical (max = vring.num), fill/flush ≙ our
  write_used_element/publish_used_idx split (QEMU smp_wmb between), num_heads/get_head
  boundaries ≙ AvailIdxJump/BadDescIndex, unmappable addr ≙ BadAddress.
- Byte-precise §2.7.6 test: pop reads exactly AVAIL+4+2*slot and writes ZERO ring bytes;
  push_used touches exactly USED+2..4 and USED+4+8*slot..+8 with LE layout {id,len} —
  every other byte proven untouched.
- Persistent-queue fuzz: ONE queue, 10^5 rounds, cumulative seq across the 2^16 wrap,
  interleaved hostile mutations (idx backward, +size+7 jumps, mid-stream desc rewrites,
  rings at DRAM edges/overlapping) — invariant used.idx == push count mod 2^16 held every
  round; misaligned bases → BadAddress; no panic/hang/OOB.
- Violation semantics: last_avail_idx not advanced on error — deterministic re-error and
  correct resume after ring repair (consistent with NEEDS_RESET rebuild).
- Advisories fixed same commit: publish_used_idx shadow-divergence-on-Err documented;
  protocol_violation() now pinned by a committed transport test
  (`protocol_violation_degrades_loudly`: NEEDS_RESET + CONFIG_CHANGE + line high +
  generation bump + reset recovery).
- Gates green (both wasm legs re-verified with case-sensitive FAILED grep).
