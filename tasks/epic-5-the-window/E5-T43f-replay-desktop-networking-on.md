---
id: E5-T43f
epic: 5
title: The Replay desktop page turns networking on through the public relay
priority: 0.3876632
status: implemented
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
