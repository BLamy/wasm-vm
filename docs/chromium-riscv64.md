# Local Replay Chromium RISC-V workspace

The retained source and build records live at `local/chromium-riscv64/` inside this
project. It is a real filesystem copy, including source Git history and dependency
checkouts. APFS copy-on-write cloning shares unchanged disk blocks while retaining
independent files. Git and Docker exclude this directory; the small manifest and
port patch archive live in `tools/chromium/`.

Check the retained copy from the wasm-vm root:

```sh
python3 tools/chromium/check-local-copy.py
```

This read-only command requires the local copy. A Git clone of wasm-vm alone does
not download Chromium or the Linux disk images. It contains the provenance and
archived changes, whose hashes are pinned in `tools/chromium/workspace.json`.

## Source selection

The requested source is [Replay Chromium master](https://github.com/replayio/chromium/tree/f2472ba7bee0ed0d91736df49035af867cce6692),
revision `f2472ba7bee0ed0d91736df49035af867cce6692`, Chromium **108.0.5359.0**.
This is Domi's merge destination, as shown by Replay PRs
[#1530](https://github.com/replayio/chromium/pull/1530),
[#1531](https://github.com/replayio/chromium/pull/1531), and
[#1529](https://github.com/replayio/chromium/pull/1529). Replay's separate `m151`
work-in-progress branch is a different source selection.

The manifest pins installed dependency repository revisions and changed source
files. `patches/` archives the current local changes for Chromium's external
sysroot configuration, ANGLE, FFmpeg's generic C RISC-V configuration, SwiftShader
link compatibility, upstream Crashpad RISC-V support, explicit Clang 18
conversions, and Blink's compile-time size reference. These are work in progress; retaining a patch does not establish
runtime correctness. Upstream license notices accompany the archived patches in
`tools/chromium/licenses/`. The Crashpad patch comes from upstream commit
`4f5dd672296e82f7bccc245125e6cd77d6e56528` (review 4581050).

## Preserved build checkpoint — 2026-11-03, before the sandbox backport

The full Chrome executable **has not built or run**. Completed partial checks
include RISC-V V8 snapshot generation under QEMU, FFmpeg compilation, SwiftShader
linking, and the Crashpad handler and context-capture smoke tests. The latest full
build 11 stopped with Linux sandbox architecture support missing, missing Kerberos
headers, and a Blink layout-size assertion. The Kerberos headers are now supplied,
and all six affected ARM64/RISC-V authentication objects compiled. Blink's size
reference now mirrors its 29 release-mode flags, and the actual RISC-V paint-layer
object compiled with its size assertion enabled. Its production layout is
unchanged. These results are build progress, not an acceptance result for the browser.

No RISC-V sandbox backport is applied in this preserved checkpoint. Automatic
approval review initially rejected that security-boundary change without specific
approval. The user subsequently approved a local backport and tests on November 3;
that follow-up work is separate from this archive. The retained patch archive
excludes the sandbox proposal.

The build is explicitly an **unbundled recording-driver** configuration. The
fork's packaged drivers target other architectures. A matching RISC-V driver and
separate runtime evidence would be needed to claim Replay recording/replay.

## Active build environment and local copy

The active build runs locally in Colima profile `replay-chromium`, Docker context
`colima-replay-chromium`, container `replay-chromium-build` (Ubuntu 24.04 ARM64).
The container's fast native source/output is `/opt/replay-chromium/src`, and its
RISC-V glibc sysroot is `/opt/replay-riscv-sysroot`. It uses native Clang/LLD 18.1.3,
RISC-V GCC 13 support, Python 3.8, and QEMU for RISC-V generators. The existing
default Colima profile is separate.

The container's `/work` bind mount still points to the original sibling
`../replay-chromium` workspace. This project-local copy is a retained checkpoint,
not a second active build. Its `build-riscv64.sh` still invokes that existing
container and `/work` configuration. Do not treat invoking the copied wrapper as
building edits to the project copy. Retargeting that mount and syncing the native
source is a separate integration step. Full native build outputs remain in the
container; the copy receipt records that location. No browser binary is implied
by the copy.

The copied `BUILDING-RISCV64.txt`, `args-riscv64.gn`, scripts, package manifests,
and `logs/` preserve the detailed setup. The port is kept local: **publish PRs only
to BLamy/wasm-vm; never push or submit a PR to replayio/chromium.** GitHub Actions
remain disabled, and no workflow or automated deploy is added.

## Lightweight Linux GUI checkpoint

The retained `gui/` contains a standalone Ubuntu Base 24.04.5 riscv64 image with
Weston 13/Pixman and Foot. Its glibc userland matches the browser build. A QEMU
system boot displayed the desktop, accepted virtual keyboard input, and printed
`gui_input_ok` and `riscv64`; see `gui/verification.json` and
`gui/desktop-verified.png`. This is separate from wasm-vm's runtime and demo.
Chromium integration and performance comparisons are pending. No fastest-distro
claim has been measured.

The immutable base image is retained. Live sockets/PID files and the running VM's
writable qcow2 overlay are omitted from the copy. Before using the copied launcher,
create its required overlay from the project root:

```sh
qemu-img create -f qcow2 -F raw \
  -b "$PWD/local/chromium-riscv64/gui/ubuntu-riscv-gui.ext4" \
  "$PWD/local/chromium-riscv64/gui/ubuntu-riscv-gui.qcow2"
```

The launcher checks that the overlay exists; it does not create it. The original
running VM stays separate. Native Cocoa-window verification
was incomplete because the Mac was locked during that check. Consult this guide
for project-copy status; copied notes containing original absolute paths describe
the original workspace.
