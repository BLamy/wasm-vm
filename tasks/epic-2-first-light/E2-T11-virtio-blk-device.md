---
id: E2-T11
epic: 2
title: virtio-blk device — request parsing, config space, status semantics
priority: 211
status: verified
depends_on: [E2-T09, E2-T10]
estimate: M
capstone: false
---

## Goal
A virtio-blk device (DeviceID 2) on the E2-T08 transport that the unmodified Linux
`virtio_blk` driver mounts as `/dev/vda`, correct through mkfs/fsck/mount/heavy-IO — the
root-filesystem workhorse for everything after this.

## Context
One request per descriptor chain: 16-byte header `{ type: le32, reserved: le32,
sector: le64 }` (device-readable), then data segments (readable for OUT/writes, writable
for IN/reads), then a 1-byte status footer (device-writable): `VIRTIO_BLK_S_OK`=0,
`IOERR`=1, `UNSUPP`=2. Types: IN=0, OUT=1, FLUSH=4 (sector must be 0), GET_ID=8 (20-byte
serial, pad with zeros), DISCARD=11 / WRITE_ZEROES=13 → return UNSUPP (features not
offered). Do not assume the header or data occupy single descriptors — Linux typically
sends header/data/status as separate descriptors, but the spec allows any segmentation,
including the header split across two descriptors; parse via the chain's byte-stream
iterators from E2-T09. `used.len` must be total device-*written* bytes (data-in + status
byte). Features to offer: `VIRTIO_F_VERSION_1`, `VIRTIO_BLK_F_FLUSH` (bit 9),
`VIRTIO_BLK_F_RO` (bit 5) when the backend is read-only. Config space: `capacity` le64 at
offset 0 (sectors); leave `blk_size`/topology unoffered. One request queue (queue 0),
QueueNumMax 256. Data len not a multiple of 512 → IOERR, not panic.

## Deliverables
- `crates/core/src/devices/virtio/blk.rs` implementing the E2-T08 `VirtioDevice` trait.
- Unit tests driving synthetic chains: all request types, segmented headers, oversized
  reads, RO-violation writes, FLUSH ordering (flush completes only after backend flush).
- Native CLI flag `--drive file=IMG[,ro]` wiring a FileBackend into slot 0.

