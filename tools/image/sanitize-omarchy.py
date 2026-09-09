#!/usr/bin/env python3
"""Create a public Omarchy root from a marked disposable extraction.

This is deliberately a filesystem copier, not an in-place image cleaner.  The
input must contain the exact disposable-root marker and is never opened for
writing.  The output is built in a sibling temporary directory and is
published only after the complete input and destination safety checks pass.

The result is a sanitized file tree for a *freshly built* ext4 image; it is
defense in depth, not a claim that deleted blocks in a raw converted disk are
private.  The script does not print file contents.  In particular, it never
includes password hashes, key material, or source paths in its output marker.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
from typing import Iterable


INPUT_MARKER = ".wasm-vm-disposable-extracted-root"
INPUT_MARKER_CONTENT = b"wasm-vm-disposable-extracted-root-v1\n"
OUTPUT_MARKER = ".wasm-vm-public-omarchy-root"
OUTPUT_MARKER_CONTENT = b"wasm-vm-public-omarchy-root-v1\n"
PACKAGED_SKEL_MARKER = ".wasm-vm-packaged-skeleton"
PACKAGED_SKEL_MARKER_CONTENT = b"wasm-vm-packaged-skeleton-v1\n"

# These are all package/runtime state which must not be copied into a public
# demo.  Package-owned files under /usr and the pacman database are retained.
DROP_EXACT = {
    INPUT_MARKER,
    ".wasm-vm-omarchy-staging",
    "etc/skel",
    "etc/inittab",
    "etc/machine-id",
    "etc/hostname",
    "etc/subuid",
    "etc/subgid",
    "etc/ssh/ssh_known_hosts",
    "etc/tailscale",
    "etc/wireguard",
    "var/lib/dbus/machine-id",
    "var/lib/systemd/random-seed",
    "var/lib/misc/random-seed",
    "var/lib/tailscale",
    "var/lib/headscale",
    "var/lib/wireguard",
    "etc/sudoers",
}

DROP_TOP_LEVEL = {"home", "root", "dev", "proc", "sys", "run", "tmp"}
DROP_EMPTY_TREES = {
    "var/log",
    "var/cache",
    "var/tmp",
}
HISTORY_NAMES = {
    ".bash_history",
    ".zsh_history",
    ".sh_history",
    ".fish_history",
    ".python_history",
    ".node_repl_history",
    ".lesshst",
    ".viminfo",
    ".wget-hsts",
}
SSH_HOST_KEY_GLOB = "ssh_host_*"
OMARCHY_UID = 1000
OMARCHY_GID = 1000


class SanitizerError(RuntimeError):
    """A safety or input-contract failure that must happen before mutation."""


def _die(message: str) -> None:
    raise SanitizerError(message)


def _absolute_no_follow(path: Path, label: str) -> Path:
    """Return an absolute path after rejecting every symlink path component."""

    if not path.is_absolute():
        path = Path.cwd() / path
    path = Path(os.path.abspath(os.fspath(path)))
    current = Path(path.anchor)
    for component in path.parts[1:]:
        current /= component
        try:
            info = current.lstat()
        except FileNotFoundError:
            # The rest of a new destination may not exist yet. Any later
            # existing component is impossible after a missing component.
            break
        except OSError:
            _die(f"cannot inspect {label}")
        if stat.S_ISLNK(info.st_mode):
            _die(f"{label} contains a symlink ancestor")
    return path


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _workspace_root() -> Path:
    # In the checkout this is tools/image/sanitize-omarchy.py. The Linux
    # preparation container mounts the image tools flat under /tools, so do
    # not assume a fixed number of parents when applying root guards.
    module = Path(__file__).resolve()
    for parent in module.parents:
        if (parent / "AGENTS.md").is_file() or (parent / ".git").exists():
            return parent
    return module.parent


def _reject_sensitive_roots(source: Path, destination: Path) -> None:
    home = Path.home().resolve()
    workspace = _workspace_root()
    for label, path in (("source", source), ("destination", destination)):
        resolved = path.resolve(strict=False)
        if resolved == Path("/"):
            _die(f"{label} may not be filesystem root")
        if resolved == home:
            _die(f"{label} may not be the home directory")
        if resolved == workspace:
            _die(f"{label} may not be the workspace root")
    if source == destination or _is_within(destination, source) or _is_within(source, destination):
        _die("source and destination must be separate trees")


def _marker_is(path: Path, name: str, expected: bytes) -> bool:
    try:
        if not path.is_file() or path.is_symlink():
            return False
        return path.read_bytes() == expected
    except OSError:
        return False


def _require_input(source: Path) -> None:
    if not source.is_dir() or source.is_symlink():
        _die("source must be a real directory")
    marker = source / INPUT_MARKER
    if not _marker_is(marker, INPUT_MARKER, INPUT_MARKER_CONTENT):
        _die("source is missing the exact disposable-root marker")


def _root_relative_symlink_target(root: Path, link: Path) -> Path:
    raw = os.readlink(link)
    target = Path(raw)
    if target.is_absolute():
        # Absolute links are interpreted as they would be inside the extracted
        # root, not as links into the host filesystem.
        candidate = root / os.fspath(target).lstrip("/")
    else:
        candidate = link.parent / target
    return Path(os.path.normpath(os.fspath(candidate)))


def _iter_paths(root: Path) -> Iterable[Path]:
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        # Do not descend through links. They are inspected as links below.
        dirnames[:] = sorted(dirnames)
        filenames[:] = sorted(filenames)
        for name in dirnames + filenames:
            yield current_path / name


def _preflight_source(source: Path) -> None:
    """Check every source object that could be observed before output mutation."""

    # These parents receive generated configuration later. Guest-absolute
    # symlinks elsewhere can be preserved, but may never redirect our writes.
    for relative in (
        "etc", "etc/systemd", "etc/systemd/system", "etc/systemd/system/getty.target.wants",
        "etc/systemd/system/multi-user.target.wants", "etc/wasm-vm", "etc/skel",
        "etc/runlevels", "etc/runlevels/default", "etc/runlevels/boot", "var",
    ):
        path = source / relative
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            _die("generated configuration parent is not a real directory")
    for path in _iter_paths(source):
        try:
            info = path.lstat()
        except OSError:
            _die("source changed while it was being inspected")
        if stat.S_ISLNK(info.st_mode):
            target = _root_relative_symlink_target(source, path)
            if not _is_within(target, source):
                _die("source contains a symlink that escapes the extracted root")
        elif not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            rel = path.relative_to(source)
            # Device nodes and sockets belong only to runtime pseudo-trees;
            # those trees are recreated empty in the public copy.
            if not rel.parts or rel.parts[0] not in DROP_TOP_LEVEL:
                _die("source contains an unsupported special file")

    # Validate all inputs needed to rebuild account files without exposing
    # their contents in diagnostics.
    for relative in ("etc/passwd", "etc/group", "etc/shadow", "etc/gshadow",
                     "etc/wasm-vm/omarchy-sanitized.json", OUTPUT_MARKER):
        path = source / relative
        if path.is_symlink() or (path.exists() and not path.is_file()):
            _die(f"{relative} must be a regular file")


def _relative(path: Path) -> str:
    return path.as_posix()


def _drop_path(rel: str) -> bool:
    parts = Path(rel).parts
    if not parts:
        return False
    if parts[0] in DROP_TOP_LEVEL:
        return True
    if rel in DROP_EXACT:
        return True
    for tree in DROP_EXACT:
        if rel.startswith(tree + "/"):
            return True
    for tree in DROP_EMPTY_TREES:
        if rel == tree or rel.startswith(tree + "/"):
            return True
    if parts[-1] in HISTORY_NAMES:
        return True
    if parts[-1] == PACKAGED_SKEL_MARKER:
        return True
    if parts[:2] == ("etc", "ssh") and fnmatch.fnmatch(parts[-1], SSH_HOST_KEY_GLOB):
        return True
    # No source sudo policy is carried into a public image. This avoids
    # retaining a bootstrap NOPASSWD grant without needing to print or report
    # the file's contents.
    if parts[:2] == ("etc", "sudoers.d"):
        return True
    return False


def _copy_regular(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination, follow_symlinks=False)
    _preserve_metadata(source, destination)


def _copy_xattrs(source: Path, destination: Path) -> None:
    """Copy extended attributes without ever dereferencing a symlink."""

    listxattr = getattr(os, "listxattr", None)
    getxattr = getattr(os, "getxattr", None)
    setxattr = getattr(os, "setxattr", None)
    if not (listxattr and getxattr and setxattr):
        return
    try:
        names = listxattr(source, follow_symlinks=False)
    except OSError as exc:
        if exc.errno in {getattr(os, "ENOTSUP", 95), getattr(os, "EOPNOTSUPP", 95)}:
            return
        raise
    for name in names:
        try:
            value = getxattr(source, name, follow_symlinks=False)
            setxattr(destination, name, value, follow_symlinks=False)
        except OSError as exc:
            if not sys.platform.startswith("linux") and exc.errno in {
                getattr(os, "ENOTSUP", 95),
                getattr(os, "EOPNOTSUPP", 95),
            }:
                continue
            _die("could not preserve a source extended attribute")


def _preserve_metadata(source: Path, destination: Path) -> None:
    """Preserve trusted-tree mode, timestamps, owner, and xattrs."""

    info = source.lstat()
    try:
        os.lchown(destination, info.st_uid, info.st_gid)
    except AttributeError:
        if sys.platform.startswith("linux"):
            _die("platform cannot preserve source ownership")
    except PermissionError:
        # A non-root macOS test fixture cannot assign arbitrary numeric ids;
        # Linux packaging must fail closed instead of silently using the host
        # owner. Equal ownership is already preserved by file creation.
        if sys.platform.startswith("linux") or (info.st_uid, info.st_gid) != (os.getuid(), os.getgid()):
            _die("could not preserve source ownership")
    # chown can clear setuid/setgid and file capabilities: metadata follows it.
    shutil.copystat(source, destination, follow_symlinks=False)
    _copy_xattrs(source, destination)


def _copy_tree(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    created_dirs: list[tuple[Path, Path]] = []
    for current, dirnames, filenames in os.walk(source, topdown=True, followlinks=False):
        current_path = Path(current)
        relative_current = current_path.relative_to(source)
        dirnames[:] = sorted(dirnames)
        filenames[:] = sorted(filenames)
        kept_dirs: list[str] = []
        for name in dirnames:
            rel = _relative(relative_current / name)
            src = current_path / name
            if _drop_path(rel):
                continue
            dst = destination / rel
            if src.is_symlink():
                dst.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(os.readlink(src), dst)
                _preserve_metadata(src, dst)
            else:
                dst.mkdir(parents=True, exist_ok=True, mode=0o700)
                created_dirs.append((src, dst))
                kept_dirs.append(name)
        dirnames[:] = kept_dirs
        for name in filenames:
            rel = _relative(relative_current / name)
            if _drop_path(rel):
                continue
            src = current_path / name
            dst = destination / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_symlink():
                os.symlink(os.readlink(src), dst)
                _preserve_metadata(src, dst)
            elif src.is_file():
                _copy_regular(src, dst)
            # Special files were admitted only under a dropped runtime tree.
    for src, dst in sorted(created_dirs, key=lambda pair: len(pair[0].parts), reverse=True):
        _preserve_metadata(src, dst)
    _preserve_metadata(source, destination)


def _sanitize_accounts(root: Path) -> None:
    passwd_path = root / "etc/passwd"
    group_path = root / "etc/group"
    shadow_path = root / "etc/shadow"
    gshadow_path = root / "etc/gshadow"

    # This is intentionally a fresh account database. No source UID-0 alias,
    # GECOS, home, shell, group membership, or other system-account field is
    # trusted; package systemd-sysusers will reconstruct package identities.
    retained_users = {
        "root": ["root", "x", "0", "0", "root", "/root", "/bin/bash"],
        "nobody": ["nobody", "x", "65534", "65534", "nobody", "/", "/usr/bin/nologin"],
        "omarchy": ["omarchy", "x", str(OMARCHY_UID), str(OMARCHY_GID), "Omarchy demo", "/home/omarchy", "/bin/bash"],
    }
    retained_groups = {
        "root": ["root", "x", "0", ""],
        "nobody": ["nobody", "x", "65534", ""],
        "omarchy": ["omarchy", "x", str(OMARCHY_GID), ""],
    }

    def passwd_line(fields: list[str]) -> str:
        return ":".join(fields)

    def shadow_line(name: str) -> str:
        return f"{name}:!:::::::"

    passwd_path.parent.mkdir(parents=True, exist_ok=True)
    passwd_path.write_text("".join(passwd_line(fields) + "\n" for fields in retained_users.values()), encoding="utf-8")
    group_path.write_text("".join(":".join(fields[:4]) + "\n" for fields in retained_groups.values()), encoding="utf-8")
    shadow_path.write_text("".join(shadow_line(name) + "\n" for name in retained_users), encoding="utf-8")
    os.chmod(shadow_path, 0o640)
    gshadow_path.write_text("".join(f"{name}:!::\n" for name in retained_groups), encoding="utf-8")
    os.chmod(gshadow_path, 0o640)


def _copy_packaged_skeleton(source: Path, output: Path) -> None:
    target = output / "home/omarchy"
    target.mkdir(parents=True, exist_ok=True)
    skeleton_output = output / "etc/skel"
    skeleton_output.mkdir(parents=True, exist_ok=True)
    marked_skeleton = source / "etc/skel"
    candidates: list[Path] = []
    if _marker_is(marked_skeleton / PACKAGED_SKEL_MARKER, PACKAGED_SKEL_MARKER, PACKAGED_SKEL_MARKER_CONTENT):
        candidates.append(marked_skeleton)
    # A directory name is not provenance. A package-owned skeleton is trusted
    # only when the package builder placed the exact marker inside it.
    for candidate in (source / "usr/share/omarchy/skel", source / "usr/share/omarchy/defaults"):
        if _marker_is(candidate / PACKAGED_SKEL_MARKER, PACKAGED_SKEL_MARKER, PACKAGED_SKEL_MARKER_CONTENT):
            candidates.append(candidate)
    for candidate in candidates:
        if candidate.is_dir() and not candidate.is_symlink():
            _copy_tree(candidate, skeleton_output)
            _copy_tree(skeleton_output, target)
            break


def _set_tree_owner(root: Path, uid: int, gid: int) -> None:
    """Assign the fixed demo identity without following links."""

    paths = [root, *sorted(root.rglob("*"))]
    for path in paths:
        try:
            os.lchown(path, uid, gid)
        except AttributeError:
            if sys.platform.startswith("linux"):
                _die("platform cannot assign demo ownership")
        except PermissionError:
            if sys.platform.startswith("linux") and (os.geteuid(), os.getegid()) not in {(0, 0), (uid, gid)}:
                _die("could not assign demo ownership")


def _remove_sshd_autostart(output: Path) -> None:
    for relative in (
        "etc/systemd/system/multi-user.target.wants/sshd.service",
        "etc/systemd/system/multi-user.target.wants/ssh.service",
        "etc/runlevels/default/sshd",
        "etc/runlevels/boot/sshd",
    ):
        path = output / relative
        if path.is_symlink() or path.is_file():
            path.unlink()
    for relative in ("etc/systemd/system/sshd.service", "etc/systemd/system/ssh.service"):
        path = output / relative
        if path.exists() or path.is_symlink():
            path.unlink()
        path.parent.mkdir(parents=True, exist_ok=True)
        os.symlink("/dev/null", path)


def _ensure_runtime_layout(output: Path) -> None:
    for relative in ("root", "home", "home/omarchy", "tmp", "run", "var/log", "var/cache", "var/tmp", "dev", "proc", "sys"):
        (output / relative).mkdir(parents=True, exist_ok=True)
    (output / "tmp").chmod(0o1777)
    (output / "var/tmp").chmod(0o1777)
    (output / "root").chmod(0o700)
    (output / "home/omarchy").chmod(0o755)
    hostname = output / "etc/hostname"
    hostname.parent.mkdir(parents=True, exist_ok=True)
    hostname.write_text("omarchy-demo\n", encoding="utf-8")

    wants = output / "etc/systemd/system/getty.target.wants"
    wants.mkdir(parents=True, exist_ok=True)
    serial_getty = wants / "serial-getty@ttyS0.service"
    if not serial_getty.exists() and not serial_getty.is_symlink():
        os.symlink("/usr/lib/systemd/system/serial-getty@.service", serial_getty)


def _write_markers(output: Path) -> None:
    (output / OUTPUT_MARKER).write_bytes(OUTPUT_MARKER_CONTENT)
    metadata = {
        "schema": 1,
        "kind": "public-omarchy-root",
        "accounts": ["root", "nobody", "omarchy"],
        "serial_getty": True,
        "sshd_autostart": False,
    }
    marker_dir = output / "etc/wasm-vm"
    marker_dir.mkdir(parents=True, exist_ok=True)
    (marker_dir / "omarchy-sanitized.json").write_text(
        json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def _validate_destination(destination: Path) -> None:
    if not destination.exists():
        return
    if destination.is_symlink() or not destination.is_dir():
        _die("destination must be absent or a previously generated public root")
    if not _marker_is(destination / OUTPUT_MARKER, OUTPUT_MARKER, OUTPUT_MARKER_CONTENT):
        _die("existing destination is not a marked public root")


def sanitize(source_arg: str | os.PathLike[str], destination_arg: str | os.PathLike[str]) -> Path:
    """Sanitize *source_arg* into *destination_arg* and return the output path."""

    source = _absolute_no_follow(Path(source_arg), "source")
    destination = _absolute_no_follow(Path(destination_arg), "destination")
    _reject_sensitive_roots(source, destination)
    _require_input(source)
    _preflight_source(source)
    _validate_destination(destination)

    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{destination.name}.", dir=parent))
    try:
        _copy_tree(source, temporary)
        _copy_packaged_skeleton(source, temporary)
        _sanitize_accounts(temporary)
        _remove_sshd_autostart(temporary)
        _ensure_runtime_layout(temporary)
        _set_tree_owner(temporary / "home/omarchy", OMARCHY_UID, OMARCHY_GID)
        _write_markers(temporary)

        if destination.exists():
            shutil.rmtree(destination)
        os.replace(temporary, destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="marked disposable extracted root")
    parser.add_argument("destination", help="new public Omarchy root directory")
    args = parser.parse_args(argv)
    try:
        sanitize(args.source, args.destination)
    except SanitizerError as exc:
        print(f"sanitize-omarchy: refused: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError) as exc:
        print(f"sanitize-omarchy: failed safely: {type(exc).__name__}", file=sys.stderr)
        return 1
    print("sanitize-omarchy: public root ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
