# Browser guest graphics contract

E6-T10c selects **WebGL2 with GLSL ES 3.00**, reusing the pinned VirGL TGSI
converter and implementing a browser command executor. This is a backend decision
and a measured prototype, not a working guest GPU. The production device continues
to advertise **no VIRGL feature, zero capsets, and no 3D renderer**. The existing
WebGL display sink uploads pixels already rendered by the guest CPU.

The complete machine-readable decision matrix is [gpu-3d-contract.json](gpu-3d-contract.json).
It covers all 33 command families, eight object families, 37 TGSI instruction
names, 17 public renderer API calls, two shader stages, nine resource formats and
19 distinct shader bodies in the four committed guest captures. Two additional
vertex formats, RG32_FLOAT (29) and RGB32_FLOAT (30), are tracked separately. Counts sum the
per-workload histograms; shared shaders therefore occur in multiple histograms.
`make verify-E6-T10c` reconstructs those histograms from hash-bound raw events and
blobs, rejects missing/extra entries, checks the pinned ABI layout and executes
the browser proof. A `supported` instruction means only the existing bounded
literal shader profile. `implementable` names a concrete mapping still to build;
`rejected` forbids advertisement and execution in this contract.

## Why this backend

VirGL already supplies the guest protocol and a proven TGSI-to-GLSL converter.
The recorded guest uses Mesa **1:26.2.2-1**, Hyprland **0.56.2-3**, riscv64; the
reference renderer is virglrenderer **1.3.0**, commit
`ca50e008863837e094747a69974dde3ae148aeaa`. Captures use QEMU and native llvmpipe
only as a reference. They are not browser performance measurements.

Porting all of native virglrenderer would also require its GL/EGL/epoxy context
and resource machinery. Instead, retain its bounded C/Wasm shader frontend and
write the command/state executor around browser APIs. A direct WebGPU path would
require another shader translation stage and additional GL coordinate, binding
and rasterization conversions. It is not selected by this contract. WebGL2 still
needs explicit lowering where its semantics differ from native GL.

The v5 shader bridge translates **twelve of 19 captured shader bodies** and
rejects all seven PRECISE-bearing bodies with unsupported-feature. The original
textured-scene pair retains its three-phase pixel proof. E6-T12e1 adds independent
pixel fixtures for two original texture/intensity fragments and two original
affine/matrix vertex bodies. E6-T12e2 links the unchanged flat fragment with a
translated literal vertex stage through the actual pair and command renderer
paths. The other five accepted bodies have no execution claim. These explicit bindings do not establish a complete original workload.
The nine literal shader regressions remain a separate frontend/API baseline.
The profile now admits CONST indices through45, TEMP indices through117, generic
`.xy`/`.xyz` declarations and MOV/ADD/MUL component writes with definite lane
initialization. Consumed lanes are checked after applying the source swizzle;
2D texture coordinates consume xy. Fragment CONSTANT interpolation is supported
through checked per-semantic smooth/flat metadata and internally derived pair
keys. A flat program owns and accounts for its vertex variant; selector
generations and the effective interface both participate in program reuse.
Unequal per-vertex attributes distinguish smooth from flat pixels, including
mixed interfaces and switching back to a cached smooth pair. Integer/control
flow and PRECISE remain rejected. The static limit is179 non-END instructions;
the original maximum is178 non-END, leaving one instruction of headroom. This
is a static admission limit, not a future loop execution bound. All other text,
token, line, GLSL, response and fixed-Wasm bounds remain unchanged.

