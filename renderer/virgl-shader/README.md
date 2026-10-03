# Bounded VirGL shader bridge

This isolated module reuses virglrenderer 1.3.0's TGSI text parser and GLSL
converter. It supplies a bounded shader translation boundary to the proof-only browser
renderers. Production GPU negotiation remains disabled; this module does not
establish general Mesa or guest desktop compatibility.

## Build and reproduce

From the repository root:

```sh
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh sanitize
EMCC="$(bash tools/setup-virgl-emsdk.sh)" bash renderer/virgl-shader/build.sh wasm
make verify-E6-T10a
make verify-E6-T10d
make verify-E6-T12e1
make verify-E6-T12e2
```

Native builds require Clang, a C11 standard library, and Python 3.9 or newer.
The sanitizer target runs AddressSanitizer and UndefinedBehaviorSanitizer with
immediate failure enabled, assertions enabled, all six literal shaders, explicit
hostile cases, every truncation of a valid input, and 4,096 deterministic
mutations followed by successful conversions. Native checks do not establish
WebGL compatibility; the headed hardware-browser gate compiles, links, binds,
draws, and checks exact interior pixels from the literal corpus in `tests/`.

The WebAssembly toolchain is Emscripten **4.0.22**, emsdk commit
`15915cad554b707837024dc2758b6a1c5b94b036`, release artifact
`bebaf7e50e31865b0724f17eaa52e161e2dfef5a`. `build.sh` checks the compiler version.
Use the setup script's returned wrapper so the compiler uses its bundled Python
rather than an incompatible system Python. The Wasm module has a fixed 16 MiB
memory and 256 KiB stack, with no memory growth or filesystem. Generated build
artifacts stay in ignored `build/`.

`verify-E6-T10d` additionally compiles and executes the two unchanged TGSI bodies
from the recorded guest textured scene. It checks three original indexed draws
against 768 literal interior pixels, compares native and Wasm translations, runs
the shared malformed-grammar cases under sanitizers and Wasm, and requires a
texture sabotage to fail its pixel oracle. `verify-E6-T12e1` additionally executes
four unchanged originals using declaration ranges and component writes: the two
texture/tint fragments `003270…` and `981906…`, affine vertex `403b05…`, and matrix
vertex `e9bc6d…`. `verify-E6-T12e2` additionally admits unchanged flat fragment
`67c701…` and pairs it with a translated vertex shader. Exactly twelve of the
nineteen original bodies translate; all seven PRECISE-bearing originals remain
rejected. These are
explicit workload bindings; they do not establish full workload compatibility.

The component sanitizer target is `build.sh component-sanitize`. Its runner is
`tools/virgl-components/native.py --binary
renderer/virgl-shader/build/component-sanitize/component-test --output DIR`.
The runner hashes the four original inputs and `tests/component-cases.json`,
records complete translations and boundary results, and runs every original byte
truncation plus 4,096 mutations with four-original recovery after each case.
Shared cases cover all 55 TEMP ranges, all 36 CONST ranges, and 64 combinations
of initialized, destination and selected source lanes. The historical 112-case
negative fixture retains its rejection contract: eleven newly valid inputs were
replaced with adjacent invalid range, unwritten-lane or incomplete-output inputs;
their admitted forms are tested positively in the component fixture. In v4, the
old CONSTANT rejection in each shared negative fixture is replaced with the
adjacent unsupported `CONSTANT, CENTROID` form. The valid flat forms are covered
by the pair fixture, preserving the historical negative-case counts.

The pair sanitizer target is `build.sh pair-sanitize`, followed by
`python3 tools/virgl-pairs/native.py --binary
renderer/virgl-shader/build/pair-sanitize/pair-test --output DIR/native`. It
hashes all nineteen originals and `tests/pair-cases.json`, checks complete
standalone/pair results and literal semantic expectations, then runs truncations,
invalid bytes and four deterministic mutation seeds. Four distinct pair outputs
and standalone smooth-VS/flat-FS outputs must recover exactly after every case.

## JavaScript contract

```js
import { createVirglShaderBridge, LIMITS } from "./renderer/virgl-shader/index.mjs";
const bridge = await createVirglShaderBridge();
const result = bridge.translate({ stage: "vertex", text: tgsiText });
if (!result.ok) console.log(result.error.code, result.error.message);
else console.log(result.glsl, result.metadata);
```

Factory options are Emscripten loading options, such as `locateFile`; they are
trusted application configuration. Translation requests accept exactly `stage`
and `text`; unknown enumerable string request keys are rejected, including
shader-key overrides. The pair request described below rejects every unknown own
key, including symbols and non-enumerable keys.
`LIMITS.registerIndex` remains 7 and `LIMITS.temporaryRegisterIndex` is 9.
Each factory call creates separate Wasm memory. Calls are synchronous and
serialized. Returned strings and objects own their data; the adapter frees its
input allocation in `finally` and does not return any view into Wasm memory.

