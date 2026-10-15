# Omarchy application inventory

`catalog.json` accounts for every one of the 147 entries in the installed
Omarchy 4.0.2 release's upstream base list, plus the requested Node.js/npm tools.
Chromium and LibreOffice are required priority applications. The image builder
does not consume this discovery catalogue; it is not an installation manifest.

The existing image has 32 base entries. Another 97 have native RISC-V or
architecture-independent repository candidates (99 including Node.js/npm).
`nvim` maps to `neovim`, and `mise-bin` maps to the native `mise` package.
The existing Nerd Font package remains accounted for even though it is absent
from the captured public repositories. Repository precedence is core, extra,
unsupported, matching pacman's first-repository rule. An unrelated all-NUL `ntk`
record is retained as an explicit discovery failure; it supplies no candidate.

Five other entries have portable data/script recipes: the Neovim configuration,
Ruby `tobi-try`, iA Writer fonts, `ufw-docker`, and Yaru icons. Their sources and
runtime dependencies still need authentication and installation. Thirteen entries
require a source-port investigation: aether, asdcontrol, cliamp, herdr,
hyprland-preview-share-picker, localsend, omacalc, omacut, omawrite, pinta, ttfx,
tensaku, and tzupdate. Their pinned recipes currently declare x86/ARM targets.
That declaration is not proof of RISC-V incompatibility. In particular, portable
Go/Rust/C sources need separate build attempts, while LocalSend's Flutter and
Pinta's .NET runtimes need architecture validation. None is silently removed or
labelled incompatible. The upstream vendor server's HTTP 403 responses likewise
do not establish architecture support or incompatibility.

The exact upstream list, complete captured repository databases, package recipe
text, archive fetch hashes, `.PKGINFO`/`.BUILDINFO`, and the first 64 bytes of the
priority native executables are retained under `evidence/omarchy-app-catalog`.
Recipes are inert source material and are never executed by this checker. These
are discovery inputs, not trusted package signing keys. The executable headers
identify ELF64 little-endian RISC-V (machine 243). They do not prove a successful
launch. Detached signatures are downloaded but not yet authenticated here.

Run the portable inventory check:

```sh
python3 tools/image/check-omarchy-app-catalog.py
```

To also hash and reopen the downloaded priority archives, re-read `.PKGINFO`,
and compare the actual executable headers:

```sh
python3 tools/image/check-omarchy-app-catalog.py --archives target/omarchy-full/packages
```

Signed dependency-closed installation, normal desktop integration, actual app
execution, and a freshly published GPU/software warm release are separate ordered
tasks E5.5-T05b, E5.5-T05c, and E5.5-T05d. An unavailable prebuilt package or its
download size alone is never an exclusion criterion.

## Offline native image build

`native-packages.lock.json` pins the complete 473-archive libalpm transaction,
including both archive and detached-signature identities. The lock is an input
identity list, not a signing trust anchor. GnuPG/pacman authenticate the signatures
against the existing accepted Arch keyring during an offline installation.

```sh
python3 tools/image/fetch-omarchy-app-packages.py \
  --lock tools/image/omarchy-apps/native-packages.lock.json \
  --cache target/omarchy-full/packages --receipt target/omarchy-downloads.json
OMARCHY_APP_EVIDENCE_DIR=target/evidence/omarchy-native-final make verify-E5.5-T05b
```

The full proof requires the accepted read-only `wasm-vm-omarchy-prep-20260909`
package-assembly fixture (`assembled-r3`), the native image-tool Docker image,
and local RISC-V user-mode binfmt support. These are explicit image-build inputs;
no personal VM or retired remote build host is accessed. Rebuild the tool image
from `tools/image/omarchy.Dockerfile`; the original accepted fixture's package
bytes are rechecked against the package mtree, selected identities and six exact
reviewed overlays. `install-omarchy-apps.py` admits no archive escape, renamed
package, mismatched digest/signature or foreign-architecture package metadata.
Real libalpm performs signed installation with dependencies and file-conflict
checks enabled, followed by `pacman -Dk` and the actual native ELF loader's
dependency resolution for Chromium, LibreOffice and Node.

