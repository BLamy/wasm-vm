# Bounded VirGL command decoder

`decoder.mjs` is a synchronous, dependency-free ES module shared unchanged by Node
and browsers. It decodes the eight original textured-scene submissions in
`evidence/virgl-corpus/captures/textured-scene`: 42,380 bytes, 210 packets, 32
command families and eight created object types. It accepts equivalent parameter
values within the profile below; capture hashes, handles and image dimensions are
not an input allowlist.

This is a wire validation boundary, not a renderer. It does not resolve resource
or object identities, check attachments or generations, establish complete draw
state, translate TGSI, allocate GPU resources, execute commands, complete fences,
or advertise a production capset. Later execution must validate all those
conditions before applying commands. A successful decode alone is not permission
to render or proof that the shader bridge accepts a shader's grammar.

## API and ownership

```js
import { decodeSubmission, PROFILE, LIMITS } from "./decoder.mjs";
const result = decodeSubmission(bytes, {
  sourceSha256: verifiedCaptureHash,
  event: 161,
  contextId: 2,
});
```

`bytes` must be an attached `Uint8Array`, including a Node `Buffer` or a view with
a nonzero or unaligned **host** byte offset. The view's byte length must be a
multiple of four. Empty submissions are valid. The module snapshots the exact
view before parsing, uses `DataView` reads with explicit little-endian flags, and
retains no guest views. SharedArrayBuffer-backed views are rejected: synchronous
copying cannot establish a race-free shared-memory snapshot. Invalid inputs,
including detached arrays, produce the failure shape below.

The optional provenance object accepts only own data properties `sourceSha256`
(lowercase 64-character hexadecimal string), `event` (nonnegative safe integer),
and `contextId` (u32). Absent, null or undefined property values become `null`;
accessors and unknown properties are rejected without evaluating their getters.
Provenance is host-owned data, not guest input; JavaScript Proxy traps are outside
this metadata contract. The caller must independently
compute and verify the source hash. This module validates the **label's syntax**
and preserves it; it does not compute a hash or authenticate a capture.

Success is a recursively frozen tree of ordinary objects, arrays and scalar
values:

```js
{
  ok: true,
  profile: "virgl-tiny-commands-v1",
  sourceSha256: "…", event: 161, contextId: 2,
  byteLength: 5736,
  commands: [{
    opcode: 43, name: "TRANSFER3D",
    objectType: 0, objectName: "NULL",
    byteOffset: 0, byteLength: 56, payloadDwords: 13,
    fields: { /* named fields below */ }
  }]
}
```

Packet offsets are relative to the supplied byte view, not its backing buffer.
`byteLength` includes the four-byte header; `payloadDwords` excludes it. Every
command belongs to the success object's source hash/event/context labels. Numeric
words remain u32 unless explicitly decoded as a signed value, boolean or float.
Floats must be finite. Float constants and clear colors also preserve their raw
u32 representations. Shader strings preserve the original ASCII bytes, excluding
only the protocol's terminal NUL and dword alignment padding.

Failure is recursively frozen and contains no commands or partial result:

```js
{
  ok: false,
  error: {
    code: "truncated-payload",
    message: "Packet payload exceeds submission.",
    byteOffset: 4096,
    opcode: 28
  }
}
```

The error location is the offending packet header. Submission/API errors use
`byteOffset: 0` and `opcode: null`. Codes are:

| Code | Meaning |
| --- | --- |
| `invalid-input` | Wrong, detached or shared byte-view input. |
| `invalid-provenance` | Invalid or unknown caller-supplied labels. |
| `unaligned-submission` | Submission byte length is not divisible by four. |
| `limit-exceeded` | Submission, packet, text, token, count or slot budget exceeded. |
| `truncated-payload` | Framed packet extends beyond the submission. |
| `payload-length` | Fixed size, variable-array divisibility or text-frame mismatch. |
| `invalid-object-type` | A non-object command has a nonzero object byte. |
| `invalid-enum` | Unknown stage, transfer direction or swizzle component. |
| `invalid-value` | Reserved bits, non-finite value, zero required handle, malformed ASCII/NUL, alignment or arithmetic failure. |
| `unsupported-command` | Opcode outside this explicitly supported command set. |
| `unsupported-object` | Unknown object type or unsupported bind/type combination. |
| `unsupported-feature` | Well-framed state outside the narrow accepted profile. |

