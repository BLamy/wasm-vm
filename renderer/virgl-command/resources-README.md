# VirGL resources and transfers

`resources.mjs` implements the bounded resource/backing/transfer boundary after
`decoder.mjs`. It does not execute draw/state commands, advertise capsets, activate
a guest renderer, handle fences, or provide asynchronous queue scheduling.
`TRANSFER3D` and both `COPY_TRANSFER3D` directions operate on actual WebGL2 buffer
or RGBA8 texture storage. CPU backing is separate from that storage; staging
resources allocate no GPU object, and no CPU mirror supplies GPU readback.

## API

All factories and store operations return `{ok:true,...}` or
`{ok:false,error:{code,message}}`. Returned metadata is recursively frozen; returned
`Uint8Array` data is an owned copy which callers may mutate. Constructors and
metadata/byte errors use the same structured result convention. Unexpected
implementation defects are not disguised as guest errors.

```js
import {
  RESOURCE_LIMITS, computeTransferLayout,
  createWebGL2TransferBackend, createResourceStore,
} from "./resources.mjs";

const backendResult = createWebGL2TransferBackend(gl);
const storeResult = createResourceStore({ backend: backendResult.backend });
const { store, bindings } = storeResult; // Check each result.ok in real callers.
store.createContext(2);
store.createResource({
  id: 3, target: 0, format: 64, bind: 16,
  width: 64, height: 1, depth: 1, arraySize: 1,
  lastLevel: 0, nrSamples: 0, flags: 0,
});
store.attachContext(2, 3);
store.attachBacking(3, [new Uint8Array(4096)]);
// Populate backing from verified input bytes, then prepare a decoded transfer.
const prepared = store.prepareTransfer(2, decodedCommand);
const completed = store.executeTransfer(prepared.ticket);
store.dispose();
```

The store API is synchronous:

| Method | Success data and meaning |
| --- | --- |
| `createContext(contextId)` | `context:{id,generation}`; context IDs are nonzero u32. Transfers use the context immediately, before any guest subcontext command. |
| `createResource(metadata)` | `resource` containing copied metadata, derived `kind,byteLength`, and `generation`; IDs are nonzero u32. |
| `attachContext(contextId,id)` | Adds this exact resource generation to the context. Duplicate membership is rejected. |
| `detachContext(contextId,id)` | Revokes membership and invalidates prepared work using it. |
| `attachBacking(id,segments)` | `byteLength`; clones an array of 1–256 Uint8Array segments. Zero-length segments are permitted. Duplicate attachment is rejected. |
| `detachBacking(id)` | Revokes that backing identity and frees its owned segments. |
| `writeBacking(id,offset,bytes)` | `byteLength`; bounded scatter into owned backing; no input reference is retained. |
| `readBacking(id,offset,length)` | `bytes`; bounded gather into a new Uint8Array. |
| `retainStorage(contextId,id,role="view")` | `lease`; an opaque frozen identity token retaining GPU storage. Roles are `view,surface,vertex,index,readback`; staging has no GPU storage. |
| `readStorage(lease,box?)` | `bytes`; actual GPU readback, tightly packed, whole resource by default. Uses retained storage even after public unref. |
| `releaseStorage(lease)` | Releases that lease once; unknown, released and foreign tokens fail. |
| `prepareTransfer(contextId,decodedCommand)` | `ticket,layout`; validates the whole operation, retains exact identities, reserves scratch and snapshots upload bytes. |
| `executeTransfer(ticket)` | `byteLength,direction`; consumes one ticket, revalidates identities and uploads or scatters actual GPU readback into backing. |
| `cancelTransfer(ticket)` | Consumes a prepared ticket and releases its reservations/references. |
| `unref(id)` | Removes lookup in every context and releases backing immediately; retained GPU storage remains alive. |
| `destroyContext(contextId)` | Revokes all memberships and prepared work in that context. Explicit storage leases remain until released. |
| `inspect()` | Frozen `resources,contexts,budgets,limits,disposed`; usable after disposal. |
| `dispose()` | Invalidates all identities, releases backing/tickets/leases/storage and disposes the backend. Repeated successful disposal is harmless. |

Byte inputs must be attached, non-shared Uint8Array views, including nonzero host
byte offsets and Node Buffers. SharedArrayBuffer is rejected because synchronous
copying cannot promise a race-free snapshot. Data records accept their documented
own properties and reject accessors, unknown keys and missing required fields.
After inspecting all segment descriptors, the store revalidates each byte view and
its inspected length immediately before copying. A later descriptor trap detaching
or shrinking an earlier segment therefore rejects without publishing backing or
budget charges. Caller metadata is copied and revalidated; frozen decoded JavaScript is not an
identity or authority token. Optional decoded header/name/length fields must agree
with the transfer opcode. Redundant `readFromHost`/`synchronized` fields, when
supplied, must agree with validated copy flags.

## Resource profile and budgets

