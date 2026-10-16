# E6-T12e1 independent predictions — before worker evidence

Role: independent critic, no implementation contribution. These predictions were
written after reading the task and draft guard, before inspecting worker results.
The prior T11c verdict does not prove this new shader boundary. Worker evidence
was not present at orientation. Heavy native/browser builds are deferred until
coordination and final source handoff; preparation is not execution evidence.

Activation: `ebd18189`; verified parent:
`fa7114021eef485be362754320cce4c06583d695`. Final runtime/head and dependencies
must be rebound after freeze; current draft bytes are recorded separately.

| ID | Falsifiable prediction and failure point | Planned independent oracle |
|---|---|---|
| C01 | All 19 original bodies retain their exact bytes. Exactly the prior seven plus task hashes 00327010, 9819066d, 403b0529, e9bc6d3b translate; all eight remaining hashes return explicit failures. No captured body is rewritten, substituted, or preprocessed into a different semantic body. | Hash originals independently, identify outputs by full hash, compare native/Wasm outcome and metadata records. |
| C02 | TEMP9 declaration/write/read succeeds; TEMP10, CONST8, IN8, OUT8, IMM8, SAMP8, SVIEW8 and GENERIC8 reject. The larger backing array does not widen any non-TEMP authority. | Literal boundary cases in native sanitizer and actual Wasm, positive controls at index7/semantic7. |
| C03 | CONST and TEMP inclusive ranges are accepted only within their respective 0–7/0–9 banks; reversed, overlapping, duplicate, oversized, huge numeric, negative, indirect and non-permitted file ranges fail without assertions, OOB or poisoned following requests. | Independent exact text mutations, valid request after every rejection, sanitizers; gaps reflected in uniform count. |
| C04 | GENERIC xyz is admitted for matching existing stage semantics. Partial POSITION/COLOR/TEMP/CONST declarations, single-lane declaration masks, duplicate/unordered/noncontiguous masks remain rejected. xy compatibility survives. | Stage-specific literal declarations, metadata componentMask7/3 and linked real shaders. |
| C05 | MOV/ADD/MUL allow single x/y/z/w, xy, xyz destinations for declared OUT/TEMP lanes; existing unmasked vec4 forms remain. MAD/TEX partial destination writes remain rejected. Explicit unsupported destination masks cannot reach upstream. | Enumerate masks and opcodes independently; assert every declared output lane written before END. |
| C06 | The register's initialized bits accumulate only after a whole valid instruction. A write to x does not initialize y/z/w, and a read cannot use the same instruction's future writes. | Reject read-before-write and self-alias first write; accept independently initialized lane chains and read-modify-write of already initialized x. |
| C07 | Componentwise consumption selects destination lanes before applying ordered source selectors. For `.w`, only source selector position3 matters; `.xyz` uses selector positions0/1/2. Missing only unconsumed selectors is accepted; one missing selected component rejects. | Literal programs initialized only in x/y, paired changing only consumed/unconsumed swizzle positions; no use of product helper to compute expectation. |
| C08 | Repeated source selectors are legal: TEMP initialized only x can feed full output through xxxx. Masked swizzles such as wwww fail only if consumed w is unavailable. The distinct order in xyzw matters even though the set of letters can be equal. | Native acceptance/rejection plus actual pixel tuple with distinct lane values. |
| C09 | 2D TEX consumes only xy after source swizzle. Uninitialized z/w in its coordinate TEMP must not reject when unused, but an xy selector mapped to uninitialized z/w must reject. Full texture destination initializes all four lanes. | Independent texture source selectors and asymmetric 2x2 texels, native/Wasm parity, actual GL draw. |
| C10 | END rejects each missing declared output lane. xyz generic output needs xyz only; full POSITION and COLOR still need xyzw. Partial final write cannot hide earlier uninitialized output lanes. | Four independent omitted-lane cases plus xyz-only generic acceptance and actual link. |
| C11 | Both unchanged new texture fragments compile/link as ESSL300 and multiply RGB by the distinct GENERIC.x brightness while preserving sampled alpha; UV comes from GENERIC.yz in that order. Operand-order difference changes no result. | Literal asymmetric texture, distinct brightness and UV, exact interior pixels; no oracle derived from generated GLSL or guard. |
| C12 | Original 403b0529 computes xyz = C0.xyz*x + C1.xyz*y + C2.xyz and w=1, preserving IN1.xy varying; original e9bc6d3b computes all four position lanes as C0*x+C1*y+C2*z+C3*w. | Independently chosen nonidentity/distinct matrices, known clip coordinates/transform-feedback vectors if supported, actual canvas interior/coverage probes; missing z/w or wrong selector must alter a checked value. |
| C13 | Metadata and native/Wasm GLSL agree exactly for identical input, profile v3, component/written masks, constant gaps/count, attributes/samplers and system block. Real browser reflection/compile/link agrees with binding claims. | Separate native/Wasm result comparison and actual GL binding/reflection; raw float-bit constant upload. |
| C14 | Flat interpolation, all PRECISE-bearing originals and synthetic PRECISE, modifiers, integer opcodes, new flow/opcodes/ADDR/indirection remain rejected. No text cleanup silently drops qualifiers. | Full remaining-original inventory plus targeted grammar suffix/prefix mutations and known-good recovery. |
| C15 | Existing limits remain 16KiB text, 8192 token storage, 128 non-END instructions and old line/GLSL/output caps. The ten-TEMP array introduces no unbounded range/token loop or memory growth. | Just-at/over text/instruction cases and sanitizer mutation/truncation coverage; source-bound token allocation proof. No impossible valid 8193-token profile case inferred. |
| C16 | Prior nine literal draws and three captured textured-scene phases still execute with unchanged intended pixels, sources and resource cleanup. Production negotiation and ordinary built web bytes are unchanged. | Source hashes and final scoped regression records; carry unrelated Rust/default-web findings only across unchanged bytes. |
| C17 | Removing consumed-lane mapping or a masked-lane write causes an independent native or pixel assertion to fail at the intended point. A source-control pass without that intended failure is insufficient. | Served/temporary isolated build mutation, exact error/failed assertion and original/mutated source hashes; never edit runtime in the shared checkout. |
| C18 | Final recordings bind exact source/toolchain/dependency hashes and active assertions/sanitizers. A pristine clone with scrubbed environment passes the same scoped command and stays clean. Every changed executable hunk is hit or has an explicit defensible narrow classification. | Independently rehash receipts/served files, inspect commands and source-bound LLVM/GCOV/V8 coverage as appropriate; no implementation agent used as critic. |

