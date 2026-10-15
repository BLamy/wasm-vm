#!/usr/bin/env python3
"""Install locked, signed native apps offline, then reassemble package-owned files.

Run in the rootful network-disabled Linux tooling container. The input is the
previously accepted package assembly, never a personal disk or a booted image.
No application desktop or emulator execution is claimed by this build tool.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def real_path(path):
    if not path.is_absolute() or path.resolve() != path or path == Path("/"):
        raise ValueError("real absolute non-root paths are required")
    return path


def preflight(lock, archives):
    if lock.get("schema") != 1 or lock.get("kind") != "omarchy-native-app-archives" or lock.get("architecture") != "riscv64":
        raise ValueError("native RISC-V archive lock required")
    records = lock["packages"]
    names = set()
    filenames = set()
    for record in records:
        name, filename = record["name"], record["archive"]
        if name in names or filename in filenames or not re.fullmatch(r"[a-z0-9][a-z0-9+_.-]*", name):
            raise ValueError("duplicate or invalid package identity")
        names.add(name)
        filenames.add(filename)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.:-]*\.pkg\.tar\.zst", filename):
            raise ValueError("unsafe archive filename")
        if record["architecture"] not in ("riscv64", "any") or record["repository"] not in ("core", "extra", "unsupported"):
            raise ValueError("wrong architecture or repository")
        expected_url = f"https://riscv.mirror.pkgbuild.com/repo/{record['repository']}/{filename}"
        if record["url"] != expected_url:
            raise ValueError("unexpected package source")
        for suffix, size, pin in (("", record["bytes"], record["sha256"]),
                                  (".sig", record["signatureBytes"], record["signatureSha256"])):
            path = archives / (filename + suffix)
            if not re.fullmatch(r"[0-9a-f]{64}", pin) or not isinstance(size, int) or size <= 0:
                raise ValueError("invalid archive digest or length")
            if path.is_symlink() or not path.is_file() or path.stat().st_size != size or digest(path) != pin:
                raise ValueError("archive/signature identity mismatch: " + name)
        if record["signatureBytes"] > 65536:
            raise ValueError("oversized detached signature")
        listing = subprocess.check_output(["bsdtar", "-tf", str(archives / filename)], timeout=120).decode()
        for member in listing.splitlines():
            if not member or PurePosixPath(member).is_absolute() or ".." in PurePosixPath(member).parts:
                raise ValueError("unsafe archive member: " + name)
        info = subprocess.check_output(["bsdtar", "-xOf", str(archives / filename), ".PKGINFO"], timeout=60).decode()
        actual = dict(line.split(" = ", 1) for line in info.splitlines()
                      if line.startswith(("pkgname = ", "pkgver = ", "arch = ")))
        if actual != {"pkgname": name, "pkgver": record["version"], "arch": record["architecture"]}:
            raise ValueError("actual archive metadata mismatch: " + name)
    if not {"chromium", "libreoffice-fresh", "nodejs", "npm"} <= names:
        raise ValueError("all requested priority applications are mandatory")
    return records


def elf_inventory(root):
    records = []
    for prefix in ("usr", "opt"):
        for current, dirs, files in os.walk(root / prefix, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(current) / d).is_symlink())
            for name in sorted(files):
                path = Path(current) / name
                if path.is_symlink() or not path.is_file():
                    continue
                with path.open("rb") as stream:
                    header = stream.read(64)
                if header[:4] != b"\x7fELF":
                    continue
                if len(header) != 64 or header[5] not in (1, 2):
                    raise ValueError("malformed ELF: " + str(path.relative_to(root)))
                endian = "little" if header[5] == 1 else "big"
                kind = int.from_bytes(header[16:18], endian)
                machine = int.from_bytes(header[18:20], endian)
                if kind not in (2, 3):  # Relocatable/BPF objects are not native runtime ELF.
                    continue
                if header[4:6] != b"\x02\x01" or machine != 243:
                    raise ValueError("non-RISC-V runtime ELF: " + str(path.relative_to(root)))
                records.append({"path": str(path.relative_to(root)), "machine": machine,
                                "type": kind, "sha256": digest(path), "mode": oct(stat.S_IMODE(path.stat().st_mode))})
    required = {"usr/lib/chromium/chromium", "usr/lib/libreoffice/program/soffice.bin", "usr/bin/node"}
    if not required <= {r["path"] for r in records}:
        raise ValueError("priority application ELF is absent")
    return records


def install(source, output, archives, lock_path, selection, source_overlays, final_overlays):
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("requires rootful network-disabled Linux image tooling")
    for path in (source, output, archives, lock_path, selection, source_overlays, final_overlays):
        real_path(path)
    if output.exists() or not output.parent.is_dir() or source in output.parents or output in source.parents:
        raise ValueError("new separate output required")
    # Fail before copying or executing guest code if any archive identity is wrong.
    lock = json.loads(lock_path.read_text())
    records = preflight(lock, archives)
    frozen = {str(path): digest(path) for path in (lock_path, selection, source_overlays, final_overlays)}
    output.mkdir(mode=0o700)
    log = output / "commands.log"
    commands = []

    def run(*args):
        command = [str(arg) for arg in args]
        with log.open("a") as stream:
            stream.write(json.dumps(command) + "\n")
            stream.flush()
            result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
        commands.append({"command": command, "exitCode": result.returncode})
        if result.returncode:
            raise RuntimeError("command failed; see " + str(log))

    assembler = module("assemble-omarchy")
    root = output / "transaction-root"
    root.mkdir(mode=0o700)
    (root / assembler.STAGING_MARKER).write_bytes(assembler.STAGING_MARKER_CONTENT)
    assembler.assemble(source, root, source_overlays, "omit-docs-man-cache-boot-modules", selection)
    for relative in ("root", "dev", "proc", "sys", "run", "tmp", "var/cache/pacman/pkg"):
        (root / relative).mkdir(parents=True, exist_ok=True)
    (root / "etc/passwd").write_text("root:x:0:0:root:/root:/usr/bin/bash\n")
    (root / "etc/group").write_text("root:x:0:root\n")
    (root / "etc/pacman.conf").write_text("[options]\nArchitecture = riscv64\nSigLevel = Required DatabaseOptional\nLocalFileSigLevel = Required\n")
    mounted = []
    gpg_started = False
    try:
        run("mount", "-t", "tmpfs", "-o", "nosuid,noexec,size=4m", "tmpfs", root / "dev")
        mounted.append(root / "dev")
        for name, minor in (("null", 3), ("zero", 5), ("random", 8), ("urandom", 9)):
            os.mknod(root / "dev" / name, stat.S_IFCHR | 0o666, os.makedev(1, minor))
            (root / "dev" / name).chmod(0o666)
        (root / "dev/fd").symlink_to("/proc/self/fd")
        run("mount", "-t", "proc", "-o", "ro,nosuid,nodev,noexec", "proc", root / "proc")
        mounted.append(root / "proc")
        run("mount", "--bind", archives, root / "var/cache/pacman/pkg")
        mounted.append(root / "var/cache/pacman/pkg")
        run("mount", "-o", "remount,bind,ro", root / "var/cache/pacman/pkg")
        for command in (("/usr/bin/systemd-sysusers",), ("/usr/bin/pacman-key", "--init"),
                        ("/usr/bin/pacman-key", "--populate", "archlinux")):
            if command[0] == "/usr/bin/pacman-key":
                gpg_started = True
            run("chroot", root, *command)
        for record in records:
            if record["name"] in ("chromium", "libreoffice-fresh", "nodejs", "npm"):
                filename = "/var/cache/pacman/pkg/" + record["archive"]
                run("chroot", root, "/usr/bin/pacman-key", "--verify", filename + ".sig", filename)
        # Real libalpm dependency, signature, conflict and filesystem checks.
        # No --nodeps, --assume-installed, --overwrite or disabled signatures.
        run("chroot", root, "/usr/bin/pacman", "-U", "--noconfirm", "--noprogressbar",
            *("/var/cache/pacman/pkg/" + record["archive"] for record in records))
        run("chroot", root, "/usr/bin/pacman", "-Dk")
        run("chroot", root, "/usr/bin/ldconfig")
        for binary in ("/usr/lib/chromium/chromium", "/usr/lib/libreoffice/program/soffice.bin", "/usr/bin/node"):
            run("chroot", root, "/usr/lib/ld-linux-riscv64-lp64d.so.1", "--list", binary)
    finally:
        errors = []
        # GnuPG agents retain /dev/null and random-device descriptors. Stop
        # only this disposable root's agents before ordinary, strict unmounts.
        if gpg_started:
            try:
                run("chroot", root, "/usr/bin/gpgconf", "--homedir", "/etc/pacman.d/gnupg", "--kill", "all")
            except Exception as error:
                errors.append(str(error))
        for mount in reversed(mounted):
            try:
                run("umount", mount)
            except Exception as error:
                errors.append(str(error))
        if errors or any(os.path.ismount(mount) for mount in mounted):
            raise RuntimeError("temporary mount cleanup failed: " + "; ".join(errors))
    # Re-admit files against the installed package mtree; no hook state, private
    # trust key or accidental unowned file is promoted to the public assembly.
    fields = module("select-omarchy-packages").fields
    installed = {}
    for desc in sorted((root / "var/lib/pacman/local").glob("*/desc")):
        info = fields(desc)
        installed[info["NAME"][0]] = info
    for record in records:
        info = installed[record["name"]]
        if info["VERSION"] != [record["version"]] or "pgp" not in info.get("VALIDATION", []):
            raise ValueError("installed identity/signature validation missing: " + record["name"])
    chosen = {"schema": 1, "packages": sorted(installed),
              "versions": {name: info["VERSION"][0] for name, info in sorted(installed.items())},
              "installedBytes": sum(int(info.get("SIZE", ["0"])[0]) for info in installed.values()),
              "versionConstraintsChecked": True}
    selection_out = output / "package-selection.json"
    selection_out.write_text(json.dumps(chosen, indent=2) + "\n")
    elves = elf_inventory(root)
    (output / "runtime-elf.json").write_text(json.dumps(elves, indent=2) + "\n")
    assembled = output / "assembled"
    assembled.mkdir(mode=0o700)
    (assembled / assembler.STAGING_MARKER).write_bytes(assembler.STAGING_MARKER_CONTENT)
    assembler.assemble(root, assembled, final_overlays, "omit-docs-man-cache-boot-modules", selection_out)
    if {path: digest(Path(path)) for path in frozen} != frozen:
        raise ValueError("frozen build inputs changed; no receipt admitted")
    receipt = {"schema": 1, "kind": "signed-omarchy-application-assembly", "inputDigests": frozen,
               "packageCount": len(installed), "newSignedArchives": len(records), "commands": commands,
               "selectionSha256": digest(selection_out), "elfInventorySha256": digest(output / "runtime-elf.json"),
               "assemblySha256": digest(assembled / "etc/wasm-vm/omarchy-assembly.json"),
               "desktopVerified": False, "emulatorExecutionVerified": False}
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"packageCount": len(installed), "newSignedArchives": len(records), "assembled": str(assembled)}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "output", "archives", "lock", "selection", "source-overlays", "final-overlays"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    install(args.source, args.output, args.archives, args.lock, args.selection, args.source_overlays, args.final_overlays)