Success is `{ok: true, glsl, metadata}`. Failure is
`{ok: false, error: {code, message}}`. Error codes are `invalid-input`,
`input-too-large`, `unsupported-stage`, `unsupported-feature`, `parse-error`,
`translation-error`, `incompatible-interface` (pair semantic/component mismatch),
and (JS input allocation only) `allocation-failed`.
Errors indicate rejection, not a fallback shader. Repeated rejected inputs do
not reset or poison the instance. Native users can call `bridge_translate` from
`bridge.h`; its static JSON result is borrowed until the next serialized call.
The native CLI reads stdin and accepts one argument, `vertex` or `fragment`.

The fixed upstream configuration is GLSL ES 3.00, GLES/core profile, integer
support, one draw buffer, fragment lower-left origin, and otherwise zero shader
key state. Pair translation additionally derives only the matching vertex
interpolation interface from checked fragment declarations. No caller-supplied
rasterizer, alpha-test, clipping, swizzle, stream-output or arbitrary shader key
is accepted.

### Pair translation

```js
const pair = bridge.translatePair({ vertexText, fragmentText });
// Success: {ok:true,vertex:{glsl,metadata},fragment:{glsl,metadata},interfaceKey}
```

Both fields must be own string-valued data properties; getters, missing fields,
unknown keys and failed reflection reject before Wasm allocation. Each text
keeps the single-stage bounds, for at most 32,768 input bytes per pair. No source
is rewritten. Both original texts are grammar-checked before upstream conversion;
each declared fragment GENERIC input needs a matching, fully written vertex
output covering its declared components. Upstream first converts the fragment,
then its value-only interpolation export is checked against the bounded profile
before being used in an otherwise-zero vertex key. Each conversion owns and
frees its output strings and shader-info arrays independently. No upstream
ownership pointers escape or become persistent compiler state.

`interfaceKey` is `generic-interpolation-v1:` followed by entries sorted by
GENERIC semantic index, such as `g0/15/flat;g1/3/smooth`; an empty interface has
only the prefix. The decimal component mask and interpolation mode are both
included. The renderer must bind program reuse to this effective interface and
selector generations; a vertex shader compiled for a smooth consumer cannot
serve a flat consumer unchanged. `bridge_translate_pair` exposes the same native
operation in `bridge.h`. Pair failure returns only the ordinary structured error,
never a partial stage. The synchronous JS wrapper frees both input allocations
in `finally` and owns all returned JSON data.

## Supported profile and bounds

`virgl-webgl2-straight-line-v4` deliberately accepts a strict subset of TGSI text:

- `VERT` and `FRAG`; unique `DCL` registers with single-digit decimal indices.
  TEMP indices are 0–9; IN, OUT, CONST, IMM, SAMP, SVIEW and GENERIC semantic
  indices remain 0–7. TEMP and CONST declarations may use non-overlapping
  inclusive ranges within their respective banks. Other ranges, multi-digit
  indices, signs and leading zeroes remain rejected. Declarations and immediates
  precede instructions; declarations may follow immediates.
- Vertex input attributes, mandatory vertex `OUT[0], POSITION`, and generic
  vertex outputs. Fragment inputs are `GENERIC[n], PERSPECTIVE` or `GENERIC[n], CONSTANT`; fragment
  output is `OUT[0], COLOR`. Generic semantics within a stage are unique.
  Generic vertex outputs and fragment inputs may declare `.xy` or
  `.xyz`; all other declarations remain full-width.
- Full `vec4` `MOV`, `ADD`, `MUL`, `MAD`; `TEMP`, `CONST`, and sequential
  `IMM[n] FLT32 {x, y, z, w}`. Temporary reads require every effectively consumed
  lane to have been written by an earlier instruction. Finite
  immediate floats must parse without range errors and have magnitude at most
  1,000,000. `UINT32` immediates accept four checked decimal words interpreted as
  float bits by upstream. Their float values must satisfy the same finite/range
  bound, and nonzero subnormals are rejected. Integer instructions remain unsupported.
- `MOV`, `ADD` and `MUL` may write TEMP or OUT with `.x`, `.y`, `.z`, `.w`,
  `.xy` or `.xyz`. Masked MAD and TEX remain unsupported, as do other explicit
  masks (including `.xyzw`, duplicate and unordered masks). Implicit full-vector
  forms remain accepted. POSITION and COLOR must be fully written before `END`;
  generic outputs must have every declared component written.
- Sources may use exactly four `xyzw` selectors, including repetitions. For
  componentwise operations, each destination lane selects its corresponding
  source selector; 2D TEX consumes coordinate lanes x and y before applying its
  source swizzle. Only those selected source lanes must be declared and, for
  TEMP, previously initialized. For example, an xy write from `.yzww` consumes
  y/z, while a 2D sample from `.xxxx` consumes only x. Unconsumed selectors must
  still be syntactically valid but need not refer to initialized lanes. All
  source checks finish before the destination's written mask is updated.
- Fragment `TEX dst, coordinates, SAMP[n], 2D`, with matching declared
  `SVIEW[n], 2D, FLOAT`. Sampling, wrapping, filtering and blending are caller
  GL state, separate from translation.
- Optional bounded sequential instruction labels. ASCII spaces, tabs, CR and
  newline; no embedded NUL or other control/non-ASCII bytes.
