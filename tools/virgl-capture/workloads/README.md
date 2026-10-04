# Guest graphics capture workloads

These workloads run **inside the actual RISC-V guest**, using its Mesa VirGL
driver. Their reference host is native ARM64 QEMU/virglrenderer with host
llvmpipe. They do not establish browser acceleration or guest desktop readiness.
`pins.json` records the sanitized image, guest packages, cross compiler,
official kmscube revision, and exact Arch RISC-V glmark2 package.

## Rebuild without modifying the source image

The reference container must already exist with the source image mounted
read-only at `/reference/omarchy.ext4`. The builder only reads it with `debugfs`;
it does not mount the image, boot a guest, modify the overlay, or configure host
binfmt. It uses native ARM64 cross GCC and the guest's extracted headers,
libraries, glibc startup objects and dynamic loader. Container preparation needs
the exact package versions in `pins.json`; the worker installed them only in the
disposable Debian bookworm container:

```sh
apt-get update
apt-get install --no-install-recommends gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu zstd
```

From the host repository root:

```sh
python3 tools/virgl-capture/workloads/build.py \
  --container wasm-vm-virgl-reference-research
```

Optional `--glmark2-package /path/to/glmark2-2023.01-2-riscv64.pkg.tar.zst`
reuses an existing download; its SHA-256 is still checked. Host prerequisites are
Python 3, Git and Docker. `--cache` chooses the host source cache. The default
container output is `/capture/workloads`, exposed to the guest through the
recorder's read/write 9p mount at `/hostcapture/workloads`. Compiler work stays
under `/workload-build` and `/workload-sysroot`; these are disposable owned paths.

The builder verifies the complete source-image hash, checks pinned toolchain
packages, retrieves the exact official kmscube commit, verifies its git archive
hash, and rebuilds both native guest workloads. No RISC-V program is executed by
the host. It extracts glmark2 into the output directory without installing guest
packages. It records:

- `build-manifest.json`: compiler identity, full argv, package/source pins and
  executable hashes.
- `sysroot-files.json`: SHA-256 inventory of the extracted guest headers and
  link dependencies.
- `sources/`: the complete kmscube source archive (including MIT notices and
  `COPYING`), the original glmark2 package, our workload source, and pins.
- `bin/virgl-textured-scene`, `bin/kmscube`, and the packaged
  `usr/bin/glmark2-es2-drm` / `usr/bin/glmark2-es2-wayland` executables.
- `bin/virgl-textured-scene-sabotage`: a negative-test executable described below.

