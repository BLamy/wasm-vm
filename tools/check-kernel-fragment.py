#!/usr/bin/env python3
"""Audit the reviewed built-in kernel fragment before a Docker kernel build.

This catches a missing, modular, conflicting, or accidentally duplicated symbol without treating a
generated release config as the source of truth. The build-time config audit remains
``tools/check-kernel-config.sh``.
"""

from __future__ import annotations

import sys
from pathlib import Path


REQUIRED_Y = {
    "CONFIG_64BIT",
    "CONFIG_MMU",
    "CONFIG_SOC_VIRT",
    "CONFIG_RISCV_SBI_V01",
    "CONFIG_SERIAL_EARLYCON",
    "CONFIG_SERIAL_EARLYCON_RISCV_SBI",
    "CONFIG_HVC_DRIVER",
    "CONFIG_HVC_RISCV_SBI",
    "CONFIG_SERIAL_8250",
    "CONFIG_SERIAL_8250_CONSOLE",
    "CONFIG_SERIAL_OF_PLATFORM",
    "CONFIG_VIRTIO_MMIO",
    "CONFIG_VIRTIO_BLK",
    "CONFIG_EXT4_FS",
    "CONFIG_DEVTMPFS",
    "CONFIG_DEVTMPFS_MOUNT",
    "CONFIG_BLK_DEV_INITRD",
    "CONFIG_RTC_CLASS",
    "CONFIG_RTC_DRV_GOLDFISH",
    "CONFIG_RTC_HCTOSYS",
    "CONFIG_POWER_RESET",
    "CONFIG_POWER_RESET_SYSCON",
    "CONFIG_POWER_RESET_SYSCON_POWEROFF",
    "CONFIG_PRINTK_TIME",
    "CONFIG_IKCONFIG",
    "CONFIG_IKCONFIG_PROC",
    "CONFIG_NET",
    "CONFIG_UNIX",
    "CONFIG_INET",
    "CONFIG_PACKET",
    "CONFIG_NETDEVICES",
    "CONFIG_NET_CORE",
    "CONFIG_VIRTIO_NET",
    "CONFIG_DRM",
    "CONFIG_DRM_VIRTIO_GPU",
    "CONFIG_DRM_FBDEV_EMULATION",
    "CONFIG_FB",
    "CONFIG_FRAMEBUFFER_CONSOLE",
    "CONFIG_FRAMEBUFFER_CONSOLE_DETECT_PRIMARY",
    "CONFIG_FONT_8x16",
    "CONFIG_VIRTIO_INPUT",
    "CONFIG_INPUT_EVDEV",
    "CONFIG_SOUND",
    "CONFIG_SND",
    "CONFIG_SND_PCM",
    "CONFIG_SND_VIRTIO",
    "CONFIG_VIRTIO_CONSOLE",
    "CONFIG_VT",
    "CONFIG_VT_CONSOLE",
}

REQUIRED_N = {
    "CONFIG_NONPORTABLE",
    "CONFIG_MODULES",
    "CONFIG_PCI",
    "CONFIG_ETHERNET",
    "CONFIG_WLAN",
    "CONFIG_USB_SUPPORT",
}


def main() -> int:
    fragment = Path(sys.argv[1]) if len(sys.argv) == 2 else Path("configs/wasm-vm.config")
    if len(sys.argv) > 2:
        print(f"usage: {sys.argv[0]} [fragment]", file=sys.stderr)
        return 2
    try:
        lines = fragment.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"kernel fragment: {exc}", file=sys.stderr)
        return 2

    values: dict[str, str] = {}
    duplicate: set[str] = set()
    for number, line in enumerate(lines, 1):
        if not line.startswith("CONFIG_") or "=" not in line:
            continue
        symbol, value = line.split("=", 1)
        if value not in {"y", "m", "n"}:
            print(f"invalid value at {fragment}:{number}: {line}")
            duplicate.add(symbol)
            continue
        if symbol in values:
            print(f"duplicate symbol at {fragment}:{number}: {symbol}")
            duplicate.add(symbol)
        values[symbol] = value

    failed = bool(duplicate)
    for symbol in sorted(REQUIRED_Y):
        if values.get(symbol) != "y":
            print(f"required built-in symbol is not =y: {symbol}={values.get(symbol, '<missing>')}")
            failed = True
    for symbol in sorted(REQUIRED_N):
        if values.get(symbol) != "n":
            print(f"required disabled symbol is not =n: {symbol}={values.get(symbol, '<missing>')}")
            failed = True
    modular = sorted(symbol for symbol, value in values.items() if value == "m")
    if modular:
        print(f"modular symbols are forbidden: {', '.join(modular)}")
        failed = True
    if failed:
        return 1
    print(
        f"kernel fragment {fragment}: {len(REQUIRED_Y)} built-in and "
        f"{len(REQUIRED_N)} disabled requirements satisfied; no modules"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
