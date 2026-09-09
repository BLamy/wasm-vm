#!/usr/bin/env python3
"""Build a fresh ext4 from a completed package assembly, offline in Linux.

Run as root in the network-disabled image tooling container. Neither the source
VM nor any recovered raw disk is a valid population input. A new output directory
is mandatory; failures retain their private diagnostic tree, never a success receipt.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build(source, output, selection, overlays, image_mib=4096):
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("requires the rootful Linux image tooling container")
    for path in (source, output):
        if not path.is_absolute() or path.resolve() != path or path == Path("/"):
            raise ValueError("real absolute, non-root paths are required")
    if source in output.parents or output in source.parents or source == output:
        raise ValueError("source and output must be separate")
    if output.exists() or not output.parent.is_dir():
        raise ValueError("output must be a new directory under an existing private parent")
    assembly_file = source / "etc/wasm-vm/omarchy-assembly.json"
    if assembly_file.is_symlink() or assembly_file.resolve() != assembly_file:
        raise ValueError("assembly provenance may not traverse symlinks")
    assembly = json.loads(assembly_file.read_text())
    if assembly.get("schema") != 1 or assembly.get("kind") != "omarchy-package-assembly" or "excluded_paths" in assembly:
        raise ValueError("completed, redacted package assembly required")
    selected = json.loads(selection.read_text())
    if {p["name"]: p["version"] for p in assembly["packages"]} != selected["versions"]:
        raise ValueError("package selection differs from assembly provenance")
    reviewed = json.loads(overlays.read_text())
    if sorted(assembly["overlays"]) != sorted(p["path"].lstrip("/") for p in reviewed["entries"]):
        raise ValueError("reviewed overlays differ from assembly provenance")
    if not 3072 <= image_mib <= 8192:
        raise ValueError("image size must be 3072..8192 MiB")
    sanitizer = load("sanitize-omarchy")
    sanitizer._require_input(source)
    sanitizer._preflight_source(source)
    input_files = {
        "selection": selection, "reviewedSourceOverlays": overlays,
        "assembly": assembly_file, "packages": source / "etc/wasm-vm/packages.tsv",
        "sanitizer": Path(sanitizer.__file__),
        "configurator": Path(__file__).with_name("configure-omarchy-demo.py"),
        "builder": Path(__file__),
    }
    frozen_digests = {key: digest(path) for key, path in input_files.items()}
    output.mkdir(mode=0o700)
    root = output / "root"
    logs = output / "commands.log"
    commands = []

    def run(*args):
        command = [str(item) for item in args]
        commands.append(command)
        with logs.open("a") as log:
            log.write(json.dumps(command) + "\n")
            log.flush()
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"command {len(commands)} failed ({result.returncode}); see {logs}")

    sanitizer.sanitize(source, root)
    load("configure-omarchy-demo").configure(root)
    mounted = []
    try:
        run("mount", "-t", "tmpfs", "-o", "nosuid,noexec,size=4m", "tmpfs", root / "dev")
        mounted.append(root / "dev")
        for name, minor in (("null", 3), ("zero", 5), ("random", 8), ("urandom", 9)):
            os.mknod(root / "dev" / name, stat.S_IFCHR | 0o666, os.makedev(1, minor))
            (root / "dev" / name).chmod(0o666)
        (root / "dev/fd").symlink_to("/proc/self/fd")
        run("mount", "-t", "proc", "-o", "ro,nosuid,nodev,noexec", "proc", root / "proc")
        mounted.append(root / "proc")
        for command in (
            ["/usr/bin/pacman", "-Dk"],
            ["/usr/bin/systemd-sysusers"],
            ["/usr/bin/grpck", "-r"],
            ["/usr/bin/systemd-tmpfiles", "--create", "--boot", "--exclude-prefix=/dev", "--exclude-prefix=/proc", "--exclude-prefix=/sys", "--exclude-prefix=/run"],
            ["/usr/bin/ldconfig"],
            ["/usr/bin/update-ca-trust"],
            ["/usr/bin/glib-compile-schemas", "/usr/share/glib-2.0/schemas"],
            ["/usr/bin/update-mime-database", "/usr/share/mime"],
            ["/usr/bin/update-desktop-database", "/usr/share/applications"],
            ["/usr/bin/gio-querymodules", "/usr/lib/gio/modules"],
            ["/usr/bin/fc-cache", "-fs"],
            ["/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "/usr/bin/env", "HOME=/home/omarchy", "USER=omarchy", "LOGNAME=omarchy", "OMARCHY_PATH=/usr/share/omarchy", "OMARCHY_THEME_HEADLESS=1", "/usr/bin/omarchy-theme-set", "Tokyo Night"],
        ):
            run("chroot", root, *command)
        # Match the package hook: built-in loaders need no absent module cache.
        if any((root / "usr/lib/gdk-pixbuf-2.0/2.10.0/loaders").glob("*.so")):
            run("chroot", root, "/usr/bin/gdk-pixbuf-query-loaders", "--update-cache")
        for theme_file in ("foot.ini", "hyprland.lua", "colors.toml"):
            if (root / "home/omarchy/.local/state/omarchy/current/theme" / theme_file).stat().st_size == 0:
                raise ValueError("empty generated theme")
    finally:
        # Never populate ext4 while any temporary pseudo-filesystem is mounted.
        cleanup_errors = []
        for mount in reversed(mounted):
            try:
                run("umount", mount)
            except Exception as error:
                cleanup_errors.append(str(error))
        if cleanup_errors or any(os.path.ismount(mount) for mount in mounted):
            raise RuntimeError("pseudo-filesystem cleanup failed: " + "; ".join(cleanup_errors))

    for relative in ("dev", "proc", "sys", "run", "tmp", "var/tmp", "var/log"):
        directory = root / relative
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("runtime tree must be a real directory")
        for entry in directory.iterdir():
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    if (root / "etc/machine-id").read_bytes() != b"":
        raise ValueError("machine identity must be generated on boot")
    for entry in (root / "etc/shadow").read_text().splitlines():
        if not entry.split(":")[1].startswith(("!", "*")):
            raise ValueError("all initial passwords must be locked")
    if any((root / "etc/ssh").glob("ssh_host_*key*")):
        raise ValueError("SSH host identity may not be baked into the image")
    if {key: digest(path) for key, path in input_files.items()} != frozen_digests:
        raise ValueError("build inputs changed during preparation; no image is admitted")

    image = output / "omarchy.ext4"
    with image.open("xb") as stream:
        stream.truncate(image_mib * 1024 * 1024)
    run("mke2fs", "-q", "-t", "ext4", "-b", "4096", "-m", "0", "-L", "omarchy-demo", "-E", "lazy_itable_init=0,lazy_journal_init=0", "-O", "^metadata_csum_seed,^orphan_file", "-d", root, image)
    run("e2fsck", "-fn", image)
    if {key: digest(path) for key, path in input_files.items()} != frozen_digests:
        raise ValueError("build inputs changed during mkfs; no success receipt is admitted")
    final_digests = {**frozen_digests, "demoOverlay": digest(root / "etc/wasm-vm/demo-overlay.json")}
    receipt = {"schema": 1, "image": {"name": image.name, "size": image.stat().st_size, "sha256": digest(image)},
        "inputDigests": final_digests,
        "population": "fresh ext4 populated only from sanitized package tree plus generated demo configuration",
        "timestamps": "not a bit-reproducible build contract",
        "machineIdentity": "empty machine-id; systemd generates a new identity on first boot",
        "accounts": "locked root, nobody, omarchy plus fresh package systemd-sysusers identities",
        "desktopVerified": False, "commands": commands}
    (output / "build-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps(receipt["image"]), flush=True)
    return image


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    parser.add_argument("--image-mib", type=int, default=4096)
    args = parser.parse_args()
    build(args.source, args.output, args.selection, args.overlays, args.image_mib)
