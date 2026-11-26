---
id: E5-T36c
epic: 5
title: Hardware cursor on the published Replay desktop — one pointer, drawn by the host, tip on the pixel
priority: 0.387654
status: pending
depends_on: [E5-T41b]
estimate: S
risk: low
capstone: false
---

## Boundary

Proof and roadmap only: a browser check of the published generation-2 desktop
(`tools/verify/e5-t36c-hardware-cursor-browser.mjs`, new) and the roadmap row. No runtime
change; the pieces are E5-T36a (host hotspot), E5-T36b (session) and E5-T41b (published image).

## Deterministic acceptance

`node tools/verify/e5-t36c-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out evidence/e5-t36c`
on the committed bundle, warm desktop:

- the canvas's computed `cursor` is a `url("data:image/png…") X Y` made from the guest's image
  over the page body, the button and the terminal, with hotspots (1,1), (9,4) and (4,8);
- for each of those, the guest pixel under the hotspot is where the page sent the pointer: the
  kernel's cursor-plane position plus the hotspot equals the sent guest position within one
  pixel (`/sys/kernel/debug/dri/0/state`);
- a screenshot of the canvas contains no painted pointer at the pointer's position (compared
  with the same region after the pointer has moved away);
- zero console errors.

## Adversarial verification

Low risk: inspect the direct result.

## Verification log
