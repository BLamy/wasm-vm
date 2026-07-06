---
id: E3-T09
epic: 3
title: Multi-tab safety via Web Locks single-writer and read-only mode
priority: 309
status: in_progress
depends_on: [E3-T05]
estimate: M
capstone: false
---

## Goal
Opening the VM in two tabs cannot corrupt the overlay: the first tab acquires an exclusive
Web Lock and runs read-write; any subsequent tab detects the held lock, boots (or offers to
boot) in explicitly read-only mode with a visible banner, and can take over write ownership
after the first tab closes.

## Context
**Groomed 2026-07-06:** re-depped E3-T07 → E3-T05 — multi-tab locking needs a durable
backend, not the backend *benchmark*. Doable against IndexedDB now; the OPFS handle
interplay below re-checks when E3-T06 lands (post E4-T22).

Two writers on one IndexedDB store or OPFS file is guaranteed corruption. Use
`navigator.locks.request("wasm-vm-disk-{image_id}", { mode: "exclusive" }, holder)` held for
the tab's lifetime — Web Locks auto-release on tab close/crash, which gives us clean
takeover without heartbeats. Second tab uses `{ ifAvailable: true }` to probe without
queueing (queueing would hang boot). Read-only mode: the overlay opens with writes rejected
at the `BlockBackend` seam and the virtio-blk device advertises `VIRTIO_BLK_F_RO` so the
guest mounts read-only cleanly instead of erroring on writeback. Note OPFS interplay (T06):
the sync access handle is itself exclusive, so the Web Lock must be acquired *before*
opening the handle, and read-only tabs must not open a sync handle at all (read via async
`getFile()` or fall back to base-image-only). Use `BroadcastChannel` to let a read-only tab
offer "take over" when the writer disappears.

## Deliverables
- Lock acquisition in the boot path (before backend open), holder released on `poweroff`.
- Read-only boot mode: RO flag through `OverlayDisk`, `VIRTIO_BLK_F_RO` in the device, UI
  banner "read-only: disk in use by another tab" with a working "retry as writer" button.
- BroadcastChannel writer-status messages + takeover flow.
- Browser integration test (two headless pages) covering: second-tab RO, writer close →
  takeover, simultaneous open race.

## Acceptance criteria
- [ ] Tab A boots rw; tab B opened during A shows the RO banner, guest in B mounts `/` ro
      (`mount` output shows `ro`), and writes in B's guest fail with EROFS, not corruption.
- [ ] Close tab A; B's "retry as writer" (or automatic prompt) succeeds and B mounts rw.
- [ ] Two tabs opened simultaneously (scripted, <50 ms apart): exactly one wins the lock;
      the other is RO. Repeated 20× in the integration test with no double-writer outcome.
- [ ] Kill tab A hard (process kill, not close event): B can take over within seconds
      (lock auto-release), and the overlay passes T08's fsck check afterward.
- [ ] RO tab never opens an OPFS sync access handle (assert via instrumentation).

## Adversarial verification
Race the lock: open 10 tabs at once in a loop; more than one active writer at any instant
(instrument backend writes with a tab id, scan for interleaving) refutes. While B is RO,
have A write and flush, then kill A, take over in B, and check B reads A's flushed data.
Try to bypass: call the JS boot API with a forged "have lock" flag — if the backend layer
doesn't independently verify lock ownership before opening writable state, note it; a
corruption-producing bypass reachable from normal UI refutes. Check the RO guest can still
be used (login works, reads fine) — an RO tab that just crashes is a refutation of the UX
claim.

## Verification log
(empty)

**2026-07-06 — single-writer core + race acceptance (pass 1).**
Implementation: exclusive Web Lock (`wasm-vm-disk-<manifest-url>`, auto-released on tab
close/crash — no heartbeats) acquired BEFORE the writable store opens; second tab probes with
`ifAvailable` (never queues — queueing would hang boot) and falls back to a READ-ONLY boot:
`ChunkedBackend::set_read_only()` refuses writes at the seam (`BlockError::ReadOnly`, before any
overlay/queue mutation), the device advertises `VIRTIO_BLK_F_RO` (pre-existing E2-T11 plumb), NO
persist pump is registered, an RO tab never writes IndexedDB (not even a fresh meta record), and
the kernel cmdline gets `root=/dev/vda ro rootflags=norecovery`. UI: RO banner + retry-as-writer;
writer lock explicitly released on clean halt (poweroff) so a waiting tab can take over; Web
Locks semantics cover the hard-kill path.

**Race acceptance MET (`multitab.spec.js` "race", 1 passed, 4.0 min): 20/20 simultaneous
dual-opens (<50ms apart) produced EXACTLY ONE writer every time** — no double-writer, no
double-RO. Seam unit test (`ro_tests`, wasm-native): RO backend serves reads incl. another tab's
persisted overlay blocks, refuses writes typed with zero queue mutation, reports is_read_only.

**Real bug found by the first dual-boot run:** the RO tab's overlay snapshot can carry a dirty
journal (the writer replays it in ITS memory only); ext4 REFUSES a ro mount needing recovery →
"Unable to mount root fs" panic. Fixed: RO boots mount `norecovery` (documented staleness
caveat — the right trade for a browse-only tab).

**Outstanding evidence (pass 2):** the full RO-guest dual-boot leg (B mounts / ro, EROFS on
write, takeover after A closes) — the fixed run was repeatedly killed by the environment
mid-execution (external process kills, several today); the spec (`multitab.spec.js` "RO guest")
is ready and re-runs unattended. Also outstanding: hard-kill takeover timing, 10-tab flood,
forged-flag bypass audit (critic charter items).
