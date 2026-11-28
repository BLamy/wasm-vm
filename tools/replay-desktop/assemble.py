#!/usr/bin/env python3
"""E5-T34b: assemble the minimal Replay desktop rootfs inside the tool container.

Runs in wasm-vm-replay-desktop-build:local (see Dockerfile). Two phases:

  assemble.py stage  --in /in --out /out
      Resolve the riscv64 package closure of packages.txt from an EMPTY dpkg status (apt, signed
      archive), download and unpack each .deb into a scratch pool, then copy into /out/stage only:
        * the ELF NEEDED closure of the root executables/libraries (ROOT_ELFS + the Replay
          Chrome 108 and Replay Node 26 payloads), with their soname symlink chains;
        * the explicitly listed data paths (DATA_GLOBS);
        * the repo-owned overlay tools/replay-desktop/rootfs/ (init, session, configs);
      and write /out/stage.tar (sorted, numeric owner, fixed mtime) + /out/stage-manifest.json.

  assemble.py pack   --in /in --out /out
      Unpack /out/stage.tar and build a raw ext4 image with mke2fs -d (fixed UUID/hash seed and
      timestamps), then fsck it read-only. Writes /out/rootfs.ext4 + /out/pack.json.

Nothing here executes guest code except `busybox --list-full` and `ldconfig` under qemu-user
(static riscv64 binaries) to create applet links and the loader cache.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

EPOCH = 1793491200  # 2026-11-01T00:00:00Z, same fixed stamp as E5-T29a
TRIPLET = "riscv64-linux-gnu"
LIBDIRS = [f"usr/lib/{TRIPLET}", "usr/lib"]
UUID = "e5734b00-0000-4000-8000-000000000034"

# Executables/libraries whose NEEDED closure is copied from the pool.
ROOT_ELFS = [
    "usr/bin/sway",
    "usr/bin/swaymsg",
    "usr/sbin/seatd",
    "usr/bin/foot",
    "usr/bin/grim",
    "usr/bin/bash",
    "usr/bin/udevadm",
    # NSS soft-token pieces Chrome dlopen()s for its certificate/crypto store.
    f"usr/lib/{TRIPLET}/libsoftokn3.so",
    f"usr/lib/{TRIPLET}/libfreebl3.so",
    f"usr/lib/{TRIPLET}/libfreeblpriv3.so",
    # NSS's built-in root certificates (Mozilla's store), which Chrome loads as its "Root Certs"
    # module. Without it every HTTPS site fails with ERR_CERT_AUTHORITY_INVALID (E5-T43f).
    f"usr/lib/{TRIPLET}/libnssckbi.so",
]
# Static binaries (no NEEDED walk).
STATIC_ELFS = ["usr/bin/busybox", "usr/sbin/ldconfig.real"]
# Data copied verbatim from the pool (fnmatch on the pool-relative path).
DATA_GLOBS = [
    "etc/fonts/*",
    "usr/share/fontconfig/conf.avail/*",
    "usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "usr/share/X11/xkb/*",
    "usr/share/libinput/*",
    "usr/share/terminfo/f/foot",
    "usr/share/terminfo/f/foot-direct",
    # udevd (systemd-udevd is a link to udevadm) + only the rules that classify input/DRM devices.
    "usr/lib/systemd/systemd-udevd",
    "etc/udev/udev.conf",
    "usr/lib/udev/rules.d/50-udev-default.rules",
    "usr/lib/udev/rules.d/60-input-id.rules",
    # glibc's C.UTF-8 locale (foot refuses to start in a non-UTF-8 locale).
    "usr/lib/locale/C.utf8/*",
    # NSS soft-token integrity files checked when libsoftokn3/libfreebl3 load.
    f"usr/lib/{TRIPLET}/libsoftokn3.chk",
    f"usr/lib/{TRIPLET}/libfreebl3.chk",
    f"usr/lib/{TRIPLET}/libfreeblpriv3.chk",
]
# Never ship these even if a glob would match.
DENY = re.compile(r"^usr/share/(doc|man|info|locale|lintian|bug|bash-completion|zsh|fish)/")


def log(*args):
    print("[assemble]", *args, file=sys.stderr, flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def run(cmd, **kw):
    log("$", " ".join(map(str, cmd)))
    return subprocess.run(cmd, check=True, **kw)


APT_ROOT = Path("/aptroot")


def apt_opts() -> list[str]:
    r = APT_ROOT
    return ["-o", "APT::Architecture=riscv64", "-o", "APT::Architectures=riscv64",
            "-o", f"Dir::State={r}/state", "-o", f"Dir::State::status={r}/status",
            "-o", f"Dir::Cache={r}/cache", "-o", "Dir::Etc::SourceList=/dev/null",
            "-o", f"Dir::Etc::SourceParts={r}/etc", "-o", "APT::Install-Recommends=false",
            "-o", "Debug::NoLocking=1"]


def resolve(packages: list[str]) -> list[tuple[str, str]]:
    for d in ("state/lists/partial", "cache/archives/partial", "etc"):
        (APT_ROOT / d).mkdir(parents=True, exist_ok=True)
    (APT_ROOT / "status").write_text("")
    shutil.copy("/etc/apt/sources.list.d/ubuntu.sources", APT_ROOT / "etc/ubuntu.sources")
    run(["apt-get", *apt_opts(), "update"], stdout=subprocess.DEVNULL)
    out = subprocess.run(["apt-get", *apt_opts(), "install", "--dry-run", "--no-install-recommends",
                          *packages], check=True, capture_output=True, text=True).stdout
    closure = []
    for line in out.splitlines():
        m = re.match(r"^Inst (\S+) \((\S+) ", line)
        if m:
            closure.append((m.group(1), m.group(2)))
    if not closure:
        raise SystemExit("apt resolved an empty closure")
    return sorted(closure)


def download(closure, pool_debs: Path) -> list[dict]:
    pool_debs.mkdir(parents=True, exist_ok=True)
    specs = [f"{p}:riscv64={v}" for p, v in closure]
    # apt-get download verifies each .deb against the signed archive index.
    if not any(pool_debs.glob("*.deb")):
        subprocess.run(["apt-get", *apt_opts(), "download", *specs], cwd=pool_debs, check=True,
                       stdout=subprocess.DEVNULL)
    debs = []
    for deb in sorted(pool_debs.glob("*.deb")):
        info = subprocess.run(["dpkg-deb", "-f", str(deb), "Package", "Version", "Architecture"],
                              check=True, capture_output=True, text=True).stdout
        fields = dict(l.split(": ", 1) for l in info.strip().splitlines())
        debs.append({"package": fields["Package"], "version": fields["Version"],
                     "arch": fields["Architecture"], "file": deb.name,
                     "bytes": deb.stat().st_size, "sha256": sha256(deb)})
    got = {(d["package"], d["version"]) for d in debs}
    missing = [c for c in closure if c not in got]
    if missing:
        raise SystemExit(f"downloads missing: {missing}")
    return debs


def unpack(pool_debs: Path, pool: Path, debs) -> dict[str, str]:
    """Unpack every deb into one pool tree with a usr-merged layout; map path -> package."""
    pool.mkdir(parents=True, exist_ok=True)
    for name in ("bin", "sbin", "lib"):
        (pool / name).symlink_to("usr/" + name)
    (pool / "usr/bin").mkdir(parents=True)
    (pool / "usr/sbin").mkdir(parents=True)
    (pool / "usr/lib").mkdir(parents=True)
    owner = {}
    for d in debs:
        deb = pool_debs / d["file"]
        listing = subprocess.run(["dpkg-deb", "--fsys-tarfile", str(deb)], check=True,
                                 capture_output=True).stdout
        with tarfile.open(fileobj=__import__("io").BytesIO(listing)) as t:
            for m in t.getmembers():
                p = m.name.lstrip("./")
                for name in ("bin/", "sbin/", "lib/"):
                    if p.startswith(name):
                        p = "usr/" + p
                if p and not m.isdir():
                    owner.setdefault(p, d["package"])
        subprocess.run(f"dpkg-deb --fsys-tarfile '{deb}' | tar -x --keep-directory-symlink -C '{pool}'",
                       shell=True, check=True)
    return owner


def readelf_dynamic(path: Path) -> tuple[list[str], list[str]]:
    out = subprocess.run([f"{TRIPLET}-readelf", "-d", "-W", str(path)], capture_output=True,
                         text=True).stdout
    needed = re.findall(r"\(NEEDED\)\s+Shared library: \[(.+?)\]", out)
    runpath = re.findall(r"\((?:RUNPATH|RPATH)\)\s+Library (?:runpath|rpath): \[(.+?)\]", out)
    return needed, runpath


def is_elf(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


class Stager:
    def __init__(self, pool: Path, stage: Path, owner: dict[str, str]):
        self.pool, self.stage, self.owner = pool, stage, owner
        self.copied: dict[str, str] = {}  # rel path -> source tag

    def _copy_one(self, rel: str, tag: str):
        """Copy pool/rel (a file or symlink, following the symlink chain) into stage."""
        while True:
            if rel in self.copied:
                return
            src = self.pool / rel
            dst = self.stage / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            self.copied[rel] = tag
            if src.is_symlink():
                target = os.readlink(src)
                os.symlink(target, dst)
                nxt = os.path.normpath(os.path.join(os.path.dirname(rel), target)) \
                    if not target.startswith("/") else target.lstrip("/")
                for name in ("bin/", "sbin/", "lib/"):
                    if nxt.startswith(name):
                        nxt = "usr/" + nxt
                rel = nxt
                continue
            if not src.is_file():
                raise SystemExit(f"missing in pool: {rel}")
            shutil.copy2(src, dst, follow_symlinks=False)
            return

    def add_file(self, rel: str, tag="data"):
        self._copy_one(rel, self.owner.get(rel, tag))

    def find_lib(self, soname: str, extra_dirs: list[Path]) -> str | None:
        for d in extra_dirs:
            if (d / soname).exists():
                return str((d / soname).relative_to(self.stage))
        for d in LIBDIRS:
            if (self.pool / d / soname).exists() or (self.pool / d / soname).is_symlink():
                return f"{d}/{soname}"
        return None

    def elf_closure(self, roots: list[Path]):
        """roots: staged ELF paths. Copies NEEDED libs from the pool; returns unresolved."""
        seen, todo, unresolved = set(), list(roots), []
        while todo:
            path = todo.pop()
            real = path.resolve()
            if real in seen or not is_elf(real):
                continue
            seen.add(real)
            needed, runpath = readelf_dynamic(real)
            origin_dirs = [Path(rp.replace("$ORIGIN", str(real.parent))) for r in runpath
                           for rp in r.split(":") if "$ORIGIN" in rp]
            for soname in needed:
                if soname.startswith("ld-linux-riscv64"):
                    # PT_INTERP is /lib/<ld.so> (= usr/lib via the /lib symlink); copy both names.
                    self.add_file(f"usr/lib/{TRIPLET}/{soname}")
                    if os.path.lexists(self.pool / f"usr/lib/{soname}"):
                        self.add_file(f"usr/lib/{soname}")
                    continue
                staged_local = [d for d in origin_dirs + [real.parent] if (d / soname).exists()]
                if staged_local:
                    todo.append(staged_local[0] / soname)
                    continue
                rel = self.find_lib(soname, [])
                if rel is None:
                    unresolved.append((str(real.relative_to(self.stage)), soname))
                    continue
                self.add_file(rel)
                todo.append((self.stage / rel))
        return unresolved


def stage_phase(args):
    inp, out = Path(args.inp), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stage = out / "stage"
    if stage.exists():
        shutil.rmtree(stage)
    packages = [l.split("#")[0].strip() for l in (inp / "tools/replay-desktop/packages.txt").read_text().splitlines()]
    packages = [p for p in packages if p]
    closure = resolve(packages)
    log(f"closure: {len(closure)} packages")
    pool_debs, pool = Path("/scratch/debs"), Path("/scratch/pool")
    # Reuse a previous download of the same closure (apt re-verifies; stale files are removed).
    if pool.exists():
        shutil.rmtree(pool)
    if pool_debs.exists() and not args.keep_debs:
        shutil.rmtree(pool_debs)
    debs = download(closure, pool_debs)
    owner = unpack(pool_debs, pool, debs)

    stage.mkdir()
    for name in ("bin", "sbin", "lib"):
        (stage / name).symlink_to("usr/" + name)
    st = Stager(pool, stage, owner)

    # --- Replay Chrome 108 (E0-T34 runtime bundle, untouched except symbol strip of `chrome`) ---
    chrome_tar = inp / "local/chromium/replay-chromium-riscv64.tar.gz"
    runtime_files = json.loads((inp / "tools/chromium/built/runtime-files.json").read_text())["files"]
    chrome_dir = stage / "opt/replay-chromium"
    chrome_dir.mkdir(parents=True)
    payload = {"chromium": {"bundle": chrome_tar.name, "bundleSha256": sha256(chrome_tar), "files": {}}}
    with tarfile.open(chrome_tar, "r:gz") as t:
        for m in t:
            if m.isdir():
                continue
            if not m.isfile() or not m.name.startswith("replay-chromium/"):
                raise SystemExit(f"unexpected chrome member {m.name}")
            name = m.name.removeprefix("replay-chromium/")
            if name == "SHA256SUMS":
                continue
            if name not in runtime_files:
                raise SystemExit(f"unlisted chrome member {name}")
            dst = chrome_dir / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            with t.extractfile(m) as s, dst.open("xb") as d:
                shutil.copyfileobj(s, d, 1 << 20)
            if sha256(dst) != runtime_files[name]:
                raise SystemExit(f"chrome member digest mismatch {name}")
            dst.chmod(0o755 if m.mode & 0o111 else 0o644)
            payload["chromium"]["files"][name] = {"verifiedSha256": runtime_files[name]}
    if set(payload["chromium"]["files"]) != set(runtime_files):
        raise SystemExit("incomplete chrome bundle")
    # The verified binary carries .symtab/.strtab (~167 MB). Strip them for the image; the code and
    # data sections are unchanged. Record both digests.
    for name in ("chrome", "chrome_crashpad_handler", "libEGL.so", "libGLESv2.so",
                 "libvk_swiftshader.so", "libvulkan.so.1"):
        p = chrome_dir / name
        before = p.stat().st_size
        run([f"{TRIPLET}-strip", "--strip-all", str(p)])
        payload["chromium"]["files"][name].update(strippedSha256=sha256(p), bytesBefore=before,
                                                   bytesAfter=p.stat().st_size)

    # --- Replay Node 26 (E5-T33, already stripped) ---
    node_tar = inp / "local/node/replay-node-26-riscv64.tar.xz"
    node_dir = stage / "opt/replay-node-26"
    node_dir.mkdir(parents=True)
    with tarfile.open(node_tar, "r:xz") as t:
        for m in t:
            if m.isdir():
                continue
            if not m.isfile() or not m.name.startswith("replay-node-26-riscv64/"):
                raise SystemExit(f"unexpected node member {m.name}")
            name = m.name.removeprefix("replay-node-26-riscv64/")
            if name not in ("bin/node", "LICENSE", "README"):
                raise SystemExit(f"unlisted node member {name}")
            dst = node_dir / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            with t.extractfile(m) as s, dst.open("xb") as d:
                shutil.copyfileobj(s, d, 1 << 20)
            dst.chmod(0o755 if name == "bin/node" else 0o644)
    node_sha = sha256(node_dir / "bin/node")
    if node_sha != args.node_sha256:
        raise SystemExit(f"node digest {node_sha} != pinned {args.node_sha256}")
    payload["node"] = {"bundle": node_tar.name, "bundleSha256": sha256(node_tar), "nodeSha256": node_sha}

    # --- pool roots ---
    for rel in ROOT_ELFS + STATIC_ELFS:
        st.add_file(rel, "root")
    for rel in sorted(owner):
        if any(fnmatch.fnmatch(rel, g) for g in DATA_GLOBS) and not DENY.search(rel):
            st.add_file(rel)
    # fontconfig conf.d symlinks point into conf.avail (copied above).

    # --- repo overlay (init, session, configs, wvm-type helper source is assembled below) ---
    overlay = inp / "tools/replay-desktop/rootfs"
    for src in sorted(overlay.rglob("*")):
        rel = src.relative_to(overlay)
        dst = stage / rel
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        shutil.copyfile(src, dst)
        dst.chmod(0o755 if os.access(src, os.X_OK) else 0o644)
    # The root is read-only: the resolver configuration lives in /run, written by udhcpc's hook
    # (E5-T43c). A dangling link until the first lease, which resolvers treat as "no servers".
    (stage / "etc/resolv.conf").unlink(missing_ok=True)
    os.symlink("/run/resolv.conf", stage / "etc/resolv.conf")
    shutil.copyfile(inp / "tools/chromium/guest/smoke.html", chrome_dir / "smoke.html")
    (chrome_dir / "smoke.html").chmod(0o644)
    # /usr/local/bin/node is the overlay's wrapper (startup snapshot, see rcS); it must be there.
    if not (stage / "usr/local/bin/node").is_file():
        raise SystemExit("overlay did not supply usr/local/bin/node")

    # wvm-type: 1 KiB static riscv64 helper (TIOCSTI) assembled from repo source.
    asm = inp / "tools/replay-desktop/wvm-type.S"
    obj = Path("/scratch/wvm-type.o")
    run([f"{TRIPLET}-as", "-o", str(obj), str(asm)])
    run([f"{TRIPLET}-ld", "-static", "-s", "-o", str(stage / "usr/local/sbin/wvm-type"), str(obj)])
    (stage / "usr/local/sbin/wvm-type").chmod(0o700)

    # --- ELF closure over everything staged ---
    roots = [p for p in stage.rglob("*") if p.is_file() and not p.is_symlink() and is_elf(p)]
    unresolved = st.elf_closure(roots)
    # libraries Chrome loads by name at runtime are fine to be absent (gtk, va, pci, ...); but a
    # NEEDED entry that cannot be resolved is fatal.
    if unresolved:
        raise SystemExit(f"unresolved NEEDED: {unresolved}")

    # --- busybox applets ---
    applets = subprocess.run(["qemu-riscv64", str(stage / "usr/bin/busybox"), "--list-full"],
                             check=True, capture_output=True, text=True).stdout.split()
    for a in applets:
        a = a.lstrip("/")
        for name in ("bin/", "sbin/"):
            if a.startswith(name):
                a = "usr/" + a
        dst = stage / a
        if dst.exists() or dst.is_symlink():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.symlink("/usr/bin/busybox", dst)
    # busybox init is PID 1.
    for p in ("usr/sbin/init",):
        q = stage / p
        if q.is_symlink():
            q.unlink()
        os.symlink("/usr/bin/busybox", q)

    # --- skeleton dirs (tmpfs mount points; root is read-only) ---
    for d in ("proc", "sys", "dev", "run", "tmp", "home", "root", "var", "mnt", "etc"):
        (stage / d).mkdir(exist_ok=True)
    (stage / "var/tmp").mkdir(exist_ok=True)

    # --- loader cache ---
    (stage / "etc/ld.so.conf").write_text(f"/usr/lib/{TRIPLET}\n")
    run(["qemu-riscv64", str(stage / "usr/sbin/ldconfig.real"), "-r", str(stage), "-X"])
    (stage / "usr/sbin/ldconfig.real").unlink()
    del st.copied["usr/sbin/ldconfig.real"]

    # --- normalise ownership/times ---
    for p in [stage, *stage.rglob("*")]:
        os.lchown(p, 0, 0)
        os.utime(p, (EPOCH, EPOCH), follow_symlinks=False)

    files = []
    total = 0
    for p in sorted(stage.rglob("*")):
        rel = str(p.relative_to(stage))
        if p.is_symlink():
            files.append({"path": rel, "symlink": os.readlink(p)})
        elif p.is_file():
            size = p.stat().st_size
            total += size
            files.append({"path": rel, "bytes": size, "mode": oct(p.stat().st_mode & 0o7777),
                          "sha256": sha256(p), "source": st.copied.get(rel, "payload/overlay")})
    used_pkgs = sorted({v for v in st.copied.values() if v not in ("root", "data")})
    manifest = {"task": "E5-T34b", "packagesRequested": packages, "aptClosure": debs,
                "packagesContributingFiles": used_pkgs, "payload": payload,
                "stagedRegularBytes": total, "files": files}
    (out / "stage-manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    tar_path = out / "stage.tar"
    with tarfile.open(tar_path, "w", format=tarfile.PAX_FORMAT) as t:
        def norm(ti):
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            ti.mtime = EPOCH
            return ti
        for p in sorted(stage.rglob("*")):
            t.add(p, arcname=str(p.relative_to(stage)), recursive=False, filter=norm)
    log(f"staged {len(files)} entries, {total} regular bytes; contributing packages {len(used_pkgs)}")
    shutil.rmtree(pool)
    if not args.keep_debs:
        shutil.rmtree(pool_debs)


def pack_phase(args):
    out = Path(args.out)
    tree = Path("/scratch/packtree")
    if tree.exists():
        shutil.rmtree(tree)
    tree.mkdir(parents=True)
    run(["tar", "-x", "-p", "--numeric-owner", "-f", str(out / "stage.tar"), "-C", str(tree)])
    # Home/desktop ownership is applied at boot on tmpfs; everything in the image is root-owned.
    used = int(subprocess.run(["du", "-s", "--block-size=1", "--apparent-size", str(tree)],
                              check=True, capture_output=True, text=True).stdout.split()[0])
    inodes = sum(1 for _ in tree.rglob("*")) + 64
    # ext4 overhead (metadata + 4 KiB tail rounding) with ~6% headroom; read-only root needs no slack.
    size = ((int(used * 1.04) + 16 * 1024 * 1024) // (1 << 20) + 1) * (1 << 20)
    img = out / "rootfs.ext4"
    if img.exists():
        img.unlink()
    env = dict(os.environ, E2FSPROGS_FAKE_TIME=str(EPOCH))
    run(["mke2fs", "-q", "-F", "-t", "ext4", "-b", "4096", "-N", str(inodes + 1024), "-m", "0",
         "-L", "replay-desktop", "-U", UUID, "-E", f"hash_seed={UUID},root_owner=0:0,lazy_itable_init=0,nodiscard",
         "-O", "^has_journal,^metadata_csum_seed", "-d", str(tree), str(img), f"{size // 1024}k"], env=env)
    run(["e2fsck", "-f", "-n", str(img)], env=env)
    meta = {"bytes": img.stat().st_size, "sha256": sha256(img), "treeApparentBytes": used,
            "inodes": inodes}
    (out / "pack.json").write_text(json.dumps(meta, indent=1) + "\n")
    shutil.rmtree(tree)
    log("packed", meta)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["stage", "pack"])
    ap.add_argument("--in", dest="inp", default="/in")
    ap.add_argument("--out", default="/out")
    ap.add_argument("--keep-debs", action="store_true", help="dev loop: keep/reuse /scratch/debs")
    ap.add_argument("--node-sha256", default="8c19cbb6c9b1f3b2cca4685e91952e314d8a5825b2a0dfc56bdf748211d7c320")  # E5-T45a
    a = ap.parse_args()
    stage_phase(a) if a.phase == "stage" else pack_phase(a)
