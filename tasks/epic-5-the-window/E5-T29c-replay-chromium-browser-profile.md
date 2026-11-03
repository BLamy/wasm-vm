---
id: E5-T29c
epic: 5
title: Launch and use the Replay Chromium desktop in the wasm-vm demo
priority: 0.383
status: pending
depends_on: [E5-T29b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Expose the qualified Linux/Chromium profile through the existing software-display
browser path. Keep the package/source identities pinned, use coherent native
startup artifacts where supported, and surface the capability honestly in web/
and roadmap.js. The existing demo and other profiles must continue to work.

## Deterministic acceptance

`make verify-E5-T29c`

Build the affected wasm/web target, load the built page with Playwright, and prove
that the visible guest browser executes JS/WASM/canvas with the genuine Replay driver enabled and responds to real DOM
keyboard/pointer input. Require an actual recording of those actions and successful validation/replay
through Replay's implementation; recording-disabled browsing cannot pass. Keep
private backend source and driver artifacts local unless publication is authorized.
Record actual input effects, guest state/digests, startup
and interaction timing, and a screenshot. Require zero host-page console errors
and the unchanged live ISA suite passing (or its new exact total). Compare only
bounded measured clock/startup options; do not assert a fastest distro without
measurements. Commit web/dist and publish the verified assets/demo to Cloudflare
with no GitHub Actions. Verify the live launch path and preserve its URL/evidence.

## Adversarial verification

Medium risk: authenticate the browser's actual wasm and image inputs, distinguish
fresh guest work from cached host pixels, test one bounded failure/input case,
and inspect live publication. Use a final pristine checkout for the deployment
claim. Do not treat an unsandboxed browser, QEMU screenshot, or static success
panel as execution on wasm-vm. No merges or upstream Replay publication.

## Verification log

(empty)
