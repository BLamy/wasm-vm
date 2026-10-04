---
id: E6-T12g6c
epic: 6
title: Decode captured hexadecimal FLT32 immediates without numeric reinterpretation
priority: 525.02701057
status: implemented
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

### 2026-10-04 — worker — claim submitted for independent criticism

Runtime and all acceptance sources were frozen at
`5a039d16b2bfd756f6908a718ea063ad7c619905` (base verified G6b:
`500ebfde1262e4615c9e15dbc96ecf1c407870f0`). The only later worker changes
are this claim/status, regenerated queue and immutable recording artifacts.
Commands:

```sh
make verify-E6-T12g6c
python3 tools/virgl-hex-literals/cold.py --output target/evidence/virgl-hex-literals-cold
python3 tools/virgl-hex-literals/seal.py --hot target/evidence/virgl-hex-literals --cold target/evidence/virgl-hex-literals-cold --output evidence/virgl-hex-literals/worker
```

The exact-source hot and pristine-clone submissions passed. Each records 676
native ASan/UBSan cases, 512 canonical complete primary-parser word comparisons,
676 matching public Wasm singles and 676 compatible/rejected pairs. Decimal and
UINT32 controls preserve their existing admission/domain outcomes; the raw
path's emitted GLSL and metadata match UINT32 exactly. Malformed/truncated,
overlong, signed/prefixed/suffixed hex and immediate ordering violations reject
without partial source. Exceptional bits survive only in permitted private
operations; their copied/numerical uses retain the prior UINT32 restrictions.
Native LLVM coverage executes all branches/statements in the new hexadecimal
runtime hunk (`native/coverage.json`, bridge.c:246–275; comments waived).

Physical headed Chrome/Apple WebGL2 seeds `883475089`, `2552332019` and
`3860417495` each check 13,344 exact feedback words (including every exponent
class and full reconstruction of literal bits) and 5,184 pixels from all 32
bit planes and legacy controls. All GL objects are physically deleted; console,
page, request and GL error checks are empty. Vertex source corruption changes
expected word `1056964609` to observed `1056964610` at edge-0 vector0 lane6.
Fragment source corruption changes expected RGBA `[0,0,255,255]` to observed
`[0,0,0,255]` at edge-0-plane-0 pixel0. Both are caught by independent oracles.
The promoted 402-case join/bank guard passes in native and Wasm; all 25 complete
original bodies retain 23 admissions and unchanged GLSL/metadata. The two
larger originals stay rejected. G6b resource/arena/stack claims and unchanged
renderer leaves remain HELD; no new authority or production import is present.

Evidence of record: `evidence/virgl-hex-literals/worker/{manifest.json,
records.json,recording.tar.gz}`. The deterministic archive has 62 members,
4,479,069 bytes and SHA-256
`6aa1b74273563be5ae6aabaef307904b2362a1584edd344a7b27bc9281ac1ace`;
the record index SHA-256 is
`e83b840de0bac0804cf99e649549fb58f50b5b261f803418ffaeecbcaa708577`.
Hot receipt SHA-256:
`de1d05fd7fc216affbdb70addbef8ca9df10fd6bddecad1ac3b2795423117dba`;
cold report:
`e69c7e9ee574419d4f26778154468c20210214ddfbe370ff2cfbbca98decb40b`;
cold receipt:
`fa724009f00209e7fbd0217d118a172d77552edcd1a8bd55fbf10b3bd23f286d`.
Both receipts bind 195 source/generated hashes and complete diagnostic/capture
records. The cold clone has exact source HEAD and empty status before/after;
its log digest is
`51edce23aa2e8662d18caad9736f00b620063f0c0fcd080a73ab08c9434112bf`.
Expanded diagnostics are in `target/evidence/virgl-hex-literals` and
`target/evidence/virgl-hex-literals-cold`. Screenshots, actual framebuffer and
feedback bytes, pinned-parser words, fixed input fixtures, sanitizer profiles
and browser coverage are sealed for a fresh adversarial verifier. No throughput
or accelerated desktop claim is made.
