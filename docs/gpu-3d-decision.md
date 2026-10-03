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

The v2 shader bridge translates **seven of 19 captured shader bodies** and rejects
the remaining twelve (eleven unsupported-feature, one parse-error). The exact
textured-scene pair has a dedicated three-phase pixel proof; the other five
translated bodies have no execution claim. The nine literal shader regressions
remain a separate frontend/API baseline. Limited TEMP ranges, generic `.xy`
declarations, MOV output masks, four-lane source swizzles, finite UINT32 float bits
and the one-target fragment property are now supported.
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
PRECISE and the expanded GLES3 promises gate desktop activation. The old broad
WebGPU tasks must be decomposed around this contract before entering the queue.

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
