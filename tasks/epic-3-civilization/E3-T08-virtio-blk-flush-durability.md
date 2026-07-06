---
id: E3-T08
epic: 3
title: Map virtio-blk flush to backend commit with crash consistency
priority: 308
status: in_progress
depends_on: [E3-T05]
estimate: M
capstone: false
---

## Goal
Honest durability: the device advertises `VIRTIO_BLK_F_FLUSH`, guest writes go through a
write-back cache in the overlay layer, and a `VIRTIO_BLK_T_FLUSH` request is only completed
on the used ring after `BlockBackend::commit` has durably resolved. Killing the tab at any
moment leaves an ext4 filesystem that mounts clean or journal-recovers — never fsck-fatal.

## Context
**Groomed 2026-07-06:** re-depped E3-T07 → E3-T05. The FLUSH→durable-commit ordering
contract only needs one durable backend (IndexedDB, verified in E3-T05); the "both
backends" crashtest line is re-run at E3-T07 when OPFS exists. Sequentially doable now.

This is where browser storage semantics meet what the Linux block layer believes. ext4's
journal correctness depends on flush barriers: if we ack FLUSH before the backend is durable,
a tab kill can produce a journal that lies, and fsck horror follows. Contract (per T04's
design doc): writes may sit in the in-core write-back queue indefinitely; FLUSH forces the
queue drained to the backend *and* `commit` (IDB strict-durability transaction complete /
OPFS `flush()`) before the FLUSH request's status byte is written and the used ring
advances. Ordering: a FLUSH must not be acked while any write that the guest completed
before issuing it is still undurable. Also implement a background trickle-writer (drain the
queue during idle) so an unflushed session doesn't accumulate unbounded dirty state.

## Deliverables
- Write-back queue in `OverlayDisk` with drain-on-flush; `VIRTIO_BLK_T_FLUSH` handling in
  the virtio-blk device wired to it; feature bit `VIRTIO_BLK_F_FLUSH` negotiated.
- Idle trickle-drain with a max-dirty-bytes threshold that forces a drain.
- `tools/crashtest.md` + script: automated tab-kill loop (headless Chrome, CDP `Target.
  closeTarget` at randomized delays during a guest write workload), reboot, run `fsck.ext4
  -f -n` in the guest, assert clean/recovered.
- Native test with a mock backend asserting the ordering contract (no FLUSH ack before
  prior writes' commit futures resolve).

## Acceptance criteria
- [ ] Guest `dmesg` / feature negotiation shows the flush feature; `sync` in the guest
      produces exactly one backend `commit` (instrumented counter).
- [ ] Ordering test passes: a delayed commit future provably delays the FLUSH used-ring
      completion.
- [ ] Crashtest: ≥30 randomized tab-kills during `while :; do cp -r /usr /root/x; sync; rm
      -rf /root/x; done` → every reboot mounts rw and `fsck.ext4 -n` reports clean or
      journal-recovered; zero corrupted-data outcomes. Results appended to the log.
- [ ] Dirty-bytes threshold forces a drain (test with threshold set tiny).
- [ ] The IndexedDB backend (`?backend=idb`) passes the crashtest loop (≥10 kills). (The
      both-backend re-run moved to E3-T07 — OPFS lands after E4-T22; groomed 2026-07-06.)

## Adversarial verification
Your job is to corrupt the filesystem. Run the crashtest with kills timed by instrumentation
to land *between* backend write completion and commit resolution, and *immediately after*
FLUSH ack. Add a hostile mock backend whose `commit` resolves before data is actually
recorded (simulating a buggy backend) and confirm the ordering test catches it. Check for the
classic cheat: acking FLUSH when the write-back queue is empty without awaiting the previous
commit's durability. Kill during the *idle trickle drain* specifically. Any boot that needs
manual fsck, any file with mixed old/new content across a flush boundary, refutes.

## Verification log

**2026-07-06 — ordering-contract core (pass 1), PR stacked on the backlog-oci branch.**
The honest-durability seam, native-testable end to end:
- `PersistQueue::barrier()/barrier_clear()` (crates/storage/writeback.rs): a FLUSH barrier is
  the pending block set at issue time; satisfied when every barrier block has left the queue.
  Post-barrier writes don't extend it; a barrier block RE-written mid-flush keeps the barrier
  held (the pre-flush version never became durable — the generation guard makes a lying
  `mark_persisted` unable to clear it, which is the built-in hostile-commit defense).
- `OverlayBackend::{durability_barrier, barrier_clear}` (default: always durable — MemOverlay
  and other sync backends unaffected) + `WriteBackOverlay` override via its shared queue;
  threaded through `OverlayDisk`.
- `BlockError::FlushPending` (crates/core/block.rs) + blk.rs `ParkReason::{Chunk, Flush}`
  refactor: T_FLUSH parks on FlushPending exactly like lazy reads/writes park on chunks —
  used ring untouched, no status byte, retried each boundary, completed exactly once when the
  barrier clears. `pending_chunks()` filters Flush parks (never reported to the fetch layer);
  `flush_waiting()` exposes the state; transport reset discards parked FLUSHes with the rest.
- `ChunkedBackend::flush()` holds ONE barrier across retries (never re-takes it — continuous
  guest writes cannot extend the wait/livelock the FLUSH).

Tests: storage barrier suite (3 — taken/cleared, post-barrier non-extension, re-dirty keeps
waiting); core `virtio_blk_flush.rs` (3 — **the acceptance ordering test**: a delayed commit
provably delays the used-ring completion (status byte poisoned + verified untouched while
parked; ack lands exactly once on the boundary after the commit resolves, commit counter = 1),
immediate-ack when durable, transport reset discards a parked FLUSH with no stale ack);
wasm-native `flush_barrier_over_writeback_overlay` (FlushPending→drain barrier only→Ok while a
newer write stays pending→new flush covers it). Gates: clippy 0 / determinism / core+storage(51)
suites / wasm32 builds all green. `VIRTIO_BLK_F_FLUSH` was already advertised (E2-T11);
`flush_count` documents attempt-counting semantics (tests read the backend's own commit counter).

**Remaining (pass 2):** wasm pump prioritization when `flush_waiting()` (persistPending already
runs per tick), dirty-bytes threshold force-drain + idle trickle documentation, `tools/crashtest`
tab-kill loop (IDB backend, ≥10-30 kills → fsck clean/recovered), guest `sync` → exactly-one-
commit instrumentation check in-browser. OPFS-backend crashtest re-run deferred to E3-T07 (groomed).
