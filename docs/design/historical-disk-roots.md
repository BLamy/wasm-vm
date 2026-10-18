# Immutable historical disk roots (E9-T04)

`crates/storage/src/disk_root.rs` defines a canonical version-1.0 root. It binds the
canonical `ImageManifest::base_hash()`, image length, exact decimal u64 overlay generation,
and a strictly increasing list of `{index, sha256}` entries. Each entry names a complete
4 KiB COW block. The hash of the canonical root bytes identifies the immutable disk view.
Generation is the VM's overlay-coherence witness; it is not a globally unique root ID.
Independent branches may share a generation and still have distinct root hashes.

Roots contain their complete sparse write set. Unwritten blocks read from the pinned base.
Sharing happens at the immutable block objects, so opening an old root does not require
following a mutable latest pointer or reconstructing a chain of parent deltas. Roots are
bounded to 65,536 entries and 12 MiB of metadata; block payloads are stored separately.
Unknown versions/fields, noncanonical bytes, duplicate/unordered indices, invalid geometry,
foreign bases and mismatched generations refuse before a replacement backend is constructed.

`web/session-disk-roots.js` uses the shared Rust codec through the independent metadata
Wasm bundle. Construct `SessionDiskRoots` with an open `SessionStore`. `capture(lease,
delta, imageManifestText)` accepts the actual native WVOD1 capture, validates its binding,
and pins every block digest synchronously before its first durable await. Shared buffers
are refused. Later mutation or detachment cannot silently rewrite the planned root.
The real session-store lease writes the bounded block objects first, then the root object.
A failed capture can leave orphan objects but cannot publish a session or half a checkpoint.

`inspect(hash)` authenticates and decodes root metadata. `verify(hash, imageManifestText,
generationString)` also exhausts all referenced blocks without allocating a whole disk
delta. `restore(...)` returns an owned WVOD1 buffer only after every block has passed its
length and SHA check. It never opens or seeds the persistent live-overlay database.
The native `private_overlay` path likewise constructs a new `MemOverlay` after admission.
`liveReferences(survivingRootHashes)` and native `live_references` compute the union of
root metadata and shared blocks; deleting a child's references cannot unmark a surviving
ancestor's objects. E9-T07 owns the atomic retention/deletion policy and reclamation.

The worker controller's `captureDiskDelta()` requires an explicitly paused software
chunked guest without a secondary disk. It waits for the actual scheduler task to finish,
then drains original disk fetch/durability work and captures the shared virtio-blk backend
without retiring guest instructions. It retries native quiescence for a bounded number of
passes and refuses unresolved work. The asynchronous drain is itself owned by the scheduler
task barrier, so stop joins it before closing storage or releasing the writer lock.
The forwarding backend preserves its read-only flag,
write/flush barriers and reset methods. Generation is encoded directly from native u64,
without the legacy numeric generation API. Capture leaves the guest paused; its owner
decides when to resume and can persist the owned root while the live guest continues.

`startLinuxBoot({sessionDiskRoot: {database, sha256, generation}, ...})` can cold-boot a
root into a private software chunked disk. It requires `persist:false` and
`bootSnapshot:false`, excludes extra disks/accelerated graphics, and authenticates the
root against the actual image manifest before constructing the machine. E9-T05 adds the
coherent CPU/RAM/device/input/clock/log tuple; a disk root alone is not that tuple.
The current worker protocol is v3. The published GPU factory retains both its exact v2
worker and its matching page client, selected before worker creation. Its existing strict
factory pair identity is preserved; E9-T17/T18 still own accelerated session qualification.

The software proof uses `web/session-software-fixture.json` and the canonical
`web/session-alpine-image.json`. Every image chunk was independently checked against
the contract's 512 MiB raw image, SHA `ebcd6b7a…`. The fixture boots `/bin/sh +i`
as PID 1 and runs fenced commands over the actual UART, avoiding interactive terminal
cursor queries in the proof harness. The ordinary public Alpine chunk manifest
currently describes a different 768 MiB image, so it cannot stand in for that pin. The
fixture's 227 unique content-addressed chunks are published under the existing R2 chunk
prefix; the manifest itself ships with the app. Each requested chunk still passes the
production Wasm hash check. No existing live user's overlay is migrated or replaced.

`make verify-E9-T04` records native/shared Node-Wasm tests, the actual compiled browser
bundle, protocol compatibility, real guest file changes and private roots, and an independent
Python/e2fsprogs filesystem oracle. The oracle reconstructs owned image copies from the
pinned base and exported deltas, replays ext4's journal only in those copies, and reads the
file bytes with `debugfs`. Original bases, roots and live IndexedDB data remain untouched.
Browser traces, precise coverage, profiles, raw deltas and file/state witnesses are retained
for the fresh adversarial verifier. Recording throughput and checkpoint/seek latency are
measured on the complete system in E9-T22.