## Acceptance criteria
- [ ] Under Linux (with E2-T15's kernel): `mkfs.ext4 /dev/vda`, mount, `dd` a 64 MiB file,
      umount, `fsck.ext4 -f` reports clean.
- [ ] GET_ID returns a stable serial visible at `/sys/block/vda/serial`.
- [ ] Write to an RO device: guest sees an I/O error (dmesg `I/O error, dev vda`), image
      hash unchanged, device stays functional for reads.
- [ ] Segmented-header unit test passes (header split 4+12 bytes across two descriptors).
- [ ] Tests green native and `wasm32`.

## Adversarial verification
Differential: run an identical guest script (mkfs, mount, fio-like dd patterns, md5sum of
files, umount, fsck) on QEMU virt and on wasm-vm with byte-identical starting images; diff
final image hashes — divergence refutes. Torture the parser: chains with status descriptor
marked device-readable, zero data segments on IN, sector beyond capacity, type=0xFFFFFFFF
— each must complete with IOERR/UNSUPP and the device must survive 10^4 such requests
interleaved with valid ones. FLUSH lie-detection: instrument the backend to count flushes;
mount ext4 with barriers, run sync-heavy workload, zero backend flushes refutes the
F_FLUSH claim. Kill the emulator mid-`dd` and fsck the image: metadata corruption beyond
journal replay refutes.

## Verification log

### 2026-07-05 — worker — implemented

**What landed.** `dev/virtio/blk.rs` (DeviceID 2; T08 transport + T09 rings + T10
storage): request engine parsing header/data/status via byte-stream cursors over the
chain's readable/writable segment lists (NO segmentation assumption — 4+12 split headers
parse identically, unit-proven). IN/OUT/FLUSH/GET_ID; DISCARD/WRITE_ZEROES/garbage →
UNSUPP; unaligned/OOR → IOERR never panic; no-writable-byte chain → transport
protocol_violation (NEEDS_RESET). used.len = device-written bytes. Features F_FLUSH +
F_RO-when-RO; config capacity le64 byte-granular. FLUSH enforces sector==0 + counts
backend flushes (the charter's lie-detector hook, exposed as BlkState::flush_count).
KICK PLUMBING: queue_notify fires inside a bus store → flag only; the run loop services
at the next boundary (deferred pattern); ring Violations degrade the slot and drop the
ring view; reset rebuilds. Machine::enable_virtio_blk; CLI --drive file=IMG[,ro] (mmap
FileBackend, CLINT+PLIC auto-enabled).

**Evidence:** 7 native full-stack tests (real rings in guest RAM, lifecycle over real
registers, kicks via the QueueNotify MMIO register, service through Machine::run):
OUT→IN round-trip with used.len bookkeeping + used-ring IRQ; segmented 4+12 header
(acceptance); GET_ID stable serial + used.len 21; FLUSH ok/sector≠0-IOERR + counter;
RO: F_RO offered, OUT→IOERR, image intact, reads still served; charter torture — 10^4
hostile requests (garbage type→UNSUPP, OOR sector→IOERR, unaligned IN→IOERR) interleaved
with valid INs, device never wedges, zero-data IN → IOERR; no-status-byte → NEEDS_RESET.
wasm32 mirror 1/1. Gates: fmt, clippy ±--all-features, both wasm legs 0 FAILED.

**Deferred honestly (acceptance #1/#2/#3 guest legs):** mkfs/mount/fsck under Linux,
/sys/block/vda/serial, and dmesg I/O-error checks require E2-T15's kernel boot — per the
acceptance text itself ("with E2-T15's kernel"). The QEMU differential (identical guest
script both sides) is likewise post-T15; the critic should attack the request engine
directly today.

### 2026-07-05 — verifier (cold critic) — REFUTED → fixed (stale ring view after reset)

**The refutation (real bug, Linux reboot/driver-reload path):** the Machine's cached
Virtqueue survived a transport reset — after Status=0 + full re-setup, the stale
last_avail_idx made pop() report idle and requests vanished SILENTLY (status byte stayed
at poison, no NEEDS_RESET); with relocated rings it would read freed ring memory and write
status bytes into whatever now lives there. The "reset rebuilds" claims in the module doc
and task log were written, not tested (the committed test's recovery clause was never
exercised). **Fix:** `BlkState::reset_pending` set by the transport-half reset, consumed
FIRST in service() (even without a kick) → cached view dropped; the critic's full
reset+re-setup repro is now a committed regression (`virtio_blk_torture.rs`, adopted
8-test suite).

**Confirmed by the critic:** spec §2.7.8.2 used.len conformance (ours = bytes written;
QEMU over-reports full writable size — known non-conformance, not Linux-observable since
virtio_blk ignores len); GET_ID both 21 full / short-room prefix+OK matching QEMU's
MIN(iov,20); FLUSH sector≠0 divergence acceptable (driver-side MUST; Linux always sends 0);
RO/OOR/unaligned → IOERR both sides. Torture 7/8 (the 8th being the refutation): 1+1+14
three-way split header; OUT across 5 odd-sized descriptors byte-exact; status straddling
descriptors; capacity-crossing IOERR with last-sector still readable; short GET_ID.
Kick semantics: kick-before-ready safe; N publishes+1 kick → all N; 1 publish+N kicks →
exactly one (no double execution). --drive: rw/ro boot hello.elf to exit 0; garbage/missing
→ clean exit 2. All gates green (34 wasm suites, 0 FAILED). Deferrals honest (mkfs/fsck/
serial/dmesg conditioned on E2-T15 by the acceptance text itself).
