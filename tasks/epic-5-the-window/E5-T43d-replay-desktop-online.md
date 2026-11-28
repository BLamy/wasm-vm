---
id: E5-T43d
epic: 5
title: Publish the Replay desktop online — generation 3 with networking through the public relay
priority: 0.387663
status: cancelled
depends_on: [E5-T43a, E5-T43b, E5-T43c]
estimate: M
risk: medium
capstone: false
decomposed_into: [E5-T43e, E5-T43f, E5-T43g]
---

Split on 2026-11-27 before start: it held three boundaries (publishing generation 3, the page
turning networking on, the relay's idle close reaching the page, which needs a relay status the
worker does not report today). Replaced by E5-T43e, E5-T43f and E5-T43g; the acceptance below is
distributed among them.

## Boundary

`web/main.js` Replay desktop boot options: `slirpNet` on with the `websocket` provider pointed at
the E5-T43a relay, the token fetched from its `/token` (fail closed: no token, no network, the
desktop still boots); `?net=0` turns it off. Generation 3 published (E5-T43c's image, a warm
snapshot captured with the DHCP lease logic in place), manifest, roadmap row, deploy.

## Deterministic acceptance

- Committed bundle and the live site: in the guest's Chrome a typed `https://example.com` loads
  (title `Example Domain`, read over the serial shell from sway's window title); in the terminal
  `node -e 'fetch("https://example.com").then(r=>console.log(r.status))'` prints 200.
- Warm resume still passes; click, key echo and node -e not slower than generation 2 on the
  same bundle; idle worker time within 2 points of generation 2's (E5-T43b).
- `?net=0`: no relay request at all.
- Idle (moved here from E5-T43a's round-4 verifier, which needs the online page): a desktop left
  untouched for 31 minutes has its relay session closed by the 30-minute idle limit; the page
  shows that the network is gone (the relay's Close reaches it, or the page notices), and a
  reload brings it back.

## Adversarial verification

Medium risk (deployment claim). Attack list: relay down (the desktop must boot and say so);
token expiry during a long session (renewal); the service worker caching `/token`.

## Verification log
