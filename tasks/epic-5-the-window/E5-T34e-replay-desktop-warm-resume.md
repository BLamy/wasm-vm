---
id: E5-T34e
epic: 5
title: Warm-resume the Replay desktop as soon as its single download finishes
priority: 0.38735
status: implemented
depends_on: [E5-T34c]
estimate: S
risk: medium
capstone: false
---

## Boundary

User request (2026-11-24): the Replay desktop must fast-boot once it has finished
downloading. Today (E5-T34c) the 181 MiB whole-image prefill takes about 85 s on the
live site, and a cold guest boot then takes about 2.5 more minutes to reach the
desktop.

Reuse the verified warm-image machinery (Omarchy paired snapshots,
`tools/build-omarchy-snapshot.sh`, E5-T26 restore and reconciliation; the loader's
`bootSnapshot`). Do not build a new restore path. The Replay rootfs is mounted
read-only, so its warm image is a RAM/device snapshot taken at
`REPLAY_DESKTOP_READY` from the exact browser device topology and the exact
E5-T34b image. A disk delta is needed only if the capture proves one (the image
SHA-256 must be unchanged).

Ship the snapshot as one content-addressed artifact fetched in parallel with the
image prefill, so the whole download is still the whole OS at once. The guest
restores from the locally prefetched image with zero chunk or Range requests. The
cold boot stays as an automatic fallback when no matching snapshot exists, and as
the `?noSnapshot` diagnostic. Bind the snapshot to the image SHA-256, kernel,
device layout and wasm build, the way Omarchy's paired artifacts are bound, so a
mismatch falls back to cold boot instead of restoring wrong state. No emulator
semantic change. Run the privacy guard on the snapshot (it holds guest RAM).

## Deterministic acceptance

A Playwright script on the built page and on the live site must show:
1. The image and snapshot downloads are the only disk-related requests, with zero
   chunk or Range requests.
2. The desktop is visible within a bounded time after both downloads finish
   (target ≤ 15 s; record the measured value).
3. The restored session is live, not a picture: clicking Chrome's "Run again"
   increments `runs`, and a DOM-typed Node command prints `v26.13.1` with a fresh
   nonce.
4. Zero console errors.
5. `?noSnapshot` still cold-boots to the same result.

Record download sizes, time from end of download to desktop, and the cold-boot
comparison.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence. Attack the
binding by serving a snapshot that does not match the image, wasm build or device
layout: it must fall back to cold boot (or fail visibly), never restore. Try one
bounded novel attack.

## Verification log

### 2026-11-24 — worker — implemented (claim)

Commits: `a38a66be2` (implementation, evidence, web/dist via pre-commit hook) + this commit
(attack-mode fix for served/live manifests, live evidence, status). No Rust/emulator change.

Design (reuses the Omarchy warm-image machinery; no new restore path):
- `tools/build-replay-desktop-snapshot.sh` — the `build-omarchy-snapshot.sh` capture (native CLI
  `--snapshot-trigger` → `save_resume`, `--browser-topology --net --virtio-rng`, JIT/block-cache/
  interrupt-batching, ICount/64, quantum 500000, core id = crate version, base id = chunk-manifest
  base hash) on an APFS clone of the exact E5-T34b image, 1024 MiB RAM and the browser's exact
  bootargs, triggered on `REPLAY_DESKTOP_READY uptime=`. The drive is writable like the browser
  chunked disk; the guest mounts it ro, and the script re-hashes it: SHA-256 unchanged
  (`2af6100e…5b05`), so no overlay delta is shipped. Privacy guard run on raw + gz snapshot.
- `web/artifacts-replay-desktop.json` gains `artifacts.bootSnapshot` (content-addressed
  `replay-desktop-ready-dfcf85c2c260.snap.gz`, 124,609,647 B gz / 338,770,744 B raw) with an
  `identity` block (image/kernel SHA, RAM, bootargs, clock, divider, `browser-topology`,
  `readOnlyRoot`).
- `web/readonly-root-snapshot.js` (JS binding) + loader option `readOnlyRootSnapshot`: the identity
  is checked before any download (mismatch → warn, cold boot); the download starts before the
  kernel/whole-image fetches so it overlaps them; after `newChunkedDisk` + `setLocalImage`, the gz is
  size/SHA-checked, streamed into a `SnapshotBuffer` (`stageGzipSnapshot`, as Omarchy) and
  `restoreSnapshotBuffer` applies the wasm coherence guard (core id = wasm build, base id =
  chunk-manifest hash, generation 0; device components in `load_resume`). Any refusal/failure →
  the untouched cold machine boots. `bootReplayDesktop()` enables it when the manifest has the
  snapshot and `?noSnapshot` is absent; a restored guest enters the same non-uniform-pixel gate
  (`watchReplayDesktopPixels`) the cold marker uses. Launcher text names both downloads.
