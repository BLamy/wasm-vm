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

# Same-length rename of one Wayland interface name (see omarchy-responsive-profile.sh): a Foot that
# never binds ext-background-effect never creates the per-surface object for which Hyprland 0.56
# damages the whole window on every commit, so an echoed keystroke recomposites one glyph cell
# instead of the full terminal under llvmpipe. No other byte of the packaged binary changes.
FOOT_EFFECT_GLOBAL = b"ext_background_effect_manager_v1\0"
FOOT_EFFECT_GLOBAL_HIDDEN = b"ext_background_effect_manager_v0\0"


def patch_foot(binary):
    if binary.count(FOOT_EFFECT_GLOBAL) != 1:
        raise ValueError("packaged foot does not contain the background-effect interface name exactly once")
    patched = binary.replace(FOOT_EFFECT_GLOBAL, FOOT_EFFECT_GLOBAL_HIDDEN)
    assert len(patched) == len(binary)
    return patched


def responsive_shell_config(defaults_text):
    """Package shell.json plus a disabled background plugin (it re-commits every frame)."""
    config = json.loads(defaults_text)
    if not isinstance(config, dict) or config.get("version") != 1:
        raise ValueError("unexpected Omarchy shell.json defaults")
    disabled = config.setdefault("disabledPlugins", [])
    if "omarchy.background" not in disabled:
        disabled.append("omarchy.background")
    return json.dumps(config, indent=2) + "\n"


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
        data = content if isinstance(content, bytes) else content.encode()
        destination = path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        destination.chmod(mode)
        changes[relative] = {"sha256": hashlib.sha256(data).hexdigest(), "mode": oct(mode)}

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
    # LP_NUM_THREADS=0: llvmpipe rasterizes inside the flush on the compositor's own thread. With a
    # rasterizer thread, Hyprland on virtio-gpu (no explicit sync; its software check reads the DRM
    # driver name) commits after a bare glFlush, and the commit can copy a half-rasterized frame
    # that then stays on screen (evidence/omarchy-responsive/README.md). One hart gains nothing.
    write("etc/environment.d/60-omarchy-browser.conf", "LIBGL_ALWAYS_SOFTWARE=1\nGALLIUM_DRIVER=llvmpipe\nLP_NUM_THREADS=0\nAQ_NO_MODIFIERS=1\nQT_QUICK_BACKEND=software\nOMARCHY_PATH=/usr/share/omarchy\n")
    write("etc/sddm.conf.d/10-omarchy-demo.conf", "[Autologin]\nUser=omarchy\nSession=hyprland-uwsm.desktop\nRelogin=false\n\n[General]\nDisplayServer=wayland\n\n[Wayland]\nCompositorCommand=Hyprland\n")
    write("etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf", "[Service]\nExecStart=\nExecStart=-/usr/bin/agetty --autologin omarchy --noclear --keep-baud 115200,38400,9600 - $TERM\n")
    write("home/omarchy/.config/hypr/monitors.lua", 'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })\nhl.env("GDK_SCALE", "1")\n')
    write("home/omarchy/.config/hypr/looknfeel.lua", """-- Browser software-rendering profile.
-- The demo is SDR-only: disable Hyprland's color-management pipeline so
-- llvmpipe does not run an unnecessary per-pixel transfer-function pass.
hl.config({
  animations = { enabled = false },
  decoration = { blur = { enabled = false }, shadow = { enabled = false } },
  render = { cm_enabled = false },
})
""")
    write("home/omarchy/.config/xdg-terminals.list", "foot.desktop\n")
    write("home/omarchy/.config/uwsm/env", "export OMARCHY_PATH=/usr/share/omarchy\nexport LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe LP_NUM_THREADS=0 AQ_NO_MODIFIERS=1 QT_QUICK_BACKEND=software\n")
    # Omarchy's bootstrap searches ~/.config before package defaults. Replace
    # only the startup module; keep the package's shell, tiling and theme code.
    # The full upstream first-run installs/configures omitted developer apps.
    write("home/omarchy/.config/default/hypr/autostart.lua", '''-- Explicit lean browser session; upstream package files stay untouched.
hl.on("hyprland.start", function()
  hl.exec_cmd("omarchy-launch-shell")
  hl.exec_cmd("/usr/local/bin/omarchy-demo-session")
end)
''')
    write("home/omarchy/.config/hypr/hyprland.lua", '''dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")
omarchy_preinstalled_bindings = false
require("default.hypr.omarchy")
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")
require("default.hypr.toggles")
''')
    write("usr/local/bin/omarchy-demo-session", Path(__file__).with_name("omarchy-demo-session.sh").read_text(), 0o755)
    # Responsive browser profile, measured in evidence/omarchy-responsive/README.md. Identical to
    # what omarchy-responsive-profile.sh applies to an already prepared session, except that a
    # fresh image can place the terminal ahead of /usr/bin on PATH instead of in the home dir.
    shell_defaults = path("usr/share/omarchy/config/omarchy/shell.json")
    if not shell_defaults.is_file():
        raise ValueError("package Omarchy shell.json defaults are required")
    write("home/omarchy/.config/omarchy/shell.json", responsive_shell_config(shell_defaults.read_text()))
    # Omarchy's own stay-awake toggle. Idle guest time fast-forwards under the icount clock, so the
    # 150 s screensaver / 300 s lock would otherwise fire seconds after the desktop goes idle.
    write("home/omarchy/.local/state/omarchy/indicators/stay-awake", "")
    packaged_foot = path("usr/bin/foot")
    if not packaged_foot.is_file():
        raise ValueError("packaged foot is required")
    write("usr/local/bin/foot", patch_foot(packaged_foot.read_bytes()), 0o755)
    write("etc/motd", "Omarchy RISC-V browser demo candidate\nOptional applications and toolchains are not bundled.\nNo personal accounts, credentials or VM session state were imported.\nDesktop/browser verification is recorded separately.\n")

    links = {
        "etc/systemd/system/default.target": "/usr/lib/systemd/system/graphical.target",
        "etc/systemd/system/display-manager.service": "/usr/lib/systemd/system/sddm.service",
        "etc/systemd/system/multi-user.target.wants/NetworkManager.service": "/usr/lib/systemd/system/NetworkManager.service",
        "etc/systemd/system/dbus-org.freedesktop.NetworkManager.service": "/usr/lib/systemd/system/NetworkManager.service",
        # The demo has ttyS0, not a configured virtio-console hvc0 port.
        "etc/systemd/system/serial-getty@hvc0.service": "/dev/null",
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
        "profile": "lean-browser-session-v1+responsive-v2",
        "upstreamFullUserProvisioning": False,
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
