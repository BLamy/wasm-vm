---
id: E5-T41b
epic: 5
title: Publish Replay desktop generation 2 — compact warm snapshot captured after the Node snapshot
priority: 0.387653
status: pending
depends_on: [E5-T41a, E5-T36b]
estimate: S
risk: medium
capstone: false
---

## Boundary

`tools/build-replay-desktop-snapshot.sh`, `rootfs/usr/local/sbin/replay-desktop-compact`
(new), the published artifacts of the image E5-T36b and E5-T41a built (chunk manifest, whole
image, warm snapshot), `web/artifacts-replay-desktop.json`, the E5-T34c/E5-T34e harnesses where
they name the old generation, the roadmap, and the deploy.

Why: a RAM snapshot stores every page that is not zero, including pages the kernel has freed
and page cache nobody maps. Building Node's startup snapshot at boot leaves about 75 MiB of
both: captured as before, the warm image grows from 124.6 MB to 154.6 MB compressed. Measured
natively on 2026-11-26: dropping the unmapped page cache and zeroing free memory before the
capture gives 120.7 MB — smaller than today's, with the Node snapshot in it.

What changes: the capture waits for the monitor's `REPLAY_NODE_SNAPSHOT` line, then types
`sleep 30; /usr/local/sbin/replay-desktop-compact || poweroff -f` into the serial root shell and
fires on the line the script prints last. The 30 guest seconds let Chrome's delayed start-up
work pass (measured: 1.65 s of guest CPU between uptime 11 s and 21 s, then under 0.1% for
minutes), so a resumed desktop is idle from its first second — under the paced clock that work
would otherwise run in the user's first real half minute. The script drops the unmapped page
cache, starts node once so its start path is cached again, and zeroes free memory. A boot
whose Node snapshot failed, or whose compaction cannot run, is never captured.

## Deterministic acceptance

- `bash tools/build-replay-desktop-snapshot.sh` on the generation-2 image writes a snapshot
  whose compressed size is at most 135 MB (generation 1: 124.6 MB without the Node snapshot;
  the same image captured as before, without compaction: 154.6 MB); the disk is unchanged
  after the capture; the privacy check passes on the raw and compressed snapshot.
- Browser, committed bundle: `tools/verify/e5-t34e-replay-desktop-warm.mjs` passes on the new
  generation (warm resume to a usable desktop, cold fallback).
- `tools/perf/desktop-latency.mjs --scenarios click,type,node,idle --n 8`, two fresh loads,
  against generation 1 on the same bundle: `node -e` to prompt at least 30% faster; click and
  key echo not slower; the first `node` of a session reads nothing from disk.
- Live site after deploy: the desktop resumes warm and `node -p process.version` answers.

## Adversarial verification

Medium risk (deployment claim: cold clone of the tooling path). Attack list: a capture run
where the Node line never comes; the compaction typed while the shell is not at a prompt;
memory pressure during the zeroing (48 MiB margin); a resumed desktop whose first click or
first `node` is slower than generation 1's; stale generation-1 URLs left in the manifest or
the service worker cache; artifacts over Cloudflare's 25 MiB per-file limit. One bounded novel
attack.

## Verification log