Every installed runtime ELF under `/usr` and `/opt` is checked for ELF64
little-endian RISC-V. The whole package tree is then reassembled against mtree
identities, excluding unowned hook state and the generated private build keyring.
The GStreamer helper's reviewed capability overlay changes only because the
signed transaction upgrades that package. Six additional exact capability overlays
preserve the signed btop/screen-recorder archive metadata and the standard
inetutils/GVfs-NFS install-script results. No arbitrary capability is admitted.
The existing Hyprland, Aquamarine,
Quickshell, Mesa and Qt packages are retained. Generic locked accounts and fresh
cache jobs are generated by the existing copy-only sanitizer and builder, then
`mke2fs -d` creates a fresh 12 GiB ext4 and `e2fsck -fn` checks it. Output-volume
names are recorded and deliberately retained for the independent verifier.

The builder's upper size bound is now 16 GiB; its 4 GiB default is unchanged.
Image processing and 256 KiB chunk creation stream with bounded memory. Package
availability, signature validation, loader checks and filesystem population are
separate from authoritative application execution in the emulator and from a
published warm release. A successful build alone establishes neither.

## Native desktop integration

`build-omarchy-image.py --applications` uses the accepted native package assembly
to seed Chromium as the default browser, LibreOffice document associations and
the package's normal application configuration. Optional native shortcuts check
their command in the live guest PATH before being registered; pending ports do
not launch architecture-specific upstream installers. Packaged desktop entries
and web apps remain available through the Omarchy launcher. This does not mark
upstream first-user provisioning complete or run network installers.

Prepare a new software desktop from the output volume recorded by T05b:

```sh
python3 tools/image/prepare-omarchy-desktop.py \
  --assembly-volume ACCEPTED_T05B_OUTPUT_VOLUME \
  --output target/omarchy-applications/software
```

The source volume is read-only; the wrapper records the actual builder, native
MIME/default checks, final ext4 metadata and bounded immutable chunks. GPU image
preparation uses the existing qualified Mesa/Quickshell inputs and
`prepare-image.py --desktop-visuals` to restore the package's GPU visual settings
and background. Software fallback keeps its previously measured responsive
profile. The Foot interop patch is retained in both profiles.

`make verify-E5.5-T05c` boots the GPU candidate cold through the original public
worker and scanout. Set `OMARCHY_DESKTOP_IMAGE_DIRECTORY` to the prepared GPU
image and `OMARCHY_APP_DESKTOP_EVIDENCE_DIR` to a new recording directory.
`CRITIC_FAST_BOOT_APPLICATION_INVENTORY` names the independently accepted T05b
`runtime-elf.json` input (default: the T05b final evidence directory). The recorder
copies and hashes it, then compares the running Chromium and Writer executable
hashes and installed Node hash with its native RISC-V entries.
Large executable hashes run on the host over the actual captured guest disk:
the recorder follows `/proc/PID/exe`, retains stable process/device/inode and
ownership metadata on both sides of a public GPU checkpoint, authenticates the
original pair and disk delta, and reconstructs its exact filesystem on a
disposable APFS copy. Read-only `debugfs` checks the observed inode against the
pathname before dumping and hashing its bytes. Tiny executables use the direct
guest hash. Original pairs, deltas and extraction commands remain evidence;
the accepted base image is never modified. This identifies executable files,
without claiming that their process memory is unchanged.
The application workload uses trusted keyboard input to launch native Chromium,
submit a note to a guest loopback fixture, launch Writer, type/save/close/reopen
and edit an actual ODT, and execute Node/npm in Foot. RPC only prepares the
loopback server, flushes the filesystem for identity capture, and reads results. External guest networking
remains explicitly offline in this test. Screenshots, actual process maps,
saved documents, input events and phase GPU counters are retained; installation
alone is never treated as a working application.
