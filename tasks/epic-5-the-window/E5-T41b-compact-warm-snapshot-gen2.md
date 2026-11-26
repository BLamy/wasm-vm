---
id: E5-T41b
epic: 5
title: Publish Replay desktop generation 2 — compact warm snapshot captured after the Node snapshot
priority: 0.387653
status: refuted
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

### 2026-11-26 — verifier — VERDICT: refuted

Fresh session; did not implement. Head `e1b3aafd6`; diff `9a2677a20..HEAD`. Predictions were written
before any run (`evidence/e5-t41b/verifier/predictions.md`). Everything I produced is in
`evidence/e5-t41b/verifier/`.

- **"The first `node` of a session reads nothing from disk" — FAILED.** I predicted it would not
  hold (P9). I resumed the published snapshot natively (`first-node-native-console-log.sh`, same
  flags as the capture plus `--resume-from`) and read `/sys/block/vda/stat` before and after the
  first `node -e "console.log(6*7)"` (the latency script's first node). Reads went from 8789 to
  8799 and sectors from 618498 to 619650: **10 requests, 576 KiB** read from the root disk
  (`first-node-native-console-log.log:8-9`). In a second resume (`first-node-native.log:9-12`)
  the first `node -e 0` read 0 (8789 to 8789). That is the exact command the compaction runs
  first, so only that command's start path is cached. The `node -p process.version` after it then
  read 7 requests (488 KiB, 8789 to 8796). This matches the browser count (31 local chunk reads
  per session in both of my gen-2 loads). The script comment
  (`tools/build-replay-desktop-snapshot.sh`, "the first `node` of a resumed session reads nothing
  from disk") and the acceptance line are therefore false for an ordinary first `node`. Demand:
  either warm the path an ordinary first run takes (for example run `node -e 'console.log(1)'` and
  `node -p process.version` in the compaction instead of `node -e 0`), recapture, redeploy, and
  show 0 reads across a fresh first `node -e 'console.log(6*7)'` with the native
  `/sys/block/vda/stat` method above; or get the planner to change the acceptance line. The worker
  cannot rewrite it to pass.
- **Size ≤ 135 MB, disk unchanged, privacy — HELD.** Published snap.gz is 129,712,599 B. My
  independent capture rerun (scratch dirs, about 188 s) gave 129,771,281 B, "disk unchanged
  after capture: 20f03da7c51d…", and privacy OK on raw and gz (`rerun-run.log`,
  `rerun-snapshot.json`). The markers come in order: NODE at 9.73, COMPACTED at 43.72,
  zeroed_mib=554 (`rerun-native-capture.log`).
- **Artifacts and public R2 — HELD (P1, P2).** The local files match the manifest in size and
  SHA-256, including the gunzipped image (20f03da7c51d…) and snapshot (5020fb05…)
  (`local-artifacts.log`). The live manifest at https://wasm-vm.pages.dev has the committed
  digests. Each of the four R2 objects (kernel, chunk manifest, whole image, snapshot) was fetched
  from its live URL; sizes and SHA-256 match, before and after gunzip. All 1784 chunk hashes
  match `target/e5-t41a/image` (`r2-artifacts.log`: ALL OK).
- **Browser warm/cold, committed bundle — HELD (P7).** 8125 hashes the same as `web/dist`. Warm
  PASS: desktop 1789 ms after the downloads; Run again and the Node nonce answered. Cold PASS
  (`warm.log`). Requests name only 20f03da7c51d / 2d4d38924d83, and no generation-1 name appears
  (`warm/*/requests.json`).
- **Latency vs generation 1 — HELD (P8).** Four loads of my own, interleaved ABBA, on 8128
  (gen 1, the same bundle with the previous manifest; only the manifest, roadmap row, sw VERSION
  and tasks.json differ) and 8125 (`latency/gen{1,2}-{a,b}.json`). node -e to prompt: 1603 and
  1608 ms against 4572 and 4529 ms, about 65 % faster. Click answered: 255.7 and 259.5 against
  278.6 and 255.0. Key echo: 45.6 and 49.9 against 41.6 and 46.1. Pooled over all 8 loads a side
  (worker's and mine, `latency/pooled.txt`): click answered median 258.2 against 266.5 ms, key echo
  median 44.3 against 45.3 ms, so not slower. Idle in-slice time is 1.5 % against 10.4–10.7 %.
- **Live site — HELD (P12).** In a fresh profile, https://wasm-vm.pages.dev/app resumed warm: desktop
  1779 ms after the downloads, Node answered `v26.13.1`. The only console error is the
  favicon.ico 404 (`live.log`, `live/warm/`).
- **Node line never comes — HELD (behaviour); prediction detail FAILED.** With MAX_INSTRS=4e9 the
  boot ends after READY and before the Node line. The script exits non-zero (102), writes nothing
  to OUT_DIR, removes WORK_DIR and leaves no feeder (`no-node-line-run.log`). The guard at
  `tools/build-replay-desktop-snapshot.sh:111` that prints "never reported its Node startup
  snapshot" never runs on that path: under `set -euo pipefail` the script exits with the boot's
  code first. That is harmless but misleading. Nit.
- **Compaction typed while the shell is not at a prompt — HELD (not driven adversarially).** In
  both captures the root prompt appears at 0.89 s, before the monitor starts. The typed line is
  echoed after the Node line, and only the real `REPLAY_DESKTOP_COMPACTED` line fires the trigger.
  The `COMPACT''ED` split works (`rerun-native-capture.log`). The tty queues input whatever the
  shell is doing. I did not build a busy-shell case.
- **Memory pressure during zeroing — HELD.** Neither capture log has an OOM, allocation-failure or
  segfault line. The resumed desktop is usable (warm PASS). The first `node -e 0` after resume
  read 0 blocks, so the dd did not evict node's cached pages. MemFree after resume is 611 MB
  (`first-node-native.log`).
- **Stale gen-1 URLs and service-worker cache — HELD, with one observation.** No tracked file
  under `web/` or `web/dist` (other than tasks.json) names 2af6100e9b37 or dfcf85c2c260. Bounded
  novel attack (`sw-upgrade.mjs`, `sw-upgrade.log`): a returning visitor with the real SW
  enabled (the e5-t34e harness blocks it) loads gen 1 twice, the server then switches to
  `web/dist` on the same origin, and the visitor loads twice more. The first post-deploy load
  still fetches the gen-1 snapshot and chunk manifest, because the old SW serves the
  same-origin manifest cache-first. The second load fetches gen 2 and the old cache is purged.
  The gen-1 R2 objects are content-addressed and still answer 200, so that one load is a
  consistent gen-1 boot, not a broken one. This lag comes from the SW design and predates this
  diff. Keep the gen-1 R2 objects, or make the manifest network-first (follow-up, not a demand
  here).
- **25 MiB — HELD (P11).** The three large artifacts are on R2. The largest file in `web/dist`
  outside the gitignored `web/dist/releases/` staging is `tailscale-connect/main.wasm` at
  26,043,701 B (24.84 MiB < 25 MiB, existing before this task).
- **Feeder leak — FAILED (new defect in this diff, low severity).**
  `tools/build-replay-desktop-snapshot.sh:85-92`: `cleanup`/line 110 kill the feeder subshell,
  but its child `sleep 86400` is orphaned and lives for a day per capture. My rerun left one, which
  I killed. One from an earlier capture is still running (pid 65021, reparented to 1). Demand
  for the rework: `exec sleep 86400`, or kill the job's process group.
- **Mock hunt — HELD (P13), one nit.** The claim's numbers match the committed JSONs. The 8128
  clone differs from `web/dist` only in the manifest, the roadmap row, sw VERSION and
  tasks.json. Nit: the manifest's `"generated"` text (`web/artifacts-replay-desktop.json:2`)
  still says the snapshot was "captured at REPLAY_DESKTOP_READY" (E5-T34e wording).
- COVERAGE: every hunk of the capture script ran in my rerun or the no-Node-line run, except the
  `|| poweroff -f` failure branch (not exercised; it is the stated safety path). The
  `turbo-equivalence.sh` change (image candidate by hash) was not run (waived: perf tooling,
  outside the acceptance).
- SUITE: none until the refutation clears. The `/sys/block/vda/stat` first-node probe is the
  recommended acceptance command for the rework.

Not checked: the E5-T34c harness; a pristine cold clone of the tooling (artifact portability was
checked through the public R2 GETs instead); a busy-shell compaction case; the `poweroff -f`
failure branch. HELD results above carry forward only for evidence whose digests do not change. A
recapture changes the snapshot digest, so the size, privacy, warm/cold, latency and live checks
must be rerun on the new artifact.