- Exactly one optional fragment `PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1` before
  instructions. The fixed one-target configuration makes this COLOR0 only.

Unsupported TGSI includes ranges outside TEMP/CONST, indirect addressing, other declaration
or write masks, short/long swizzles, source modifiers, all other properties
(including unknown properties upstream would otherwise ignore), PRECISE,
control flow, other opcodes, integer/double operations, other texture types,
extra shader stages, MRT, UBOs, SSBOs, images and atomics.
This is not a general Mesa desktop-shader frontend. Widening this profile
requires new safety checks and independent browser execution evidence.

Input is capped at 16,384 bytes, 256 nonempty lines, 512 bytes per nonempty line,
128 non-END instructions, ten TEMP registers and eight registers in every other file. Tokens have a fixed 8,192
word allocation, GLSL is capped at 65,536 bytes, and JSON storage is fixed at
147,456 bytes per standalone result and 295,936 bytes per pair result. Pair
conversion reuses the text/token stack workspaces sequentially. The fixed
16 MiB Wasm memory and 256 KiB stack are unchanged. Output bounds are checked
before returning success. The small
guard checks syntax, numeric bounds and dataflow before upstream sees input;
upstream still performs the actual TGSI parsing and GLSL generation. No upstream
assertion is disabled. Upstream diagnostics cause translation failure.

## Binding metadata

Every success has `profile`, `stage`, and the following arrays, including empty
arrays where applicable:

| Field | Meaning |
| --- | --- |
| `inputs`, `outputs` | `{index,name,type,semantic,semanticIndex,componentMask}`; outputs additionally include `writtenMask`. GENERIC inputs/outputs also have `interpolation:"smooth"|"flat"`; standalone VS outputs are smooth, while pair VS outputs reflect the matched FS modes (unmatched outputs stay smooth). Attributes, POSITION and COLOR have no interpolation field. Masks are numeric bitsets (`xy=3`, `xyz=7`, `xyzw=15`). Type remains `vec4`, matching upstream declarations, even for partial generic components. A linker must check component coverage rather than infer it from type. VS attribute names are `in_n`, linked generic names are `vso_gn`, position is `gl_Position`, and fragment color is `fsout_c0`. |
| `attributes` | Vertex input records; bind or reflect each attribute name. Fragment list is empty. |
| `uniforms` | `{name,type:"uvec4[]",count,encoding:"float32-bits"}`. Base name is `vsconst0` or `fsconst0`; query `name + "[0]"`. Upload float bit patterns with `uniform4uiv`, not numeric integer conversion or `uniform4fv`. `count` includes any register gaps. |
| `samplers` | `{index,name,type:"sampler2D"}`; name is `fssampn`. Caller binds each texture unit and sets the sampler uniform. |
| `uniformBlocks` | Vertex `VirglBlock`, 656 bytes under std140. Its required member is `winsys_adjust_y`, float at byte offset 640, default 1. Fragment list is empty. |

The upstream vertex shader multiplies `gl_Position.y` by `winsys_adjust_y`.
Initialize the whole block to zero, then set that member to 1 (or deliberately
choose -1 for an explicit coordinate flip). Reflect block size/member offsets
and validate the metadata before binding. The remaining upstream block fields
are clip planes (bytes 0–127), stipple data (128–639), alpha reference (644),
clip-enable (648), and draw-id base (652); the supported fixed key does not use
them. The browser harness checks the actual block reflection and GLSL types.
Declared bindings may be optimized away by GL when unused, so production callers
must use program reflection for active locations.

## Upstream provenance and regeneration

Source: <https://gitlab.freedesktop.org/virgl/virglrenderer>, tag
`virglrenderer-1.3.0`, commit `ca50e008863837e094747a69974dde3ae148aeaa`.
`vendor/` contains byte-identical upstream files, the shader dependency closure
for the native/Wasm builds, and generation inputs. MIT notices are retained in
each file and `vendor/COPYING`. `UPSTREAM.json` records the complete source and
generated SHA-256 inventory. Every build verifies it via `verify_sources.py`.
The full renderer, EGL, DRM, epoxy, Vulkan and GPU command handling are absent.
The only platform hooks supplied by `bridge.c` are deterministic disabled debug
options and bounded diagnostics; no upstream source is patched.

Ordinary builds require no Python package downloads. To check generation in a
temporary environment:

```sh
python3 -m venv /tmp/virgl-shader-regenerate
/tmp/virgl-shader-regenerate/bin/pip install PyYAML==6.0.2
/tmp/virgl-shader-regenerate/bin/python renderer/virgl-shader/regenerate.py --check
```

`regenerate.py` runs the pinned unmodified `u_format_table.py` and
`u_format_parse.py` over `u_format.yaml`, using `--enums` for `u_format_gen.h`
and the default output for `u_format_table.c`. It substitutes 1/3/0 into the
upstream `virgl-version.h.meson` template. Remove `--check` only when deliberately
regenerating, then review changes and update the recorded hashes. To verify
upstream identity independently, obtain the pinned git revision and compare
each `vendor/<path>` with `git show <revision>:<path>`.
