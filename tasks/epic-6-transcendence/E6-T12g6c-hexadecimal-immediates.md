---
id: E6-T12g6c
epic: 6
title: Decode captured hexadecimal FLT32 immediates without numeric reinterpretation
priority: 525.02701057
status: in-progress
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

### 2026-10-04 — worker — activate hexadecimal FLT32 grammar

The human graphics continuation authorizes this ordered compiler boundary after
E6-T12g6b was independently verified at `500ebfde1262e4615c9e15dbc96ecf1c407870f0`. Its frozen capacity proof,
402-case promoted guard and unchanged original-program results remain HELD.
This high-risk S task adds only the pinned `0x` plus eight hexadecimal digits
spelling for FLT32 immediates. The primary source is the pinned
`vendor/src/gallium/auxiliary/tgsi/tgsi_text.c:252-267`: hexadecimal words are
reinterpreted as binary32 bits, not numerically converted from an integer.
Canonical syntax, immediate ordering and prior decimal/UINT32 grammar stay
bounded. Raw private operations may consume exact exceptional encodings;
existing numerical and raster-output authority checks still decide their uses.
The complete c5806d5f/92cb866a programs remain rejected for later capabilities.
Production negotiation, imports, caps and deployment remain gated.

### 2026-10-04 — worker — freeze scoped literal implementation

The only runtime hunk is `bridge.c:literal_float`: eight checked ASCII digits
produce the binary32 word before the pinned parser runs. Raw consumers keep
the existing word/domain analysis; legacy conversion applies the existing
UINT32 normal-or-zero/finite/magnitude gate. Canonical letter case is accepted;
uppercase prefix, signs, short/long forms, C hex floats, suffixes and malformed
terminators reject. Existing decimal/UINT32 parsing and immediate order remain
unchanged. The pinned parser is queried only with complete canonical witnesses.

The affected high-risk submission is `make verify-E6-T12g6c`: strict owned C,
native ASan/UBSan/coverage, 676 singles with 512 primary-token comparisons,
Wasm singles and pairs, 25 unchanged original bodies, the promoted 402-case
G6b guard, three hardware seeds, exact carrier words and bit-plane pixels,
and two emitted-source fault captures. Legacy GLSL differs by immediate type,
so its metadata and physical pixels are compared instead of assuming identical
source. One frozen-head pristine clone follows. G6b's unchanged capacities,
allocation/stack/fixed-memory proofs and other renderer boundaries stay HELD.
This isolated compiler has no production import; the demo/deployment gate does
not apply. No guest graphics or throughput result is claimed.
