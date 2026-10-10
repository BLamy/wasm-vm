# Bounded VirGL objects and state

`createVirglStateRenderer` in `state.mjs` executes the state-only portion of the
pinned VirGL 1.3.0 tiny profile on WebGL2. It consumes raw submissions using the
independently verified `decodeSubmission` boundary. This factory continues to
return `unsupported-draw` for every `DRAW_VBO`. The separate
`createVirglDrawRenderer` shares its private engine and adds the bounded draw
profile described in [draw-README.md](draw-README.md). Neither factory enables a
guest device or advertises acceleration.

Create a resource store and WebGL2 transfer backend as described in
`resources-README.md`, initialize `createVirglShaderBridge` from
`../virgl-shader/index.mjs`, then call:

```js
const { store, bindings } = createResourceStore({ backend });
const { renderer } = createVirglStateRenderer({
  gl, resources: store, bindings, shaderBridge, limits: {},
});
store.createContext(2);
renderer.createContext(2);
const result = renderer.executeSubmission(2, submissionBytes, provenance);
```

Factories and operations return `{ok:true,...}` or
`{ok:false,error:{code,message,byteOffset,opcode}}`. `executeSubmission` also
returns `appliedCommands` on either outcome. The complete wire submission is
validated and copied before any command executes: malformed tails apply zero
commands. Semantic failures stop at their command and report the applied prefix.
For example, original submit161 applies 38 commands and stops at DRAW_VBO at byte
5684. Source hash/event/context labels remain caller-supplied provenance; a
context label, when present, must agree with the execution context. Unexpected
implementation defects are not disguised as guest errors. Host capabilities must
be synchronous and non-reentrant; raw bytes and provenance follow the decoder's
attached, non-shared `Uint8Array` and own-data-property conventions.

`createContext(id)` requires an existing resource context and snapshots its
generation. Destroying/recreating that resource context cannot silently reassign
state to the new context. `destroyContext(id)` releases renderer state only;
resource context lifetime remains the caller's responsibility. `dispose()` is
idempotent and releases all renderer allocations and leases. If the resource
store was already disposed, its leases are already released; renderer cleanup
still deletes its own GL objects and clears its counters. Other lease errors
remain errors. `inspect(ctxId?)`
remains available after disposal and returns frozen copied logical state and
budgets. `restoreContext(id)` selects the current subcontext's complete supported
GL state. Incomplete bindings restore safe defaults (no program, disabled missing
attributes, zero unset constants); they do not authorize a draw. CLEAR requires
a color surface but does not require shader bindings.

Contexts start in subcontext zero. CREATE_SUB_CTX creates and selects a fresh
subcontext; SET_SUB_CTX requires an existing one. Destroying the current nonzero
subcontext selects zero. Zero cannot be destroyed directly. Object names share
one typed namespace per subcontext, with monotonically increasing generations.
Duplicate public names and wrong-type lookups fail. Reusing a removed name makes
a new generation and cannot redirect old bindings.

The public object table and binding lifetimes are separate. Surface, sampler-view
and shader-selector bindings hold references to the exact object generation.
DESTROY_OBJECT drops their public name/reference; existing bindings survive until
explicit replacement/unbind or subcontext destruction. In particular original
submit249 destroys surface3 at byte11376 while its framebuffer still owns it; the
framebuffer reset at byte11384 releases the last reference to already-unreferenced
resource5. Shader programs disappear when either selector is finally released and may be evicted sooner under bounded cache pressure; live bindings recreate them.
DSA and vertex elements unbind when destroyed. Sampler-state destruction clears
matching slots and compacts later slots, following the pinned destructor. Blend
and rasterizer bindings own a bounded copy of their fields; destroying their
public names leaves those copied fields active until replacement/unbind. Live private objects still count
against the object limit. Each surface/view and direct vertex/index binding owns
an opaque resource lease; no resource ID can resolve native storage directly.

The resource factory's separate trusted `bindings.resolve(lease)` capability
returns `{ok:true,metadata,generation,role,storage}` only for a live opaque lease
from that store. It continues resolving retained storage after public unref and
ID reuse, and rejects foreign/released leases. `storage` is the backend's native
`{kind:"buffer",buffer}` or `{kind:"texture",texture}` descriptor. This capability
belongs to the trusted renderer host; guest code receives neither leases nor
native handles. The ordinary resource-store API remains unchanged.

