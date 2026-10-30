---
kind: "Current reference"
source: "docs/design/session-store.md"
source_revision: "c396efe1ecd061721865a5929235e6d0a6268561"
source_sha256: "ac2e822ee4b7d1505d40dab745bdc36d605fa7da8151b306a0b5893d999158fb"
scope: "Current source at the stated revision; not part of the pinned migration inventory"
---

# Session store

{% hint style="info" %}
Current reference. Published from the exact source at revision `c396efe1e` (the PR 626 stack), separately from the pinned migration inventory. It describes the shipped format and its stated limits; read it with the time-travel guide. Contracts at the same revision: [Replay contract](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-replay-contract.json) · [Workload qualification (v11)](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-workload-qualification-v11.json).
{% endhint %}

`web/session-store.js` provides a separate IndexedDB store for recorded sessions.
The existing live overlay and single resume-snapshot databases remain independent.
Manifest admission, immutable-prefix checks and event-payload reference discovery use
the shared Rust codec through four read-only Wasm adapters. The small independent
`crates/session-web` bundle also provides incremental SHA-256. It is built into
`web/session-pkg` and committed under `web/dist/session-pkg`; it does not add exports
to the machine runtime. The published GPU snapshot's original runtime is retained below.

The database is `wasm-vm-sessions-v1`, version 1. `chunks` maps a SHA-256 to an immutable
Blob of at most 1 MiB; Blob size is checked before loading bytes. `objects` maps a whole
object SHA-256 to its version, exact decimal length and ordered chunk references.
Non-tail chunks are exactly 1 MiB, with at most 4,096 chunks per object. `sessions` maps
a stable ID to a manifest and a decimal-string publication revision. Wide guest positions
remain strings throughout JavaScript and IndexedDB.

`SessionStore.open()` returns a connection. `writer(id)` acquires an exclusive Web Lock
named from the exact database and session ID, using `ifAvailable`. An unavailable lock
refuses a second writer immediately. Missing Web Locks refuses writes. A frozen lease
cannot be retargeted to a different ID, and only one operation may be active per lease.
`release()` stops new work, drains pending operations and then releases ownership;
browser termination releases the Web Lock automatically.

`lease.put(reference, iterable)` accepts byte chunks up to 4 MiB and coalesces them through
one 1 MiB write buffer. It hashes the owned bytes actually copied to that buffer, including
when an input view spans an await. Detachment is refused. Each chunk's strict transaction
finishes before the next durable step. The whole-object descriptor is added only after
the complete length and SHA-256 match. Existing immutable data is verified and reused.
An interrupted or rejected put can leave orphan chunks, never a session commit.

`lease.publish(manifestBytes)` validates the candidate and preserves the complete old
event/checkpoint prefix, identity and policy. It verifies all direct asset, machine/GPU,
disk-root and event-chunk objects, plus out-of-line payloads discovered from verified
event chunks. The total unique logical data plus metadata is capped at 4 GiB. The final
strict transaction rechecks the previous revision/manifest and object/chunk presence,
then advances the manifest and cursor atomically. No data is overwritten during append.
A maximum of 256 sessions bounds the catalog; later retention policy owns removal.

`stream(reference)` yields verified bounded chunks and verifies the whole object on
exhaustion. Consumers must exhaust it before claiming the whole object is valid.
`openSession(id)` exhausts all required objects before returning the committed manifest.
`list()` reads one manifest at a time, returns compact complete-session summaries and
reports unavailable IDs separately; missing/corrupt data never appears in its complete
list. Neither reading nor a failure migrates or deletes saved data.

This is the storage/integrity boundary. E9-T04 owns disk-root contents and descendants;
E9-T05 owns machine payload decoding and coherent live-state restore. A structurally
complete storage record alone does not qualify a runtime for replay. Compatibility
admission and retained-runtime availability remain separate mandatory checks before use.

`make verify-E9-T03` records the affected native/no_std/Wasm checks and the built-page
Chromium proof: 127/0 CPU suite, two distinct sessions reopened after reload, a streamed
96 MiB + tail object, forced renderer crashes at each durable publication boundary,
twenty two-tab ownership races, missing/corrupt content and typed refusal cases. Chromium
uses an isolated persistent profile retained with the recording, so the verifier can
inspect the original IndexedDB. The synchronous `__e9SessionStoreProbe` observer only
provides a DevTools pause point; the real IDB transactions and renderer crashes remain
the authority. It has no callback in ordinary operation.
The stream memory assertion measures live retained JS/backing storage after periodic
DevTools garbage collection, with raw samples retained too. A whole-session copy would
remain live and fail; discretionary accumulation of unreachable Blob/crypto buffers is
reported separately. This is not a claim about recording throughput or transient peak
allocation, which E9-T22 measures on the complete recorder.

The quota case explicitly injects the standard `QuotaExceededError` at the native IDB
write boundary and checks the real transaction's abort and unchanged committed prefix.
It proves propagation and atomicity, rather than claiming to exhaust Chromium's quota.

Rebuilding the machine can change its exact Wasm bytes even without a VM semantic change.
The published GPU factory pair binds build `222950026e3e01ed…`; it cannot be relabeled as
the current build. Its original 46 runtime files and build stamp are retained byte for byte
in `web/gpu-runtime/<full-build-id>/`, with a digest inventory and source commit. The app
explicitly selects that runtime for its existing factory warm boot; cold diagnostic boots
use the current runtime. A root-level worker entry preserves the original relative release
URL base. The worker still performs its original strict native/renderer pair admission.
`make verify-E9-T03` checks every retained byte, recomputes the original build identity and
boots the real factory pair to resumed CPU execution and fresh physical scanout. This preserves the accepted GPU
demo while session metadata evolves. Accelerated session qualification remains E9-T17/T18.

## Related field guide

{% content-ref url="./docs.html?page=time-travel" %}
Record, rewind, and branch
{% endcontent-ref %}