Malformed guest bytes are handled through this result contract. The decoder does
not swallow unexpected implementation defects as guest errors. Parsing has no
renderer callbacks, asynchronous yields, externally visible command state changes
or graphics effects.
A failed call leaves no state for the next call. Callers can mutate or detach their
input after decoding without changing the returned result.

## Budgets and accepted profile

`PROFILE` is `virgl-tiny-commands-v1`; exported `LIMITS` is frozen. Limits are local
validation budgets, not guest-advertised capabilities:

| Bound | Maximum |
| --- | ---: |
| Submission bytes | 262,144 |
| Packets per submission | 4,096 |
| Shader text bytes, excluding terminal NUL | 16,384 |
| Declared shader tokens | 8,192 |
| Vertex elements / vertex buffers | 16 / 16 |
| Sampler slots | 32 |
| Constant buffer slots / words in active slot | 15 / 184 |
| Shader storage buffer / image / atomic buffer slots | 16 / 32 / 16 |
| Viewport / color attachment slots | 1 / 1 |

Active constant data is restricted to slot zero in VS/FS, in complete vec4s.
The 184-word (46-vec4) maximum includes finite float bit patterns without changing
the existing empty reset policy. Decoding a shorter prefix is valid; the renderer
separately checks draw completeness against the actual linked program. This high
limit is proved by authored packets: original captures uploaded at most 32 VS
words and 4 FS words, so they do not demonstrate high-constant execution.

The wire's 16-bit packet length and submission bound cap opaque padding and every
packet allocation. Array shape/count/range checks precede allocation. Slot checks
use subtraction, so large wire values cannot wrap the accepted range. Transfer
boxes use nonnegative signed-32-bit coordinates/extents, nonempty extents, and
checked endpoint sums. The row span and backing offset sum must fit u32. Resource
format-dependent byte footprints, row pitch adequacy, actual backing length,
vertex/index fetch ranges and allocation/work budgets require later resource and
execution validation; this module has no resource table.

The 32 accepted opcode families and their decoded fields are:

