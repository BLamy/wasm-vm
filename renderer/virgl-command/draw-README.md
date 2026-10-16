# Bounded VirGL triangle draws

`createVirglDrawRenderer` in `state.mjs` adds actual WebGL2 triangle drawing to the
same private engine used by `createVirglStateRenderer`. The state-only factory
continues to reject every DRAW_VBO, with its existing API and result shape.
Neither factory activates a guest device, advertises capsets, implements Mesa
initialization or provides asynchronous queue/fence scheduling.

```js
import { createVirglDrawRenderer, DRAW_LIMITS } from "./state.mjs";
const result = createVirglDrawRenderer({
  gl, resources: store, bindings, shaderBridge,
  limits: {},       // optional existing STATE_LIMITS overrides
  drawLimits: {},   // optional DRAW_LIMITS overrides
});
const renderer = result.renderer; // Check result.ok and each operation result.
renderer.createContext(contextId); // resource context must already exist
const executed = renderer.executeSubmission(contextId, originalBytes, provenance);
```

The profile is `virgl-tiny-indexed-draw-v1`. The context, subcontext, object,
resource-reference, shader and GL-restoration contracts in `state-README.md`
remain in force. `drawLimits` accepts only nonnegative safe integers that tighten
`DRAW_LIMITS`: 64 draws and 65,536 total indices per submission. Zero disables
that allowance. The state-only factory rejects the unknown `drawLimits` option.
The draw factory additionally requires the resource store's `readStorage`
capability. Host capabilities remain trusted, synchronous and non-reentrant;
callers cannot supply draw callbacks or predecoded command objects.

Every call validates the complete raw submission with the verified decoder before
applying any command. Malformed wire tails apply zero commands. Semantic errors
report the successful command prefix and stop before the failing draw. Successful
and failed draw-factory submission results include a frozen `draws` array of the
successful prefix's draw summaries; the state-only results remain unchanged.

Each summary contains:

