---
id: E5-T41b
epic: 5
title: Publish Replay desktop generation 2 — compact warm snapshot captured after the Node snapshot
priority: 0.387653
status: verified
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

### 2026-11-26 — worker — round 2 claim (head `dfc5da39b`)

The refutation is right: `node -e 0` cached only a bare start. Commit `dfc5da39b`.

**Changed** (`tools/build-replay-desktop-snapshot.sh`): before zeroing free memory the compaction
runs node the ways a first command starts — bare, printing (`-e 'console.log(1)'`), `-p`, `-e`
code that loads fs/os/path and starts a child through `process.execPath`, a script file and an
ES module (files in /tmp, removed after). The feeder now `exec`s its sleep, so the cleanup's
kill ends it (your leftover-process finding). The manifest's `generated` text is corrected.

**Capture**: 130,233,796 bytes compressed (limit 135 MB), disk unchanged, privacy check passed on
raw and compressed (`evidence/e5-t41b/capture/`; round 1's in `round-1/`). An intermediate
capture with the first four warm-ups only (130.7 MB) still read 3 requests / 128 KiB for a
first script file, which is why the last two were added; it was discarded, not published.

**First node reads nothing** (`evidence/e5-t41b/first-node/first-node.sh SNAPSHOT.gz WORKDIR
'command'` — your method: a native resume of the published snapshot, `/sys/block/vda/stat`
around the session's first command, a fresh resume per command; `first-node.log`):
`node -e "console.log(6*7)"`, `node -p process.version`, a script file, an ES module, and `-e`
code running a child — read requests and sectors identical before and after, all five.

**Committed bundle** (`dfc5da39b`, 8125; generation 1 on the same bundle at 8128):
warm and cold pass (`warm.log`). Two interleaved loads a side, `--n 8 --idle-s 30`
(`browser/`): node -e to prompt 1616 / 1562 ms against 4552 / 4529 ms (65 % faster); click
271.5 / 256.1 ms against 262.2 / 258.2 (pooled 263.8 against 260.2 ms, within the spread of
earlier rounds: 255-279 ms); key echo 47.2 / 45.2 against 47.2 / 48.9 ms; idle 1.8 / 1.6 %
against 10.9 %; local image chunk reads over the whole run 24 against 256, none from the network.

**Live**, after the redeploy (one R2 object uploaded and verified, the new snapshot): the served
manifest names `replay-desktop-ready-f729cee9838e`; warm resume passes (`live.log`);
`desktop-latency --url https://wasm-vm.pages.dev --app /app --n 6`: click 261 ms, key echo
47.8 ms, node -e 1649 ms, idle 1.7 % (`live/latency.json`). The one console error is the favicon.

Unchanged from round 1 and carried as you held them: the artifacts' R2 integrity method, the
Node-line-never-comes path, memory pressure, the service-worker upgrade behaviour. The
`node`-line nit at `:111` is not changed.

### 2026-11-26 — worker — round 3 claim (head `10c312e6a`)

Round 2's verifier session ended before a verdict; its partial evidence is in
`evidence/e5-t41b/verifier-r2/` and showed six first commands still reading 0.1-6.8 MB (a shebang
script, the REPL, crypto, zlib, Intl, a worker thread). Round 2's evidence is in `round-2/`.

**Changed** (`tools/build-replay-desktop-snapshot.sh`, commit `10c312e6a`):
- The compaction also warms a shebang script, the REPL (`printf '1+1\n.exit\n' | node -i`),
  crypto and zlib, and Intl (`de` month names, `en` numbers, `toLocaleString`). NOT a worker
  thread: with it the snapshot was 135.28 MB, over the limit.
- It is typed as a script file, one line at a time, then run with `|| poweroff -f`: the single
  command line had grown to about 1.2 KiB and busybox's line editor cut it, leaving the shell
  at a continuation prompt until the capture's time limit (one capture lost that way).
- Free memory is zeroed down to 16 MiB (was 48): with 48 the snapshot was 135.76 MB. No
  out-of-memory kill in the capture log.

**Capture**: 134,069,642 bytes compressed (limit 135 MB), disk unchanged, privacy passed on raw
and compressed (`capture/`).

**First command of a resumed session** (round-2 verifier's `first-cmd.sh`, a fresh resume each,
`/sys/block/vda/stat` before and after; `first-node/first-node.log`): no reads for
`node -e "console.log(6*7)"`, `node --version`, `node -p process.version`, a `#!/usr/bin/env node`
script, `echo 1+1 | node`, `typeof fetch`, crypto, zlib, Intl `de`, a script file, an ES module,
a child process — 12 of 15. Still read: the REPL with its output on the terminal
(`printf … | node -i`, 3 requests / 156 KiB — the warm-up sends its output to /dev/null), Intl in a
locale not warmed (`ja`, 2 / 128 KiB), a worker thread (46 / about 3.6 MB). So the acceptance line
"the first node of a session reads nothing from disk" holds for those 12 kinds of first command
and not universally; caching the whole 105.6 MB binary to make it universal would put the
snapshot far over 135 MB. That trade is the planner's to confirm.

**Committed bundle** (generation 1 on the same bundle at 8128): warm and cold pass (`warm.log`);
two interleaved loads a side (`browser/`): node -e to prompt 1643 / 1704 ms against 4837 / 4863 ms
(65 % faster); click 256.3 / 260.7 against 261.5 / 268.4 ms; key echo 46.8 / 46.8 against
46.4 / 43.7 ms (pooled 46.8 against 45.1 ms, within the spread of earlier rounds, 41-48 ms);
idle 1.2 % against 9.8 %; local image chunk reads over a run 24 against 256, none from the network.

**Live** after the redeploy (the new snapshot uploaded to R2 and verified): the served manifest
names `replay-desktop-ready-39f10258e690`; warm passes (`live.log`); click 258.4 ms, key echo
47.6 ms, node -e 1678 ms, idle 1.2 % (`live/latency.json`).

### 2026-11-26 — verifier (round 3) — VERDICT: verified

Fresh session. I did not implement this task and did not verify rounds 1 or 2. Head `2b128510d`
(change `10c312e6a`). Diff `1642970a0..HEAD -- tools web/artifacts-replay-desktop.json web/roadmap.js`.
I wrote my predictions before running anything (`evidence/e5-t41b/verifier-r3/predictions.md`).
Everything I produced is in `evidence/e5-t41b/verifier-r3/`. Bundles: 8125 hashes the same as
`web/dist`. 8128 differs from `web/dist` only in the manifest, which is byte-identical to
`9a2677a20:web/dist/artifacts-replay-desktop.json` and names `dfcf85c2c260` (`bundles.log`).

- **"The first `node` of a session reads nothing from disk" (P1-P4) — HELD for the acceptance's
  own first node; the three remaining kinds are a planner limit, not a refutation.**
  - *Native.* I resumed the published `39f10258e690` snapshot fresh for each command, with
    round 2's `first-cmd.sh` and output on the serial tty (`native/first-cmd-summary.log`). These
    read 0 requests: `node -e "console.log(6*7)"`, `node -p process.version`, and a
    `#!/usr/bin/env node` script. These still read: the REPL on the tty (3 requests, 156 KiB),
    Intl `ja` (1 request, 128 KiB) and a worker thread (45 requests, 3640 KiB). That matches the
    worker's table, and its "before" counts (9057/638250) are the same as mine.
  - *Browser, the latency script's own first node.* This is `node -e 'console.log(6*7)'`, typed in
    foot through the DOM keyboard on 8125 (`browser-first-node.mjs`, a copy of round 2's).
    - With no idle wait (`browser/first-node-idle0.json`), the window from Enter to 15 s later
      read 70 requests, 280 KiB and 7 local chunks.
    - With 60 s of idle first (`browser/first-node-idle60.json`), the same 280 KiB (sectors
      637690 to 638250) was read 10-20 s after desktop-ready while nothing was touched. The
      first-node window then read **0** requests. Typing (the click, `clear`) read 1 request,
      4 KiB.
    - `browser-who-faults.mjs` (`browser/who-faults.json`) names the reader: Chrome's browser
      process (pid 103, +1 major fault) and its renderer (pid 192, +3) at guest uptime 69.5-80.0.
      No other process changed.
    - Natively the same 280 KiB has already been read by the time the first command runs. A
      `sleep 45` idle window followed by the first node read 0.
  - *Judgement.* The 280 KiB is a Chrome read at a fixed guest time. It is served from the
    in-memory prefill (no network fetches) and is not the node's. The acceptance line sits in the
    `desktop-latency` bullet, and that bullet's first node reads nothing.
  - *The three kinds that still read.* A worker thread, the REPL with its output on the terminal,
    and an unwarmed locale are not the acceptance's command. Making "reads nothing" hold for every
    possible first node is a trade only the planner can make (the worker reports 135.28 MB with a
    worker-thread warm-up; I did not re-measure that). I classify it as a limit the planner should
    accept or re-scope, with no demand on this task. The claim and the roadmap row state it
    honestly.
  - *Nit.* The comment at `tools/build-replay-desktop-snapshot.sh:40-41` still says, without
    qualification, that the first `node` "reads nothing from disk".
- **Size, disk and privacy (P5) — HELD.**
  - The published file is 134,069,642 B (≤ 135,000,000), SHA-256 `39f10258e690…`. Gunzipped it is
    357,412,069 B, SHA-256 `7e740013…`, equal to the manifest (`local-artifacts.log`).
  - My own capture rerun into scratch directories gave **134,057,692 B** with "disk unchanged after
    capture: 20f03da7c51d…". The privacy check passed on the raw and gz files. The markers are
    `REPLAY_NODE_SNAPSHOT` at 9.69 s and `COMPACTED zeroed_mib=578` at 47.69 s, and the run exited
    0 (`capture/run.log`, `capture/native-capture.log`).
  - I ran `check-no-replay-backend.py` myself on the published raw and gz files: OK on both
    (`privacy.log`).
  - Observation: there is only 0.93 MB of headroom, so any image growth will break the limit.
- **R2 against the manifest (P6) — HELD.** On the live manifest, all four artifacts' sizes,
  digests and identity equal the committed values. The snapshot fetched from its public R2 URL is
  134,069,642 B, SHA-256 `39f10258…`. Gunzipped it is 357,412,069 B, SHA-256 `7e740013…`. The chunk
  manifest's R2 SHA-256 is unchanged at `4a4b014c…` (`r2-artifacts.log`). The kernel, chunk
  manifest, whole image and their 25 MiB checks are carried forward from round 1 as HELD (same
  digests).
- **16 MiB margin (P7) — HELD.**
  - In a resumed guest, `/proc/vmstat oom_kill 0`, and dmesg has no oom, out-of-memory or
    allocation-failure line. MemFree is 603,636 kB and MemAvailable 819,908 kB. The full process
    set is alive: sway, foot, Chrome browser, zygotes, GPU, network and storage utilities, and
    renderer 192 (`native/p7-probe-serial.log`).
  - Neither capture log has an OOM, Killed or segfault line.
  - The warm-ups' pages were not evicted by the zeroing: the native first commands above read 0.
- **Compaction typed as a script (P8) — HELD.**
  - The typed script arrived whole: the resumed guest's `/tmp/compact.sh` is 1228 B, the exact
    length of the script text with the settle time substituted.
  - Failing step: `REPLAY_DESKTOP_SETTLE_SECONDS=x` into scratch directories made `sleep x` fail
    under `set -e`. The log shows `sh: invalid number 'x'` and `reboot: Power down` at 11.39 s. The
    script printed "no snapshot was written" and exited 1. The output directory stayed empty, the
    work directory was removed and no `sleep 86400` was left (`failstep/run.log`,
    `failstep/native-capture.log`). This was round 1's unexercised `|| poweroff -f` path, now run.
  - The `exec sleep` fix held: no leftover sleep after either of my captures.
- **Warm and cold on the committed bundle (P9) — HELD.**
  - Warm PASS: desktop 1774 ms after the downloads, Run again answered, and the Node nonce
    answered.
  - Cold PASS: desktop 33.1 s after the downloads.
  - The warm run's requests name only `replay-desktop-ready-39f10258e690`; there is no
    `f729cee9838e`, `2d4d38924d83` or `dfcf85c2c260` (`warm.log`, `warm/*/requests.json`).
- **Latency against generation 1 (P10) — HELD.** I ran eight loads of my own (`latency/`),
  interleaved ABAB and then BABA: 8128 for gen 1, 8125 for gen 2, `--n 8 --idle-s 30`.
  - node -e to prompt, run medians: gen 2 1775, 1745, 1808 and 1664 ms; gen 1 5099, 5102, 5076 and
    4845 ms. That is **65 % faster** pooled (1760 against 5088 ms).
  - Click answered, pooled 32 samples a side: 275.9 against 275.9 ms (Mann-Whitney z −1.11).
  - Key echo, pooled: gen 2 44.7 against gen 1 42.3 ms (z +0.96). Adding the worker's round-3
    loads gives 45.2 against 42.3 ms, z +1.50.
  - The gap of 2.4-2.9 ms is inside the gen-1 run-to-run spread of medians (2.0 ms across my
    loads; 4.3 ms with the worker's), so this is not slower under my pre-registered rule. It is
    the closest of the three margins (`latency/pooled-all.txt`).
  - Idle in-slice time is 1.1-1.5 % against 9.7-10.8 %. Local chunk reads per run are 24 against
    256, with no network fetches.
- **Live site, fresh profile (P11) — HELD.** https://wasm-vm.pages.dev/app resumed warm: desktop
  2027 ms after the downloads, Run again answered, Node answered `v26.13.1`. The requests name
  `39f10258e690`. The only console error is the favicon.ico 404 (`live.log`, `live/warm/warm/`).
- **Novel attack (P12) — nit.** The capture never removes `/tmp/compact.sh`. Every resumed
  session ships it in its tmpfs as a 1228 B root-owned, world-readable file that the desktop user
  sees in `ls /tmp` (`native/p7-probe-serial.log`). It holds only the warm-up text, so there is no
  privacy problem. Follow-up: `rm -f /tmp/compact.sh` before the marker.
- **Mock hunt (P13) — HELD.**
  - The claim's numbers equal the committed JSONs (`mock-hunt.log`).
  - `first-node/first-node.log`'s "before" counts equal those of my fresh resumes of
    `39f10258e690`.
  - The latency JSONs do not record which snapshot they ran. My own runs and the warm requests
    tie gen 2 on 8125 to `39f10258e690`.
- **Observation (not a demand on this task):** a resumed session's Chrome reads 280 KiB about
  20 s after resume (above). Whether the `drop_caches` step causes it is unproven. If it matters,
  file it as a follow-up.
- **COVERAGE.** Every line of the new compaction script and feeder ran in my capture rerun. The
  `set -e` / `|| poweroff -f` failure path ran in the failstep capture. The manifest and roadmap
  hunks were served and read in my browser runs.
- **SUITE.** No new committed test. `verifier-r2/first-cmd.sh` (native first command) and
  `verifier-r3/browser-first-node.mjs` (with `IDLE_S=60`, which separates Chrome's read from the
  node's) are the reusable acceptance probes for any future recapture. I recommend making them a
  `make verify-*` target when the planner next touches the snapshot. Discarded: `who-faults`, a
  one-off attribution.

Not checked: a pristine cold clone (artifact portability was checked through the public R2 GETs
and the fresh-profile live run, as in round 1); the worker's 135.28 MB worker-thread capture; the
E5-T34c harness; a busy-shell compaction case (the shell is at its prompt in all three of my
captures, and the typed script arrived whole). Commands: `bash evidence/e5-t41b/verifier-r2/first-cmd.sh
<dir> '<cmd>' ['<setup>']`; `[IDLE_S=60] node evidence/e5-t41b/verifier-r3/browser-first-node.mjs
http://127.0.0.1:8125 /app.html <out>`; `REPLAY_DESKTOP_SNAPSHOT_DIR=… REPLAY_DESKTOP_SNAPSHOT_WORK=…
[REPLAY_DESKTOP_SETTLE_SECONDS=x] bash tools/build-replay-desktop-snapshot.sh`; the e5-t34e warm/cold
and desktop-latency commands from the task, on 8125, 8128 and the live site.