E6-T12e3b carries up to184 finite float-bit words (46 vec4s) per stage through
slot0 command uploads. The pinned compiler can declare47 uniform entries when
CONST45 precedes a disjoint CONST0 declaration; the legal address range stays
0..45. Metadata preserves the declaration, and renderer reflection separately
records the actual active extent and upload extent. Draws conservatively require
the complete min(active extent,46) prefix. A wholly inactive array requires none;
a driver retaining46 entries for a shader reading only CONST7 still requires46.
This policy does not claim exact source liveness. Restoration initializes missing
legal words to zero, but a short upload still fails draw completeness and cannot
borrow the previous suffix. Host-only element46 is never uploaded or cleared.
Actual per-stage component limits and successful linking govern host admission.
See E6-T12e1/E6-T12e2/E6-T12e3/E6-T12e3b for bounded APIs and acceptance evidence.
No general Mesa capset can honestly describe that frontend: pinned Mesa assumes
256 temporaries, indirect temporary/constant access and control-flow depth 32
regardless of many advertised bits.

## Measured browser boundary

The qualified prototype environment is Chrome **154.0.8037.93**, Darwin **25.6.0**,
arm64, **ANGLE Metal / Apple M4 Max**. The checker defaults to rejection for every
other browser/version/host; Safari, Firefox and other Chrome combinations have
no acceptance evidence here. Software GL and unproven headless rendering fail.
This qualification is tooling policy, not a production feature switch; production
3D stays disabled on every browser.

The headed run records nine translated literal draws and **4,336 exact pixels**,
including generic linkage, float-bit uniforms, multiply/add, nearest texturing,
MAD and blending. Separate handwritten GLSL probes cover channel/alpha patches,
manual A/B/A state replay and event-loop fence progress. Those probes do not
implement guest namespaces or translate captured shaders. Format probes check
allocation, FBO completeness and sample counts, not pixel conversion equivalence.
All source and served Wasm hashes, browser/GPU identity, errors and a screenshot
are recorded in `evidence/virgl-contract/browser/`.

Measured limits include 16 uniform blocks per stage, 32 combined block uses and
binding points, 16,384-byte blocks, 16-byte block alignment, 4,096 ordinary uniform
components per stage, 16 texture units per stage, eight color attachments/draw
buffers, 16 attributes, 30 varying vectors, and line widths restricted to 1.
These are measured prerequisites, not advertised guest limits.

## Capsets: exact current policy and ABI

The only active profile is exactly:

```json
{"virglFeature":false,"numCapsets":0,"capsets":[],"guestRendererImplemented":false}
```

No experimental capset payload is authorized by this decision. Copying the
reference host's GL4.x caps or filling a native structure with zeros is unsafe.
[capset-layout.json](../renderer/virgl-contract/capset-layout.json) describes every
field and all boolean masks from the pinned header; a compiled C oracle checks
it. Capset 1 is 308 bytes, maximum version 1; capset 2 is 1,408 bytes, maximum
version 2, beginning with the entire v1 structure. Older requested versions use
the same layout for their capset ID. Future payloads must explicitly encode
little-endian integers/IEEE float bits, including the one-word boolean set.
Six-stage arrays use pinned PIPE order: vertex, fragment, geometry, tessellation
control, tessellation evaluation, compute.

A future restricted ES2 activation should prefer capset 2; capset 1 omits limits
and triggers legacy assumptions. Candidate limits are guest GLSL 120, one render
target, eight attributes/varying vectors and samplers, one viewport, ordinary
constants only, and no active streamout or advanced stages. This is a target,
not an accepted byte profile. Its final fields require a reduced-capability
reference capture and pinned Mesa initialization proof. Host ESSL 300 is separate
from guest GLSL level: native GLES3 uses VirGL `glsl_level=130`, not 300.

Pinned Mesa makes zero/legacy fields dangerous:

- Zero texture dimensions become 16384/256/4096 for 2D/3D/cube textures.
- Feature-check versions below 12 assume 64 KiB constants; below 15 imply timer
  queries. Zero constants with newer versions can underflow lowered-state budgets.
- NPOT, swizzle, derivatives/texture LOD, instance ID and divisors are unconditional.
  Most plain vertex formats bypass the vertex-format mask; depth checks use the
  sampler mask. `HOST_IS_GLES` also sets a double capability and is not just a label.
- Below GLSL 150, Mesa couples varying-vector limits to attribute count. Baseline
  WebGL2's 16 attributes and 15 varying vectors cannot be copied indiscriminately.
