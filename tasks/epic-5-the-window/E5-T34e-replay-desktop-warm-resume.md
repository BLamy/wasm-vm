---
id: E5-T34e
epic: 5
title: Warm-resume the Replay desktop as soon as its single download finishes
priority: 0.38735
status: verified
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

### 2026-11-24 — fresh verifier — VERDICT: verified

Head `027717ded` (a38a66be2 + a30861760 + 027717ded). Medium risk: acceptance criteria on the
live site, binding attacks on the built page, one novel attack. Every prediction below was written
before observing the state it names.

- P1 live warm, one image + one snapshot, zero chunk/Range: HELD. Committed
  `tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold` against https://wasm-vm.pages.dev/app
  (Chrome 158 headless): wholeImage 1 (189,669,297 B), snapshot 1 (124,609,647 B, started 2.5 s,
  finished 68.2 s), chunkOrRange 0, diskRelated 2, `fetchStats.fetches` 0, `localImage` true.
- P2 desktop within 15 s of the downloads finishing: HELD. Downloads finished 74.4 s; desktop
  visible 76.5 s, so **2,057 ms**. States `fetching → instantiating → restoring → restored`, never
  `booting`; no `Linux version`/`Run /sbin/init`/`MONITOR start` in the serial log.
- P3 live session, not a picture: HELD. The `runs` count is read inside the guest (`swaymsg -t
  get_tree` over the serial root shell gives Chrome's own document title), not from a page overlay:
  `PASS #1` before, `PASS #2` 6.7 s after one DOM click. The DOM-typed fresh nonce gave
  `E5T34E_04DBC0D9 v26.13.1` (51 s), and it went through the keyboard bridge (frames 0 → 214).
  That output cannot be in a snapshot captured before the nonce existed. The screenshot shows
  smoke.html `"runs": 2` and the nonce line in the foot terminal.
- P4 zero console errors (warm and cold): HELD. `consoleErrors: []` in both.
- P5 `?noSnapshot` cold run gives the same result: HELD. 1 image, 0 snapshot, 0 chunk/Range,
  `booting` and never `restored`, PASS #1→#2, `E5T34E_59EE8EEA v26.13.1`. Downloads finished
  71.8 s and the desktop appeared 238.7 s, so 166.9 s after the downloads (warm is 2.1 s).
- P6 deployed bytes match the committed bytes: HELD. The live `artifacts-replay-desktop.json`
  matches the committed manifest on every field except the R2-rewritten `url`. The identity blocks
  are equal. Live `loader.js`, `main.js`, `readonly-root-snapshot.js` and `gpu-checkpoint-build.js`
  are byte-identical to `web/dist`. The live wasm SHA (`c6cc6692…`) equals `web/dist/pkg` and
  `web/pkg`. I downloaded the live .snap.gz once: SHA-256 `dfcf85c2…54cb3`, 124,609,647 B. Its
  gunzipped SHA is `f41f820c…bd03` (= `uncompressedSha256`). `check-no-replay-backend.py` is OK
  on both the gz and the raw snapshot. Both files were deleted afterwards.
- P7 binding: every mismatch cold-boots or fails visibly, never restores, never fetches chunks.
  HELD for every snapshot mismatch. These ran on the built page (`tools/serve-dev.sh 8123`), with
  the manifest route intercepted and the fixtures served from a separate loopback origin. A
  positive control served the genuine snapshot the same way and reached `restored`, so the
  harness can restore.
  - Snapshot built for another image: header base id flipped, the manifest identity still naming
    the right image, digests re-derived. Result: `not coherent (foreign_image)`, then `booting`.
  - The wasm sees a different device layout: the virtio-rng section is removed from the blob.
    Result: `restore failed … corrupt`, then `booting`.
  - Raw snapshot truncated mid-RAM, with consistent digests: `not coherent (corrupt)`, then
    `booting`.
  - .snap.gz truncated under the real declared SHA/size, and .snap.gz with a byte flipped (wrong
    SHA, right size): both `integrity check failed` before `restoring`, then `booting`.
  - Identity `imageSha256`, `ramMib: 2048` and `deviceLayout: "native"`: refused before download
    (`not admitted (image|ram|device_layout)`, 0 snapshot requests), then `booting`.
  - Every case: 0 chunk/Range requests, a cold guest boot visible on serial, no console errors.
  - Not covered: a cold boot that also gets a wrong image. Whole image swapped (gz of zeros) under
    the unchanged manifest gives `fetching → error`. The snapshot is never restored and no chunks
    are fetched, but the overlay stays on "Booting Replay desktop…" with a black screen and no
    console error. The same happens with `?noSnapshot`, so this comes from the E5-T34c whole-image
    prefill error path, not from this diff. It is filed as a follow-up observation, not a finding
    against this task (the task binds the snapshot to the image; the prefill integrity refusal
    itself works).
  - wasm-build binding (gap 3): the core id is the crate version (`0.0.1`, NUL-padded), exactly
    as Omarchy's. A same-version rebuild with an incompatible device encoding would pass the
    header check and depend on `load_resume`'s transactional component checks. The drop-a-section
    attack above shows those checks refuse layout drift. A semantically different encoding of
    the same length would not be caught. The task claims binding "the way Omarchy's paired
    artifacts are bound", and that is what ships, with the gap disclosed. Not a finding; a
    content-hash core id is a worthwhile follow-up for both.
- P8 novel attack: the snapshot URL returns 404. HELD. `restore failed, cold booting: … HTTP 404`
  (states `fetching → instantiating → booting`), with no hang and no chunk requests.
- P9 non-regression: HELD. `node --test tests/e5-t34e-readonly-root-snapshot.test.mjs
  tests/omarchy-desktop-services.test.mjs tests/e5-t34a-whole-image.test.mjs` gives 20/0.
  `omarchy-seeded-loader.test.mjs` has 12 pass / 1 fail ("freshDesktop rejects a RAM snapshot
  coherence mismatch…"). The same single failure happens on the parent `2651ac2f9`, run in a
  temporary worktree (since removed) with node_modules/pkg symlinked, so it predates this task.
- COVERAGE (from a38a66be2 to 027717ded):
  - loader import, admission and parallel fetch: executed (warm; `id-*` refusals).
  - Restore success: executed (warm, control).
  - Integrity-throw branch: executed (`gz-trunc`, `gz-flip`).
  - Non-resume decision branch: executed (`foreign-base`, `trunc-raw`, `unknown-tag`, worker's
    `foreign_build`).
  - Catch on `load_resume` Err: executed (`no-rng`).
  - Download-error branch: executed (`snap-404`).
  - Precondition `throw` (readOnlyRootSnapshot with an incompatible option set): waived. It is a
    defensive guard that the shipped `replayDesktopBootOptions` can never reach.
  - main.js `watchReplayDesktopPixels` split: executed on both paths (warm via the restored
    branch, cold via the marker).
  - Warm/cold option, banner and launcher text: both branches executed.
  - Availability label: executed on load.
  - roadmap row, manifest, `gpu-checkpoint-build.js`/`sw.js` build ids: waived (declarative or
    generated).
  - `build-replay-desktop-snapshot.sh`: executed by the worker. Its `snapshot.json` record equals
    the manifest entry field for field, and its own exit-on-SHA-change makes "image unchanged" a
    precondition of the published artifact.
- SUITE: the committed verify script already holds the acceptance. The binding attacks (foreign
  base id, dropped device section, truncated raw, unknown trailing section) would be worth
  promoting as `attack-*` modes of that script; I'm not adding them here because the verifier's
  writes are limited to this log. Discarded: the scratch runner and fixtures (deleted).
- Roadmap: the "Replay desktop warm resume after its download" row in `web/roadmap.js` is still
  `in-progress`. The worker should now flip it to `verified` (web change → web/dist + deploy).
