---
id: E5-T34c
epic: 5
title: Boot the shared Replay Chrome and Node 26 desktop in the browser demo
priority: 0.3873
status: implemented
depends_on: [E5-T34a, E5-T34b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Expose the E5-T34b image through the E5-T34a single-fetch mode in web/, update roadmap.js, and publish to Cloudflare. No driver bytes are present (privacy check on the exact shipped image and dist).

## Deterministic acceptance

Playwright on the built page and the live site: one disk fetch, desktop visible, Chrome renders smoke.html, the Node terminal answers a typed command, zero console errors, measured download size and time to desktop.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

### 2026-11-24 — worker — submitted at b39cc978f

**Claim.** The launcher has a **Replay desktop** entry (`data-os="replay-desktop"`, React launcher row) that
opens `?guest=replay-desktop&desktop=1#ide`, the same full-window desktop surface as Omarchy (display canvas
owns keyboard and pointer, boot overlay, toolbar). `bootReplayDesktop()` in `web/main.js` cold-boots the
E5-T34b image as a chunked raw ext4 with the E5-T34a prefill. The boot manifest is `web/artifacts-replay-desktop.json`:
- kernel `releases/kernel/6.6.63/Image` (`af7c4e47…`);
- chunk manifest `releases/rootfs/replay-desktop-2af6100e9b37.chunks.json` (`2e644ad8…`, committed, byte-identical
  to `evidence/e5-t34b/build/chunk-manifest.json`);
- whole image `releases/rootfs/replay-desktop-2af6100e9b37.img.gz` (`37911eaa…`, 189,669,297 B, gitignored),
  decompressed 467,664,896 B / `2af6100e…5b05`.

Devices are the browser assembly (equal to the native `--browser-topology` set). Settings: JIT, fast
interpreter, icount divider 64, quantum 500k, no persistence or snapshot, offline network, and the E5-T34b
bootargs (`root=/dev/vda ro … quiet loglevel=4`). The overlay lifts only after the guest's
`REPLAY_DESKTOP_READY` serial marker (sway mapped both windows and Chrome reported the PASS title) **and**
`hasDesktopPixels` on presented frames. Desktop sessions get no Explorer/Docker serial RPCs and a lazy agent
channel (`web/ide.js`, `web/desktop-agent-session.js`). The deploy stages the manifest; the image and chunk
manifest go to content-addressed R2 keys through the existing `releases/rootfs/*` path, behind the privacy guard.

On the built page, locally and on the live site, the recorded runs show:
- exactly 1 `.img.gz` request and 0 chunk or Range requests;
- `fetchStats`: `fetches:0`, `localHits` about 1,222;
- Replay Chrome 108's smoke.html PASS result object, with the renderer sandboxed;
- the sway desktop with Chrome and the Node terminal side by side;
- a nonce-tagged `node -e` command typed as real DOM key events on the canvas, answered with `v26.13.1`;
- zero console errors and an unchanged 127/0 ISA suite.

**Deviation: guest RAM is 1 GiB, not the native 2 GiB.** The first boot failed in the wasm machine with
`cannot allocate 2048 MiB of guest RAM`. Guest RAM is one wasm32 allocation, and 2^31 B exceeds `isize::MAX`.
Changing that would be an emulator change, which is out of scope. 1 GiB matches browser Omarchy and is 5.6×
E5-T34b's measured 182 MiB high-water mark.

**Commands.**
- `make web-build` (57 s).
- `bash tools/serve-dev.sh 8123`.
- `node tools/verify/e5-t34c-replay-desktop.mjs boot`, then `… suite`, both on local `web/`.
- Commit b39cc978f. The pre-commit hook rebuilt and staged `web/dist`. It needs a real `rg`, which is only a
  shell function here, so it ran with a temporary PATH shim: a bash `exec -a rg` wrapper around the Claude
  Code bundled ripgrep, in the session scratchpad.
- `bash tools/deploy-cloudflare.sh`. The first attempt stopped at artifact validation: the gitignored Omarchy
  `omarchy-apps-ready-98235fbe8cc4.snap.gz` and `omarchy-apps-virgl-ready-3583ea9927d1.wvgpair` were absent locally,
  which is unrelated to this task. I restored both from their public content-addressed R2 keys with SHA-256 checked,
  then re-ran.
  - `[privacy] OK: 796 file(s)`, covering the Pages tree and every R2 source including the new `.img.gz`.
  - The two new R2 objects were uploaded and publicly verified.
  - The 204 MB virgl pair's public check hit the script's 300 s curl limit, so it re-uploaded the same bytes to
    the same content-addressed key.
  - Published at https://bcd9f1bb.wasm-vm.pages.dev, which is production https://wasm-vm.pages.dev (`evidence/e5-t34c/deploy.log`).
- `E5_T34C_URL=https://wasm-vm.pages.dev E5_T34C_APP=/app E5_T34C_OUT=evidence/e5-t34c/live node tools/verify/e5-t34c-replay-desktop.mjs boot suite`.
- Gates: `node --check` on all changed JS. `node --test tests/omarchy-startup-state.test.mjs` passes 4/4.
  `tests/omarchy-desktop-agent-session.test.mjs` is 4 pass / 3 fail, identical at HEAD~ with the old `main.js`
  (`ReferenceError: mountSessionTimeline is not defined`, a pre-existing fixture gap). No Rust changes, so no
  fmt, clippy or cargo tests.

**Results (system Chrome 158 headless, 1280×800, production URL without `?testHooks`).**

| | local (serve-dev, `web/`) | live (`wasm-vm.pages.dev/app`, image from R2) |
|---|---|---|
| download | 1 request, 189,669,297 B in 1.7 s | 1 request, 189,669,297 B in 84.7 s |
| chunk / Range requests | 0 of 169 total | 0 of 171 total |
| fetchStats | fetches 0, localHits 1221 (320,077,824 B), error null | fetches 0, localHits 1223, error null |
| page open → desktop visible | 167.9 s | 242.9 s |
| guest uptime (icount/64 clock) | sway IPC 25.40, READY 64.23, RAM HWM 162,092 KiB | sway IPC 24.18, READY 62.90, RAM HWM 162,600 KiB |
| typed command → Node answer | 51.2 s | 51.3 s |
| Node output | `E5T34C_56D18492 v26.13.1` | `E5T34C_18436867 v26.13.1` |
| console errors | 0 | 0 |
| ISA suite | 127 passed, 0 failed | 127 passed, 0 failed |

Chrome: `REPLAY_CHROMIUM_TARGETS … "title":"Replay RISC-V PASS #1"` and `REPLAY_CHROMIUM_PAGE … "value":"pass {"pass": true,
"runs": 1, "javascript": 42, "webassembly": 42, "pixel": [42,128,64,255], "browser": "Chrome/108.0.0.0"}`, then
`REPLAY_CHROMIUM_READY renderers=1 sandboxed=1`.

Input proof: the script never writes to the serial console; it uses no `sendInput` or `typeBytes`. It clicks
the canvas at 82%×50% to focus foot, which follows sway's click focus. It then presses W3C codes, holding Shift
explicitly. The keyboard bridge recorded 0 frames before typing and 208 (local) or 206 (live) after: 2 per key
plus Shift pairs. The live count is two lower because its nonce has no hex letter. Each run's nonce is fresh,
and the line is relayed to serial only because the typed pipeline appended it to `/run/replay-desktop/events`.
`desktop-node.png` shows the typed command and its output in the foot window beside Chrome's PASS JSON.

**Evidence (`evidence/e5-t34c/`).**
- `{local,live}/`: `boot-summary.json` (times, counts, fetchStats, display, chrome/node lines, keyboard
  frames), `requests.json` (every page and worker request, with Range header and body size), `console.json`,
  `serial.log`, `desktop.png` (at ready), `desktop-node.png` (after the typed command), `demo-suite.{json,png}`
  and `run.log`.
- `deploy.log`.

**Gaps / not proven.**
- 1 GiB instead of 2 GiB RAM (above).
- Timing is single-run on a loaded host (load average 9 to 15). The live download time is this Mac's link to R2.
- foot shows three empty `desktop$` prompts before the typed command in both runs, with no keyboard frames
  sent before typing. Their origin was not investigated; they do not affect the command or its output.
- Only headless system Chrome was tested. There was no Firefox, real GPU, mobile or DPR≠1 run, and no
  repeat/warm-cache visit.
- The chunk manifest is fetched without a digest check. Image integrity rests on the declared decompressed
  SHA-256 (checked before boot) plus the per-chunk hashes.
- smoke.html's subtitle still says "Weston / Wayland" (inherited from E5-T34b).
- The roadmap row stays `in-progress`, pending this task's fresh verifier.
