# Guest VirGL command corpus

This corpus records real RISC-V guest Mesa workloads running on the native Linux
QEMU reference host. It establishes the guest's command, shader and resource
requirements. It does **not** establish browser rendering, an accelerated Omarchy
session, or an emulator throughput improvement.

The guest is the sanitized Arch image with Mesa `1:26.2.2-1` and Hyprland
`0.56.2-3`. It uses the VirGL driver. The reference renderer is pinned
virglrenderer 1.3.0 at `ca50e008863837e094747a69974dde3ae148aeaa`; its host GL
implementation is llvmpipe, deliberately separated from future browser hardware
validation. Each run starts from a fresh qcow2 overlay over the read-only source
image and shuts down QEMU after a finite workload.

Run the offline acceptance from the repository root:

```sh
make verify-E6-T10b
```

`captures/<workload>/manifest.json` hashes the ordered API events, guest logs,
source and executable payloads. Content-addressed blobs retain the complete
submitted command buffers, resource backing and capsets. `.bin.gz` is lossless
storage: the recorded SHA-256 and byte count refer to the original uncompressed
bytes. The validator checks those bytes before extracting shaders or counting
commands. The manifest is unchanged by packing.

`summary.json` and `shaders/*.tgsi` are deterministic derived outputs. Validation
recomputes and compares them. Opcode counts include every recorded submission,
including boot/setup/teardown. Shader instruction counts count each distinct
TGSI body once; occurrences record all creation packets and context/subcontext
identities, including continuation boundaries. They are not execution-frequency
or GPU performance measurements.

The textured scene performs three draws and checks 768 exact interior pixels against
literal colors. kmscube executes eight cube draws; its upstream performance
report excludes the warmup frame and reports seven. glmark2 validates one texture
scene in an 800×600 Wayland window under Hyprland; its capture includes both client
and compositor contexts. The compositor-only run uses the shipped Hyprland binary
with a minimal configuration and exits through `hyprctl dispatch exit`. Neither
compositor run claims the complete Omarchy user session.

The recorder is scoped to the pinned QEMU GPU path, whose calls are serialized.
Its thread and nesting metadata preserves callbacks and nested API forwarding;
it does not prove arbitrary concurrent native embedding. Snapshots before every
submission preserve backing read internally by `COPY_TRANSFER3D`. The corpus
validator proves integrity, framing and the documented workload markers, not
full VirGL command semantics or correctness of every rendered compositor pixel.

Reproduction and the capture format are documented in
[`tools/virgl-capture/README.md`](../../tools/virgl-capture/README.md). Recorded
worker/verifier logs and their source commits are named in the E6-T10b task's
Verification log. Failed exploratory runs are not promoted into this corpus.
