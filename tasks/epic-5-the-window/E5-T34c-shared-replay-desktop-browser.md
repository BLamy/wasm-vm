---
id: E5-T34c
epic: 5
title: Boot the shared Replay Chrome and Node 26 desktop in the browser demo
priority: 0.3873
status: in-progress
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

(empty)
