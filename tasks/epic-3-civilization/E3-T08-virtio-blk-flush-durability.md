---
id: E3-T08
epic: 3
title: Map virtio-blk flush to backend commit with crash consistency
priority: 308
status: pending
depends_on: [E3-T07]
estimate: M
capstone: false
---

## Goal
Honest durability: the device advertises `VIRTIO_BLK_F_FLUSH`, guest writes go through a
write-back cache in the overlay layer, and a `VIRTIO_BLK_T_FLUSH` request is only completed
on the used ring after `BlockBackend::commit` has durably resolved. Killing the tab at any
moment leaves an ext4 filesystem that mounts clean or journal-recovers — never fsck-fatal.

## Context
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
- [ ] Both backends (`?backend=idb`, `?backend=opfs`) pass the crashtest loop (≥10 kills each).

## Adversarial verification
Your job is to corrupt the filesystem. Run the crashtest with kills timed by instrumentation
to land *between* backend write completion and commit resolution, and *immediately after*
FLUSH ack. Add a hostile mock backend whose `commit` resolves before data is actually
recorded (simulating a buggy backend) and confirm the ordering test catches it. Check for the
classic cheat: acking FLUSH when the write-back queue is empty without awaiting the previous
commit's durability. Kill during the *idle trickle drain* specifically. Any boot that needs
manual fsck, any file with mixed old/new content across a flush boundary, refutes.

## Verification log
(empty)
