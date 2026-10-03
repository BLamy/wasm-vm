# Asynchronous renderer jobs

`createVirglAsyncRenderer` from `state.mjs` shares the verified state/draw engine
while exposing owned, resumable jobs. Existing `createVirglStateRenderer` and
`createVirglDrawRenderer` retain their synchronous APIs and behavior. This factory
does not expose `executeSubmission` and does not activate production guest 3D.

Use one resource owner and check every result:

```js
const owner = createResourceStore({ backend });
const created = createVirglAsyncRenderer({
  gl, resources: owner.store, bindings: owner.bindings,
  asyncAccess: owner.asyncAccess, shaderBridge,
  limits: {}, drawLimits: {}, jobLimits: {},
});
const renderer = created.renderer;
renderer.createContext(contextId); // The resource context must already exist.
const begun = renderer.beginSubmission(contextId, bytes, provenance);
// Drive renderer.step(begun.job) from the host pump, outside Machine.run.
```

The profile is `virgl-tiny-async-jobs-v1`. `JOB_LIMITS` defaults to one job,
64 commands per step, 262144 submission bytes and 4194304 bytes per transfer or
index read. Overrides only tighten these limits; commandsPerStep must be positive.
Existing draw/index quotas apply across the whole submission, including yields.
The resource store additionally charges owned dense rows to its CPU/scratch quota
and GPU staging allocations to its GPU quota. One pending exchange/read is held.

`beginSubmission(id, bytes, provenance={})` decodes the complete byte stream before
any command mutation and returns `{ok:true,job,profile,byteLength,commandCount}`.
The opaque job owns immutable decoded commands and retains no caller byte views.
Malformed tails apply zero commands. `step(job)` returns
`{ok:true,status,appliedCommands,request?,result?}`. Status is `ready`,
`waiting-gpu`, `needs-input`, `needs-output`, or `done`. A `done.result` contains
the usual success/error, successful command prefix and `draws` summaries, plus
`gpuComplete`. Only completion covered by a signaled fence sets that flag true.
An uncertain wait failure or context loss terminates with false. Jobs are consumed
on completion; wrong, foreign or consumed identities reject without advancing work.

An input/output request has an opaque `token`, original command
`{byteOffset,opcode}`, destination/source-backing `resource:{id,generation}`,
`backingGeneration`, and the existing checked `layout` (including `offset`,
`rowBytes`, `rowStride`, `rowCount`, `tightBytes`). Output additionally has owned
`bytes`: row-major dense data with no padding. `provideInput(job,token,bytes)`
requires exactly tightBytes and makes its own snapshot; later source mutations
cannot alter the upload. `acknowledgeOutput(job,token)` confirms that the host
published the requested rows. Both consume the request once. Input/output tokens
are distinct from job and resource-access identities.

The async path never gathers attached private backing copies or scatters into
them. Those copies remain synchronous-proof storage, not current guest RAM.
The pump supplies fresh upload rows at `needs-input`. For readback it validates
its own destination generation and every guest SG range, scatters only rowBytes
at offset + row*rowStride, and acknowledges before execution continues. The store
validates its captured backing/context/membership identities before issue, after
yields, and before acknowledgement. Failed commands do not roll back earlier
state changes. There is no submission-wide output list.

Texture readback queues `readPixels` into a private PIXEL_PACK_BUFFER. Buffer
readback queues `copyBufferSubData` into private staging of the same WebGL buffer
class; index staging first binds ELEMENT_ARRAY_BUFFER on a private VAO. Each copy
is followed by fenceSync and flush. Only `clientWaitSync(sync,0,0)` polls readiness;
getBufferSubData executes after a signaled result. There is no finish, positive
wait or synchronous readback fallback. The external pump must yield to a later
browser task before polling again; a microtask loop is not a scheduler. A final
completion fence covers issued work, or a completed final readback fence is reused
when no subsequent GL work was issued. Ordinary shader/driver calls and bounded
CPU copies retain their normal execution costs.

Public store uploads increment a storage content revision before attempting the
host write, including failures of that attempt. Staged index reads retain their
lease and revision; a changed revision rejects before a resumed draw. The draw
revalidates actual staged indices and restores all supported GL bindings. Trusted
host code must not mutate private native object contents directly or reenter host
capabilities. External GL binding changes remain supported.

One active job makes renderer context creation, destruction and explicit state
restoration return `busy`; inspection is allowed. `cancel(job)` marks an error
outcome and returns `cancelling`. Continue stepping to drain issued GPU work while
retaining the single retiring slot and byte reservations; collected bytes are
never exposed after cancellation. Then destroy the context. Disposal revokes all
jobs and deletes owned allocations immediately without claiming GPU completion;
WebGL retains any necessary driver references. Context loss also fails closed.
The future device FIFO can defer destruction until prior jobs complete.

`renderer.inspect().jobs` reports active count, phase, applied command count,
command count, input/output bytes, pending resource reads/transfers and staging
bytes. The new trusted `owner.asyncAccess` capability supplies resource preparation,
input, staging, polling, validation, release and accounting to the renderer.
Synchronous transfer methods reject its tickets before consumption, and the
asynchronous capability rejects synchronous tickets. It is not a guest API.

`asyncAccess.describeBacking(resourceId)` returns
`{ok:true,resource:{id,generation},backingGeneration,byteLength}` for the current
public resource and backing. The transport adapter captures this identity when
attaching SG metadata, before the first DMA exchange; it must not infer identity
from a later request. Missing, detached or unpublished resources reject. Backing
reattachment and resource ID reuse produce new generations.

Buffer-copy staging uses the legal DYNAMIC_COPY usage hint. Independent raw
WebGL reproductions on Chrome 154/ANGLE found deferred GL_INVALID_OPERATION for
same-class ELEMENT_ARRAY_BUFFER staging allocated with *_READ hints, despite
correct returned bytes; repeated DYNAMIC_COPY runs returned correct indices with
zero GL errors. Texture PIXEL_PACK_BUFFER staging retains STREAM_READ. The
runtime keeps all GL error checks and does not treat the driver error as success.

Resource-store disposal retains only the bounded opaque tokens of accesses it
revoked, allowing the renderer to release each once when the store is disposed
first. These tombstones retain no payloads, backing arrays or native handles.
Foreign and duplicate releases reject; repeated disposal preserves unconsumed
tombstones. Normal completed/released accesses leave no tombstone.