## Independent values selected before results

The two texture fragments use GENERIC `(brightness,u,v)` with brightness 0.5 and
UV chosen at texel centers. Planned 2x2 RGBA8 texels are bottom row red
`(200,0,0,255)`, green `(0,120,0,128)`, top row blue `(0,0,80,64)` and distinct
`(40,60,100,192)`. Expected fragment output texel values are respectively
`(100,0,0,255)`, `(0,60,0,128)`, `(0,0,40,64)`, `(20,30,50,192)` with blending off.
Texture-origin/actual readback row ordering must be stated separately so an
accidental double flip cannot pass. Pointwise shader arithmetic is the oracle,
not historical pixel results from another task.

For affine position, choose C0=(0.5,0.125,0.25,9),
C1=(-0.25,0.5,-0.125,8), C2=(0.125,-0.25,0.5,7).
At input position (0.5,-0.5,0.75,1), expected output is
(0.5,-0.4375,0.6875,1). The input z/w and constant w values are deliberately
irrelevant to that original body. For the full matrix choose
C0=(0.5,0.125,0.25,0.125), C1=(-0.25,0.5,-0.125,-0.25),
C2=(0.125,-0.25,0.5,0.25), C3=(0.125,0.25,-0.25,1).
At the same input, expected clip position is
(0.59375,-0.125,0.3125,1.375). These binary-exact values prevent rounding from
obscuring a changed component; expected values will be independently checked
arithmetically before being used as a test, not adjusted from product output.

## Novel bounded attack

Exhaustively generate lane-initialization subsets and ordered four-selector
swizzles for one instruction, then compare admission to a tiny independent set
oracle: map only destination lanes (or TEX xy) through selectors and require the
resulting set to be within declared/previously-written lanes. Include aliasing
where destination equals source so write-before-validation is observable. Bound
the enumerated subset/seed count before execution and follow failures with a
known-good translation. Use actual GPU pixels for selected distinct tuples;
native-only admission does not prove arithmetic or browser compatibility.

## Coverage plan

Changed C sites include per-file index limit and range endpoints; swizzle identity
initialization/parsing/order; needed-lane map and declaration/init comparisons;
GENERIC xyz admission; partial-opcode gate and TEX-versus-componentwise consumed
mask; metadata version. Exercise both sides of every added branch. Classify
static array sizing/types/constants as configuration, not measured execution.
Test/tooling/contract changes need their own final command and source binding.
Inspect native sanitizer flags and assertions; never equate synthetic hostile
fixture count with coverage. Confirm README/profile contract eventually matches
v3 (the draft README still describes v2; this is preparatory observation, not a
runtime refutation).
