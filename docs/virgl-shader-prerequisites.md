# Read-only T12e prerequisite proposal

All 19 raw TGSI SHA-256 names were independently recomputed. Outcome labels are the verified T10d receipt, not a new execution run. No repository files were changed.

## Exact original inventory

| SHA-256 | Stage | T10d outcome | PRECISE | Workloads |
| --- | --- | --- | --- | --- |
| `003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605` | FRAG | unsupported-feature | False | kmscube |
| `0ec6a7a8741638e5a62cbf4a1f6896dd91bb2d60182e8e01f60866adf40fbed6` | VERT | translated | False | compositor,glmark2-es2 |
| `12f6d594f42e244d2d35c6a0b51cee809d219cc0729d9cee697b40725139f373` | VERT | unsupported-feature | True | glmark2-es2 |
| `23b5f8a83172e68c9365028d2f3fedbb4d0a12d3b02a39b694388e89304910d3` | VERT | translated | False | glmark2-es2 |
| `3f78a90d838490257666b66477683b24c6ff110c6469504ecba701815312a572` | VERT | unsupported-feature | True | compositor,glmark2-es2 |
| `403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c` | VERT | unsupported-feature | False | compositor,glmark2-es2 |
| `5a243fc7a19476612a000906c6060a6c1883fee7f2d87d7137d508269a0cd998` | FRAG | unsupported-feature | True | glmark2-es2 |
| `616a643d02f33f502b08d9bd6368de93ba1bd9c7e6bacdee0e0aa946a2c3e4ad` | FRAG | unsupported-feature | True | glmark2-es2 |
| `67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa` | FRAG | parse-error | False | compositor,glmark2-es2 |
| `80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808` | FRAG | translated | False | textured-scene |
| `9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83` | FRAG | unsupported-feature | False | glmark2-es2 |
| `a6143f113a7d0a3ce6118a518c12bc7c537bebfdfa9a0af6580496709188379e` | FRAG | unsupported-feature | True | glmark2-es2 |
| `b28f0dbcbc79d9931938c29cb77b62a42ba8e95d65bbd1a720d9aecd3f8ec030` | FRAG | translated | False | compositor,glmark2-es2 |
| `c00de140c2e9b128f07f7fba74bd60f3257b832d3251ae52a044bf8e68d90518` | FRAG | translated | False | compositor,glmark2-es2 |
| `d4f702f7a846a93b6f767bc73ed99a9c0f4fbe5fcb55662bca99e3f07f47d450` | VERT | unsupported-feature | True | kmscube |
| `e911b393909ab041c24f608b41497143eba765cc8d7db1206a47896934d43c51` | FRAG | unsupported-feature | True | glmark2-es2 |
| `e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33` | VERT | translated | False | textured-scene |
| `e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551` | VERT | unsupported-feature | False | glmark2-es2 |
| `ef095954837a421fd04071ffd1d99e70f56b258614d47a40fc9148238d6d3c88` | FRAG | translated | False | compositor,glmark2-es2 |

## Corrected smallest executable boundary

Five rejected non-PRECISE originals have no integer or control-flow instructions. Close their declaration/lane/interpolation boundary first: retain the existing MOV/ADD/MUL/MAD/TEX/END opcode set and 16 KiB text / 8192-token / 128-instruction budgets; add bounded CONST ranges, TEMP indices through 9, generic xyz declarations, checked partial MOV/ADD/MUL writes, and initialized-lane accounting. Handle the CONSTANT fragment interpolation explicitly as flat. Keep PRECISE, loops, integer opcodes, ADDR and indirect indexing rejected. Target exactly 12 accepted original hashes and seven PRECISE-containing rejections; acceptance does not mean whole workload compatibility.

| Newly targeted original | Missing syntax |
| --- | --- |
| `003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605` | FRAG generic xyz; partial TEMP xy/x/y writes; read initialized xy through 2D TEX and x/y through xxxy. |
| `9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83` | Same declarations and lane requirements; final MUL operands exchanged. Preserve both original hashes. |
| `403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c` | CONST[0..2], TEMP xyz MUL/ADD, OUT[0].xyz ADD followed by w write. |
| `e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551` | CONST[0..3], declared TEMP[6..9] (actual arithmetic uses TEMP0..5). |
| `67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa` | GENERIC CONSTANT interpolation; valid captured TGSI outside current PERSPECTIVE-only guard. |

