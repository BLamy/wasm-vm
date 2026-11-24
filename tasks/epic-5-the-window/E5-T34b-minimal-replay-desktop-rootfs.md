---
id: E5-T34b
epic: 5
title: Minimal read-only rootfs for Replay Chrome 108 and Node 26 on one desktop
priority: 0.3872
status: implemented
depends_on: [E0-T34, E5-T33, E5-T34a]
estimate: S
risk: medium
capstone: false
---

## Boundary

Build the smallest rootfs that runs both: kernel config trimmed to the wasm-vm device set, busybox init, a single-process Wayland kiosk compositor, minimal fonts, Replay Chrome 108 (the verified riscv64 build, E0-T34; Chrome 157 is blocked on Replay's uplift, E5-T32b), Node 26 and a terminal. Pack it as a compressed read-only filesystem; run tools/privacy/check-no-replay-backend.py over the source tree before packing and over the packed image after.

## Deterministic acceptance

Native wasm-vm boot reaches the desktop with Replay Chrome 108 showing smoke.html success and a Node 26 terminal, with recorded boot time, image size and guest RAM high-water mark.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

### 2026-11-23 — worker — submitted at e01d14ed1

**Claim.** `bash tools/build-replay-desktop-image.sh target/e5-t34b/image` builds a 446 MiB raw ext4
rootfs (467,664,896 B, SHA-256 `2af6100e9b37b9d1effd5102922672b682ec27d1eb1f56aa66e343c865d55b05`;
`.img.gz` 189,669,297 B / 181 MiB, SHA-256 `37911eaa6efbdae7a826bd96e4addc1dece21eef8b68e23d346e003aeec8faba`;
blob chunk manifest, 1,784 × 256 KiB, SHA-256 `2e644ad8f01ac9c80813a5953efeeeabf50e6d8badea3aab16c469ba1a922ecc`,
verified against the image by `tools/build-whole-image.sh`, so the E5-T34a prefill can serve it). The image
mounts read-only, has no journal, and uses tmpfs for `/run /tmp /home /var /root /dev/shm`. It contains busybox
init, `systemd-udevd`/udevadm (input classification only), seatd, sway 1.9 (wlroots DRM backend, pixman
renderer, no bar or background client), foot, grim, Replay Chrome 108 (E0-T34 bundle, with `.symtab`/`.strtab`
stripped from the binaries), Replay Node 26.13.1 (E5-T33, unchanged), DejaVu Sans/Mono, xkb data, and glibc
C.UTF-8. The staged files total 412.9 MiB: Chrome 253.7, Node 105.8, system libraries/userland 48.2, xkb 3.2
and fonts 2.1. Files come from 208 apt-resolved Ubuntu 24.04 riscv64 packages, pinned by version and .deb SHA-256
in `stage-manifest.json`. Only the ELF NEEDED closure of the roots plus an explicit data list is copied, which
draws files from 123 packages. The image has no dpkg/apt database, docs, man pages, or locales other than
C.UTF-8. The privacy check passed on the staged tree before packing (705 files), on the packed ext4, and on the
`.img.gz`.

On native wasm-vm, `node tools/replay-desktop/native-boot.mjs --image target/e5-t34b/image/replay-desktop.ext4
--out target/e5-t34b/native-final` cold-boots the image. It uses the browser desktop device layout
(`--browser-topology --jit --block-cache --interrupt-batching --icount-divider 64 --ram-mib 2048 --net
--virtio-rng`, kernel `releases/kernel/6.6.63/Image`, drive `ro`). Results:
- The guest reached `REPLAY_DESKTOP_READY` **88.6 s host wall time** after spawn, at guest uptime 5.29 s on the
  icount-divided virtual clock. Sway IPC was up at 27.6 s, the terminal mapped at 28.6 s, and Chrome mapped and
  passed at 88.0 s.
- Chrome's private DevTools pipe reported the page title `Replay RISC-V PASS #1`.
  `Runtime.evaluate` returned `pass {"pass": true, "javascript": 42, "webassembly": 42, "pixel": [42,128,64,255],
  "browser": "Chrome/108.0.0.0"}`. The renderer was sandboxed (`NoNewPrivs=1 Seccomp=2`, own PID namespace).
- The keyboard path works end to end. With foot focused through swaymsg, the CLI's `--keyboard-proof` injected
  one virtio KEY_A (evdev → udev/libinput → sway → foot), and `/tmp/keyboard.txt` read `KEYBOARD_a`.
- `node -e "console.log(process.version)" | tee /tmp/node-version.txt` was typed into foot's pty (TIOCSTI) and
  printed `v26.13.1` 30.4 s later.
- grim captured a 1280×800 desktop screenshot (`desktop.png`, SHA-256 `e3022fb3…0dda`). It shows Chrome tiled
  left with the PASS JSON and the terminal right with `KEYBOARD_a` and `v26.13.1`.
- The guest RAM high-water mark was **181,972 KiB** (MemTotal − MemAvailable, sampled every guest second over
  the whole run). It was 172,228 KiB at ready. Chrome browser-process VmHWM was 141 MB, renderer 96 MB, sway
  31 MB and foot 15 MB.
- Totals: 8,096,213,035 retired instructions, final state SHA-256 `52db2dcb…fc1a`, exit 0. The image SHA-256 was
  unchanged after the boot, so the read-only mount held.

**Commands.**
- `cargo build --release -p wasm-vm-cli` (cold, 2m21s).
- `bash tools/build-replay-desktop-image.sh target/e5-t34b/image` (1m18s, Docker context
  `colima-replay-chromium`, throwaway container from `wasm-vm-replay-desktop-build:local`).
- `node tools/replay-desktop/native-boot.mjs --image target/e5-t34b/image/replay-desktop.ext4 --out
  target/e5-t34b/native-final --timeout-min 60` (206.7 s total).
- Gates: `python3 -m py_compile`, `node --check`, `sh -n`/`bash -n` on all new scripts. There are no Rust or
  `web/` changes, so fmt/clippy, wasm and Playwright gates are not applicable. Browser proof is E5-T34c.

**Evidence.**
- `evidence/e5-t34b/build/`: `build.json` receipt, `stage-manifest.json` (package closure plus every file's
  path, size, mode, SHA-256 and source package), `chunk-manifest.json`, `replay-desktop.img.gz.json`, three
  `privacy-*.txt`, and the pack/stage logs.
- `evidence/e5-t34b/native/`: `native-boot.json` (timings, markers, keyboard/Node/Chrome results, raw guest
  metrics), `console.log` (serial, with the PNG base64 elided), `stderr.log` (JIT stats and keyboard-proof
  lines), `desktop.png`, and `guest-evidence.txt`.

**Choices and deviations (for the verifier).**
- *Compositor: sway.* It shows both windows side by side deterministically in one compositor process.
  - Weston desktop-shell places new toplevels at random positions and needs a separate desktop-shell client.
  - kiosk-shell and cage show one application at a time.
  - Sway is wlroots, the same stack as the labwc finalist that E5-T16 measured under emulation. No sway-vs-weston
    bake-off was run for this image.
- *Kernel and filesystem.* The existing `releases/kernel/6.6.63` kernel was used unchanged (no emulator or
  kernel changes). It has no SquashFS or EROFS, so the "compressed read-only filesystem" is raw ext4 mounted
  `ro`, with compression in the `.img.gz` single-fetch transport. This is the raw image that the E5-T34a prefill
  requires.
- *udevd is included.* Without it libinput ignored the virtio input devices. `WLR_LIBINPUT_NO_DEVICES` is
  deliberately unset: with it set, wlroots defers device enumeration until the first input event and drops that
  event.
- *TIOCSTI typing.* The native CLI's only host keyboard path is the fixed KEY_A proof hook. Command text is
  therefore typed with `wvm-type`, a root-only (mode 0700) 1 KiB TIOCSTI helper assembled from
  `tools/replay-desktop/wvm-type.S`. The kernel has `CONFIG_LEGACY_TIOCSTI=y`.
- *Chrome digest.* The image `chrome` is the verified binary (`df9b4315…`) with symbols stripped
  (387,891,736 → 220,220,600 B, `ddc58592…`). Both digests are in `stage-manifest.json`.

**Not proven or known gaps.**
- No browser (wasm) boot; that is E5-T34c.
- No recording: `RECORD_REPLAY_DONT_RECORD=1`, unbundled driver.
- No byte-reproducibility claim: two builds of the same inputs produced different ext4 digests, and this was not
  investigated.
- Package downloads need network access to ports.ubuntu.com.
- The RAM high-water mark is sampled, so peaks shorter than one sample interval can be missed.
- Expected noise: Chrome logs D-Bus connection errors (no bus in the image); foot warns that there is no X11
  Compose table (dead keys only); sway logs one `Unable to clone DRM fd` error.
- The smoke page's subtitle still reads "Weston / Wayland": the page is copied verbatim from E5-T29a.
- The pre-commit hook ran only its privacy check (no `web/` changes), so no `rg` shim was needed.
