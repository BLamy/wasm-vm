# Local Chromium Linux image candidate

Build the candidate from the retained Ubuntu base and verified browser bundle:

```sh
python3 tools/chromium/build-linux-image.py --output target/replay-chromium-image
```

The output directory must be new. The command requires this Mac's APFS cloning,
local Docker/Colima, and the already-installed filesystem-tool image
`sha256:986b9aec6385491294c550e1a95275e05f56fa76b0581b606527f7871daefce8`.
It checks both input digests before creating an output, uses Docker without
network access, and never mounts or boots the guest filesystem. It does not run
a browser, package installer, or downloaded program.

The assembler retains the base unchanged, inserts the exact 13 browser runtime
files, a local JS/WASM/canvas test page, and an unprivileged startup wrapper.
The existing desktop service still runs as `desktop:desktop` (UID 1000); its
account and permission settings stay unchanged. Weston/Pixman and the Foot
launcher remain available. The desktop's automatic Foot launch is replaced by
the browser; it uses one raster thread and requests one renderer process to suit
the single-hart emulator.

The startup wrapper is stored as guest payload during assembly. When that image
is later booted, it uses Chromium's private fd 3/4 DevTools pipes inside the guest,
checks the test page's actual title and renderer sandbox state, syncs, and emits
a readiness marker. Its control directory belongs to UID 1000 with mode 0700;
it opens no debugging TCP listener. Assembly checks its bytes and permissions;
it does not establish that this startup program has run successfully on wasm-vm.

Every installed file is read back from ext4 and checked for its exact bytes,
root ownership, mode and fixed timestamp. The original desktop service is compared
before and after. Read-only `e2fsck` must propose no repairs. `assembly.json`
records the tool, code/input hashes, commands, file results and final image hash.
`manifest.json` and `chunks/` provide the existing 256-KiB content-addressed disk
format for later browser delivery. A successful result says **prepared** and
`browserBootVerified: false`.

This candidate has not been exposed in the live demo. E5-T29b must prove the real
browser on native wasm-vm and capture a coherent RAM/disk pair; E5-T29c owns the
browser launcher, real input proof, roadmap update and Cloudflare publication.
The [built browser record](chromium-riscv64-build.md) describes the earlier QEMU
reference. No Replay recording driver, fastest-distro result, or working wasm-vm
browser is implied by assembling this image.