Shader creation passes original decoded TGSI text and its VS/FS stage to the
verified Wasm bridge, then compiles the emitted GLSL ES300 on the actual GL
context. LINK_SHADER prelinks a pair without binding it; BIND_SHADER selects its
stage and links the pair when both stages are present. Programs are keyed by the
private subcontext owner, two immutable selector generations, every used view and a canonical interface derived from the actual pair's
GENERIC semantic indices, component masks and interpolation modes. Fragment
input components must be written by the matching vertex semantic, independently
of physical register order. The v4 shader bridge exposes `smooth`/`flat` metadata.
A flat input uses `translatePair` on the exact immutable selector TGSI to derive
matching vertex qualifiers; callers cannot supply compiler keys. The returned
fragment must match its existing translation, and the vertex metadata must
match the derived interface before any variant is compiled.

Each flat program owns one additional vertex shader. Each nonidentity color view
adds a private fragment variant for the used sampler slots. Their generated GLSL lengths
counts toward `shaderBytes`, including while it is being compiled. Allocation,
compile, link and reflection failures release that charge and every temporary
GL object. Program deletion, final selector release and context disposal release
the variant; dropping a bound selector's public name preserves its variant until
the final binding is released. Smooth pairs keep their existing base shaders.
`inspect()` exposes each program's `key`, `interfaceKey`, `samplingKey`,
`samplingViews` and aggregate `variantBytes`.

Fragment sampling keys canonically include used sampler slot/name, exact color
format, target2, level/layer0, fixed lower-left origin and all four immutable
RGBA/ZERO/ONE selectors. RGBA identity includes its complete sampling key as well. The
checked 2D TEX lookup is wrapped by a private GLSL helper before fragment main;
helpers map the native normalized sample, including X-format alpha one. Shared
texture contents and parameters remain unchanged. No per-view image or CPU
shadow is created. Native sampler objects apply clamp-edge nearest/linear
filtering and non-mip LOD state on every restoration. These native filter
settings do not change the generated shader and therefore do not change its key.

An all-constant view may optimize its native sampler uniform away. The logical
sampler still requires a view/state lease and still rejects framebuffer feedback.
Both vertex and fragment variants are charged before compilation, rolled back on
failure and released with their program. A/B/A view selection reuses A's native
program; replacing a public view handle cannot select an obsolete specialization.
`make verify-E6-T12g4` proves actual pixels on all three color storage formats,
each selector in each lane, constant lanes, slot7 combinations, filter/alias
restoration, combined flat/view byte charges, delayed job draws, exact quotas,
native allocation/compile/link/reflection failures and a physical swizzle fault.

Reflection checks actual attribute type/size/location, uvec4
constant-array type/declared and active extents, sampler2D type/count, fragment output location zero,
and every uniform block. `VirglBlock` must be 656 bytes with float
`winsys_adjust_y` at offset640, initialized to 1. Its buffer is rebound and
rewritten on restoration. Inline constant words are uploaded with
`uniform4uiv`, preserving float bit patterns. Slot-zero VS/FS packets contain at
most 184 words (46 vec4s). Each packet replaces that stage's owned word array,
including an empty reset; words from a previous packet never supply its suffix.

Constant reflection keeps the compiler's `count` as the declared extent (up to 47)
and records actual `activeCount` plus `uploadCount = min(activeCount,46)`.
The real driver may retain an unread suffix: a shader reading only CONST7 but
reflecting 46 entries conservatively requires 46 guest vec4s. This policy does not
claim exact source liveness. A wholly inactive array records zero active/upload
counts and requires no guest constants. Inconsistent location/index, wrong type,
an active extent exceeding the declaration, or reflected component storage beyond
the measured stage limit rejects the program with allocation cleanup. Actual
successful linking remains the packing check. `inspect().hostUniformComponents`
contains the measured vertex and fragment component limits; invalid reported
limits reject renderer creation.

CONST45 followed by CONST0 can produce a declared and reflected extent 47.
Guest addresses still stop at 45. Restoration uploads only the legal reflected
prefix and never writes or clears host-only element 46. Missing legal words are
zeroed during safe restoration of incomplete state, but the stored guest array
remains short: a draw rejects before index reading/staging unless every legal
reflected word was supplied. This policy is shared by synchronous and asynchronous
draw factories. The unrelated 64KiB system-UBO budget remains unchanged.

The 184-word boundary is exercised with authored raw packets and actual hardware
output. Original captured uploads reached at most 32 VS words and 4 FS words;
no original high-constant execution is claimed. Fragment
sampler slot N uses texture unit N; vertex slot N uses unit16+N. Active slots are
bounded by the measured stage limits and a 16-slot stage maximum. All 32-slot
inactive resets remain accepted.

