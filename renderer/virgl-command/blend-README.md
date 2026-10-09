# Single-target normalized blending

`make verify-E6-T11d2` qualifies the original-form BLEND packet for the current
RGBA8, XRGB8 and XRGB10_A2 render surfaces. It does not enable a production API
or capset. Multiple targets, dual-source factors, logic operations, independent
blend, alpha-to-coverage and alpha-to-one still return explicit errors.

The pinned Gallium C header supplies the equation/factor values through an
independent compiled oracle. The decoder admits ADD, SUBTRACT, REVERSE_SUBTRACT,
MIN and MAX independently for RGB and alpha, and the 15 non-dual source factors
(14 destination factors). Disabled factors may be zero. SRC_ALPHA_SATURATE uses
`min(source alpha, 1 - destination alpha)` for RGB and one for alpha.

Normal draws use native WebGL2 blending. WebGL rejects mixing CONSTANT_COLOR or
its inverse with CONSTANT_ALPHA or its inverse as the RGB source/destination
pair ([WebGL restriction](https://registry.khronos.org/webgl/specs/1.0.0/)). GLES2
permits these pairs ([Khronos factor reference](https://github.com/KhronosGroup/OpenGL-Refpages/blob/main/es2.0/glBlendFuncSeparate.xml)).
For ADD/SUBTRACT/REVERSE_SUBTRACT with exactly those constant pairs, the renderer
folds the clamped source factor into the fragment RGB result and binds native
source ONE with the original destination factor. It clamps RGB before the fold
because the current surfaces store normalized colors. Alpha remains unchanged.
MIN/MAX ignore factors; they use native ONE/ZERO without a fragment variant.
An authenticated terminal discard needs no output variant.

Each variant belongs to its immutable shader pair and subcontext, with the
source-factor choice in its program cache key. Blend color is copied into owned
state and uploaded on every restore, so object destruction, name reuse, poisoned
host state, cache eviction and context/subcontext switches cannot retain a stale
coefficient. Reflection proves the extra vec4 uniform; its components count
against the actual fragment limit. Variant source bytes use the existing bounded
program/shader budget. Errors release native allocations and retain the normal
command-prefix semantics.

The recording contains 2,302 physical frames: every 15-by-14 RGB and alpha factor
pair for all five equations, plus clamps, masks, both saturation branches,
disabled fields, X-alpha storage, A/B/A restoration, real subcontexts, terminal
discard, varied asynchronous fences and allocation/size/uniform-limit recovery.
The JavaScript oracle uses BigInt rationals. A separate Python Fraction oracle
recomputes every pixel from the raw packet/bank/color inputs, checks each recorded
native equation/factor/upload and accepts at most one stored component unit of
UNORM8 or UNORM10 quantization difference. Fault runs swap equations, replace a
destination factor and sabotage the actual folded uniform; all must contradict
their named physical pixel prediction. The acceptance also retains the raster,
indexed, resource, asynchronous and cache gates.

Worker submission freezes the source, runs acceptance and one pristine exact-head
clone, then seals the raw pixels, complete packets/TGSI/ESSL/reflection, browser
identity, screenshot, V8 coverage and compiled source closure. Only a fresh
adversarial verifier may mark this isolated prerequisite verified.
