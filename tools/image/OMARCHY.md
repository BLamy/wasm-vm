# Prepared Omarchy image

This path uses the existing RISC-V VM's installed packages, not its personal
filesystem blocks. The output is an image candidate; desktop and browser boot
must be verified separately. Never upload the source qcow2, converted raw image,
recovery copy, or a previously booted writable test disk.

## Private capture and extraction

`capture-omarchy-vm.py` pins the intended QEMU 11.1.1 disk and performs an atomic
APFS clone during a short QMP pause, restoring the prior VM state. It requires a
private output directory and a single QMP controller. Its receipt labels the
copy **crash-consistent**, not guest-filesystem frozen. Work only on separate
copies after capture; check qcow2 metadata and conversion equivalence before
repairing a recovery copy. Mount the recovered filesystem read-only with
`noload,nodev,nosuid,noexec` in a network-disabled Linux container.

## Package-only assembly

1. Select the installed dependency closure using `select-omarchy-packages.py`
   and `omarchy-browser-packages.json`. It records exact installed versions;
   the subsequent `pacman -Dk` checks their dependency compatibility.
2. Restore modified package-owned `/etc` defaults only when their bytes match
   the installed package mtree digest, using `recover-package-defaults.py`.
   Mount those verified defaults above the read-only recovery source with a
   read-only overlay; never mount a writable upper over the personal source.
3. Run `assemble-omarchy.py` into a fresh marked staging directory, using the
   selected packages, `omit-docs-man-cache-boot-modules` profile, and the exact
   `omarchy-reviewed-source-overlays.json` manifest. Its completion marker is
   emitted only after successful assembly. Unknown files are not imported.

Installed package mtree matching proves identity against that installed package
database, not independent upstream signature authentication. The six source
overlays are explicitly identified; omitted personal filenames are not included
in public provenance. Keep staging directories private with no concurrent writers.

## Fresh filesystem

Build the pinned `omarchy.Dockerfile` tooling image. In the rootful, networkless
Linux preparation container, with `/tools` read-only and output in a private volume:

The container needs `CAP_SYS_ADMIN` for its temporary `/dev` and `/proc` mounts.
On an AppArmor-enabled Docker host, permit these container-local mounts with
`--security-opt apparmor=unconfined`; retain `--network none`, a read-only input
volume, and a separate output volume. No source VM or host filesystem is needed
in the builder. A failed mount is a failed build, not permission to skip caches.

```sh
python3 /tools/build-omarchy-image.py /work/assembled /work/candidate \
  --selection /work/package-selection.json \
  --overlays /tools/omarchy-reviewed-source-overlays.json
```

The builder runs the copy-only sanitizer, seeds generic demo configuration,
recreates package system users and necessary runtime caches, renders Tokyo Night
from packaged templates, and runs fresh `mke2fs -d` plus `e2fsck -fn`.
It accepts only a new output directory. A failure retains private diagnostics
without producing a successful build receipt. Never bypass a missing marker or
populate ext4 directly from the recovered disk.

The `omarchy` account is uid/gid 1000. Initial passwords are locked, no inherited
sudo grant is copied, SSH service autostart is masked, and machine-id is empty
for first-boot generation. Desktop first-run provisioning, administrative policy,
and public package-manager key initialization remain separate integration checks.
The image is not a bit-reproducible upstream rebuild; timestamps are outside that
contract. Only fresh caches generated during this build may remain.

The `lean-browser-session-v1` overlay retains Omarchy's package-owned shell,
tiling and Tokyo Night theme. Its user-local `default.hypr.autostart` module
selects the demo session initializer instead of the upstream developer-app
first-run installer. It does not mark upstream user provisioning complete or
grant administrator access. Optional preinstalled-application bindings are off;
Foot is the selected terminal. The nonexistent hvc0 serial-getty instance is
masked; ttyS0 remains available.

The builder generates the hardware database with strict parsing, updates the
journal catalog, and requires nonempty regular cache files before running
`systemd-update-done`. This records real completion of package cache jobs, not
desktop readiness. The session initializer has its own separate marker and
starts the initial Foot window only after its local setup succeeds. Its exact
script digest is included in the frozen input receipt. A fresh guest boot is
still required before this profile can be described as ready.

### Responsive browser profile (`responsive-v2`)

