---
id: E5-T43f
epic: 5
title: The Replay desktop page turns networking on through the public relay
priority: 0.3876632
status: pending
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
