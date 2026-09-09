#!/usr/bin/env python3
"""Seed only reviewed demo configuration on an already sanitized package tree.

This does not provision an upstream ISO, migrate personal settings or assert a
working desktop. Guest services must still be boot-tested on wasm-vm.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat


def configure(root):
    if os.geteuid() != 0:
        raise ValueError("image ownership configuration requires container root")
    if not root.is_absolute() or root.resolve() != root or not root.is_dir():
        raise ValueError("root must be a real absolute directory without symlink ancestors")
    marker = root / ".wasm-vm-public-omarchy-root"
    if marker.is_symlink() or marker.read_bytes() != b"wasm-vm-public-omarchy-root-v1\n":
        raise ValueError("root is not a sanitized Omarchy tree")
    assembly = root / "etc/wasm-vm/omarchy-assembly.json"
    if not assembly.is_file() or assembly.is_symlink():
        raise ValueError("package assembly provenance is required")
    changes = {}

    def path(relative):
        pieces = Path(relative).parts
        if not pieces or Path(relative).is_absolute() or ".." in pieces:
            raise ValueError("invalid overlay path")
        current = root
        for piece in pieces:
            current = current / piece
            if current.is_symlink():
                raise ValueError(f"overlay would follow a symlink: {relative}")
        return current

    def write(relative, content, mode=0o644):
        destination = path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)
        destination.chmod(mode)
        changes[relative] = {"sha256": hashlib.sha256(content.encode()).hexdigest(), "mode": oct(mode)}

    # Configuration is copied only from package-provenance-checked content.
    source = path("usr/share/omarchy/config")
    destination = path("home/omarchy/.config")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("demo configuration must be freshly empty")
    shutil.copytree(source, destination, symlinks=True, dirs_exist_ok=True)

    write("etc/fstab", "/dev/vda / ext4 defaults,noatime 0 1\n")
    write("etc/hosts", "127.0.0.1 localhost\n::1 localhost\n127.0.1.1 omarchy-demo\n")
    write("etc/locale.conf", "LANG=C.UTF-8\n")
    write("etc/locale.gen", "# The demo uses the built-in C.UTF-8 locale.\n")
    write("etc/shells", "/bin/sh\n/bin/bash\n/usr/bin/sh\n/usr/bin/bash\n")
    write("etc/pacman.d/mirrorlist", "Server = https://riscv.mirror.pkgbuild.com/$repo/os/$arch\n")
    write("etc/machine-id", "")
    write("etc/pacman.conf", "[options]\nArchitecture = riscv64\nCheckSpace\nSigLevel = Required DatabaseOptional\nLocalFileSigLevel = Required\n\n[core]\nServer = https://riscv.mirror.pkgbuild.com/$repo/os/$arch\n\n[extra]\nServer = https://riscv.mirror.pkgbuild.com/$repo/os/$arch\n")
    write("etc/environment.d/60-omarchy-browser.conf", "LIBGL_ALWAYS_SOFTWARE=1\nGALLIUM_DRIVER=llvmpipe\nLP_NUM_THREADS=1\nAQ_NO_MODIFIERS=1\nQT_QUICK_BACKEND=software\nOMARCHY_PATH=/usr/share/omarchy\n")
    write("etc/sddm.conf.d/10-omarchy-demo.conf", "[Autologin]\nUser=omarchy\nSession=hyprland-uwsm.desktop\nRelogin=false\n\n[General]\nDisplayServer=wayland\n\n[Wayland]\nCompositorCommand=Hyprland\n")
    write("etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf", "[Service]\nExecStart=\nExecStart=-/usr/bin/agetty --autologin omarchy --noclear --keep-baud 115200,38400,9600 - $TERM\n")
    write("home/omarchy/.config/hypr/monitors.lua", 'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })\nhl.env("GDK_SCALE", "1")\n')
    write("home/omarchy/.config/hypr/looknfeel.lua", "-- Browser software-rendering profile.\nhl.config({ animations = { enabled = false }, decoration = { blur = { enabled = false }, shadow = { enabled = false } } })\n")
    write("home/omarchy/.config/xdg-terminals.list", "foot.desktop\n")
    write("home/omarchy/.config/uwsm/env", "export OMARCHY_PATH=/usr/share/omarchy\nexport LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe LP_NUM_THREADS=1 AQ_NO_MODIFIERS=1 QT_QUICK_BACKEND=software\n")
    write("etc/motd", "Omarchy RISC-V browser demo candidate\nOptional applications and toolchains are not bundled.\nNo personal accounts, credentials or VM session state were imported.\nDesktop/browser verification is recorded separately.\n")

    links = {
        "etc/systemd/system/default.target": "/usr/lib/systemd/system/graphical.target",
        "etc/systemd/system/display-manager.service": "/usr/lib/systemd/system/sddm.service",
        "etc/systemd/system/multi-user.target.wants/NetworkManager.service": "/usr/lib/systemd/system/NetworkManager.service",
        "etc/systemd/system/dbus-org.freedesktop.NetworkManager.service": "/usr/lib/systemd/system/NetworkManager.service",
        "etc/resolv.conf": "/run/NetworkManager/resolv.conf",
    }
    for relative, target in links.items():
        output = path(relative)
        if output.exists():
            raise ValueError(f"fresh overlay link already exists: {relative}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.symlink_to(target)
        changes[relative] = {"symlink": target}

    home = path("home/omarchy")
    for entry in [home, *home.rglob("*")]:
        os.lchown(entry, 1000, 1000)
    # Keep an explicit overlay identity separate from upstream package identity.
    write("etc/wasm-vm/demo-overlay.json", json.dumps({"schema": 1, "files": changes,
        "configurationSource": "package-verified usr/share/omarchy/config",
        "desktopVerified": False}, indent=2, sort_keys=True) + "\n")
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    changed = configure(args.root)
    print(f"Configured {len(changed)} reviewed demo overlays; desktop not yet verified")


if __name__ == "__main__":
    main()
