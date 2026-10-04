# Original guest gears and required resource inventory

This is G1 capture and packet evidence. It proves an unmodified Mesa demos
client ran inside the pinned RISC-V guest, submitted real VirGL draws, and
exited zero after its actual Wayland window was closed through compositor IPC.
It does not prove browser shader admission, resource mapping, rendered pixels,
guest graphics offload, or a performance target. Production negotiation stays
disabled.

## Source and execution

The recording used frozen source `a669aad01b93e03e3b528a931748d0800156e57c`.
`captures/es2gears/manifest.json` binds every original packet and backing blob,
the actual guest script, source archive, build manifest, executable, process
identity, mapped libraries, render-node descriptor, input coldplug, and normal
closure logs. Its SHA-256 is
`202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8`.
All backing blobs are preserved with lossless gzip; none are omitted.

The official Mesa demos 9.0.0 archive SHA-256 is
`3046a3d26a7b051af7ebdd257a5f23bfeb160cad6ed952329cdff1e9f1ed496b`.
The original four C files and selected headers/build inputs are byte-identical
to that archive. Pinned GCC 12 cross-builds against the immutable guest image;
three builds in distinct directories produced the same RISC-V executable:
`59f4029a08b809f8d191cd7b3d719e2c5b09f0aadb97833f088b41fa60a918af`.
The recording has 52,809 events, 632,291,908 unique blob bytes, no dropped
records/open calls, and zero QEMU, guest, client and window-close exits.

The controller coldplugs the real VirtIO keyboard/tablet, floats and resizes
the actual client window to 300×300, waits for the original positive five-second
frame report, saves live process provenance, and closes the same window.
That report establishes completion only. Host llvmpipe is the reference
renderer; guest software fallback is forbidden. Original `-info` prints EGL
information rather than a GL_RENDERER line. Guest backend proof instead binds
the live Gallium maps, VirtIO render descriptor, named context and shader/draw
packets.

## Client requirements

`es2gears-inventory.json` separates 1,566 client draws from 29,025 supporting
draws. The selected context lifetime is `6@4410`; earlier numeric context 6 was
Hyprland. Every selected command retains its original words, event, byte
offset/length, command SHA-256 and packet SHA-256. Resource/object lifetime keys
prevent reused handles from borrowing earlier state.

| Workload | Storage format | Actual client role |
| --- | --- | --- |
| gears | 233 B10G10R10X2_UNORM| color surface |
| gears | 16 Z16_UNORM| depth surface |
| gears | 64 R8_UNORM, target buffer| vertex bytes; vertex format 30 R32G32B32_FLOAT |
| kmscube | 2 B8G8R8X8_UNORM| color surface |
| kmscube | 67 R8G8B8A8_UNORM| sampled texture |
| kmscube | 64 R8_UNORM, target buffer| vertex bytes; vertex formats 29 and30 |

The saved inventories include original flags, origin hints, dimensions,
levels/layers, surface/view formats, swizzles, targets, sampler fields,
transfers and snapshot citations. Both clients have zero inline writes.
The enum channel spelling is nominal; actual bit/byte mapping remains
unproven. G2–G6 must prove each admitted role independently.

`index.json` pins all four old capture manifests. Their unchanged nineteen
shader bodies remain F6's separate claim. The new capture contains thirteen
of those bodies and six additional original bodies: two selected client
shaders and four supporting-compositor shaders. The index lists both new
hash sets; `captures/es2gears/summary.json` gives stage and original fragment
citations, and `shaders/` retains the unchanged bodies. None of these six
inherits F6 admission or browser execution proof.

## Failure sensitivity and repeatable acceptance

`negative/recording.tar.gz` preserves a separate actual guest run with an
explicitly fake, cross-compiled RISC-V program that immediately returns zero.
It includes that source, binary and compile argv plus the complete recording.
The client exited 0 while the guest exited 1; rendered/resized/identity were 0,
window-close was 1, and workloadPass/complete were false. Supporting compositor
draws were still recorded. This archive is rejection evidence, never an
original gears happy run. `negative/manifest.json` and `records.json` bind every
member; the canonical gate authenticates it and requires workload rejection.

Run `make verify-E6-T12g1` from the repository root with the prepared local
reference Docker container. It checks the 21 existing framing tests, four
retained captures, new complete capture, reconstructed inventories, 42 forged
provenance/packet/shader-gap cases, the actual early-zero failure run, and 27
native recorder cases plus a source sabotage check. It uses no ssh, rr,
GitHub Actions or browser deployment.

`worker/recording.tar.gz` is the original frozen-source submission: build,
repeat build, capture, packing, inventory and first 39-case acceptance logs
plus native recorder sources/events/binaries. Its manifest and records bind
the archive. Later evidence supplements preserve that original recording;
the final pristine-clone acceptance is recorded separately under `worker/cold/`.
It passed at `928f4fb6e3ae4c134aca8fdd79a759045fbc877d` with clean Git status
before and after. `source-bindings.json` inside that archive binds the exact
code; its logs and native recorder artifacts retain all acceptance results.