On one emulated hart, Hyprland composites through llvmpipe, so every damaged pixel
costs guest instructions. Measured in `evidence/omarchy-responsive/README.md`, the
shipped desktop never idled and typed text never appeared within 15 minutes in the
browser; the responsive pair echoes a typed command 4.3-7.5 s after the last key
and shows its output 4.2-7.4 s after Enter (8 runs) at today's ~18 guest MIPS. The profile
changes four things and keeps the package's bar, tiling, Tokyo Night theme,
Hyprland configuration and Foot:

- Quickshell's `omarchy.background` layer re-commits every frame and Hyprland
  damages a layer's whole geometry per commit: a 1280x800 recomposite back to back,
  100% of the hart, while idle. Its `.webp` wallpaper is not decodable in this
  image, so the layer drew nothing. The plugin is disabled (user `shell.json`).
- Foot 1.28 always binds `ext-background-effect`, and Hyprland 0.56 damages the
  whole window on every commit of such a surface. The profile's Foot has that one
  interface-name string renamed (same length), so it only damages glyph cells.
- Omarchy's own stay-awake indicator is on: idle guest time fast-forwards under the
  icount clock, so the 150 s screensaver / 300 s lock would fire within seconds.
- `LP_NUM_THREADS=0`: Hyprland on virtio-gpu has no explicit sync and only
  `glFlush()`es before its atomic commit, so an llvmpipe rasterizer thread can
  still be drawing when the commit copies the buffer (torn 64-pixel tile rows and
  stale frames that stay on screen). Rasterizing inside the flush fixes it; one
  hart gains nothing from the thread.

`configure-omarchy-demo.py` bakes all four into fresh images (`/usr/local/bin/foot`).
`omarchy-responsive-profile.sh` applies them to a prepared session's home
directory; the LP setting takes effect only in the next graphical session.

To refresh the published pair without rebuilding the 4 GiB image, cold-boot a
profiled copy of an existing pair's disk and capture a new pair bound to the same
chunk manifest:

```sh
node tools/image/prepare-omarchy-responsive-cold.mjs --bin target/release/wasm-vm \
  --kernel <kernel of the source pair> --pair <dir with omarchy-ready.snap.gz + omarchy-overlay-delta.bin.gz> \
  --base-image <ext4 matching the chunk manifest> --chunks <chunked-omarchy dir> --out <new dir>
node tools/verify/omarchy-responsive-latency.mjs <out> --pair <new dir> \
  --kernel <kernel> --chunks <chunked-omarchy dir>
```

The preparer applies the profile in the restored session, syncs, cold-boots the
same disk, checks that the compositor process really runs with `LP_NUM_THREADS=0`
and no `llvmpipe-N` thread, applies the shipped opaque Foot window properties, and
has the CLI inject one virtio-tablet click (`WASM_VM_PREP_TABLET_CLICK`) before
capture: the first real pointer event in a fresh session costs Hyprland ~1.5e9
guest instructions (about 80 s in the browser), and a compositor warp does not
pay it. `--warm-only` does only that click on an already prepared pair.
`prepare-omarchy-responsive.mjs` (profile applied to a restored session without a
cold boot) remains for comparison; its pairs keep the rasterizer thread.

Use the T03aq input kernel (evdev client buffer 1024 events) and a pair made with
it: with the stock 64-event buffer, typing faster than the compositor drains input
loses keystrokes (SYN_DROPPED), natively and in the browser. That kernel is a
different file from the stock `releases/kernel/6.6.63/Image` that the other guests
use, so it is published at its own path (`evidence/omarchy-responsive/README.md`,
"Artifacts to publish").

## Chunk integrity and tests

```sh
target/release/wasm-vm chunk releases/rootfs/omarchy.ext4 \
  --out releases/chunked-omarchy --chunk-size 131072 --layout split
python3 tools/image/verify-omarchy-image.py \
  --image releases/rootfs/omarchy.ext4 \
  --manifest releases/chunked-omarchy/manifest.json --receipt
python3 -m unittest discover -s tools/image -p 'test_*.py'
```

Run the tests as Linux root as well: macOS cannot establish Linux ownership,
capability-xattr or chroot behavior. Preserve the build receipt, command log,
package-selection identity, chunk manifest identity and fresh critic report.
The chunk verifier streams bytes with bounded memory and makes no sanitization
or boot claim. Boot only an independent writable copy of the release image.
