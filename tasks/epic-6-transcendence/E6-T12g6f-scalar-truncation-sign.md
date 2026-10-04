---
id: E6-T12g6f
epic: 6
title: Admit bounded scalar truncation and sign operations
priority: 525.027010573
status: in-progress
depends_on: [E6-T12g6e]
estimate: S
risk: high
capstone: false
---

## Boundary

Add finite numeric TRUNC/SSG and preserve existing numeric versus raw private authority. State signed-zero and result-domain behavior from the pinned TGSI primary source. No precise floor/fract or saturating modifier.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6f`: Literal scalar word/pixel predictions for negative/positive fractions, integer neighbors, both zeros, lane/swizzle/modifier cases and inherited finite input restrictions. Native/wasm and independent actual hardware outputs, raw-sign/subnormal/domain attacks, source-fault sensitivity and existing numeric profiles.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

### 2026-10-04 — worker — activation

Activated this S/high boundary above independently verified G6e `58601f91`.
Pinned TGSI defines component-wise TRUNC as dropping fractional bits toward
zero and SSG as +1/-1/0 for positive/negative/zero inputs. This bounded owned
profile preserves the TRUNC source zero sign and gives SSG canonical positive
zero for both input zero signs. Ordinary unmodified Mesa GLSL comparisons
permit either encoding of a mathematical zero, following the pinned GLSL ES
floating contract; owned full-word checks require the declared exact policy.
Both operations require existing finite numeric authority; raw private
integer encodings gain no new numeric access. Preserve prior finite-bank,
input, mask/swizzle/modifier, alias/version/join and conversion obligations.
Implement unsigned word helpers over approved source encodings, one bounded
outer profile, native/Wasm and actual physical-word/pixel evidence, varied
seeds, real source faults and one final pristine clone. Production negotiation,
complete captured compositor admission and FPS/MIPS remain gated. Fresh
independent verification must hold before the next dependent activates.
