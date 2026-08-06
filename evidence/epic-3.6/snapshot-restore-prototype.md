# Epic 3.6 — snapshot-restore-instead-of-boot: prototype proof (native)

**Goal:** get the container host "ready" in seconds, not minutes, by restoring a
build-time snapshot instead of re-executing the Linux boot.

**Mechanism (already in-tree):** `Machine::save_resume()`/`load_resume()` full-machine
serialize/restore (RAM + hart + CSR + PMP + devices), exposed on the CLI via
`--snapshot-trigger <marker> --snapshot-out <file>` and `--resume-from <file>`. Same
serialization the browser already uses for E3-T12 persistence.

## Measured (native, release, busybox guest)
| Path | Wall time to live guest |
|---|---|
| Boot to `busybox userland up` (one-time snapshot capture) | **42.1 s** (~380M instrs) |
| **Restore via `--resume-from`** | **0.96 s** → resumes at `~ #`, runs commands |

- Snapshot size: **35.7 MB** uncompressed (RAM 256 MiB image; compressible to ~5–10 MB).
- Restore proven LIVE: post-restore the guest runs `echo`/`uname`/`cat /proc/uptime`.
- Speedup vs busybox boot: **~44×**. Against Alpine's ~3B-instruction / ~27-min boot the
  same restore is ~1–2 s → **~1000×**.

## Takeaway
Restore-instead-of-boot is the dominant lever and it already works. Remaining work is the
browser path: ship a build-time snapshot as a versioned artifact (like the kernel Image),
fetch+cache (IndexedDB/OPFS), and restore on load instead of booting; re-seed time
(E4-T24 TimeSource) / RNG / network. Minimal "docker-host" image shrinks the snapshot;
lazy/streaming restore takes first-interactive sub-second.
