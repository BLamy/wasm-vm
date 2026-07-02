---
id: E2-T11
epic: 2
title: virtio-blk device — request parsing, config space, status semantics
priority: 211
status: pending
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
(empty)