- `max_samples=1` selects fake software MSAA, and zero primitive masks do not
  constrain all Mesa primitive modes. Every derived capability needs auditing.

GLES3 and Hyprland activation additionally require UBOs, transform feedback, MRT,
instancing, texture arrays and the requisite format families. Twelve guest UBOs
per stage plus a reserved `VirglBlock` require at least 13 host blocks per stage,
26 combined block uses and 25 distinct bindings. Wire `max_uniform_blocks=13`
includes the ordinary constant slot; Mesa subtracts it to get 12 guest UBOs.
The measured machine meets those numeric prerequisites. WebGL2's minimum host
limits do not. No GLES3 claim follows until execution semantics are implemented.

## Three difficult mappings

**Shared storage with isolated state.** Use one physical WebGL context, a global
resource store with attachment membership, and virtual guest context/subcontext
state. Context IDs are reusable: in the glmark capture, context 6 is Hyprland at
event 120, destroyed at 201 and Xwayland at 2729. The glmark client is context 7
at event 3010; most draws belong to compositor context 5. Key object tables and
caches by device epoch, context generation, subcontext, type and handle. Restore
all bindings, vertex formats, framebuffer, uniforms, sampler, blend, depth,
stencil, scissor, viewport and rasterizer state before a draw. The API replay
probe exercises a small subset; real cross-context isolation still needs tests.

**Texture views and exact bytes.** Recorded sampler views include BGRA swizzle
(glmark event 576, byte 8720) and RGBX forced alpha (event 4569, byte 5960).
WebGL2 has no texture-object swizzle API. Specialize all supported sample
operations using immutable view swizzle/type and framebuffer format in the shader
key. Native upstream's buffer/TXF swizzle path does not solve ordinary TEX2D.
RGBA8 can back several byte layouts only with explicit upload/sample/render/copy/
readback conversion; aliases must observe the same resource. R8_UINT requires
integer storage and sampling. Format 64 is observed as a buffer, not evidence of
R8 texture support. Packed depth/stencil IDs 20 and 21 require precise bit
conversion. ID 17 Z32_UNORM is **rejected**: float depth storage is not the same
format. Sampling/rendering/depth/vertex/readback/scanout masks are separate.

**Shader syntax and PRECISE.** Structured loops and integer operations have ESSL
300 equivalents, but need bounded parsing, register/dataflow checks and correct
bit representations. The corpus uses declarations after immediates, register
ranges, partial writes, source swizzles/negation, UINT32 immediates, CONSTANT or
PERSPECTIVE inputs, indirect CONST[ADDR[0].x], branch target annotations and
FS_COLOR0_WRITES_ALL_CBUFS=1. It reaches temporary 117 and seven nested conditionals.
The bounded v2 subset is documented in the shader bridge README; larger ranges,
negation, integer instructions, indirect addressing and control flow remain rejected. The four complex Xwayland fragment
shaders are created and linked at glmark event 5462 but never subsequently bound;
the capture does not establish that their loop/indirect paths executed.

Strict `_PRECISE` is rejected. Upstream emits its qualifier only when
`has_gpu_shader5` is enabled; disabling that flag silently loses the constraint.
The browser litmus compiles baseline ESSL300 and rejects the precise variant.
Removing the suffix, treating `invariant` as equivalent, or relying on one
compiler's incidental arithmetic results is not a valid translation. This is
an explicit blocker for full recorded compositor/Xwayland shader compatibility.
A separate numerical lowering decision and proof is required.

## Transport, lifetime and failure contract

The command matrix defines strict framed decoding: validate lengths, enums,
checked arithmetic, handles, attachments and bounds before mutation. Unsupported
commands and active unsupported state fail; they are never skipped as success.
Recorded zero-binding SSBO/image/atomic clears and inactive streamout/tessellation
initialization may be accepted only after their exact inactive payload is checked.
Shader-key caches and GPU allocations have explicit byte/entry budgets and eviction;
in-flight references prevent eviction of live resources. Host allocation failure
must return an error without publishing a half-created object.

