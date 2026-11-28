---
id: E5-T43f
epic: 5
title: The Replay desktop page turns networking on through the public relay
priority: 0.3876632
status: verified
depends_on: [E5-T43a, E5-T43b, E5-T43e]
estimate: S
risk: medium
capstone: false
---

## Boundary

`web/main.js` Replay desktop boot options: `slirpNet` on with the `websocket` provider pointed at
the E5-T43a relay, the token fetched from its `/token` before the boot (fail closed: no token, no
network, the desktop still boots, and the page says the network is off); `?net=0` turns it off.
Roadmap, deploy.

Revised 2026-11-28, before the claim: the first online run reached example.com but Chrome refused it
with `NET::ERR_CERT_AUTHORITY_INVALID` (`evidence/e5-t43f/try/online/chrome-example.png`). The image never
shipped NSS's built-in roots (`libnssckbi.so`, in the `libnss3` package it already uses). So this task
also adds that library to the image (`tools/replay-desktop/assemble.py`) and republishes the desktop with
a new warm snapshot (same capture as E5-T43e); E5-T43c's, E5-T41a's and E5-T36b's acceptances are rerun
on the image.

## Deterministic acceptance

- Committed bundle and the live site: in the guest's Chrome a typed `https://example.com` loads
  (title `Example Domain`, read over the serial shell from sway's window title); in the terminal
  `node -e 'fetch("https://example.com").then(r=>console.log(r.status))'` prints 200.
- Warm resume still passes; click, key echo and node -e not slower than generation 3 offline on the
  same bundle; idle worker time within 2 points of generation 3's (E5-T43b).
- `?net=0`: no relay request at all.

## Adversarial verification

Medium risk (deployment claim). Attack list: relay down or `/token` refused (the desktop must boot
and say so); the service worker caching `/token`; a token from another origin.

## Verification log

### 2026-11-28 — worker — claim (head `6a50ebd0f`)

Commits on `codex/replay-desktop-online`: `99388f8e1` (`web/main.js`: `replayDesktopNetwork`,
`showReplayDesktopNetwork`, the options; `bootLinux` prefers `opts.slirpRelayToken`; the acceptance script
`tools/verify/e5-t43f-replay-desktop-online.mjs`), `65fe57fc0` (`assemble.py` ships `libnssckbi.so`),
`53019092e` (image `ec157fd1b3a7…`, built at `65fe57fc0`, `evidence/e5-t43f/image-build.json`), `c8e8e5fb9`
(capture re-lease step, manifest, roadmap), `6a50ebd0f` (acceptance script: favicon filter, screenshot after
paint).

**Image** `ec157fd1b3a7` (E5-T43e's plus `usr/lib/riscv64-linux-gnu/libnssckbi.so` from `libnssckbi`'s package
`libnss3`): E5-T43c three machines pass (READY slirp 5.44, loopback 5.34, none 5.43 s, baselines 5.29/5.29/5.30;
`evidence/e5-t43f/e5-t43c-*/result.json`), E5-T41a passes, E5-T36b passes.

**Capture** (`evidence/e5-t43f/capture/`): with the roots, Chrome's sign-in check succeeds and keeps its
connection; the first capture waited past 600 guest seconds and powered off (no snapshot). The capture now
releases and retakes the lease (udhcpc SIGUSR2/SIGUSR1; Chrome drops pooled and HTTP/2 connections on an
address change), then waits: `REPLAY_CAPTURE_TCP_WAIT seconds=0`, two `REPLAY_NETWORK bound` lines,
`COMPACTED zeroed_mib=575`, snapshot `c5d6ff60fda9…` **135,290,972 bytes**.

**Browser, committed bundle** (`tools/serve-dist.sh 8125`):
`E5_T43F_OUT=evidence/e5-t43f/browser node tools/verify/e5-t43f-replay-desktop-online.mjs online off relay-down sw`
— all four PASS (`browser.log`):
- online: `/token` GET 200 from the network, one WebSocket `wss://wasm-vm-relay.brett-lamy.workers.dev/ws`; guest
  `10.0.2.15/24`, `default via 10.0.2.2`; a DOM-typed `https://example.com` in the guest's Chrome → sway title
  `Example Domain - Chromium` (25.0 s from typing; `online/chrome-example.png` shows the page); a DOM-typed
  `node -e "fetch('https://example.com')…"` in the terminal → `E5T43F_A9BFD42A 200` (92.6 s after typing began —
  see E5-T43h); no console errors but the favicon 404.
- off (`?net=0`): state `disabled`, no request to the relay host, no WebSocket, no banner, no console errors.
- relay-down (`/token` refused): state `off`, banner "Network off: Failed to fetch. The desktop runs offline;
  reload to retry." (`relay-down.png`), no WebSocket, Chrome's smoke page runs.
- sw (service worker allowed, two loads): both controlled by the SW on the second load; each `/token` 200 from
  the network (`fromServiceWorker: false`).

Latency on the same bundle, net on vs `?net=0`, interleaved (`evidence/e5-t43f/latency/`): click 259.5, 281.5 vs
279.9, 280.7 ms; key echo 47.7, 46.1 vs 43.3, 43.5 ms (about 3.5 ms slower with networking on); node -e 1778,
1792 vs 1776, 1764 ms; idle in run slices 1.4, 1.4 vs 1.4, 1.5 %. (Generation 3 offline: E5-T43e's verifier
measured click ~278, node -e ~1766 on this machine.)

**Live** after `bash tools/deploy-cloudflare.sh`: the first online run right after the deploy found no network
state (the edge still served the previous `main.js`; `live-first.log`, where off, relay-down and sw passed a few
minutes later); rerun: online PASS (`live.log`: Chrome example.com, node fetch 200); warm resume passes
(`live-warm.log`); `desktop-latency` live: click 261.2, key echo 44.8, node -e 1658 ms, idle 1.2 %.

**Not done / limits**: a token expiring during a long session and the relay's 30-minute idle close are E5-T43g;
the slow network waits are E5-T43h (filed).

### 2026-11-28 — verifier — VERDICT: verified

Fresh session, head `d2cdbd5c8` (claim head `6a50ebd0f`; nothing after it touches the implementation).
Predictions written before any run: `evidence/e5-t43f/verifier/predictions.md`. `web/dist` served on 8125
hashes as committed (`main.js`, `loader.js`, `sw.js`, `artifacts-replay-desktop.json`, `app.html`), and
`web/main.js` == `web/dist/main.js`. Every manifest artifact under `releases/` matches its declared size and
sha256. Live: `main.js` and `loader.js` on https://wasm-vm.pages.dev hash as `web/dist`; the live manifest
differs only in R2 content-addressed URLs with the same hashes, and all four R2 objects answer 200 at the
declared sizes.

- P1 online/Chrome — HELD. `/token` 200, network not service worker, one WebSocket
  `wss://wasm-vm-relay.brett-lamy.workers.dev/ws`; guest `10.0.2.15/24`, default via 10.0.2.2; sway title
  `"Example Domain - Chromium"` 24.3 s after typing (`verifier/browser/online.json`,
  `browser/online/chrome-example.png` shows the real page with a padlock, so the NSS roots are in use).
- P2 online/node — HELD. `E5T43F_9DC13526 200`, 94.6 s after typing began (`online.json`). It is slow. The
  claim states that and files E5-T43h, and this criterion sets no time limit.
- P3 no console errors — HELD (`online.json` consoleErrors `[]`).
- P4 `?net=0` — HELD. The worker's script found no relay requests and no WebSocket, state `disabled` and
  no banner (`browser/off.json`). My own load waited 20 s after ready and saw requests to one host only,
  `127.0.0.1:8125`, so no relay and no `cloudflare-dns.com` (`attack/attack.json` `net0-all`).
- P5 relay down (`/token` refused) — HELD. State `off`, banner "Network off: Failed to fetch. …", no
  WebSocket, Chrome's title `Replay RISC-V PASS #1` (`browser/relay-down.json`, `.png`).
- P6 a 200 answer with garbage — HELD (novel). First body `{"token":"v1.bogus","ws":"ws://127.0.0.1:9/ws"}`:
  state off, "the relay's token answer is malformed", no WebSocket. Second body `<html>`: state off with
  the JSON parse error, no WebSocket. The desktop ran both times (`attack.json` `garbage-json`, `not-json`).
- P7 503 — HELD. State off, "the relay answered 503", no WebSocket. The browser's own "Failed to load
  resource: 503" console line is expected.
- Extra: `/token` never answers — state off, "the relay did not answer"; the desktop was ready in 11.5 s
  against about 3.4 s otherwise (the page's 8 s timeout fired). Clicking the banner removed it in every
  fail-closed case (`bannerAfterClick: false`).
- P8 service worker — HELD. `web/sw.js` passes cross-origin requests through (`url.origin !==
  self.location.origin`). Two loads, both under the service worker, each made one `/token` request,
  answered 200 from the network. The two tokens differ (`attack.json` `sw-tokens.distinct: true`); the
  worker's script states this in its header but never asserts it.
- P9 a token from another origin — HELD. `/token` with `Origin: https://evil.example` or with no Origin
  answers 403 with no CORS header (curl, this session), so a page on another origin cannot get a token.
  E5-T43a's verified results carry forward for `/ws` refusing a token used from another origin. The token
  goes in the ws-proxy HELLO frame (`crates/slirp/src/ws_proxy/driver.rs:204`), not in the URL.
- P10 persistence and the IDE network panel overriding the relay — HELD (novel). I seeded localStorage
  `wasm-vm.network-config.v1` with provider `relay` and evil websocket, relay and control URLs. The page
  still connected only to the public relay (`hosts`: page, relay, cloudflare-dns.com), and the guest's
  `wget http://example.com` printed `Example Domain`. The token string appears in no localStorage,
  sessionStorage, IndexedDB, Cache Storage or input value, and the saved config is unchanged.
  Observation, not a finding: the IDE panel then shows provider `websocket` next to the user's saved
  (unused) websocket URL, not the relay URL in use. That is cosmetic and nothing persists it without a
  user change.
- P11 other guests — HELD (source). The only shared change is `opts.slirpRelayToken ?? networkRelayTokenEl?.value`
  (main.js:1421). The only caller that sets `slirpRelayToken` is `bootReplayDesktop` (main.js:2402), so
  every other guest takes the previous path.
- P12 warm resume — HELD (`verifier/warm/warm.log`: PASS, desktop visible 3620 ms, 0 chunk fetches).
- P13 latency — HELD against the criterion, FAILED against my own stricter bound for key echo. These are
  two interleaved pairs on 8125, net on vs `?net=0` (`verifier/latency/summary.txt`). Click 259.8 / 262.2
  vs 260.7 / 263.2 ms. node -e 1663 / 1711 vs 1641 / 1674 ms (+1.4 %, +2.3 %). Idle in run slices 1.1 %
  on all four, guest seconds per second 1.0. Key echo 45.4 / 46.0 vs 43.2 / 42.4 ms; pooled medians over
  16 samples are 44.7 vs 41.7 ms, +3.0 ms (+7 %), with fully overlapping ranges. That is above the 5 % I
  pre-registered. It is within the +5 ms bound E5-T43e's verifier applied to the same "not slower"
  criterion, and inside generation 3's own measured range (41.2-49.3 ms). It is under one frame. The worker
  disclosed the same ~3.5 ms. Not a refutation.
- P14 coverage — HELD. Every branch of `replayDesktopNetwork` ran:
  - disabled, online, `!response.ok`, malformed, JSON parse error, fetch TypeError, and TimeoutError.
  - `showReplayDesktopNetwork` ran its online, disabled and off branches, plus the dismiss click.
  - The options merge and main.js:1421 ran online; the relay accepted the token, since the guest reached
    example.com.
  - The capture's lease step ran in `evidence/e5-t43f/capture/native-capture.log` (USR2/USR1, 2 bound
    lines required under `set -e`, `REPLAY_CAPTURE_TCP_WAIT seconds=0`, `COMPACTED`). Its `snapshot.json`
    sha, size and identity match the manifest.
  - `assemble.py`: the image hash `ec157fd1b3a7…` matches `target/e5-t43f/image/replay-desktop.ext4` and
    the e5-t43c/e5-t41a/e5-t36b `result.json` files (all pass). The Chrome padlock shows the library at work.
  - Waived: the banner's reuse path (`el` already present). One call per boot never reaches it. It is
    harmless.
- P15 mock hunt — HELD with two weak spots, neither hiding a defect:
  - The worker's `sw` mode never asserts distinct tokens. I covered that above.
  - `tools/perf/desktop-latency.mjs` does not record whether the net-on load was actually online. Every
    one of my online loads in this window got a token (05:05-05:10), so I accept it.
  The Chrome check reads sway's tree from the guest, the node check uses a random nonce, and relay-down
  aborts only `/token`. Each of these discriminates.
- P16 bundle integrity — HELD (above).
- E5-T43h — the claim leans on it honestly. The 92-95 s node fetch time is stated, measured
  (`probe-timing.json`) and filed with a root cause. None of this task's acceptance criteria depend on it.

SUITE: `evidence/e5-t43f/verifier/attack.mjs` holds the fail-closed variants: garbage-json, not-json,
http-503, token-timeout, net0-all, sw-tokens and saved-config. Promoting them into
`tools/verify/e5-t43f-replay-desktop-online.mjs` is recommended, along with the distinct-token assertion.
Follow-up for the worker after this verdict: flip the roadmap item "Replay desktop online" to `verified`
(`web/roadmap.js`; the verifier does not edit `web/`).
Not checked: a cold clone (no portability finding); rerunning the native image acceptances (carried from
the worker's `result.json` files, which name image `ec157fd1b3a7`); an online run on the live site (live
assets hash-checked only); token expiry and the relay's idle close (E5-T43g).
Commands:
- `E5_T43F_URL=http://127.0.0.1:8125 E5_T43F_APP=/app.html E5_T43F_OUT=evidence/e5-t43f/verifier/browser node tools/verify/e5-t43f-replay-desktop-online.mjs online off relay-down sw`
- `node evidence/e5-t43f/verifier/attack.mjs evidence/e5-t43f/verifier/attack garbage-json not-json http-503 token-timeout net0-all sw-tokens saved-config`
- `E5_T34E_URL=http://127.0.0.1:8125 E5_T34E_APP=/app.html E5_T34E_OUT=evidence/e5-t43f/verifier/warm node tools/verify/e5-t34e-replay-desktop-warm.mjs warm`
- `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html [--query=&net=0] --scenarios click,type,node,idle --n 8 --idle-s 30` (on/off/on/off)
