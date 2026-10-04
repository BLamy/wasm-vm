---
id: E6-T12g6c
epic: 6
title: Decode captured hexadecimal FLT32 immediates without numeric reinterpretation
priority: 525.02701057
status: pending
depends_on: [E6-T12g6b]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only the pinned TGSI hexadecimal FLT32 bit spelling needed by c5806d5f. Decode exact 32-bit words; preserve the decimal/UINT32 grammar and contiguous immediate declarations. No new numeric opcode or raster input.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6c`: Literal pinned upstream parser/spec comparisons, all zero/sign/subnormal/finite encodings in raw private operations, malformed/truncated/overflow/noncanonical hex, native/wasm equality and independent physical word captures. Numerical-use and output-domain restrictions remain enforced; hex spelling must not grant authority to NaN/infinity/subnormal copied raster lanes.

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

(empty)