Metadata has exactly `id,target,format,bind,width,height,depth,arraySize,lastLevel,
nrSamples,flags`. Every value is a checked u32. Width, height, depth and array size
are nonzero. Supported classes are:

| Derived kind | Required fields | Logical storage |
| --- | --- | --- |
| `vertex-buffer` | target 0, format 64, bind 16, height 1 | width bytes on GPU |
| `index-buffer` | target 0, format 64, bind 32, height 1 | width bytes on GPU |
| `staging` | target 0, format 64, bind 524288, height 1 | no GPU allocation; attached backing only |
| `texture` | target 2, format 67, bind 10 | width × height × 4 GPU bytes |

All classes require depth/arraySize 1 and lastLevel/nrSamples/flags 0. No format
aliases, mixed buffer bindings, depth textures, mipmaps, MSAA, blobs or arrays are
accepted. An attached backing page may be larger or smaller than the resource's
logical extent. Each operation must independently fit both the logical resource
and the backing range it actually accesses.

Frozen `RESOURCE_LIMITS` defines defaults. `createResourceStore({backend,limits})`
and `computeTransferLayout(...,limits)` accept overrides that only tighten them:

| Key | Default |
| --- | ---: |
| `resources` | 16 live or retained resource generations |
| `contexts` | 8 live contexts |
| `segments` | 256 segments per backing |
| `tickets` / `leases` | 64 / 64 |
| `resourceBytes` | 4 MiB per resource allocation or attached backing |
| `transferBytes` | 4 MiB per tight transfer and strided footprint |
| `cpuBytes` | 32 MiB for attached backing plus reserved scratch |
| `gpuBytes` | 32 MiB of live and retained GPU storage |
| `scratchBytes` | 8 MiB of pending/temporary transfer storage |
| `textureSize` | 16,384, additionally limited to measured GL MAX_TEXTURE_SIZE |

A pending transfer reserves its tight byte count for either direction. Upload
bytes are copied during prepare; readback storage is allocated during execute.
All reservations are released once after success, cancellation, stale rejection
or backend failure. Resource and GPU budgets include unpublished generations held
by leases or prepared work, preventing ID churn from bypassing limits. Caller-owned
returned byte arrays are no longer retained or budgeted by the store.

`inspect().budgets` reports `resources,contexts,storages,backingBytes,cpuBytes,
gpuBytes,scratchBytes,tickets,leases`. `resources` includes retained unpublished
generations and reports copied metadata plus `generation,public,backingBytes,
references,attachments`. `contexts` contains `id,generation,resourceIds`.

## Transfer layout and backing

`computeTransferLayout(metadata,fields,backingByteLength,limits?)` is a pure Node
and browser helper. Success returns frozen `layout` with:

```js
{
  kind: "texture", box: {x,y,z,width,height,depth},
  offset, rowBytes, rowCount, rowStride, layerStride,
  footprintBytes, requiredEnd, tightBytes,
  direction: "upload" // or "readback"
}
```

`fields` uses the decoder's transfer fields. Both variants require
`resourceHandle,level,usage,stride,layerStride,box`. TRANSFER3D additionally uses
`dataOffset,direction` (1 upload, 2 readback). COPY_TRANSFER3D uses
`stagingResourceHandle,stagingOffset,flags` (1 synchronized upload, 3 synchronized
readback), with optional agreeing `synchronized,readFromHost` booleans. The
`resourceHandle` must match the metadata ID. `usage` is preserved as a checked
opaque u32, matching the pinned renderer, and has no execution effect.

Box coordinates must fit the logical resource. Buffers use byte x/width, zero y/z
and height/depth one. Textures use pixels, level/z zero and depth one. Calculations
use checked multiplication and subtraction before reads, writes or allocation:

- `rowBytes = box.width × bytesPerPixel`, with bytesPerPixel one for buffers.
- An explicit nonzero stride must cover rowBytes. Zero stride uses the **full
  resource** width, not the transfer box width.
- An explicit nonzero layer stride must cover `rowStride × box.height`. Zero uses
  `rowStride × resource.height`.
- `footprintBytes = (box.height - 1) × rowStride + rowBytes`; there is no unused
  trailing padding after the final row.
- `requiredEnd = offset + footprintBytes` must fit the attached IOV sum.
- `tightBytes = rowBytes × box.height` is the GPU upload/readback byte count.

Gather and scatter preserve row padding and bytes outside the validated footprint.
They cross segment boundaries without assuming one backing segment or page-sized
logical resources. All box/stride/IOV arithmetic is validated before touching
bytes. Readback first succeeds into private tight scratch, then writes only the
validated rows, so a failed backend read does not partially publish guest bytes.

TRANSFER3D uses the primary resource's attached backing. COPY_TRANSFER3D always
uses the secondary **staging** resource's backing: flags 1 reads it for upload,
flags 3 writes it for readback. Both resources must belong to the context. The
pinned read-from-host copy also requires primary resource backing to remain
attached, although the target bytes go to staging. The GPU resource's storage
and all backing/membership/context identities are captured during prepare, including
the primary backing's absence when an upload does not need it. Attaching, detaching
or replacing even that otherwise unused backing invalidates the prepared ticket.

