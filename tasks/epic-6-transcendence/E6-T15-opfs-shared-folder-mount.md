---
id: E6-T15
epic: 6
title: OPFS-backed shared folder — HostFs over the Origin Private File System
priority: 615
status: pending
depends_on: [E6-T14]
estimate: M
capstone: false
---

## Goal
A browser `HostFs` implementation over OPFS so the guest gets a persistent shared folder
at `/mnt/opfs` that survives reloads, with the sync-access-handle plumbing, metadata
synthesis, and mount UX that make it feel like a normal directory rather than a browser
API with a filesystem costume.

## Context
OPFS constraints shape the design: `createSyncAccessHandle()` (the only fast path) works
solely in dedicated workers and takes an *exclusive lock per file* — but guests routinely
open one file from several processes, so the backend needs a handle pool: one sync handle
per file, multiplexing all guest fids over it, LRU-evicting closed-and-idle handles
(quota on open handles is finite). OPFS stores no POSIX metadata — mode/uid/gid/mtime
must be synthesized and persisted in a sidecar map (a single `.wasmvm-meta.json`-style
file or IndexedDB record; document the choice and its crash-consistency). Names: no `/`
or NUL, some platforms reject reserved names — surface EINVAL cleanly. Capacity comes
from `navigator.storage.estimate()`, durability from `navigator.storage.persist()`.
The 9p server from E6-T14 runs where the device worker runs; OPFS calls land on a
dedicated FS worker via the async bridge established for the block device in Epic 3.

## Deliverables
- `hostfs/opfs.rs` implementing `HostFs` with the handle pool, sidecar metadata store,
  and directory-handle cache; statfs mapped from `storage.estimate()`.
- Mount UX: machine config flag adds the 9p device with tag `opfs`; guest image gains an
  fstab entry / init hook mounting it at `/mnt/opfs`; docs page with quota + persistence
  guidance (how to request persistent storage, what eviction means).
- Import/export affordances on the host page: drag-and-drop a file into the terminal
  area lands it in `/mnt/opfs/inbox/`; a download button exports a chosen guest path.
- Throughput benchmark harness (guest `dd` + host timing) recorded in `bench/`.

## Acceptance criteria
- [ ] Write a file in `/mnt/opfs`, hard-reload the tab, boot, and the file is intact
      with the same sha256, mtime (within 2s), and mode bits.
- [ ] `chmod 600`, `chown` (within guest-visible synthesized ids), and `touch -d` values
      round-trip across reload via the sidecar store.
- [ ] Two guest processes appending to the same OPFS-backed file concurrently produce
      correctly interleaved (no lost write) output through the single-handle multiplexer.
- [ ] Sequential read ≥ 50 MB/s and write ≥ 30 MB/s for a 200 MB file on a documented
      reference machine (Chrome; numbers recorded in bench/).
- [ ] fsstress 10 minutes on `/mnt/opfs` with zero backend errors; quota exhaustion
      (fill to estimate) surfaces as ENOSPC in the guest, not a hang or panic.

## Adversarial verification
Attack the handle pool: open 3,000 distinct files from a guest script (exceeding any
plausible handle quota) and verify eviction keeps the mount functional; then hold 100
files open with active writes while opening 3,000 more — a deadlock or dropped write
refutes. Attack crash consistency: kill the tab (task-manager kill, not clean unload)
mid-`dd` and after a metadata-only change; on reboot the file may be short but the
filesystem must mount and the sidecar must not be corrupt (a poisoned metadata store
that breaks *all* files refutes). Attack names: guest creates files named `con`, `a:b`,
250-char names, trailing dots, emoji — each either works or fails with EINVAL; a
server panic refutes. Verify the exclusive-lock story in a second tab running the same
origin simultaneously (two VMs, same OPFS folder): the second mount must degrade with a
clear error, not silently corrupt. Re-run the E6-T14 pjdfstest subset here and diff
failures against the documented OPFS limitation list — any undocumented failure refutes.

## Verification log
(empty)
