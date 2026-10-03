# Proof-only VirtIO 3D control bridge

`make verify-E6-T11a` drives literal guest requests through real native and Wasm
virtqueues. Wasm invokes `createVirglControlBridge` synchronously, using the
verified WebGL2 resource store and state renderer. This is the context/resource
control boundary, not live Mesa support. Production VIRGL negotiation and capsets
remain disabled. The separately compiled `virgl-control-proof` feature adds an
explicit proof constructor; even that build's ordinary constructors stay 2D.

Supported operations are CTX_CREATE/DESTROY/ATTACH_RESOURCE/DETACH_RESOURCE,
RESOURCE_CREATE_3D, RESOURCE_ATTACH_BACKING/DETACH_BACKING and RESOURCE_UNREF.
Submission, GPU DMA transfer, scanout, and asynchronous fences are later tasks.
The resource classes and limits are those documented in resources-README.md.

## Ownership and synchronous completion

The core validates exact packet lengths, fields, resource namespace, quotas,
complete response capacity, and every guest-RAM backing range before invoking the
host. Request fields and backing bytes are copied before the callback. The guest
receives success only after the host completes. A failure before commit leaves
Rust's public transport metadata unchanged. The existing 2D resource namespace is
shared: the same numeric ID cannot identify both a 2D and a 3D public resource.

Every event carries an epoch and context/resource identities. Each identity has
a guest numeric ID and a full-width transport generation. Epochs, generations,
and guest addresses cross Wasm as exactly 16 lowercase hexadecimal digits, never
JavaScript floating-point numbers. The bridge maps these identities to distinct
resource-store generations. Captured stale host events cannot target a recreated
resource. Guest wire commands themselves contain only numeric IDs; a newly
accepted command resolves that current ID, not an unknowable former intent.

The JS store owns storage, independent memberships, backing copies and retained
leases. Context destruction removes its renderer state and membership without
unrefing every public resource. Resource unref removes its public name/backing and
memberships, while previously retained storage remains until its last owner
releases it. Retired allocations continue to count against JS budgets even when
Rust has released its public metadata budget. The bridge uses the real WebGL2
backend, whose allocation failure cleans up partial objects. A context renderer
allocation failure rolls back the already-created store context.

Backing events carry an ordered array of `{address,length,data}` segments. All
segments must be nonempty and RAM-contained; overlap is allowed and each segment
is copied in order. Short backing is legal at this boundary. It does not imply a
future transfer fits. These owned copies are an **initial snapshot**, not a
promise that later guest RAM writes update the store. Future DMA commands must
revalidate and gather current guest memory or scatter readback at execution.

## Failure, reset and snapshots

Expected failure-atomic errors map to invalid-context-id, invalid-resource-id,
invalid-parameter, out-of-memory or unspecified. Unexpected callback exceptions,
malformed results, thenables/promises, and uncertain teardown poison the bridge;
subsequent 3D work fails until reset. Callback response fields must be own data
properties; getters are never executed. The marshaller accepts exactly `{ok:true}`
or `{ok:false,error:{code,message}}`. A synchronous callback is a trusted host
capability, not guest JavaScript.

Reset revokes Rust ownership and increments its epoch before calling the host.
The bridge disposes both old owners, invalidating retained tokens, and constructs
fresh ones. It only clears poison after successful cleanup and recreation. Reset
failure remains poisoned. Committed Rust generations remain monotonic across resets, separate from the
store's fresh internal generation counter. The bridge resets its per-epoch
creation high-water mark: an uncertain callback may have applied before throwing,
so Rust can legitimately retry that uncommitted generation in the new epoch.
The epoch prevents it from aliasing the old allocation.

Saving or restoring GPU, desktop or resume snapshots refuses a proof sink even
when its public metadata is empty: retained host leases cannot be serialized or
inferred from that metadata. Machine-level guards run before quiescing, restoring
RAM/CPU/devices, or entering the desktop cold-boot fallback. The direct desktop
restore backend likewise rejects before staging.

## Proof surface and evidence

`WasmVirglControlProof` exists only in explicit wasm32 proof builds. It provides a
4 MiB Machine, exact-address bounded RAM reads/writes, aligned GPU MMIO access,
and `run1()` to execute one real guest instruction and service devices. Test code
writes all descriptors, request bytes, rings and feature negotiation itself.
There is no alternate protocol implementation in the Wasm wrapper. Every access
to the Machine rejects reentrancy during a renderer callback. RAM reads and event
byte arrays are owned copies; no borrowed Wasm-memory views escape.

`inspect()` returns copied transport metadata, explicit little-endian canonical
bytes and their SHA-256 digest. `run1()` also returns a guest architectural state
digest. The JS bridge's copied `inspect()` reports transport mappings and both
owner budgets. Construction separately returns `probes.owners()` for trusted
host tests of real storage and retained leases; none of those capabilities is
available to guest code.

Acceptance records raw request/response/ring bytes, transport canonical bytes and
native/Wasm digests, plus real hardware renderer snapshots. Browser diagnostics,
served-source hashes, precise JS coverage and a screenshot bind the run to its
sources. An intentionally skipped renderer-context creation must fail the oracle.
A final clean clone reruns the gate with build-related environment overrides
removed. The fresh critic independently tests attacks and reviews coverage before
marking the task verified.