| Command | Fields and profile |
| --- | --- |
| `CREATE_OBJECT` | Eight object types detailed below; nonzero `handle`. |
| `BIND_OBJECT` | `handle` (zero unbind allowed); BLEND, RASTERIZER, DSA, VERTEX_ELEMENTS only. |
| `DESTROY_OBJECT` | Nonzero `handle`, any of the eight supported object types. |
| `SET_VIEWPORT_STATE` | `startSlot`, `viewports[{scale[3],translate[3]}]`; finite floats, at most viewport 0. |
| `SET_FRAMEBUFFER_STATE` | `colorBufferCount`, `depthStencilSurface`, `colorSurfaces[]`; 0–1 color attachments, no depth/stencil. |
| `SET_VERTEX_BUFFERS` | `buffers[{stride,offset,resourceHandle}]`; up to 16 entries. |
| `CLEAR` | `buffers`, `colorWords[4]`, `color[4]`, `depth` (f64), `stencil`; COLOR0 only, finite color/depth, depth in [0,1], stencil u8. |
| `DRAW_VBO` | `start,count,mode,indexed,instanceCount,indexBias,startInstance,primitiveRestart,restartIndex,minIndex,maxIndex,countFromStreamOutput`; exactly 12 words, TRIANGLES, one instance, no bias/base instance/restart/stream output; start+count fits u32 and min≤max. `indexed` is boolean; `indexBias` is i32. |
| `SET_SAMPLER_VIEWS`, `BIND_SAMPLER_STATES` | `stage,startSlot,handles[]`; VS/FS bindings, stage 2–5 only all-zero unbinds. |
| `SET_INDEX_BUFFER` | `resourceHandle,indexSize,offset`; one-word zero unbind or three-word nonzero u16 binding with aligned offset. |
| `SET_CONSTANT_BUFFER` | `stage,index,words[],values[]`; whole finite vec4s, active VS/FS slot 0, empty clears stage 0–5 / slots 0–14. |
| `SET_STENCIL_REF` | `front,back` u8; high 16 bits reserved. Does not enable stencil. |
| `SET_BLEND_COLOR` | `color[4]` finite floats. |
| `SET_POLYGON_STIPPLE` | `pattern[32]`, all ones only; active stipple unsupported. |
| `SET_SAMPLE_MASK` | `mask`, all ones only. |
| `SET_STREAMOUT_TARGETS` | `appendBitmask:0,handles:[]`; exactly one zero payload word. |
| `SET_SUB_CTX`, `CREATE_SUB_CTX`, `DESTROY_SUB_CTX` | `subContextId`; u32 label, lifetime checks deferred. |
| `BIND_SHADER` | `handle,stage`; active VS/FS only, zero unbind accepted for stages 2–5. |
| `SET_TESS_STATE` | `outer[4],inner[2]`, all 1.0; inactive initialization only. |
| `SET_MIN_SAMPLES` | `minSamples`, zero or one only. |
| `SET_SHADER_BUFFERS` | `stage,startSlot,buffers[{offset,length,resourceHandle}]`; stage 0–5, fully zero entries only. |
| `SET_SHADER_IMAGES` | `stage,startSlot,images[{format,access,layerOffset,levelSize,resourceHandle}]`; stage 0–5, fully zero entries only. |
| `SET_FRAMEBUFFER_STATE_NO_ATTACH` | `width,height` u16, `layers:0,samples:0`; high reserved bits zero. |
| `SET_ATOMIC_BUFFERS` | `startSlot,buffers[{offset,length,resourceHandle}]`; fully zero entries only. |
| `TRANSFER3D` | Common transfer fields plus `dataOffset,direction` (1=to host, 2=from host). |
| `END_TRANSFERS` | `paddingDwords`; all framed payload bytes are opaque and ignored. |
| `COPY_TRANSFER3D` | Common transfer fields plus `stagingResourceHandle,stagingOffset,flags,synchronized:true,readFromHost`; flags 1 or 3 only. |
| `SET_TWEAKS` | `id,value`; exact recognized pairs (1,1) and (2,1024). |
| `LINK_SHADER` | `vertexHandle,fragmentHandle,geometryHandle,tessControlHandle,tessEvaluationHandle,computeHandle`; last four must be zero. |

Common transfer fields are `resourceHandle,level,usage,stride,layerStride` and
`box:{x,y,z,width,height,depth}`. The resource/staging handles are nonzero. Level
and z are zero, and depth is one. `usage` is an opaque preserved u32: the pinned
`vrend_decode_transfer_common` (upstream `src/vrend_decode.c`, lines 417–434)
does not read or act on that field. Captured modern Mesa usage bits must not be
interpreted using the renderer's older `pipe_transfer_usage` enum. This exception
does not apply to transfer `direction` or copy `flags`, which are validated.
`stagingResourceHandle` names the
packet's secondary backing resource in both directions: uploads read from it;
readbacks write into it. No staging bytes are accessed during decoding.

A zero-length array is accepted when its prefix and start slot remain valid.
Inactive stage and feature resets must have **every** inactive entry field zero,
not merely a zero resource handle. This does not implement the corresponding
compute, tessellation, image, SSBO, atomic or transform-feedback capability.
Unknown commands—including NOP and the full corpus's `SET_SCISSOR_STATE`—are
explicitly rejected by this narrower profile.

### Object payloads

- **BLEND:** `handle`, named independent/logicop/dither/alpha controls,
  `logicopFunction`, and eight `renderTargets` with named enable, RGB/alpha
  functions/factors and color masks. RT0 supports disabled blending or additive
  `(ONE or SRC_ALPHA, INV_SRC_ALPHA)` RGB and `(ONE, INV_SRC_ALPHA)` alpha.
  Disabled function/factors and RT1–7 must be zero; any RT0 color mask and optional
  dithering are allowed. Logic operations, independent blending, alpha coverage
  and alpha-to-one are rejected.
- **RASTERIZER:** `handle`, all named flag fields, `pointSize,spriteCoordEnable`,
  line stipple fields, `clipPlaneEnable,lineWidth,offsetUnits,offsetScale,offsetClamp`.
  Fill triangles with depth clip and half-pixel center; optional back-face culling,
  front winding and scissor. The recorded point/sprite mode bits are accepted as
  inert under the triangle-only draw profile. Point/line size is one, sprite and
  clip masks zero, stipple pattern 0xffff/factor zero, polygon offsets zero;
  other rasterizer flags are rejected. Enabling the scissor flag alone does not
  establish a valid scissor rectangle; complete state compatibility is deferred.
