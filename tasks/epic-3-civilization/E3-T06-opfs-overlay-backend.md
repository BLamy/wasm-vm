---
id: E3-T06
epic: 3
title: OPFS overlay backend with sync access handles in a worker
priority: 306
status: pending
depends_on: [E3-T04]
estimate: M
capstone: false
---

## Goal
A `BlockBackend` on the Origin Private File System using `FileSystemSyncAccessHandle` inside
a dedicated worker: synchronous, low-latency block reads/writes to a real file, with
`flush()` mapped to `commit`. This is the expected performance winner over IndexedDB.

## Context
`createSyncAccessHandle()` is worker-only and takes an exclusive lock on the file — which
composes nicely with running the VM in a worker, but means the handle must be owned by
exactly one worker and released cleanly (`close()`) on shutdown, or subsequent opens fail
(interacts with T09 multi-tab). Layout options: (a) flat file sized to the full disk, sparse
where the OS supports it — simplest, offset = block*4096; (b) compact log/slab file + block
allocation table in a header. Start with (a) and measure actual disk usage via
`navigator.storage.estimate()`; note in code why, and leave (b) as a documented follow-up if
sparse files aren't sparse on a target browser. Feature-detect: OPFS sync handles exist in
2026 Chrome/Firefox/Safari, but detect at runtime and report capability to the backend
selector (T07) rather than assuming.

## Deliverables
- `OpfsBackend` implementing `BlockBackend`: open/create file per image id under an
  `overlays/` OPFS directory, sync read/write at block offsets, `flush()` on `commit`,
  `close()` on VM shutdown; `meta` sidecar file for version + base binding (T04).
- Runtime capability detection exported to JS (`opfs_supported()`).
- Browser integration test: write/reload/read-back identity, same shape as T05's.
- Microbench hook for T07 (same metrics as T05).

## Acceptance criteria
- [ ] Boot Alpine on `OverlayDisk`+`OpfsBackend`, write a file, `sync`, reload tab, file
      intact — on Chrome and one other engine (Firefox or Safari), both recorded in the log.
- [ ] T04 proptest suite (browser harness) passes byte-identical on `OpfsBackend`.
- [ ] `commit` calls `FileSystemSyncAccessHandle.flush()` and only then resolves.
- [ ] Reload without clean shutdown does not brick the overlay: the new session acquires
      the handle after the old worker is gone (document the retry/timeout strategy).
- [ ] On a browser profile with OPFS sync handles unavailable, `opfs_supported()` is false
      and construction returns a typed error (no crash).

## Adversarial verification
Kill the worker (terminate(), not clean close) mid-write-burst, reopen, and check per-block
atomicity of the readback; torn 4 KiB blocks refute. Try to open a second sync handle on the
same file from another worker while the first holds it — the error must be caught and typed.
Write at the file's far end (last block of a 4 GB virtual disk) and check `estimate()` to see
whether the file went dense; if the flat-file assumption silently costs 4 GB of quota on any
target browser and no code comment/fallback acknowledges it, refute. Run the T05 reload-kill
torture loop here too. Confirm `close()` happens on `poweroff` path (handle leak check:
immediate reopen succeeds).

## Verification log
(empty)