A prepared ticket is not an already-accepted fenced GPU operation. Revoking any
captured attachment or identity makes it stale before the first GPU/backing write.
Detaching and reattaching the same IDs creates a new membership/backing identity;
destroying and recreating a context or resource creates a new generation. Changing
backing **contents** after prepare is allowed: uploads use their prior snapshot.
Actual queue acceptance/fence completion and guest reset epochs are later tasks.

Storage leases are trusted host ownership objects, not guest handles. They remain
usable for readback after lookup, backing or context removal until explicitly
released or disposed. The factory returns `{ok:true,store,bindings}`. Its separate
trusted `bindings.resolve(lease)` capability returns
`{ok:true,metadata,generation,role,storage}` for a live opaque lease, including
retained unpublished storage. Foreign, forged and released leases fail. The
native backend descriptor is available only through this trusted capability;
ordinary store operations expose no raw GL handles. The state executor in
`state.mjs` owns its surface/view and vertex/index leases and releases each when
its owning object or binding dies. State and resource context lifetimes remain
separate; see `state-README.md`.

## Backend contract and WebGL state

The trusted host backend interface is:

```js
{
  maxTextureSize,
  allocate(normalizedMetadata),                 // returns storage
  destroy(storage),
  upload(storage, normalizedMetadata, layout, tightBytes),
  readback(storage, normalizedMetadata, layout), // owned Uint8Array
  dispose()
}
```

Normalized metadata adds `kind,byteLength`. `allocate` is never called for staging.
Host backend methods may throw; the store reports `backend-error`. A backend that
throws during allocation must delete its unpublished allocation itself. The real
WebGL backend does this, and store allocation failure publishes no resource or
GPU budget charge. Readback must return a new owned non-shared byte array of
exactly `layout.tightBytes`; short results fail before any backing scatter.
A deterministic memory backend is useful for ownership/arithmetic tests, but is
not GPU execution evidence.

The real backend's allocation descriptors are shallow-frozen
`{kind:"buffer",buffer:WebGLBuffer}` or `{kind:"texture",texture:WebGLTexture}`.
A trusted acceptance wrapper around `allocate` can independently inspect these
handles through GL; the resource store never returns them through its public API.

Index buffers first bind to ELEMENT_ARRAY_BUFFER on a private VAO. Vertex buffers
first bind to ARRAY_BUFFER. Later upload/readback uses COPY_WRITE_BUFFER and
COPY_READ_BUFFER, preserving WebGL2's permanent element-versus-other-data buffer
classification. Textures use immutable single-level RGBA8 texStorage2D, tightly
packed texSubImage2D uploads, and readPixels from a private read framebuffer.
No CPU shadow is used as a readback oracle.

Every transfer establishes its required state: PACK/UNPACK PBO bindings null,
alignments one, row lengths/image heights/skips zero, unpack flipY/premultiply false,
colorspace conversion NONE, and its own copy/texture/read-FBO binding. Texture
operations choose texture unit zero; readback selects COLOR_ATTACHMENT0. The
private FBO detaches its texture afterward, so it does not accidentally retain
storage. The backend owns an isolated renderer context and does not restore
external bindings. A future draw executor must establish its own complete state.
Context loss and GL errors fail explicitly; no successful CPU fallback is returned.

Error codes include `invalid-input,unsupported-resource,unsupported-command,
invalid-transfer,out-of-bounds,limit-exceeded,resource-exists,context-exists,
missing-resource,missing-context,missing-attachment,already-attached,missing-backing,
invalid-ticket,stale-ticket,invalid-lease,disposed,backend-error`. An execute attempt
consumes a valid ticket even when it fails; retry requires preparing fresh work.

## Sources and acceptance

The implementation follows pinned VirGL 1.3.0 commit
`ca50e008863837e094747a69974dde3ae148aeaa`: `src/vrend_decode.c`
`vrend_decode_transfer_common` and `vrend_decode_copy_transfer3d`, and
`src/vrend_renderer.c` `vrend_resource_alloc_buffer`, `vrend_transfer_size` and
`check_iov_bounds`. The renderer's default row stride is the full resource width;
its backing footprint omits final-row padding. Staging uses guest backing only.
WebGL's distinct buffer classes follow the
[WebGL2 Buffer Object Binding rules](https://registry.khronos.org/webgl/specs/latest/2.0/#5.1).

Run `make verify-E6-T12b` for source-hashed recorded acceptance. Original upload
inputs are capture snapshots 156/157/160 only; later snapshots containing renderer
readback are comparison evidence, never replay inputs. The original resources
have 4,188 logical GPU bytes and 1,064,960 attached backing bytes. Transfer proof
covers the 64-byte vertex buffer, 12-byte u16 index buffer and 16-byte texture via
actual GL readback, independent layout/SG/lifetime/poison cases, and a final clean
clone. It does not claim replaying the scene's draws or speeding up guest graphics.