## Flat-link boundary

The zero-key single-stage bridge can translate a flat FS, but upstream derives VS output interpolation from fragment interpolation information. Explicitly expose interpolation metadata. The smallest isolated bridge acceptance can link the unchanged original FS with a literal flat-output GLSL VS and prove flat pixels. If automatically linking two translated TGSI stages is required, define a separate internally derived pair-link API/key; never expose arbitrary shader keys or rewrite captured TGSI. This coupling must be stated before activation.

## Independent browser oracles

Use both unchanged texture/tint fragments with xyz varyings and independent 2D texels; render the matrix/affine vertex bodies with non-identity constants affecting distinct lanes; link the original flat FS against an independently authored flat VS and use differing per-vertex colors so smooth interpolation cannot satisfy the oracle. Retain the earlier nine literal draws and three captured scene phases. Hash all 19 unchanged bodies, native/Wasm generated GLSL and metadata; require actual ESSL300 compilation/linking and pixels for new claims. Attack overlapping/reversed/oversized ranges, register9/10 edges, read-before-write in selected lanes, noncontiguous masks, incomplete outputs, and qualifier mismatches. A mask or selected-lane omission must fail literal pixels.

## Deferred integer/control flow

The captured plain integer/comparison opcodes are AND, OR, NOT, ISGE, USEQ, USNE, UCMP, UADD, SHL, USHR and UARL; comparisons also include FSLT/FSGE. Structured control uses UIF, ELSE, ENDIF, BGNLOOP, BRK, ENDLOOP. Every containing original also includes PRECISE. There is no original plain IF or CONT in this inventory. Scalar negation, CONST ranges through45, TEMP declarations through117, component writes and UINT32 integer bit patterns are coupled requirements. Bodies a614… and e911… also exceed the present128 instruction cap (179 and141 including END).

Only 616a643d… and e911b393… contain loops. Their loop does UARL ADDR[0].x, indirect CONST[ADDR[0].x], unsigned update/shift operations and a break conditional involving runtime CONST[9]; instruction count alone does not bound execution or indirect memory. Preserving original semantics cannot be achieved by silently inserting a fixed loop cutoff or removing PRECISE. A future bounded static literal loop contract can be proved separately, but must not be labelled original-corpus acceptance.

## Pinned primary source anchors

- `renderer/virgl-shader/UPSTREAM.json:1–16`: virglrenderer1.3.0, commit ca50e008863837e094747a69974dde3ae148aeaa; Emscripten4.0.22.
- `renderer/virgl-shader/bridge.c:110–170,198–260,278–316`: present bounds, component guard, full-TEMP initialization, range restrictions, instruction allowlist and immediate restrictions.
- `vendor/src/gallium/auxiliary/tgsi/tgsi_util.c:167–344`: effective source usage; componentwise operations consume destination lanes, 2D TEX consumes xy, then swizzle maps to source lanes.
- `vendor/src/vrend/vrend_shader.c:6383–6400,7000–7018,7762–7786`: CONSTANT→flat and fragment-driven vertex interface qualifiers.
- `vendor/src/gallium/auxiliary/tgsi/tgsi_text.c:935–1008,1219–1238`: source negate/absolute syntax and optional branch labels parsed as tokens.
- `vendor/src/gallium/auxiliary/tgsi/tgsi_info.c:317–394,452–485`: signed/unsigned/untyped opcode typing.
- `vendor/src/vrend/vrend_shader.c:2534,4655–4692,5615–5630,5741–5786,5845–5910,5940–5955`: bit reinterpretation, all-ones comparison masks, UIF x condition, unsigned arithmetic/shifts, UCMP and unbounded do/while lowering.

Vendor paths above are relative to renderer/virgl-shader. No production activation, general shader compatibility, compositor rendering, FPS or MIPS claim is proposed.
