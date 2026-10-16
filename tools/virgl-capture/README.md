# Real guest VirGL reference captures

This tooling records the sanitized Arch RISC-V guest's actual Mesa submissions to
a native Linux reference renderer. It is isolated from the VM and browser
implementation. Host llvmpipe is intentional; guest software fallback is a failed
capture. This corpus does not claim browser desktop rendering.

The reference host uses QEMU 7.2.22, virglrenderer **1.3.0 commit
ca50e008863837e094747a69974dde3ae148aeaa**, and Mesa 22.3.6 GLX under Xvfb. Native
ARM64 QEMU executes the RISC-V guest using TCG. The guest remains Mesa
`1:26.2.2-1` and Hyprland `0.56.2-3`. Every recording includes the actual package
list, renderer output, loaded host-library maps, binary hashes, command line,
guest script and explicit success/failure status.

## Setup and execution

Run from the repository root. The Docker build requires the pinned Debian
packages to remain available; it fails rather than silently substitute newer
runtime packages. The acceptance verifier uses recorded artifacts offline.

```sh
sh tools/virgl-capture/reference.sh build
sh tools/virgl-capture/reference.sh start \
 /absolute/path/releases/rootfs/omarchy.ext4 \
 /absolute/path/releases/kernel/6.6.63
```

Both mounts are read-only. Each workload gets its own new qcow2 overlay, complete
QEMU startup, recording and guest shutdown. `capture.py` checks the source mount
is read-only and refuses to overwrite an output directory. The temporary overlay
is deleted after the process exits. The base image is never opened writable.

Build the workload tools with the adjacent workload build instructions. Copy them
to `/capture/workloads` in the container, including `build-manifest.json`, binaries
and glmark2 data. No guest package upgrade is needed. QEMU exposes this directory
through an explicit modern `virtio-9p-device`; the guest mounts `/hostcapture`.

```sh
sh tools/virgl-capture/reference.sh capture textured-scene /capture/corpus/textured-scene
sh tools/virgl-capture/reference.sh capture kmscube /capture/corpus/kmscube
sh tools/virgl-capture/reference.sh capture glmark2-es2 /capture/corpus/glmark2-es2
sh tools/virgl-capture/reference.sh capture compositor /capture/corpus/compositor
mkdir -p evidence/virgl-corpus/captures
docker cp wasm-vm-virgl-reference:/capture/corpus/. evidence/virgl-corpus/captures/
python3 tools/virgl-capture/validate.py evidence/virgl-corpus/captures --write --pack-blobs
```

Set `VIRGL_REFERENCE_CONTAINER` when reusing another prepared container. The
implementation sessions used `wasm-vm-virgl-reference-research` on local Colima.
Colima shares `/Users` here; use `docker cp` for host `/tmp` data. The source
kernel includes DRM and VirtIO GPU. QEMU's default legacy MMIO prevents those
drivers from binding, so **`-global virtio-mmio.force-legacy=false` is required**.

The direct guest launch unsets `LIBGL_ALWAYS_SOFTWARE`, `GALLIUM_DRIVER`, and
`LP_NUM_THREADS`, without changing the source image's environment files. The
compositor uses a minimal finite configuration and seatd, then exits through
`hyprctl dispatch exit`. It exercises the real shipped compositor binary rather
than the full Omarchy user session. The custom scene asserts 768 exact pixels;
kmscube renders eight frames (upstream's perf report excludes its warmup and
prints seven); packaged `glmark2-es2-wayland` validates one 800x600 texture scene
under the finite compositor. Its recording includes compositor initialization
and frame traffic as well as the glmark2 context. The DRM glmark2 backend forces
the largest connector mode and failed its unchanged pixel oracle, so it is not
used. `/dev/shm` is mounted normally before Hyprland creates its dma-buf format
table; omission causes an invalid shared-memory FD. These are
functional captures, not benchmark measurements.

