#!/usr/bin/env python3
"""Create a separate cold-boot accelerated Omarchy image and immutable chunks.

The source image is never modified. GPU selection is explicit; software DRI
entrypoints are removed from this disposable image to make fallback detectable.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--base", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
p.add_argument("--eglinfo", type=Path, required=True)
p.add_argument("--kmscube", type=Path, required=True)
p.add_argument("--scene", type=Path, required=True)
p.add_argument("--index-probe", type=Path, required=True)
p.add_argument("--mesa", type=Path, required=True, help="cross-build directory with stage/ and build.json")
p.add_argument("--quickshell-profile", type=Path, help="Quickshell-only GLES initializer and executable build receipt")
p.add_argument("--reuse-chunks", type=Path)
a = p.parse_args()
a.output = a.output.resolve()
a.output.mkdir(parents=True, exist_ok=False)
image = a.output / "guest.ext4"
try:
    subprocess.run(["cp", "-c", str(a.base.resolve()), str(image)], check=True)
except subprocess.CalledProcessError:
    shutil.copyfile(a.base, image)
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()
base_sha = digest(a.base)
quickshell = None
if a.quickshell_profile:
    quickshell = json.loads((a.quickshell_profile / "build.json").read_text())
    for name, pin in quickshell["files"].items():
        file = a.quickshell_profile / name
        assert file.stat().st_size == pin["bytes"] and digest(file) == pin["sha256"], name
with tempfile.TemporaryDirectory(prefix="preparation-", dir=a.output) as temporary:
    scratch = Path(temporary)
    overrides = "-GL_EXT_texture_border_clamp -GL_OES_texture_border_clamp -GL_EXT_texture_sRGB_decode"
    environment = 'GALLIUM_DRIVER=virgl\nMESA_EXTENSION_OVERRIDE="' + overrides + '"\nAQ_NO_MODIFIERS=1\nQT_OPENGL=es2\nQSG_RHI_BACKEND=opengl\nOMARCHY_PATH=/usr/share/omarchy\n'
    (scratch / "environment").write_text(environment)
    (scratch / "uwsm-env").write_text('export GALLIUM_DRIVER=virgl AQ_NO_MODIFIERS=1 QT_OPENGL=es2 QSG_RHI_BACKEND=opengl OMARCHY_PATH=/usr/share/omarchy\nexport MESA_EXTENSION_OVERRIDE="' + overrides + '"\n')
    for name, binary in (("eglinfo", a.eglinfo), ("kmscube", a.kmscube), ("textured-scene", a.scene), ("egl-index", a.index_probe)):
        shutil.copyfile(binary, scratch / name)
    commands = [
        "rm /etc/environment.d/60-omarchy-browser.conf",
        "write /work/environment /etc/environment.d/60-omarchy-browser.conf",
        "rm /home/omarchy/.config/uwsm/env",
        "write /work/uwsm-env /home/omarchy/.config/uwsm/env",
        "rm /usr/lib/dri/swrast_dri.so",
        "rm /usr/lib/dri/kms_swrast_dri.so",
        "rm /usr/lib/libgallium-26.2.2-arch1.1.so",
        "rm /usr/lib/libGLX_mesa.so.0.0.0",
        "mkdir /opt/virgl-proof",
    ]
    if quickshell:
        library = "libquickshell-browser-gles.so"
        for name in (library, "quickshell", "quickshell-original", "build.json"):
            shutil.copyfile(a.quickshell_profile / name, scratch / ("quickshell-" + name))
        commands += ["mkdir /usr/lib/omarchy", "rm /usr/bin/quickshell",
                     "write /work/quickshell-quickshell /usr/bin/quickshell",
                     "set_inode_field /usr/bin/quickshell mode 0100755",
                     "write /work/quickshell-" + library + " /usr/lib/omarchy/" + library,
                     "set_inode_field /usr/lib/omarchy/" + library + " mode 0100755",
                     "write /work/quickshell-quickshell-original /opt/virgl-proof/quickshell-original",
                     "write /work/quickshell-build.json /opt/virgl-proof/quickshell-profile.json"]
    mesa = json.loads((a.mesa / "build.json").read_text())
    shutil.copyfile(a.mesa / "build.json", scratch / "mesa-profile.json")
    commands += ["write /work/mesa-profile.json /opt/virgl-proof/mesa-profile.json"]
    for relative, pin in mesa["files"].items():
        if not relative.startswith("usr/lib/") or "/pkgconfig/" in relative:
            continue
        assert all(c.isalnum() or c in "/._-" for c in relative)
        target = "/" + relative
        commands += ["mkdir " + str(Path(target).parent), "rm " + target]
        if "symlink" in pin:
            link = pin["symlink"]
            assert all(c.isalnum() or c in "/._-" for c in link)
            commands += ["symlink " + target + " " + link]
        else:
            file = a.mesa / "stage" / relative
            assert digest(file) == pin["sha256"]
            temporary_name = "mesa-" + Path(relative).name
            shutil.copyfile(file, scratch / temporary_name)
            commands += ["write /work/" + temporary_name + " " + target, "set_inode_field " + target + " mode 0100755"]
    for name in ("eglinfo", "kmscube", "textured-scene", "egl-index"):
        commands += ["write /work/" + name + " /opt/virgl-proof/" + name,
                     "set_inode_field /opt/virgl-proof/" + name + " mode 0100755"]
    (scratch / "commands").write_text("\n".join(commands) + "\n")
    command = ["docker", "run", "--rm", "-v", str(image) + ":/disk/guest.ext4", "-v", str(scratch) + ":/work:ro", "wasm-vm-virgl-reference:1.3.0", "debugfs", "-w", "-f", "/work/commands", "/disk/guest.ext4"]
    result = subprocess.run(command, capture_output=True, text=True)
    (a.output / "debugfs.log").write_text(result.stdout + result.stderr)
    result.check_returncode()
    # Verify the replacement bytes and the absence of both software entrypoints.
    check = ["docker", "run", "--rm", "-v", str(image) + ":/disk/guest.ext4:ro", "wasm-vm-virgl-reference:1.3.0", "debugfs", "-R"]
    for target, expected in (("/etc/environment.d/60-omarchy-browser.conf", environment), ("/home/omarchy/.config/uwsm/env", (scratch / "uwsm-env").read_text())):
        actual = subprocess.check_output(check + ["cat " + target, "/disk/guest.ext4"], stderr=subprocess.DEVNULL, text=True)
        assert actual == expected, target
    for target in ("swrast_dri.so", "kms_swrast_dri.so"):
        actual = subprocess.run(check + ["stat /usr/lib/dri/" + target, "/disk/guest.ext4"], capture_output=True, text=True, check=True)
        assert "Inode:" not in actual.stdout, target
    if quickshell:
        for target, name in (("/usr/bin/quickshell", "quickshell"),
                             ("/usr/lib/omarchy/libquickshell-browser-gles.so", "libquickshell-browser-gles.so"),
                             ("/opt/virgl-proof/quickshell-original", "quickshell-original")):
            actual = subprocess.check_output(check + ["cat " + target, "/disk/guest.ext4"], stderr=subprocess.DEVNULL)
            assert hashlib.sha256(actual).hexdigest() == quickshell["files"][name]["sha256"], target
    for relative, pin in mesa["files"].items():
        if not relative.startswith("usr/lib/") or "/pkgconfig/" in relative:
            continue
        target = "/" + relative
        if "symlink" in pin:
            actual = subprocess.check_output(check + ["stat " + target, "/disk/guest.ext4"], stderr=subprocess.DEVNULL, text=True)
            assert 'Fast link dest: "' + pin["symlink"] + '"' in actual, target
        else:
            actual = subprocess.check_output(check + ["cat " + target, "/disk/guest.ext4"], stderr=subprocess.DEVNULL)
            assert len(actual) == pin["bytes"] and hashlib.sha256(actual).hexdigest() == pin["sha256"], target
chunks = a.output / "chunks"
chunks.mkdir()
hashes = []
with image.open("rb") as f:
    for data in iter(lambda: f.read(256 * 1024), b""):
        sha = hashlib.sha256(data).hexdigest()
        hashes.append(sha)
        destination = chunks / (sha + ".bin")
        if destination.exists():
            continue
        reuse = a.reuse_chunks / destination.name if a.reuse_chunks else None
        if reuse and reuse.is_file() and hashlib.sha256(reuse.read_bytes()).hexdigest() == sha:
            os.link(reuse, destination)
        else:
            destination.write_bytes(data)
manifest = {"version": 1, "image_len": image.stat().st_size, "chunk_size": 256 * 1024, "layout": "split", "chunks": hashes}
(a.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
assert digest(a.base) == base_sha, "source changed during preparation"
receipt = {"baseSha256": base_sha, "imageSha256": digest(image), "manifestSha256": digest(a.output / "manifest.json"), "removedSoftwareDrivers": ["swrast_dri.so", "kms_swrast_dri.so"], "forcedDriver": "virgl", "mesa": mesa, "mesaBuildSha256": digest(a.mesa / "build.json"), "extensionOverride": overrides, "binaries": {name: digest(binary) for name, binary in (("eglinfo", a.eglinfo), ("kmscube", a.kmscube), ("textured-scene", a.scene), ("egl-index", a.index_probe))}}
if quickshell:
    receipt["quickshellProfile"] = quickshell
    receipt["quickshellBuildSha256"] = digest(a.quickshell_profile / "build.json")
(a.output / "preparation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
