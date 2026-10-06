---
id: E6-T12g6m5b2a
epic: 6
title: Authenticate original 92cb viewport and raster power-base domain
priority: 525.02701058221
status: in-progress
depends_on: [E6-T12g6m5b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Independently bind every original 7bf4/92cb draw's active viewport, framebuffer extent, sample count, and quad geometry to the captured command/resource state. Determine the exact *ideal pixel-center* envelope for the two first pc221/222 `POW` bases, and explicitly reject a portable numeric lower bound without a stated interpolation and arithmetic error budget. This is capture evidence only; neither the translator nor a future renderer DRAW may assume it.

## Deterministic acceptance

`make verify-E6-T12g6m5b2a` replays all 1,957 selected draws and packet/snapshot citations, emits per-bank ideal pixel-center bounds with independently checked original packet bytes, and rejects viewport, sample-count, and bank substitutions. Native/Wasm numerical auditors agree byte-for-byte for all covered framebuffer pixel centers; an independent rational oracle checks their complete output and report fields. Record exact-head command-capture evidence and a pristine clone; submit to a fresh critic. Existing full-original rejection remains unchanged.

## Adversarial verification

Attack signed viewport, clipped edges, multisampling, half-pixel assumptions, center crossings, resource and bank lifetimes, and any ideal center that makes a zero or subnormal base. Verify that the artifact denies numeric compiler authority: an ideal geometric gap does not establish a portable hardware interpolation/error budget. Every cited state must be live at the draw.

## Verification log

### 2026-10-05 — worker — activation

E6-T12g6m5b1's complete quad/bank provenance is verified at `d7e091c9b90a97bb2f4417d29193d372a4e5b3a0`. The original viewport observed at the three first draws is event 648/offset 4844, but that observation alone does not prove its live identity at every selected draw or a half-pixel lower bound. This task will replay that state and either prove the raster domain under a documented precision budget or reject the lower-bound claim.
