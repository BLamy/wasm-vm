---
id: E6-T14
epic: 6
title: virtio-9p device and 9P2000.L server over a host filesystem trait
priority: 614
status: pending
depends_on: [E5]
estimate: L
capstone: false
---

## Goal
A virtio-9p device (virtio device id 9) with a 9P2000.L protocol server backed by a
`HostFs` trait — mountable from the guest with `mount -t 9p -o trans=virtio` — giving
the machine its first shared-folder mechanism and the backend seam that E6-T15 (OPFS)
and the embedding SDK's file injection will plug into.

## Context
9P2000.L is the Linux-flavored dialect: errors are Rlerror carrying errno; opens use
Linux open-flag values (Tlopen/Tlcreate); Tgetattr/Tsetattr use request/valid masks over
a stat-like struct. Required message set: Tversion (negotiate `9P2000.L` + msize),
Tattach, Twalk (fid cloning, ≤16 names), Tlopen, Tlcreate, Tread/Twrite (clamped to
msize - 24), Treaddir (dirents = qid+offset+type+name, offset is an opaque resume
cookie), Tgetattr, Tsetattr, Tmkdir, Tsymlink, Treadlink, Tlink, Trenameat, Tunlinkat,
Tfsync, Tstatfs, Tclunk; Txattr* and Tlock/Tgetlock may return ENOTSUP/success-if-
uncontended but must not break mounts. qid.path must be a stable unique id per file
(host inode natively; a persistent path→id map for backends without inodes). Config
space carries the mount_tag. Mount line: `mount -t 9p -o trans=virtio,version=9p2000.L,
msize=131072 hostshare /mnt/host`.

## Deliverables
- `devices/p9.rs`: virtio transport glue (single queue), message framing, fid table,
  msize negotiation with hard cap tied to virtqueue descriptor limits.
- `p9/server.rs`: the message set above against `trait HostFs` (open/read/write/readdir/
  stat/set-times/mkdir/rename/unlink/symlink/statfs...), with a native `StdFs` impl
  rooted at a host directory (path-escape-proof: every resolved path is verified to stay
  under the root, symlinks resolved host-side never escape).
- Error mapping table (io::ErrorKind → errno) with tests.
- Guest test scripts: mount, then run fsstress (from LTP) and a pjdfstest subset against
  the mount; host-side golden tests for framing (captured byte-level exchanges).

## Acceptance criteria
- [ ] Guest mounts with the documented line; `dmesg` shows negotiated version 9p2000.L
      and msize; mount survives `umount` + remount cycles.
- [ ] Correctness battery in-guest passes: create/read/write/append/truncate, mkdir -p,
      rename across dirs, symlink + readlink, hard link count via `stat`, `dd` of a
      100 MB file with matching sha256 on both sides, readdir of a 10,000-entry
      directory (paginated Treaddir) listing exactly 10,000 names.
- [ ] fsstress runs 10 minutes with zero server panics and zero kernel 9p errors.
- [ ] A guest path like `/mnt/host/../../etc/passwd` and a crafted Twalk with `..`
      components cannot read outside the shared root (unit + in-guest tests).
- [ ] Same server code passes the framing golden tests natively and under wasm32.

## Adversarial verification
Attack the protocol layer with a raw client (no kernel): replay captured exchanges with
mutated lengths, fids, and offsets — truncated Twrite counts, fid reuse after Tclunk,
Twalk with 17 names, msize-exceeding Tread requests; any panic, hang, or over-long reply
refutes. Attack path escape seriously: symlink inside the share pointing to `/`, rename
races that move a directory out from under an open fid, `..` walks from the root fid,
NUL and `/` bytes inside names. Attack concurrency: two guest processes appending to one
file through separate fids — interleaved corruption beyond POSIX append semantics
refutes. Diff behavior against QEMU's virtfs (`-fsdev local,security_model=none`) for 20
scripted operations including error cases (unlink open file, rmdir non-empty) — errno
divergences refute. Pull the host directory out from under the server mid-run (delete a
file host-side) and verify graceful EIO/ENOENT rather than panic.

## Verification log
(empty)
