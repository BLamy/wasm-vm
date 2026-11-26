---
id: E5-T41b
epic: 5
title: Publish Replay desktop generation 2 — compact warm snapshot captured after the Node snapshot
priority: 0.387653
status: implemented
depends_on: [E5-T41a, E5-T36b]
estimate: S
risk: medium
capstone: false
---

## Boundary

`tools/build-replay-desktop-snapshot.sh` (the compaction is one command line it types into the
serial root shell; revised: no script in the image), the published artifacts of the image E5-T36b and E5-T41a built (chunk manifest, whole
image, warm snapshot), `web/artifacts-replay-desktop.json`, the E5-T34c/E5-T34e harnesses where
they name the old generation, the roadmap, and the deploy.

Why: a RAM snapshot stores every page that is not zero, including pages the kernel has freed
and page cache nobody maps. Building Node's startup snapshot at boot leaves about 75 MiB of
both: captured as before, the warm image grows from 124.6 MB to 154.6 MB compressed. Measured
natively on 2026-11-26: dropping the unmapped page cache and zeroing free memory before the
capture gives 120.7 MB — smaller than today's, with the Node snapshot in it.

What changes: the capture waits for the monitor's `REPLAY_NODE_SNAPSHOT` line, then types
`sleep 30 && sync && echo 1 > /proc/sys/vm/drop_caches && node -e 0 && <zero free memory> && echo
REPLAY_DESKTOP_COMPACTED … || poweroff -f` into the serial root shell and fires on the line it
prints last. The 30 guest seconds let Chrome's delayed start-up
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

### 2026-11-26 — worker — claim (head `2528fecd4`)

Commits `6b16fe055` (manifest, capture script, equivalence script, the chunk manifest) and
`2528fecd4` (roadmap row, browser evidence). The image is the one E5-T41a's verifier checked
(`target/e5-t41a/image`, sha256 `20f03da7c51d…`), published under content-hashed names.

**Capture** (`bash tools/build-replay-desktop-snapshot.sh`, defaults now name generation 2;
`evidence/e5-t41b/capture/`): READY at 5.33 s, `REPLAY_NODE_SNAPSHOT bytes=6754398` at 9.74 s,
`REPLAY_DESKTOP_COMPACTED zeroed_mib=554` at 43.68 s, then the snapshot. **129,712,599 bytes
compressed** (limit 135 MB; generation 1 124.6 MB; uncaptured-as-before 154.6 MB). The working
disk's SHA-256 is unchanged after the capture; the privacy check passed on the raw and the
compressed snapshot. A boot whose Node line never comes ends at `MAX_INSTRS` (1e11, about 156
guest seconds) without a snapshot; a failed compaction powers the guest off.

**Browser, committed bundle** (`tools/serve-dist.sh 8125`):
- `E5_T34E_URL=http://127.0.0.1:8125 E5_T34E_APP=/app.html E5_T34E_OUT=evidence/e5-t41b/warm node tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold`:
  both pass (`warm.log`): warm, desktop visible 1.77 s after the downloads, Run again and a
  DOM-typed Node nonce answered; cold boot to the same results.
- `tools/perf/desktop-latency.mjs --scenarios click,type,node,idle --n 8 --idle-s 30`, two fresh
  loads a side, interleaved, against generation 1 on the SAME bundle (a clone of `web/dist` with
  the previous manifest, served on 8128): `evidence/e5-t41b/browser/gen{1,2}-{1,2}.json`.

| | gen 2 | gen 1 |
|---|---|---|
| node -e to prompt (median of 3) | 1690, 1653 ms | 4851, 4862 ms |
| click result (median of 8) | 258.1, 261.2 ms | 262.0, 270.2 ms |
| key echo | 45.0, 41.3 ms | 46.7, 45.7 ms |
| idle: wall time inside run slices | 1.2, 1.1 % | 9.7, 10.1 % |
| local image chunk reads over the run | 31 | 256 |

  `node -e` is 65 % faster (acceptance: 30 %); click and key echo not slower. "The first `node`
  of a session reads nothing from disk": NOT shown as stated — the run reads 31 chunks (8 MiB)
  from the in-memory image over all four scenarios, none from the network, and the script does
  not attribute them to the first `node`.

**Live site** after `bash tools/deploy-cloudflare.sh` (three R2 objects uploaded and verified:
chunk manifest, whole image, snapshot): the served manifest names generation 2; warm resume
passes (`evidence/e5-t41b/live.log`: desktop 1.78 s after downloads, Run again, Node answered);
`desktop-latency --url https://wasm-vm.pages.dev --app /app --n 6`: click 255.2 ms, key echo
46.4 ms, node -e 1551 ms, idle 1.7 % (`evidence/e5-t41b/live/latency.json`). The one console
error in every run is the favicon's 404.

**Not done:** the attack list's "compaction typed while the shell is not at a prompt" and
"memory pressure during the zeroing" were not exercised; the E5-T34c harness was not run.
