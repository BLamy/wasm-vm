---
id: E6-T12e1
epic: 6
title: Admit bounded declaration ranges and initialized component writes
priority: 525.0269901
status: in-progress
depends_on: [E6-T11c]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend the existing straight-line MOV/ADD/MUL/MAD/TEX/END profile only enough
to accept these four unchanged original bodies:

- `003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605`
- `9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83`
- `403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c`
- `e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551`

Add CONST declaration ranges within the existing constant bank and TEMP
indices through 9. Preserve existing IN/OUT/IMM/SAMP/SVIEW limits. Add GENERIC
xyz declarations and x/y/z/w, xy and xyz destination masks for MOV/ADD/MUL;
keep the existing full-vector operation forms. Unsupported noncontiguous,
duplicate or unordered destination/declaration masks remain rejected.

Track initialized lanes per register. Determine each instruction's consumed
source lanes from its opcode and destination mask before applying its source
swizzle: componentwise arithmetic consumes the destination lanes, and 2D TEX
consumes xy. A repeated source swizzle may select already initialized lanes;
unconsumed source lanes must not create false uninitialized-read failures.
Every lane consumed by an admitted instruction must be declared and initialized,
and all declared output lanes must be written before END.

Keep 16 KiB text, 8192 tokens and 128 instructions. Do not add opcodes,
modifiers, flat interpolation, integer interpretation, structured control flow,
ADDR, indirect indexing or PRECISE. Do not rewrite captured text.

## Deterministic acceptance

`make verify-E6-T12e1` hashes every original body and requires exactly 11 of
19 to translate: the existing seven plus the four hashes above. Record every
remaining rejection by hash and reason. Require native sanitizer/Wasm output
and metadata parity, actual ESSL300 compile/link, and independent pixels for
both original texture fragments and both original affine/matrix vertex bodies.
Use distinct non-identity constants and components so a dropped xyz lane or
wrong source swizzle cannot pass. Preserve the prior nine literal draws and
three captured textured-scene phases. Record final exact-head and clean-clone
evidence. Production negotiation and full-workload compatibility stay unchanged.

## Adversarial verification

Attack reversed/overlapping/oversized declaration ranges, numeric overflow,
TEMP9 versus TEMP10, existing per-file index boundaries, missing selected lanes,
read-before-write, repeated source swizzles, malformed masks and incomplete
outputs. Sabotage one consumed-lane computation or masked write and require an
independent pixel/native assertion to fail. The flat fragment and every
PRECISE-bearing original must remain rejected.

## Verification log

### 2026-10-03 — worker — activated

The independently verified T11c parent is `fa7114021eef485be362754320cce4c06583d695`
(PR414). The original-hash inventory selects this smallest declaration/lane
boundary before integer, flow and precision work. No other task is active.
Production GPU negotiation remains disabled. This isolated shader C/Wasm profile
uses the affected sanitizer/native/Wasm/hardware-browser risk-tier gates and a
final pristine clone; unchanged Rust and default-web targets carry forward.