- `byteOffset,opcode,count,indexed,mode,start,indexOffset,indexByteLength,actualMinIndex,actualMaxIndex`;
- `contextId,contextGeneration,subContextId,subContextGeneration`;
- `indexResourceId,indexResourceGeneration` (null for arrays);
- `vertexFetches`: each active attribute's `attributeIndex,location,resourceId,
  resourceGeneration,stride,offset,components,firstByte,requiredEnd`;
- `framebuffer`: `resourceId,resourceGeneration,width,height,depthResourceId,depthResourceGeneration`;
- `vertexShader,fragmentShader`: `{handle,generation}` references.

`inspect()` reports the draw profile and `drawLimits` alongside the existing
state snapshot. No index cache, draw history or diagnostic arrays are retained by
the renderer. Summary count is bounded by drawsPerSubmission; attribute count is
bounded by the shader/vertex-element profiles. Each index read is at most 128 KiB,
and the sum of index bytes read in a successful submission is at most 128 KiB.
Returned summaries own only frozen metadata, never native handles or index bytes.

## Validation before a GPU draw

The decoded draw must be nonempty TRIANGLES or TRIANGLE_STRIP, one instance, no base vertex
or base instance, no primitive restart and no stream-output count. `start` must
be zero for indexed draws. Nonindexed start/count must fit signed GL integers.
The pinned renderer's indexed path uses SET_INDEX_BUFFER's byte offset;
it does not add DRAW_VBO.start (`vrend_renderer.c` around 6019 and 6149–6158).
Nonzero indexed starts and zero counts are explicitly unsupported in this profile.

Both shader stages, a color surface, a viewport, vertex elements and a u16 index
buffer must be bound for an indexed draw. Active depth testing requires a Z16
attachment. Each active uniform array must have all its constant words.
Each reflected sampler must have its view and sampler state, and its texture
allocation must differ from the framebuffer allocation. Feedback rejects before
issuing a draw. Every active vertex attribute must have its referenced buffer.
An active zero stride rejects because Gallium treats it as a constant attribute
(pinned renderer 5129–5150), whereas WebGL vertexAttribPointer treats zero as tightly
packed. State-only binding/restoration still accepts its previously documented
incomplete state; that does not authorize drawing.

Check `count <= floor((indexStorageBytes - indexOffset) / 2)` before allocating or
reading. Read that exact range from actual retained GPU index storage through
`store.readStorage(indexLease, box)`, using the resource backend's synchronous
getBufferSubData path. CPU backing is not an index oracle, and public resource
unref/ID reuse cannot replace the allocation held by the index binding. Scan
all actual u16 values with explicit little-endian DataView reads. The wire's
minIndex/maxIndex are advisory and never authorize or bound accesses;
UINT_MAX maxIndex therefore requires only the actual selected index range.

Reject actual index 65535: WebGL2 always enables fixed primitive restart, including
for TRIANGLES, whereas this wire profile disables it. Silently passing that value
would change primitive assembly. See the Khronos WebGL2 specification section
[PRIMITIVE_RESTART_FIXED_INDEX is always enabled](https://registry.khronos.org/webgl/specs/latest/2.0/).

For every active R32/RG32/RGB32/RGBA32_FLOAT attribute, validate the largest actual fetch:

```
offset = vertexBuffer.offset + vertexElement.sourceOffset
elementBytes = 4, 8, 12 or 16
actualMaxIndex <= floor((vertexStorageBytes - offset - elementBytes) / stride)
```

The state layer already proves alignment and that the first whole element fits.
The division check proves the complete final element fetch before computing
reported endpoints. Original position and UV attributes use stride 16; the UV
fetch at index 3 ends exactly at byte 64. Inactive attributes do not cause GPU
fetches, and no extra vertex/index padding is required.

After all checks, restore the complete supported GL state, including bindings
changed by GPU index readback, then call
`gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, indexOffset)` and check
GL errors (using TRIANGLE_STRIP when requested). Nonindexed draws use
`gl.drawArrays(mode,start,count)` after validating the complete actual array
range. They allocate/read no index staging; both families share the existing
64-draw/65,536-element submission budget. The call remains synchronous through validation and submission, so no
JavaScript yield allows guest input changes between the index scan and draw.
A successful result records command issue, not fence completion. Subsequent
original COPY_TRANSFER3D readPixels operations synchronize actual GPU results
and scatter them into staging backing; no extra finish or CPU render mirror is
used. Existing retained objects/storage and ordered GL deletion preserve lifetime.

## Replay evidence boundary

The acceptance harness selects the captured scene's context 2 and resources 3–7,
including chronological public initialization, the 92 bytes of CPU geometry/index/
texture input from backing snapshots 156–160, all eight unchanged submissions,
three actual draws, readbacks into staging offsets 64/4160/8256, and ordered
cleanup. The independent workload's literal quadrant colors decide the 768
interior pixel assertions. Later recorded output snapshots are comparison data
only and never initialize runtime backing or decide expected colors. Independent
boot resource 2/context 1 scanout and fence transport are excluded explicitly.

The runtime does not recognize capture hashes, event numbers, resource IDs,
shader texts or fixed image dimensions. Equivalent inputs within the bounded
profile use the same checks. Restart lowering, constant vertex
attributes, other formats and live guest transport
remain outside this boundary. Actual context-loss recovery remains a later task.

`make verify-E6-T12h` additionally replays the complete first client submissions
of kmscube/es2gears (nine actual array-strip draws), original CPU inputs and full
constant banks. Independent literal pixel scenes prove depth/scissor/winding,
negative Y, adjacent state toggles and poisoned A/B/A restoration. Owned async
arrays use the existing final completion fence without waiting for GPU indices.
See [raster proof](../../tools/virgl-command/raster-README.md). This isolated
renderer proof does not advertise guest caps or claim live frame rate.

The verify-E6-T11d6 make target extends only the explicit standard async facet
with native instanced triangle/strip draws and u8/u16/u32 indices. Wire instance
counts zero/one execute one equivalent ordinary native draw; larger counts
select instanced calls. Every vertex-instance pair is charged against the
existing 65,536-work ceiling, including cumulative draws. Fetch bounds derive
from the actual later-task GPU index snapshot and each wire divisor, ignoring
range hints. The final read revision is validated immediately before draw.

Wire divisors above 65,536 map to native divisor65,536: no admitted instance
index reaches either divisor, so both fetch element zero. This avoids native
signed-query saturation while preserving the entire admitted fetch domain.
Recording includes both wire and bounded native divisors, real fetched extents,
original owned input bytes, queried native bindings/bytes, full saved pixels,
GPU calls and completion fences. The independent literal-packet oracle catches
an actual served divisor corruption. Legacy factories retain their old grammar,
result shape and behavior. Zero stride, other primitive modes, restart lowering
and production capability negotiation remain subsequent boundaries.

`make verify-E6-T11d7` admits zero-stride float attributes only through the
host-selected standard async factory. Each active R32/RG32/RGB32/RGBA32 record
uses the retained GPU buffer at buffer offset plus element source offset;
missing lanes are 0,0,0,1. Native generic values replace disabled arrays, with
native divisor zero even when the wire divisor is positive. Prefix restoration
resets generic values; every actual draw restores the freshly collected values.
These retain native GLES floating-point authority, not an exact raw-bit input
certificate. Legacy factories continue to reject active zero stride.

A draw batches at most sixteen constant reads and one index read. Their dense
payload sum must fit the job transfer budget before any read starts. Existing
opaque tickets retain each resource generation and content revision; an already
collected ticket stays owned until every read is ready and the whole batch is
validated immediately before the draw. Cancellation, stale storage and partial
ticket allocation drain all started reads. Explicit renderer/store disposal
invalidates the batch without claiming GPU completion. No finish or blocking
poll is used. Original words, native generic values, fetch extents and physical
pixels are recorded. The unchanged D6 and legacy async boundaries are retained
in the frozen gate. This isolated facet does not enable production caps or the
guest device; full API qualification and guest offload remain ordered work.


## Standard core line and triangle-fan primitives

The explicit `createVirglStandardAsyncRenderer` also maps Gallium modes1,2,3,6
onto native LINES, LINE_LOOP, LINE_STRIP and TRIANGLE_FAN. All four existing
array/index ordinary/instanced entry points use the same checked selection.
Legacy factories continue to admit only modes4/5. Native one-pixel line state,
actual-index bounds, all vertex-instance work, GPU-read constant defaults and
whole-batch ownership are unchanged; incomplete primitive tails are charged and
bounded even when they produce no geometry. Nonempty counts, disabled restart,
zero base offsets and the existing format/resource/shader limits remain required.
Points, point size, quads, adjacency and patches remain unsupported.

`make verify-E6-T11d8` proves original wire modes and 87 physical frames/50,176
pixels, exact/short complete tails, false hints, work limits, native-state A/B/A,
three later-task schedules and pending cancellation/staleness/name reuse. The
independent oracle reads only original upload packets/bytes and known source
geometry. Native GLES3 section3.5 permits bounded line raster alternatives;
fragment-center endpoints may be present or absent while all interiors and
outside pixels remain strict. The closing loop-edge interiors and fan area are
strict, and a real served LINE_LOOP-to-LINE_STRIP mutation completes its draw and
fence but fails the named full-pixel oracle. Full D6/affected legacy and D7
physical gates are retained once, with unchanged historical receipts carried
rather than rewritten for this new mode boundary. This isolated factory still
grants no positive production capabilities, guest/API/throughput or demo claim.

The standard async facet also lowers explicit indexed primitive restart. Only
matching original restart words are excluded from actual fetch bounds. Custom
markers become native u32 fixed restart, and disabled-restart u8/u16 maximum
vertices are widened without changing their vertex IDs. Already compatible
streams keep the original native type and binding offset. Nonrestart u32max,
nonindexed restart, base offsets and stream output remain explicit errors.

Private normalized EBOs are detached from the guest VAO before a yield and
retained through final job completion/drain or explicit disposal. The existing
65536 source-work and 64-draw ceilings bound retained normalized storage to
262144 bytes and 64 buffers. CPU normalization scratch is separately accounted
and cannot cross a yield. Inspection exposes all three counters. All-restart
streams report empty/null vertex bounds while charging original source work.

`make verify-E6-T11d9` records original GPU bytes, physical normalized EBO bytes,
actual native indexed calls, full pixels and private ownership through later
reads/fences, allocation failures and disposal. Its shader guards clip W with
the actual native vertex ID and the original position record's ID tag. This
proves index preservation without relying on a browser's flat-line provoking
vertex convention. Core provoking-vertex qualification, complete GLES, actual
guest Mesa, production negotiation and performance remain outside this facet.

The trusted standard factory additionally accepts `primitiveAssembly: "lists"`.
The historical default remains `"native"`; legacy factories reject this option.
The list selection requires `WEBGL_provoking_vertex` and restores LAST before
every draw. Original LINE_LOOP segments become native LINES, including their
closing pair; original TRIANGLE_FAN segments become native TRIANGLES. Only exact
enabled original restart words split segments. Arrays use `start + i`, and all
emitted words retain their original vertex IDs, winding and shader inputs.
Nothing evaluates a guest shader on the CPU.

Two bounded passes count then write one u32 vector. A fan emits at most three
times its source count, so the existing source-work ceiling derives at most
786432 retained native bytes per job and 64 private buffers. The largest single
65536-source fan emits 196602 indices/786408 bytes; 64 fans of 1024 sources each
retain 784896 bytes. Every original word, restart and incomplete tail still
charges source work times effective instances. The same D9 owner retains these
buffers through completion/drain or explicit disposal. The original VAO index
binding, including a retained binding on an array draw, is restored before any
yield. CPU output scratch never crosses a yield.

`make verify-E6-T11d10` uses original position ID tags plus per-vertex flat
colors, smooth interpolation, winding/culling, FIRST-state poisoning and actual
private GPU bytes. Original and native mode/count/indexed/work remain separate
in draw summaries. The selected list boundary is an isolated prerequisite;
complete API/profile qualification, production capsets, guest rendering and
performance remain outstanding.