Resource IDs refer to generations. Unref/destroy revokes future lookup immediately;
views, FBOs, scanout and accepted work retain owned references until completion.
Guest backing is separately attached/detached: copy command/upload bytes before
an asynchronous yield, and never retain a borrowed Wasm memory view across growth
or reset. Checked row/layer strides, byte offsets, format block sizes and IOV
lengths govern all transfer paths. COPY_TRANSFER3D also reads attached staging
backing, even without an exported transfer-write call.

Fences preserve all 64 bits with BigInt or paired u32 values. Legacy reference
`create_fence.ctxId` is a command type, not the graphics context. Use fenceSync,
flush, then zero-timeout clientWaitSync polling after returning to the event loop.
The VM service must poll pending completions even without a new queue kick. Keep
one pending control chain initially, retain FIFO order, and service cursor work
independently. Readback/response bytes precede used-ring publication and IRQ.
Queue identity plus device epoch prevent late completions after reset from
writing to reconfigured guest queues. Each accepted chain completes at most once.

On WebGL context loss, stop submissions, invalidate the epoch and all handles,
fail current queued work in order with a device error, and expose a recoverable
VM error/restart path. Do not pretend lost 3D storage can fall back to a valid 2D
frame. Restoration requires fresh resource creation and renegotiation, not reuse
of old GL objects. Explicit guest reset cancels the old epoch without publishing
stale completions into the new queue.

Initially reject snapshot save/restore while a 3D renderer is configured, before
any machine mutation. Existing WVGPU001 CPU-only snapshots remain unchanged for
2D mode. Reconstructing GPU state is separate work; neither host textures nor
pending fences can be serialized as borrowed pointers.

## Reproduction and next boundaries

Run `make verify-E6-T10c` with local Clang/Python/Node, the pinned Emscripten setup,
and headed Chrome. `VIRGL_CONTRACT_EVIDENCE_DIR` selects the output directory.
It builds the unchanged native/Wasm bridge, executes fresh browser acceptance,
checks the matrix/ABI and records all 19 real shader translation/rejection results.
`make verify-E6-T10d` additionally proves the exact textured-scene shader pair and
its narrow grammar expansion; translation alone is not execution evidence. No Rust or
production web runtime changes occur in this slice, so it does not deploy a new
demo or claim a MIPS/FPS gain.

After the captured simple-shader slice, implementation continues in small
boundaries: bounded command decoding; virtual resources/state and replayed pixels;
async virtio transport; direct GPU scanout; then reduced-profile Mesa guest proof.
PRECISE and the expanded GLES3 promises gate desktop activation. The broad transport and WebGPU planning containers are replaced by ordered
S tasks E6-T11a–e and E6-T12a–m, preserving the live guest and performance milestones.

## Captured command boundary

`renderer/virgl-command/decoder.mjs` adds the isolated `virgl-tiny-commands-v1`
wire profile. `make verify-E6-T12a` checks all eight unmodified textured-scene
submissions (42,380 bytes, 210 packets, 32 families, eight object types) in Node
and a browser. Typed field extraction and whole-submission validation precede
any future resource lookup or execution. Caller-provided capture labels are
not authenticated by the runtime decoder; the acceptance loader separately
verifies every raw input hash. No guest capabilities change.

The `END_TRANSFERS` payload is opaque padding up to the declared packet end;
Mesa reserves a transfer prefix and may leave nonzero stale words in it. Only
outer framing governs the next command. The earlier contract's “empty marker”
wording was incorrect and is corrected here. See the pinned protocol's
`VIRGL_CCMD_END_TRANSFERS`, upstream 1.3.0 `vrend_decode_dummy` dispatch, and
Mesa 26.2.2 `virgl_encode_end_transfers`. This is not a completion fence.

Resource replay must distinguish CPU upload inputs from completed reference
readbacks. The tiny scene's initial upload ranges are in snapshot events
156/157/160. Later snapshots 184/208/232 contain the three reference images;
those bytes are comparison evidence only. Copying every later backing snapshot
into renderer storage would preload the expected output and invalidate the
replay proof. Command decoding itself consumes no backing-memory snapshots.