- Guest clock: same as Omarchy — ICount/64 continues from the snapshot's instruction count; guest
  CLOCK_REALTIME is the capture's wall time plus elapsed (RTC is read only at boot). Chrome
  ("Run again") and the terminal (Node) are live after restore (below).
- Deploy: the existing `releases/boot-snapshot/*` branch of `tools/deploy-cloudflare.sh` already
  routes >25 MiB snapshots to R2 under `sha256/<sha>/…` and privacy-scans every R2 source; the
  deploy uploaded and publicly verified the object (`evidence/e5-t34e/deploy.log`).

Commands:
- `bash tools/build-replay-desktop-snapshot.sh` (89 s native capture; `evidence/e5-t34e/capture/`)
- `cd web && node --test tests/e5-t34e-readonly-root-snapshot.test.mjs tests/omarchy-desktop-services.test.mjs tests/e5-t34a-whole-image.test.mjs` → 20 pass / 0 fail
  (`tests/omarchy-seeded-loader.test.mjs` has 1 failure that is identical on HEAD's loader.js — pre-existing, not touched)
- local: `bash tools/serve-dev.sh 8123 &`; `node tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold attack-identity attack-core`;
  `E5_T34C_OUT=evidence/e5-t34e/local node tools/verify/e5-t34c-replay-desktop.mjs suite` → 127/0
- `bash tools/deploy-cloudflare.sh` → https://wasm-vm.pages.dev
- live: `E5_T34E_URL=https://wasm-vm.pages.dev E5_T34E_APP=/app E5_T34E_OUT=evidence/e5-t34e/live node tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold` (`live-run.log`),
  then `… attack-identity attack-core` (`live-attacks.log`), and the e5-t34c `suite` on live → 127/0.

Results (evidence/e5-t34e/{local,live}/{warm,cold}/summary.json, comparison.json):

| | downloads | downloads finished | desktop visible | end-of-download → desktop |
|---|---|---|---|---|
| live warm | 189,669,297 B image + 124,609,647 B snapshot (parallel) | 97.8 s | 99.9 s | **2.0 s** |
| live cold `?noSnapshot` | 189,669,297 B image | 50.4 s | 210.5 s | 160.1 s |
| local warm | same | 1.8 s | 3.6 s | 1.8 s |
| local cold | same | 1.6 s | 168.9 s | 167.3 s |

Every run: exactly one whole-image request, one snapshot request (warm) / none (cold), zero chunk
or Range requests, `fetchStats.fetches == 0`, `localImage: true`, zero console errors; the only
other release request is the 125 KiB chunk-manifest metadata. Warm states are
`fetching → instantiating → restoring → restored` (never `booting`) and the serial log has no
guest boot output. Liveness after restore: a DOM click on Chrome's "Run again" moved the sway
window title from `PASS #1` to `PASS #2` (6.2 s live), and a DOM-typed
`node -e "console.log('E5T34E_<nonce>', process.version)"` printed `E5T34E_<nonce> v26.13.1`
(47 s live; screenshots `warm/desktop-run-again.png`, `warm/desktop-node.png`). Cold mode gave the
same results. Attacks: identity naming another kernel → refused before download
(`not admitted (kernel)`), cold boot (local + live); snapshot re-gzipped with core id `9.9.9`
and matching manifest digests → wasm guard `foreign_build`, cold boot (local).

Claim: the recorded runs show the Replay desktop resuming from a RAM/device snapshot of the same
image and device layout, fetched in parallel with the whole image, with the desktop visible about
2 s after the last download finishes on the live site (budget 15 s), live Chrome and Node
sessions afterwards, zero chunk/Range traffic, and cold boot preserved for `?noSnapshot` and for
both identity and wasm-guard mismatches.

Gaps: (1) the parallel snapshot adds 119 MiB, so the whole live download is ~98 s instead of ~50 s
(total time to desktop still ~100 s vs ~210 s); the whole-image request also starts only after
the 23 MiB kernel and chunk manifest (29 s in the live warm run) — fetching it concurrently is a
possible follow-up. (2) The live `attack-core` run could not fetch the tampered copy from a
loopback origin (mixed content); it still cold-booted (`live/attack-core-mixed-content.json`) and
the wasm-guard refusal is proven locally only. (3) "wasm build" binding is the crate-version core
id, exactly as Omarchy's — a rebuilt wasm with an incompatible device format but the same crate
version would be refused only by `load_resume`'s component checks. (4) Every visitor restores the
same guest CRNG state (virtio-rng keeps feeding it), as with Omarchy.