The kmscube source list matches its pinned Meson mandatory source list. Optional
GStreamer, PNG export, GLES3 shadertoy and texturator are omitted; no upstream
source is patched. The RGBA texture dataset remains the upstream bundled data.
The archive is from the [official repository](https://gitlab.freedesktop.org/mesa/kmscube/)
at `f60e50e887d3c49e91ac9b06d8199b36152632fa`. glmark2 is the pinned
`2023.01-2` Arch RISC-V package, upstream
[2023.01](https://github.com/glmark2/glmark2/tree/2023.01).

## Finite guest invocations

The capture driver owns boots, serial input, workload markers, logs and shutdown.
Run these sequentially, with no compositor owning DRM master during kmscube.
The glmark2 Wayland invocation needs the finite Hyprland session created by the
capture driver and its `XDG_RUNTIME_DIR` / `WAYLAND_DISPLAY` environment.
Unset the sanitized image's software-forcing variables explicitly.
A timeout or nonzero exit fails the workload; timeout is only a watchdog.

```sh
env -u LIBGL_ALWAYS_SOFTWARE -u GALLIUM_DRIVER -u LP_NUM_THREADS \
  timeout -k 3s 30s /hostcapture/workloads/bin/virgl-textured-scene /dev/dri/renderD128

env -u LIBGL_ALWAYS_SOFTWARE -u GALLIUM_DRIVER -u LP_NUM_THREADS \
  timeout -k 3s 30s /hostcapture/workloads/bin/kmscube \
  --device=/dev/dri/card0 --mode=rgba --count=8 --nonblocking

env -u LIBGL_ALWAYS_SOFTWARE -u GALLIUM_DRIVER -u LP_NUM_THREADS \
  timeout -k 3s 60s /hostcapture/workloads/usr/bin/glmark2-es2-wayland \
  --validate -b texture:texture-filter=nearest --off-screen --size 800x600 \
  --frame-end finish \
  --data-path /hostcapture/workloads/usr/share/glmark2
```

`kmscube --nonblocking` prevents queued serial input from terminating its draw
loop early with exit code zero. `--count=8` is the actual upstream frame bound.
The final `Rendered 7 frames` line is expected: pinned `perfcntrs.c:510–524`
excludes the first draw from FPS accounting, while `drm-legacy.c:78–88` still
executes eight draws. Check both the finite invocation and recorded draw work.
For an explicitly different offscreen capture, kmscube also supports
`--offscreen --device=/dev/dri/renderD128`; record the changed invocation rather
than treating it as the KMS workload above.

glmark2 `--validate` draws one frame of each selected scene and stops (upstream
`src/main-loop.cpp`, `MainLoopValidation::draw`, lines 373–382). Its process exit
status alone does **not** report failed pixel validation. Require the renderer
line to contain `virgl` and the selected scene to print `Validation: Success`.
`SceneTexture::validate` uses the upstream literal center-pixel color with its
own tolerance; this is separate from the exact oracle below. Never accept
`Validation: Failure` or `Unknown` as a successful capture.

The DRM build ignores the requested window size and selects the connector's
largest mode (`src/native-state-drm.cpp:603–613`), which is 5120×2160 on this
reference host. Its texture oracle fails at that size. The Wayland build permits
the intended 800×600 surface without changing the upstream oracle. Its capture
also contains the supporting compositor's contexts; context names distinguish
that work from the glmark2 client.

## Textured scene's independent oracle

The program opens the DRM render node and uses GBM/EGL with a surfaceless GLES
context. It refuses a renderer string without `virgl`. It renders two indexed
triangles into a 32×32 RGBA framebuffer, sampling an independently specified
2×2 texture with nearest filtering and clamp-to-edge. Dithering is disabled.
Each phase checks four 8×8 rectangles wholly inside the texture quadrants:
256 exact RGBA pixels per phase, 768 total. Texture memory and framebuffer
coordinates both use the bottom-left convention.

| Phase | Bottom left | Bottom right | Top left | Top right |
| --- | --- | --- | --- | --- |
| Nearest | 255,0,0,255 | 0,255,0,255 | 0,0,255,255 | 255,255,0,255 |
| Tint (1,½,0,1) | 255,0,0,255 | 0,128,0,255 | 0,0,0,255 | 255,128,0,255 |
| Alpha ¼ over blue | 64,0,191,255 | 0,64,191,255 | 0,0,255,255 | 64,64,191,255 |

Quarter alpha deliberately avoids halfway rounding: `255 × ¼ = 63.75` rounds
to 64, and `255 × ¾ = 191.25` rounds to 191. Quantizing source alpha to 64/255
before blending produces those same bytes. No tolerance or observed-color
substitution participates in this oracle.

Each draw finishes and reads actual guest GL pixels. Expected values are literal
bytes, not outputs of the shader bridge or reference recorder. Success requires
three `PIXELS_PASS` lines followed by exactly
`TEXTURED_SCENE_END status=pass draws=3 checked_pixels=768`. A mismatch reports
phase, coordinate, actual and expected bytes and exits nonzero. Resource cleanup
occurs before the success marker. The program's bound is exactly three draws;
it has no animation/time-based loop.

The builder also makes a sabotage copy with the first uploaded texture texel
changed from red to green while preserving every expected pixel. Run
`virgl-textured-scene-sabotage` with the same render-node arguments and watchdog.
The test passes only if the process exits 1, reports `PIXEL_MISMATCH phase=0`
with actual green versus expected red, and omits the success end marker. This
proves the exact oracle detects a wrong draw; it is not one of the four happy
capture workloads. The altered source and binary hashes are retained alongside
the normal artifacts.

Building is not runtime evidence. The recorded four-workload corpus and its
validator provide the task's authoritative guest-run evidence.

## Unmodified es2gears

`gears-pins.json` pins the complete official [Mesa demos9.0.0 archive](https://archive.mesa3d.org/demos/).
`build_gears.py` cross-builds the original `es2gears.c`, EGLUT Wayland backend,
and matrix helper against the same immutable guest image. No C source is
patched. Linux `_GNU_SOURCE`, `HAVE_SINCOS` and `WL_EGL_PLATFORM` follow the
original Meson configuration. The builder preserves the full source archive,
all selected source/header/build hashes, compiler identity and argv, guest
sysroot inventory, compile log, ELF header and executable digest.

```sh
python3 tools/virgl-capture/workloads/build_gears.py \
  --container wasm-vm-virgl-reference-research \
  --output /capture/gears-workload
docker cp tools/virgl-capture/capture.py wasm-vm-virgl-reference-research:/capture/capture.py
docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py \
  --workload es2gears --gears-directory /capture/gears-workload \
  --output /capture/corpus/es2gears --timeout 150 \
  --max-blob-bytes 1073741824
```

The bash-init reference boot coldplugs its real VirtIO keyboard/tablet before
Hyprland. Without udev, the original Wayland client receives a seat without a
keyboard and crashes. This setup affects only the fresh disposable overlay.
The controller floats and resizes the actual PID's window to the upstream
nominal300×300 size, waits for its positive first five-second idle-loop report,
saves its executable/comm/maps/environment/open DRM descriptor/library hashes,
and closes that same window through compositor IPC. It waits for the real
zero exit, then exits the compositor and guest normally. No kill or timeout is
accepted as completion. The animation needs an explicit1GiB unique-blob bound
because every submission still includes every attached backing snapshot.

`-info` prints EGL information; it does not print `GL_RENDERER`. Backend proof
comes from the actual process's mapped guest Gallium/VirtIO render node and
its named live context's original shader uploads and positive draw packets.
The original report is a completion marker, not a benchmark or pixel oracle.
`make verify-E6-T12g1` checks the committed recording and reconstructs the
client-only format/view/transfer inventory. The nineteen original shader
inputs remain a separate immutable claim. The new capture adds two client
shaders and four supporting-compositor shaders outside that set. All six need
their own admission/browser execution proof before their workload paths can
activate. `evidence/virgl-workload-inventory/index.json` binds the two lists.
The separate early-zero negative recording substitutes an explicitly fake
RISC-V executable: its actual zero exit still fails the guest controller and
capture acceptance, even while the compositor submits draws.
