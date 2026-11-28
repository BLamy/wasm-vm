---
id: E5-T46
epic: 5
title: Replay desktop — sway's pixman compositing is most of a click; cut the blended and filled area
priority: 0.3876638
status: pending
depends_on: [E4-T40c1]
estimate: S
risk: medium
capstone: false
---

## Why

E4-T40c1 (`evidence/e4-t40c1/`): about 19 M of the ~26 M guest instructions a click costs are sway's libpixman
`fast_composite_over_8888_8888` (alpha blending, 102 k samples over 8 clicks) and `fast_path_fill` (46 k) — wlroots
0.17's pixman renderer, generic C on riscv64. A click redraws far more pixels than its button.

## Boundary (investigate first, then fix in the guest image)

Find why: (a) whether wlroots repaints the whole output or only the damage on this legacy-KMS, dumb-buffer swapchain
(buffer age), e.g. `WLR_SCENE_DEBUG_DAMAGE=highlight` and a screenshot (`grim`); (b) whether Chrome's and foot's
surfaces declare opaque regions (an opaque surface is copied, not blended, and what it covers is not filled);
(c) how much each client damages per frame. Fix in the image (session environment, sway config, client flags) —
no emulator change.

## Deterministic acceptance

Same bundle, interleaved: click result and key echo faster than generation 4; the pixman share of a click's samples
lower (`tools/perf/code-page-concentration.mjs`); E5-T36b/E5-T43c/E5-T43f acceptances pass; nothing drawn wrong
(screenshots).

## Verification log
