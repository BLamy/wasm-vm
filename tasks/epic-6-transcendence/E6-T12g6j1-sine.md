---
id: E6-T12g6j1
epic: 6
title: Admit bounded sine evaluation for captured compositor equations
priority: 525.027010578
status: in-progress
depends_on: [E6-T12g6i]
estimate: S
risk: high
capstone: false
---

## Boundary

Add SIN only with a bounded finite argument domain and stated hardware numerical budget. Preserve private/numeric provenance and use-site/conditional validity. No unbounded range-reduction or POW admission.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

The admitted argument encodings are normal-or-zero in [-8,8], proved from
conservative post-modifier source facts at every use. SIN consumes post-swizzle
x once and replicates its result before masked or aliased publication. Results
retain inherited numerical authority and bank dependence but no static range,
exact word, or F2I facts. Opaque/unbounded sources and unsupported modifiers
remain rejected.

The physical acceptance budget is absolute error <=2^-20 against independently
enclosed real sine values. ESSL 3.00 section 4.5.1 specifies no trigonometric
precision guarantee; this budget is measured on the recorded hardware, and
production integration must establish any supported host guarantee separately.
Record the conservative maximum observed error for each backend.

The pinned TGSI token/documentation requires scalar replication, while the
pinned reference converter emits componentwise sin. Retain its actual sources
and independently predicted componentwise equations, record concrete deviations
for nonbroadcast inputs, and compare canonical broadcasts and the two literal
captured broadcast statements against the same scalar references. Known
initializers isolate those statements; they do not establish either full body
or the bounds of its original computed arguments.

## Deterministic acceptance

`make verify-E6-T12g6j1`: Independent high precision sine values at zeros, quadrants, critical neighbors and varied bounded inputs, aliases/modifiers/lane masks and branch joins. Pinned Mesa differential plus actual WebGL2 outputs and domain/source faults. Record maximum observed error without deriving the expected result from emitted GLSL.

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

### 2026-10-04 — worker — activated

The human requested continued graphics offload implementation. The prerequisite
EX2/LG2 boundary is verified at `322bb56ee95ef9e2fb26b85179d61ae51efbbf5f`;
its fresh critic seal is authenticated. This ordered S/high leaf is next within
that requested scope. Use exact rational alternating-Taylor enclosures at
220/280 bits, original source bindings, and one final pristine clone. The
measured-platform budget and pinned converter discrepancy remain explicit.
No runtime proof or implementation claim is made by this activation.