- **DSA:** `handle,depthEnable,depthWriteMask,depthFunction,alphaEnable,alphaFunction,
  alphaReference,stencil[2]`; all state must be zero. Stencil entries name enabled,
  function, fail/depth-pass/depth-fail operations, value mask and write mask.
- **SHADER:** `handle,stage,stageName,declaredTextBytes,tokenCount,streamOutputCount,
  text`. Only VS/FS; no continuations or stream outputs. Declared text length
  includes its final NUL, agrees exactly with the framed payload's rounded size,
  and is bounded before scanning. Text accepts printable ASCII plus tab/LF/CR,
  has no interior NUL, and has zero terminal NUL/padding. Token count is a bounded
  declaration, not a TGSI parser result. Shader grammar, token truth and stage
  agreement remain the shader bridge's responsibility.
- **VERTEX_ELEMENTS:** `handle,elements[{sourceOffset,instanceDivisor,
  vertexBufferIndex,sourceFormat}]`; per-vertex R32G32_FLOAT (29), divisor zero,
  buffer index below 16, sourceOffset+8 fits u32.
- **SAMPLER_VIEW:** `handle,resourceHandle,format,target,firstLayer,lastLayer,
  firstLevel,lastLevel,swizzle[4]`; RGBA8 (67), 2D (2), level/layer zero; swizzle
  components 0–5 (RGBA/ZERO/ONE). Resource type compatibility is deferred.
- **SAMPLER_STATE:** `handle,wrapS,wrapT,wrapR,minImageFilter,minMipFilter,
  magImageFilter,compareMode,compareFunction,seamlessCubeMap,maxAnisotropy,
  lodBias,minLod,maxLod,borderColor[4]`. Clamp-edge S/T; repeat or clamp-edge R;
  nearest/linear image filters, no mipfilter/compare/anisotropy; zero bias/min LOD
  and nonnegative finite max LOD; zero inactive border. Compare-function and
  seamless-cube fields are preserved but inert with compare disabled and 2D
  views. Reserved packed bits are rejected.
- **SURFACE:** `handle,resourceHandle,format,level,firstLayer,lastLayer`; required
  normalized color formats 2 (BGRX8), 67 (RGBA8), 233 (B10G10R10X2), or16 (Z16_UNORM),
  level and layer zero, nonzero resource handle. Target compatibility is deferred.

### Opaque END_TRANSFERS framing

The pinned upstream decoder routes END_TRANSFERS to a dummy handler and ignores
its length-framed payload. At event 173, the first packet has 1,023 payload words
and spans bytes 0–4095. Its payload includes stale, nonzero words that resemble
other commands. Only its outer header is decoded. The following SET_SUB_CTX and
COPY_TRANSFER3D begin at offsets 4096 and 4104. Injecting apparent valid or
invalid headers inside this padding must not create commands or errors; making
the outer packet exceed the submission must fail. The first submission's two
TRANSFER3D packets precede a shorter padding packet that also ends at 4096.

## Protocol and verification

Wire fields follow the vendored
[`virgl_protocol.h`](../virgl-shader/vendor/src/virgl_protocol.h) and
[`p_defines.h`](../virgl-shader/vendor/src/gallium/include/pipe/p_defines.h) at
VirGL 1.3.0 commit `ca50e008863837e094747a69974dde3ae148aeaa`. The corresponding
upstream `src/vrend_decode.c` supplies shader offset framing, packed state
extraction, array layouts and opaque END_TRANSFERS behavior. The narrower profile
is intentional; do not substitute upstream's permissive length checks or silent
unknown-command handling for these strict checks.

Run `make verify-E6-T12a` for recorded raw-capture hash checks, deterministic Node
and browser parity, independent typed-field/framing expectations, invalid tails,
truncations, hostile mutations, input ownership, boundary budgets, sabotage and
the final pristine-clone proof. This parser-only task does not change or deploy
production `web/` or claim GPU execution, Mesa compatibility or FPS gains.
