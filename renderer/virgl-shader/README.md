# Bounded VirGL shader bridge

This isolated module reuses virglrenderer 1.3.0's TGSI text parser and GLSL
converter. It proves a small shader translation boundary for a future browser
command renderer. It is not connected to the emulator or production demo, does
not advertise a VirGL device, and does not render guest desktop frames.

## Build and reproduce

From the repository root:

```sh
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh sanitize
EMCC="$(bash tools/setup-virgl-emsdk.sh)" bash renderer/virgl-shader/build.sh wasm
make verify-E6-T10a
make verify-E6-T10d
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
texture sabotage to fail its pixel oracle. Five other corpus shaders now translate
without an execution claim; twelve remain rejected. These are explicit workload
bindings, not VirGL command-stream replay or a running emulator guest.

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
and `text`. Unknown request keys are rejected, including all shader-key overrides.
Each factory call creates separate Wasm memory. Calls are synchronous and
serialized. Returned strings and objects own their data; the adapter frees its
input allocation in `finally` and does not return any view into Wasm memory.

Success is `{ok: true, glsl, metadata}`. Failure is
`{ok: false, error: {code, message}}`. Error codes are `invalid-input`,
`input-too-large`, `unsupported-stage`, `unsupported-feature`, `parse-error`,
`translation-error`, and (JS input allocation only) `allocation-failed`.
Errors indicate rejection, not a fallback shader. Repeated rejected inputs do
not reset or poison the instance. Native users can call `bridge_translate` from
`bridge.h`; its static JSON result is borrowed until the next serialized call.
The native CLI reads stdin and accepts one argument, `vertex` or `fragment`.

The fixed upstream configuration is GLSL ES 3.00, GLES/core profile, integer
support, one draw buffer, fragment lower-left origin, and otherwise zero shader
key state. No rasterizer, alpha-test, clipping, swizzle, stream-output, or
interpolation patch state is inferred from guest data.

## Supported profile and bounds

`virgl-webgl2-straight-line-v2` deliberately accepts a strict subset of TGSI text:

- `VERT` and `FRAG`; unique `DCL` registers with decimal indices 0–7.
  TEMP declarations may use non-overlapping inclusive ranges within 0–7. Ranges
  for every other file are rejected. Declarations and immediates precede
  instructions; declarations may follow immediates.
- Vertex input attributes, mandatory vertex `OUT[0], POSITION`, and generic
  vertex outputs. Fragment inputs are `GENERIC[n], PERSPECTIVE`; fragment
  output is `OUT[0], COLOR`. Generic semantics within a stage are unique.
  Generic vertex outputs and perspective fragment inputs may declare `.xy`;
  all other declarations remain full-width.
- Full `vec4` `MOV`, `ADD`, `MUL`, `MAD`; `TEMP`, `CONST`, and sequential
  `IMM[n] FLT32 {x, y, z, w}`. Temporary reads must follow a full write. Finite
  immediate floats must parse without range errors and have magnitude at most
  1,000,000. `UINT32` immediates accept four checked decimal words interpreted as
  float bits by upstream. Their float values must satisfy the same finite/range
  bound, and nonzero subnormals are rejected. Integer instructions remain unsupported.
- Only `MOV` to `OUT` may have destination masks `.xy`, `.z` or `.w`. POSITION
  and COLOR must be fully written before `END`; generic outputs must have every
  declared component written. TEMP writes remain full-width. Sources may use
  exactly four `xyzw` selectors; every selected component must be declared, even
  if the destination mask does not consume that lane. This is a deliberately
  conservative profile, not a general TGSI dataflow validator.
- Fragment `TEX dst, coordinates, SAMP[n], 2D`, with matching declared
  `SVIEW[n], 2D, FLOAT`. Sampling, wrapping, filtering and blending are caller
  GL state, separate from translation.
- Optional bounded sequential instruction labels. ASCII spaces, tabs, CR and
  newline; no embedded NUL or other control/non-ASCII bytes.
- Exactly one optional fragment `PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1` before
  instructions. The fixed one-target configuration makes this COLOR0 only.

Unsupported TGSI includes non-TEMP ranges, indirect addressing, other declaration
or write masks, short/long swizzles, source modifiers, all other properties
(including unknown properties upstream would otherwise ignore), PRECISE,
control flow, other opcodes, integer/double operations, other texture types,
extra shader stages, MRT, UBOs, SSBOs, images and atomics.
This is not a general Mesa desktop-shader frontend. Widening this profile
requires new safety checks and independent browser execution evidence.

Input is capped at 16,384 bytes, 256 nonempty lines, 512 bytes per nonempty line,
128 non-END instructions and eight registers per file. Tokens have a fixed 8,192
word allocation, GLSL is capped at 65,536 bytes, and JSON storage is fixed at
147,456 bytes. Output bounds are checked before returning success. The small
guard checks syntax, numeric bounds and dataflow before upstream sees input;
upstream still performs the actual TGSI parsing and GLSL generation. No upstream
assertion is disabled. Upstream diagnostics cause translation failure.

## Binding metadata

Every success has `profile`, `stage`, and the following arrays, including empty
arrays where applicable:

| Field | Meaning |
| --- | --- |
| `inputs`, `outputs` | `{index,name,type,semantic,semanticIndex,componentMask}`; outputs additionally include `writtenMask`. Masks are numeric bitsets (`xy=3`, `xyzw=15`). Type remains `vec4`, matching upstream declarations, even for partial generic components. A linker must check component coverage rather than infer it from type. VS attribute names are `in_n`, linked generic names are `vso_gn`, position is `gl_Position`, and fragment color is `fsout_c0`. |
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