## Recording format

`manifest.json` uses schema `wasm-vm-virgl-capture-v1`. It hashes `events.jsonl`,
all artifact files, input binaries and immutable source images, and names the
workload, versions, limits, command and process/guest result. `payload/` preserves
the recorder source/shared library, execution script, workload binary and its
build manifest. Guest commands and their full serial output are artifacts.

Each JSONL event has a strictly increasing `seq`, a `type`, and a `blobs` array.
Blob references contain `role`, `sha256`, and `bytes`; bytes reside at
`blobs/<sha256>.bin`. Identical content is deduplicated. No native pointers,
structure padding or host-endian object dumps appear in metadata. VirGL command
blobs preserve every submitted little-endian dword, including short submissions.

API events have `phase: enter|return`. Returns point to `callSeq` and give the
actual integer `result` (zero represents a void function's return). Record-local
`threadId` and `parentCallSeq` describe nested forwarding and callbacks without
exposing native thread identifiers. The bounded TLS stack allows 64 nested calls.
For example, upstream `context_create` forwards to `context_create_with_flags`;
these nested events represent one effective context creation.

Recorded types cover initialization, capset query/data, context create/destroy,
resource creation/unref, context resource attachments, iov attach/detach,
submissions, transfer reads/writes, fence creation and completion, and reset or
cleanup when QEMU calls them. This records the serialized pinned QEMU submission
path; it does not claim correct recording of arbitrary concurrently mutating
embeddings. Legacy `create_fence`'s `ctxId` field is the actual
API argument; QEMU passes a command type there, not a live graphics context ID.

`backing_snapshot` events give `resourceId`, `reason`, `iovLengths`, and a
concatenated backing blob. They occur on attachment and transfers, and for **every
attached nonempty resource before every submit**. This is necessary because
`COPY_TRANSFER3D` reads guest backing inside the renderer and bypasses the public
transfer API. Transfer enters identify `explicitIov` versus attached backing;
reads also snapshot after completion. The original pointers and API arguments
are passed through unchanged, and copied iov descriptors live only until detach
or unref. The no-blob/no-context-init QEMU profile is explicit; encountering a
blob resource fails the recording.

The first event names the workload and limits. A destructor footer records
normal process exit, open-call count, failure status and whether QEMU actually
called renderer cleanup. QEMU normally exits without calling that API, so the
recorder does not invent a cleanup call. Success additionally requires QEMU
exit zero, exact full-line guest BEGIN/END markers, guest exit zero, a workload
success marker and the actual VirGL renderer. Missing footer, dropped records,
limit exhaustion, a watchdog kill, software fallback or missing blobs fail.

Runner limits default to 100,000 events, 64 MiB JSONL, 512 MiB unique blobs, 64 MiB per
blob, 4,096 resources, 16,384 iov segments, 8 MiB per log and 120 seconds. Any
recorder failure writes a `FAILED` marker; the runner terminates QEMU and marks
the run incomplete. Existing failed runs are not overwritten or relabeled.

Upstream `VREND_DEBUG=dump_cmd_streams` is deliberately unused: it emits unordered
fuzz seeds only for large submissions and discards their first 4,096 bytes. This
recorder captures the complete public API submission and backing boundaries.

## Checks

The recorder compiles with `-Wall -Wextra -Werror`. Run the independent offline
validator and its malformed-record tests through `make verify-E6-T10b`. The
recording and validation implementations are owned separately. Preserve a fresh
reference recapture for the verifier; do not substitute a hand-authored stream.

The validator's `--pack-blobs` export uses deterministic gzip with mtime zero.
An event's SHA256 and byte length always describe the complete uncompressed
bytes; `.bin.gz` is only a lossless storage representation. The validator checks
those bytes after decompression. `--write` regenerates summaries and extracted
shaders. Shader opcode histograms count unique shader bodies, not every repeated
binding or identical shader upload.
