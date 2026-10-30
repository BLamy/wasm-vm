# Native GPU result admission (E9-T18a)

The native adapter owns the point at which GPU DMA and completion results become
visible to the guest. It is opt-in before execution, with an installed GPU control/submit
owner and an active single-hart ICount/source policy. It does not enable a browser
GPU recording profile. E9-T18b owns pending keyframes; E9-T18c owns the durable
Wasm/physical-renderer replay integration.

## Recorded inputs

Synchronous control and scanout binding returns use source observation kind 7.
Their fixed 40 bytes contain a canonical intent SHA-256 and an explicit outcome.
The intent binds the logical owner epoch, operation, resource/context generations,
metadata and backing bytes. Replay skips originally failed physical operations;
an originally successful operation must reconstruct successfully before its
observation can be consumed. A live error never replaces a recorded return.

Asynchronous results use channel 22 at the common clock's Before boundary:

- Gather: accepted request identity, backing/exchange/row authority and an input
  hash. Replay reads deterministic guest RAM at this boundary and retains owned
  input bytes for the later physical upload.
- Scatter: the same authority plus an immutable payload reference. Replay applies
  the recorded bytes through tracked RAM writes, then consumes the exchange once.
- Complete: accepted request identity and the exact error, fence, exchange and
  command/draw outcome. Response bytes, used-ring publication and IRQ generation
  occur at this boundary. Posted physical mailboxes cannot retire it early.

Intent hashes include the original accepted control snapshot, request/header,
queue generation and immutable descriptor-chain snapshot. Rewriting the guest's
live descriptor table cannot redirect a result. All native DMA span/backing and
response/ring checks run before reserving an event, writing RAM or consuming an
exchange. A full result outbox or a failed identity check leaves those effects
unchanged.

## Ownership and limits

`Submit3dMailbox` retains its independent revocable handle. Its callbacks never
borrow Machine. The execution loop admits a ready result while it owns Machine
exclusively, before opening the next synchronous observation scope.

Large data is separate from the common event payload. One GPU payload is at most
32 MiB, matching the admitted production DMA bound. The immutable recording window
holds at most 64 MiB or 256 objects and transfers ownership with the event receipts.
The common clock remains at 1 MiB per event and 4 MiB total. Replay holds one prepared
result and a bounded physical transport receipt window (64 MiB/256 receipts).
Transient copies are individually bounded by the 32 MiB exchange ceiling.

Physical replay consumes gather/scatter receipts through the explicit replay
transport API. Gather returns the earlier owned bytes; scatter checks authority
and length and discards the live contents. Neither call rewrites guest RAM or
consumes an exchange twice. Early transport is retryable `PhysicalPending`.
Recorded successful completion requires a real successful physical completion
and drained transport receipts. A recorded failed completion explicitly cancels
the physical job before retiring the recorded error. Failed cancellation or
reconstruction refuses publication. Late and duplicate mailbox posts are rejected.

A prepared frame caps dispatch at its exact position. Missing results, missing or
corrupted payloads, and wrong identities have explicit outcomes; pending replay
without a next result cannot run guest instructions. The native embedding must
supply the authenticated next frame and persist transferred objects. The complete
session replay driver, persisted object closure, Wasm transport, external-ingress
policy and physical presentation evidence are E9-T18c, not claims of this slice.

## Keyframes and proof

The legacy accelerated checkpoint API remains refused while the adapter is active.
The explicit `save_gpu_result_resume` / `load_gpu_result_resume` APIs use native
GPU format v2 and required resume section 22 (`WVGFRNT1`). The whole resume is
sealed with the renderer witness and binds the existing CPU/RAM/device, build,
base-disk and overlay-generation identity. Disk bytes are separately reconstructed
by the embedding before native admission; the native codec never fabricates them.

V2 retains the actual pending descriptor chain, accepted control/resource/backing
snapshot, queue generation, command/transfer/scanout request, exchange counters,
owned physical-ready completion and diagnostic command trace. Physical work must
be settled even when the real guest response/fence and used entry remain pending.
An unavailable or uncertain physical result is refused. No pending work is drained
or reissued during capture/restore. All parsing, payload hashes, descriptor/queue
RAM spans, cached ring/RAM positions, request/context identities and coherent result
frontier checks precede the first incumbent mutation. V2 requires an empty staged
common-clock queue and a balanced pending/completed/cancelled admission ledger,
including its sequence high-water mark. V1 quiescent snapshots and
the ICount/source policy remain unchanged.

The frontier retains mode, logical/physical epoch and queue coordinates, result
cursor, up to 64 MiB/256 immutable payloads, one prepared frame (up to 32 MiB), and
64 MiB/256 transport receipts. Its encoding is bounded by 161 MiB and has its own
seal plus a hash of the entire native GPU section, including its transport/cursors.
Restore reserves fresh physical epoch and queue coordinates; only those explicitly
host-owned coordinates are normalized in logical result intents. Every guest
resource generation, descriptor, fence, counter, GPU shadow and scanout field is
retained. Completion senders are opaque per-admission leases and never serialized.
A former sender fails after revoke/rearm even if every numeric tag is reused. The
unbound legacy mailbox cannot post into an opted-in session job.

A restored settled owner applies future recorded logical DMA at its original
boundary without requesting another physical job. Its retained transport frontier
is retired with that owner's terminal result; it cannot authorize a new request.
Subsequent real guest work uses ordinary fresh physical callbacks and the same
logical identities. This is a native boundary; durable store chunks and actual
browser GPU reconstruction remain E9-T18c.

`make verify-E9-T18a` records literal RV64 code configuring the queue, publishing
available heads, notifying GPU MMIO, polling the fenced response and loading the
readback. It compares full CPU sections, all-RAM digests, response/used-ring bytes,
GPU virtual-state encodings, event receipts and instruction traces across changed
physical bytes/timing and interpreter/cache schedules. The 32 MiB case uses the
production native DMA profile. These native sinks prove guest effects; they are
not evidence of physical GPU rendering or a working GPU browser replay profile.
