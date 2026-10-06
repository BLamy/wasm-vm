---
id: E6-T12g6m5b2a
epic: 6
title: Authenticate original 92cb viewport and raster power-base domain
priority: 525.02701058221
status: pending
depends_on: [E6-T12g6m5b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Independently bind every original 7bf4/92cb draw's active viewport, framebuffer extent, sample count, and quad geometry to the captured command/resource state. Determine a conservative finite and positive-normal-or-zero envelope for the first pc221/222 `POW` bases at all covered sample centers, or soundly reject such a domain. This is capture evidence only; neither the translator nor a future renderer DRAW may assume it.

## Deterministic acceptance

`make verify-E6-T12g6m5b2a` replays all 1,957 selected draws and packet/snapshot citations, emits per-bank viewport/raster bounds with independently checked original packet bytes, and rejects viewport, framebuffer, sample-count, clipping, subpixel, bank, source, and draw-state substitutions. Native/Wasm numerical auditors agree byte-for-byte over edge/interior and exceptional inputs. Record exact-head guest-layer evidence and a pristine clone; submit to a fresh critic. Existing full-original rejection remains unchanged.

## Adversarial verification

Attack signed viewport, clipped edges, multisampling, half-pixel assumptions, interpolation precision, center crossings, resource and bank lifetimes, and any sample that makes a positive subnormal base. Demand a stated interpolation/error budget or reject the lower bound; finite endpoint maxima alone do not prove the lower domain. Every cited state must be live at the draw.

## Verification log
