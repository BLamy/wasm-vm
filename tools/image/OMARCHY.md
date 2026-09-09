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