## Source anchors

- [Pinned VirGL header](../renderer/virgl-shader/vendor/src/virgl_hw.h), structs
  `virgl_caps_v1/v2`; [upstream renderer 1.3.0](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/ca50e008863837e094747a69974dde3ae148aeaa/src/vrend/vrend_renderer.c),
  caps at 12100–12215, 13133–13148; shared contexts at 13152; swizzles at 2690 and 4327.
- [Pinned shader converter](../renderer/virgl-shader/vendor/src/vrend/vrend_shader.c),
  TXF swizzle 3417–3492, precise marking 4384/4482, extensions 6233, qualifier 6640,
  internal block 7960.
- [Mesa 26.2.2 virgl screen](https://gitlab.freedesktop.org/mesa/mesa/-/blob/mesa-26.2.2/src/gallium/drivers/virgl/virgl_screen.c),
  implicit shader promises 177–223, limits 265–466, format checks 529–753;
  [state-tracker extensions](https://gitlab.freedesktop.org/mesa/mesa/-/blob/mesa-26.2.2/src/mesa/state_tracker/st_extensions.c),
  constant/UBO accounting 190–328;
  [version checks](https://gitlab.freedesktop.org/mesa/mesa/-/blob/mesa-26.2.2/src/mesa/main/version.c), 487–511.
- [WebGL2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/),
  differences from GLES3 including texture swizzles, fixed restart and sync objects;
  [ESSL 3.00 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf),
  language types, operators and control flow. The WebGL reference is a living draft.


## Private raw shader words

E6-T12e4a adds `virgl-webgl2-raw-bits-v1` for a bounded program containing
validated AND, OR, NOT, SHL or USHR instructions. MOV and these operations use an
owned IR and emitter with highp unsigned private storage. A shift always masks its
count with31. Each instruction reads all consumed source lanes before writing any
destination lane. All checked UINT32 immediate words are admitted on this path.
The vendored converter is unchanged. The owned backend derives declaration
metadata from the checked profile, including the established constant-count
ordering rule; upstream float-backed instruction bodies are not used. Legacy-only
programs retain their exact v5 acceptance, errors, source and metadata.

The stage interface stays float. An unchanged float-input origin may pass through
MOV directly. A computed raw output must conservatively prove a finite normal
value or zero before emission. Unknown raw constants do not satisfy that proof;
NaN, infinity and subnormal payloads stay private until converted into a proven
safe carrier. This is why merely allowing upstream integer opcodes would not
establish raw32 correctness: its float TEMP storage can lose those bit patterns.

The hardware acceptance reconstructs every output bit using finite byte carriers
in vertex transform feedback and0/255 bitplanes in fragment pixels. Inputs include
dynamic actual uvec4 uniforms, high banks, masked shift neighbors, overlapping
writes and179-instruction programs. Those arbitrary host uniforms are direct
compiler probes; the guest's finite float-bit constant command policy is unchanged.
Mixed legacy/owned pairs derive the existing smooth/flat interface key internally.
The native sanitizer, fixed16MiB Wasm, unchanged legacy suites and actual GPU
output are bound to the frozen source by `make verify-E6-T12e4a`.

Mixed float operations and comparisons remain a separate successor. PRECISE,
control flow and raw-stage sampler declarations still reject. This isolated shader
boundary does not activate a guest renderer or establish a MIPS/FPS improvement.


## Integer arithmetic, masks and selection

E6-T12e4b adds `virgl-webgl2-raw-bits-v2` only to stages containing a validated
UADD, ISGE, USEQ, USNE or UCMP. Existing v1 and legacy v5 stages retain their full
serialized results. UADD wraps modulo2^32. ISGE uses signed32 ordering, while
USEQ and USNE compare raw words, including distinct positive/negative zero and
identical NaN bit patterns. Every true comparison returns all32 bits set. UCMP
selects the raw second operand for any nonzero condition, otherwise the third;
conditions need not be canonical comparison masks. All consumed operands are
validated and read before partial or aliased destination writes.

The compiler emits only integer operations over private uint values. It computes
signed ordering by XORing the sign bit before an unsigned comparison. The
independent hardware oracle instead uses signed mathematical integers. The
compact checked source representation adds a third operand without increasing
the112-byte instruction or26,232-byte IR allocation.

Output proof remains conservative. Fully known arithmetic/comparison operands
produce exact known bits; other results need a proven safe carrier. A statically
determined UCMP condition preserves its selected payload proof. An unknown
condition intersects both payloads' known bits and preserves an input origin only
when both payloads name that same origin. Both payloads must be initialized, even
when the condition is constant. Selecting different unknown float origins or
adding zero does not grant an unproven float-output exemption.

`make verify-E6-T12e4b` records native sanitizer/Wasm parity, exact prior results,
dynamic hardware execution of every operation in both stages, all32 output bits,
mixed stage interfaces, bounded failures/recovery and intentionally incorrect
GPU lowerings. Direct arbitrary host uniforms remain compiler probes. The guest
constant command policy, production negotiation and original19 shader bodies are
unchanged. Float comparisons, mixed float arithmetic and PRECISE remain gated.


## Ordered binary32 comparison masks

E6-T12e4c1 adds `virgl-webgl2-raw-bits-v3` only to stages containing a validated
FSLT or FSGE. Comparisons classify and order the raw unsigned encodings directly.
Every signed quiet or signalling NaN is unordered, both signed zeros compare
equal, negative magnitudes order in reverse, and infinity and subnormal values
retain their binary32 order. Every result is an exact all-ones or zero word.
FSGE includes its own ordered guard and cannot be the unconditional complement
of FSLT. No raw input is converted to a GLSL float for these comparisons.

The emitter adds bounded uint helpers only to new-profile stages. Existing v1,
v2 and v5 outputs remain exact for inputs without a newly supported operation.
The instruction and IR layouts, memory limits, consumed-lane checks and safe
float-output policy remain unchanged. Full encoding guarantees apply to private
words and raw constants; an ordinary float input means the encoding actually
delivered by that float interface.

`make verify-E6-T12e4c1` compares real VS/FS output against an independent integer
binary32 oracle. Its vectors cover zeros, adjacent normal values, subnormal
boundaries, infinities and varied NaN payloads. It contrasts integer equality
with ordered comparisons and carries masks through arithmetic and selection.
The successor receipt explicitly binds newly admitted historical inputs and
their adjacent unsupported replacements while preserving all unaffected native
results and earlier GPU checks. Numeric float shadows and actual mixed
ADD/MUL/MAD/TEX chains remain E6-T12e4c2; production negotiation remains off.


## Ordinary numeric chains beside raw words

E6-T12e4c2 adds the owned v4 stage profile for validated ADD/MUL/MAD and fragment
2D FLOAT TEX mixed with raw operations. Private unsigned words remain available
for integer consumers. Actual arithmetic/sample values also retain a bounded
ordinary float shadow, so later arithmetic and float outputs can use the value
directly. Every consumed float view is determined before its instruction writes;
both RHS representations are captured before partial or aliased destinations are
published. Integer operations invalidate float authority. MOV preserves it, and
mixed-stage UCMP can select between independently authorized float views using
its unchanged nonzero raw selector. Earlier profiles retain their narrow rules.

Numeric source authority requires an ordinary input, a computed/sample shadow,
or a conservative proof that raw words are finite normal values or signed zeros.
Unknown raw numeric constants are still rejected. All seven remaining unsupported
captured bodies use such constants; they require a separate enforced domain or
full-domain numeric lowering before Mesa activation. The guest decoder's finite
value check, which permits subnormals, is not authority for standalone callers.

The floating arithmetic contract follows [GLSL ES3.00 revision6, sections4.5.1
and4.5.3](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
It permits ordinary GPU precision behavior, including higher internal precision
and a single or sequential MAD. It makes no PRECISE or exceptional raw-payload
preservation promise after numeric computation. Exact dyadic chains and texture
endpoints provide strict hardware oracles. Any non-exact assertion must use a
derived rational enclosure rather than assuming one rounding mode. Comparisons
of captured raw words retain the separately proved all-encoding integer semantics.

TEX uses the existing fragment-only 2D FLOAT grammar, samples once per instruction
and reports its real sampler names/indices. The checked destination is compacted
to keep instruction and IR allocations unchanged. The GLSL cap still rejects
excessive generated text; additional shadow arrays are bounded logical storage,
not a prediction of the driver's register allocation. `make verify-E6-T12e4c2`
records these behaviors, failures, recovery and retained renderer regressions.
Production negotiation and original captured shader outcomes remain unchanged.


## Remaining ordinary componentwise operations

E6-T12e5 adds owned DIV, MAX, FRC and LRP, plus source negation in numeric operand
positions. It uses the pinned VirGL mappings and v4 source authority, retaining
both snapshots before writes. Source negation applies after swizzling; the raw
comparison, integer, MOV and UCMP modifier grammars remain unchanged. New pure
numeric programs enter the checked owned path without needing an integer token.

The ordinary contract is intentionally distinct from an exact CPU floating-point
model. Shader admission does not impose arbitrary magnitude limits, positive
divisors or interpolation weights in [0,1]. Unknown raw numeric constants remain
rejected. The [GLSL ES3.00 precision rules](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
limit numerical assertions: independent rational division enclosures use a
specified input domain, while exact dyadic and texture-endpoint witnesses check
other operations. Computed zeros may use either sign. Undefined exceptional
results receive no invented exact payload oracle. PRECISE and the distinct
LEGACY_MATH_RULES contract remain unsupported.

The captured inventory retains all39 affected operations and six MAX source
negations, including two CONST sites that still need the later constant boundary.
Six newly accepted historical bodies are preserved as explicit positive fixtures;
adjacent rejections retain the earlier negative slots. Complete original shader
outcomes remain12/19. This compiler layer does not enable production negotiation
or claim guest graphics speed.

### Ordinary scalar reduction and reciprocal operations

E6-T12e6 extends the checked owned compiler with DP3, RCP and RSQ. DP3 consumes
post-swizzle xyz; RCP/RSQ consume the first post-swizzle lane. Each evaluates one
scalar result and replicates it before committing only the enabled destination
lanes. Initialization and numeric-authority checks use the same consumed lanes.
This preserves aliases, ignored source components and typed source negation.

The scalar RCP rule is supported by [Mesa 26.2.2](https://archive.mesa3d.org/mesa-26.2.2.tar.xz):
`docs/gallium/tgsi.rst` (RCP/RSQ/DP3), `src/gallium/auxiliary/tgsi/tgsi_exec.c`,
`tgsi_info_opcodes.h` and `tgsi_util.c` agree on scalar replication and consumed lanes. The older pinned VirGL RCP emitter uses
a componentwise shortcut; the owned lowering deliberately follows the TGSI scalar
contract. Both original captured RCP instructions already select xxxx and write x,
so this discrepancy does not justify dropping or rewriting a captured operation.

The [GLSL ES3.00 precision contract](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
§4.5.1 permits approximation. Independent dot controls have exact products and
partial sums under every association;
reciprocal checks use rational 2.5 ULP enclosures over the specified positive-divisor
domain. Inverse-root references use an integer square-root bracket and a 2 ULP
allowance. No host sqrt is an exact oracle, and perfect mathematical roots alone
do not establish exact GPU output bits. These ranges qualify tests, not shader
admission. Ordinary exceptional behavior receives no invented payload guarantee.

Two historical DP3 bodies become explicit positives. An explicitly named
compatibility run preserves the full preceding native workload with exactly two
adjacent rejection substitutions, unchanged anchors/seeds, and every unchanged
hardware oracle. It does not pretend the preceding task's fixed six-migration
receipt accepts a different history. Full original outcomes remain 12/19, and
production graphics remains disabled. Numeric constant-domain enforcement follows
this scalar layer before control-flow and original-corpus closure.

### Stage-local constant requirements at draw issue

E6-T12e6a adds the consumer for `virgl-webgl2-raw-bits-v7`. Its sole
`constant-bank-finite-f32-v1` record identifies the stage, slot zero, exact bank
name and declared extent. The renderer validates that record against the
compiler uniform metadata and actual reflection. The checked upload is the
active prefix, capped at the 46 guest-addressable registers, including unused
holes. A retained declaration of 47 never exposes CONST46 to the guest.

Completeness is independent of the finite-word check. Every uploaded raw u32
must have exponent bits other than all ones; signed zero and all subnormals
qualify without float conversion. This preserves their raw encodings and makes
no promise that ordinary GPU arithmetic retains subnormal results. A short
replacement bank cannot acquire authority from temporary restoration zeros.

The strict draw plan binds immutable checked prefixes to the selected context,
subcontext, shaders, program and constant bank identities. After an asynchronous
yield, identity validation and external binding restoration precede upload of
that snapshot. Non-draw restoration skips unusable conditional banks while
retaining the applied CPU command prefix. Unconditional restoration keeps its
existing behavior. Normal decoder Inf/NaN rejection remains unchanged.

The consumer proof uses an explicitly trusted host metadata wrapper over real
compiler results; it changes no TGSI or GLSL and enables no new compiler input.
The missing-contract test retains v7, and the inconsistent-profile test retains
the contract. Removing both from a formerly unconditional result is outside
this trusted-host contract; the renderer cannot authenticate arbitrary host
metadata by inspecting generated GLSL. Actual compiler derivation follows in
E6-T12e6b. Production guest graphics remains disabled.


### Compiler-derived finite constant authority

E6-T12e6b connects the owned shader compiler to the preceding draw-time
consumer. Previously successful translations keep their complete GLSL and
metadata. Only a typed missing-numeric-authority failure permits a second full
validation from the original immutable TGSI text, and success requires actual
numeric consumption dependent on the finite constant bank. The stage then
emits raw-bits-v7 and its own matching slot-zero constant obligation. Caller
options, source rewriting and host-injected metadata are not admission paths.

The compact facts distinguish numeric access, ordinary output permission and
finite-bank dependency. A copied conditional constant is numerically usable
but is not a computed value or a proof that raw subnormal output is safe. An
unknown UCMP preserves the selected raw bits and a synchronized numeric shadow;
if either possible arm has only conditional numeric authority, MOV and further
UCMP retain that limitation. An actual arithmetic operation grants the ordinary
output authority of its computed result. Known selectors ignore the numeric
authority of unselected initialized arms, while partial integer writes discard
stale authority on the lanes they overwrite.

The [GLSL ES3.00 contract](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
§8.3 preserves finite binary32 bits under reinterpretation, including signed
zero and subnormal inputs. Ordinary arithmetic remains subject to §4.5.1.
For the subnormal hardware witness, multiplication by exactly 2^126 must yield
the independently derived representable normal product, or zero when the input
is flushed as permitted; a normal nonzero control must yield its product.
Either sign of computed zero is allowed. Original raw constant words are
exported in the same programs and must remain exact, independently of numeric
latitude. Reciprocal and root witnesses retain the preceding rational bounds.

An explicit migration inventory preserves 105 formerly rejected exact shader
bodies as new positive inputs, with adjacent unsupported absolute-modifier
replacements retaining the historical negative positions. Successor receipts
account for these changes and reuse earlier GPU oracles without weakening
historical source-bound receipts. The larger consumer matrix remains a named
regression; new positive integration uses genuine compiler-produced contracts
through decoded commands and the shared renderer. Source-bound compiler faults
separately test missing metadata and an incorrect numeric constant index.
TEX remains fragment-only, all seven PRECISE originals remain rejected, and
production guest graphics stays disabled.
