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


def compatible_application_bindings(text):
    """Keep upstream bindings, guarded when an optional native app is absent.

    These names are literals from the pinned Omarchy package. Check the guest's
    live PATH at config load so installing a port later also enables its binding.
    A missing port must not invoke an upstream x86-only installer by accident.
    """
    commands = {
        '"terminal-tmux"': "tmux", '"terminal-herdr"': "herdr",
        '"spotify"': "spotify", '"cliamp"': "cliamp",
        '"omarchy-launch-docker-tui"': "lazydocker", '"signal"': "signal-desktop",
        '"obsidian"': "obsidian", '"omawrite"': "omawrite", '"1password"': "1password",
    }
    counts = {name: 0 for name in commands}
    result = ["-- Optional native applications use their actual guest PATH.\n",
              "local function application_present(name)\n",
              '  local status = os.execute("command -v " .. name .. " >/dev/null 2>&1")\n',
              "  return status == true or status == 0\nend\n"]
    for line in text.splitlines(keepends=True):
        matching = [name for name in commands if name in line and "o.bind(" in line]
        if len(matching) > 1:
            raise ValueError("ambiguous packaged application binding")
        if matching:
            name = matching[0]
            counts[name] += 1
            result.append(f'  if application_present("{commands[name]}") then\n')
            result.append("  " + line)
            result.append("  end\n")
        else:
            result.append(line)
    if any(count != 1 for count in counts.values()):
        raise ValueError("unexpected packaged native application bindings")
    return "".join(result)


def configure(root, applications=False):
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

    if applications:
        for relative in ("usr/lib/chromium/chromium", "usr/lib/libreoffice/program/soffice.bin", "usr/bin/node"):
            executable = path(relative)
            with executable.open("rb") as stream:
                header = stream.read(64)
            if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\xf3\x00":
                raise ValueError(f"native RISC-V application required: {relative}")
        for name in ("chromium.desktop", "libreoffice-writer.desktop", "libreoffice-calc.desktop", "libreoffice-impress.desktop"):
            launcher = path("usr/share/applications") / name
            if launcher.is_symlink():
                expected = "/usr/lib/libreoffice/share/xdg/" + name.removeprefix("libreoffice-")
                if not name.startswith("libreoffice-") or os.readlink(launcher) != expected:
                    raise ValueError(f"unexpected packaged application link: {name}")
                launcher = path(expected.lstrip("/"))
            if not launcher.is_file():
                raise ValueError(f"application launcher missing: {name}")

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
    write("etc/pacman.d/mirrorlist", "Server = https://riscv.mirror.pkgbuild.com/repo/$repo\n")
    write("etc/machine-id", "")
    write("etc/pacman.conf", "[options]\nArchitecture = riscv64\nCheckSpace\nSigLevel = Required DatabaseOptional\nLocalFileSigLevel = Required\n\n[core]\nServer = https://riscv.mirror.pkgbuild.com/repo/$repo\n\n[extra]\nServer = https://riscv.mirror.pkgbuild.com/repo/$repo\n\n[unsupported]\nServer = https://riscv.mirror.pkgbuild.com/repo/$repo\n")
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
    if applications:
        write("home/omarchy/.config/hypr/hyprland.lua", path("usr/share/omarchy/config/hypr/hyprland.lua").read_text())
        write("home/omarchy/.config/default/hypr/bindings/applications.lua", compatible_application_bindings(
            path("usr/share/omarchy/default/hypr/bindings/applications.lua").read_text()))
        write("home/omarchy/.config/default/hypr/autostart.lua", '''-- Offline, package-owned browser desktop; no architecture-specific installers.
hl.on("hyprland.start", function()
  hl.exec_cmd("systemctl --user import-environment $(env | cut -d'=' -f 1)")
  hl.exec_cmd("dbus-update-activation-environment --systemd --all")
  hl.exec_cmd("omarchy-launch-shell")
  hl.exec_cmd("/usr/local/bin/omarchy-demo-session")
end)
''')
        write("home/omarchy/.config/mimeapps.list", """[Default Applications]
text/html=chromium.desktop
x-scheme-handler/http=chromium.desktop
x-scheme-handler/https=chromium.desktop
application/xhtml+xml=chromium.desktop
application/vnd.oasis.opendocument.text=libreoffice-writer.desktop
application/vnd.oasis.opendocument.spreadsheet=libreoffice-calc.desktop
application/vnd.oasis.opendocument.presentation=libreoffice-impress.desktop
application/msword=libreoffice-writer.desktop
application/vnd.openxmlformats-officedocument.wordprocessingml.document=libreoffice-writer.desktop
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet=libreoffice-calc.desktop
application/vnd.openxmlformats-officedocument.presentationml.presentation=libreoffice-impress.desktop
""")
        for desktop in sorted(path("usr/share/omarchy/applications").glob("*.desktop")):
            if desktop.is_symlink() or not desktop.is_file():
                raise ValueError("packaged application launcher must be a regular file")
            write("home/omarchy/.local/share/applications/" + desktop.name, desktop.read_bytes())
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
    if applications:
        write("etc/motd", "Omarchy RISC-V\nChromium, LibreOffice, Node.js/npm and native Omarchy applications are installed.\nUnresolved RISC-V ports remain listed in the application catalogue.\nNo personal accounts, credentials or VM session state were imported.\n")
    else:
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
        "profile": "native-applications-v1+responsive-v2" if applications else "lean-browser-session-v1+responsive-v2",
        "upstreamFullUserProvisioning": False,
        "configurationSource": "package-verified usr/share/omarchy/config",
        "desktopVerified": False}, indent=2, sort_keys=True) + "\n")
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--applications", action="store_true")
    args = parser.parse_args()
    changed = configure(args.root, applications=args.applications)
    print(f"Configured {len(changed)} reviewed demo overlays; desktop not yet verified")


if __name__ == "__main__":
    main()
