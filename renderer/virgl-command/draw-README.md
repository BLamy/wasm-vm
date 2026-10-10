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
