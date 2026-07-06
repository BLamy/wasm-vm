# The wasm-vm guest kernel (E2-T12)

One command, Docker-only host, byte-reproducible: `bash tools/build-kernel.sh` produces a
pinned riscv64 `Image` for the [wasm-vm virt platform](platform.md) into
`releases/kernel/<version>/`. The `.config` is a **reviewed source artifact** — "which
kernel are we booting" is never a variable while debugging the emulator.

## Pinned inputs

| Input | Pin | Where |
|---|---|---|
| Linux | **6.6.63** (6.6 LTS) | `KVER` in `tools/build-kernel.sh` |
| tarball | sha256 `d1054ab4…061835`, verified before use | `KSHA256`, checked with `shasum -c` |
| toolchain | Debian bookworm `gcc-riscv64-linux-gnu` | `tools/kernel.Dockerfile` |
| config | `riscv defconfig` + `configs/wasm-vm.config` (merged) | checked in |

Apt packages are **unpinned by version** (Debian stable's set) — tolerable and documented
per the task charter; the *kernel tarball* is the input that must be pinned, and it is
(version + sha256, fetch aborts on mismatch).

## Reproducibility

Byte-identical `Image` across hosts/UIDs is achieved by neutralizing build-time identity:

- `KBUILD_BUILD_TIMESTAMP` fixed (`build-kernel.sh`) — kills the embedded build date.
- `KBUILD_BUILD_USER` / `KBUILD_BUILD_HOST` fixed to `wasmvm` (`kernel.Dockerfile`).
- Toolchain from the container, not the host.

Verify: run the build on two machines (or two container UIDs) and diff
`releases/kernel/<version>/SHA256SUMS` — the `Image` hash must match.

## Why each config symbol (the fragment)

- **`64BIT` / `MMU` / `SOC_VIRT` / `NONPORTABLE=n`** — the base rv64 MMU virt machine; no
  vendor-nonportable hacks.
- **`RISCV_SBI_V01=y`** — the SBI v0.1 legacy console fallback, so `earlycon=sbi` works
  before the 8250 driver binds (our E2-T04 implements legacy putchar/getchar).
- **`SERIAL_8250` + `_CONSOLE` + `SERIAL_OF_PLATFORM`** — our E2-T07 ns16550a as `ttyS0`.
- **`VIRTIO_MMIO` + `VIRTIO_BLK`** — the E2-T08/T09/T11 storage stack → `/dev/vda`.
- **`EXT4_FS`** — the rootfs filesystem.
- **`DEVTMPFS` + `_MOUNT`** — `/dev` populated automatically (no static device nodes).
- **`BLK_DEV_INITRD`** — allow an initramfs (E2-T13 busybox) before the ext4 root.
- **`RTC_DRV_GOLDFISH` + `RTC_HCTOSYS`** — the E2-T01 goldfish-rtc at `0x0010_1000`.
- **`POWER_RESET_SYSCON` + `_POWEROFF`** — the E2-T01 syscon test device for reboot/poweroff.
- **`PRINTK_TIME`** — timestamped dmesg (bisecting boot hangs).
- **`IKCONFIG` + `_PROC`** — `/proc/config.gz` so the running kernel's config is auditable.
- **`MODULES=n`** — everything built-in; no initramfs/module coupling, no module load path.
- **`NET/UNIX/INET/PACKET/NETDEVICES/NET_CORE/VIRTIO_NET=y`** (E3-T13) — the network stack +
  the stock virtio_net driver for our slot-1 device. `PACKET` is AF_PACKET (arping/udhcpc/
  tcpdump — the T13/T15 acceptance tools). `ETHERNET` stays **off**: it only gates vendor NIC
  drivers (virtio_net lives in drivers/net under NET_CORE, not drivers/net/ethernet).
- **`PCI/ETHERNET/USB/SOUND/DRM/FB=n`** — cut boot probing for hardware we don't emulate.

## Bumping the version

1. Change `KVER` in `tools/build-kernel.sh`.
2. Fetch the new tarball, `shasum -a 256` it, update `KSHA256`.
3. Rebuild; commit the new `releases/kernel/<KVER>/` and update the table above.
4. Re-run `tools/check-kernel-config.sh <KVER>` to confirm the fragment still merges cleanly
   (a symbol renamed upstream shows as missing).