The active profile is one required normalized level-zero color surface
(BGRX8, RGBA8 or B10G10R10X2), exact-matching color sampler
views with immutable selectors0–5, clamp-edge nearest/linear non-mip samplers,
R32/RG32/RGB32/RGBA32_FLOAT vertex elements, float-aligned vertex strides at most255 bytes,
u16 indices or nonindexed triangles/strips, integer viewports with either Y sign
and normalized GL depth range, additive alpha blend modes supported by the
decoder, optional dithering/back-face culling/scissor, and Z16 depth testing.
Stencil/alpha tests, depth views and mip/layer/cube sampling fail explicitly. Buffer
and element ranges, resource classes, link inputs and quotas are validated before
publication. Backend allocation/compile/link failures delete temporary objects.

X-format color surfaces force sampled and destination alpha one. The resource
backend initializes physical packed alpha; CLEAR and draw restoration mask
alpha writes while preserving the guest RGB color mask and source fragment
alpha. Thus SRC_ALPHA RGB blending still observes the shader's source alpha,
and DST_ALPHA observes one. RGBA8 retains its ordinary stored alpha behavior.

The original gears Z16_UNORM SURFACE can retain exact format16/bind1 native
depth storage through a separate depth-surface lease. It cannot become a color
attachment or an RGBA8 sampler view. E6-T12h adds depth framebuffer selection,
full depth clear and the eight GL depth comparisons; Z16 has no stencil storage.
`make verify-E6-T12g3` retains original surface lifetime, incompatible
color attachment rejection and independent native depth observations.
Required matching color view admission is the E6-T12g4 boundary above.

Negative viewport scaleY sets the owned system block's `winsys_adjust_y` to -1
on every restoration. Its rectangle remains translateY - abs(scaleY), height
2*abs(scaleY); GL clip Z is unchanged. Scissor uses literal lower-left min/max
coordinates. Full CLEAR ignores scissor and color/depth masks, then restores
those masks and scissor enable. Depth attachments retain their object/storage
generation independently of their public names. Color/depth dimensions must
match. See [raster proof](../../tools/virgl-command/raster-README.md).

Restoration binds the renderer's private VAO/FBO/program, every texture/sampler
unit, vertex/index buffers, system UBO and constants, color/blend/raster state,
viewport/depth range, pixel pack/unpack state and disabled unsupported GL state.
Host binding poisoning and context A/B/A switches cannot contribute bindings.
The trusted host must not mutate private immutable object contents (for example
sampler parameters); mutable program uniforms and system-buffer data are restored.
Supported resource flags select lower-left origin, so front-face winding inverts
Gallium `frontCcw`, following pinned `vrend_update_frontface_state` at6676–6682.
Gallium full-color CLEAR temporarily forces all color channels writable and then
restores the declared color mask. It is independent of the bound shader. This
follows pinned `vrend_renderer.c` clear preparation/finish around4691–4796;
surface/view and shader references follow1268–1293,1337–1363,2418–2429,
3168–3202,3964–3969 and4646–4680. Inactive storage/image/atomic/stream-output,
tessellation, sample-mask and tweak packets are recorded as bounded reset state;
they do not enable those features. Transfer packets delegate to the verified
resource store's prepare/execute contract.

`inspect` reports `contexts[].subContexts[]` with live public/private typed
`objects`, logical `bindings`, retained `programs[].reflection`, and latest
inactive `resets`. Object references are `{handle,generation}` or null. Constants
are two stage arrays of raw words. Reflection includes attributes, uniforms,
samplers, uniformBlocks and outputs; it contains no native GL handles. Budgets
count contexts, subContexts, objects, programs, shaders, samplers, leases,
shaderBytes and uniformBytes. Limits may only tighten defaults: 8 contexts,
16 total subcontexts, 256 live objects, 64 linked programs, 1MiB shader text/GLSL,
and 64KiB system UBO storage. Resource storage/leases remain additionally bounded
by the resource store's independent limits.

Inline-write submissions use the same immutable decoded command snapshot. Async
inline jobs own their dense reserved upload at preparation and yield in
`upload-ready` before any GPU write; they request no guest DMA input. The next
step checks resource/context/membership identity, issues the upload and retires
through a nonblocking GPU completion fence. Cancellation, stale identity and
backend failures release the reservation without publishing an unowned payload.

Translation, native program and render-state reuse, limits, exact-key equality,
eviction, truthful counters and host frame captures are described in
[cache-README.md](cache-README.md). Every supported GL binding still restores on
every cache hit.
