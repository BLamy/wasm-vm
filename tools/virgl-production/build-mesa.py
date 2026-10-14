#!/usr/bin/env python3
"""Build the pinned GLES-only guest Mesa with overridable border extensions.

Run in the owned Linux reference container with the read-only guest sysroot.
The two extension names share a real flag, following Mesa's own override policy.
No renderer, shader, packet or capability value is substituted.
"""
import argparse
import hashlib
import json
import os
import posixpath
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--archive", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--sysroot", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
expected = "55b1234c8653dad9b85ba3de7b777a0d957909baf4628f0c00e21d4ba89c004cb687a1dcf8da46ed0a092231dd4f859027509f83ad8c558750845ba470902615"
assert hashlib.sha512(args.archive.read_bytes()).hexdigest() == expected
source = args.output / "mesa-26.2.2"
if not source.exists():
    with tarfile.open(args.archive) as archive:
        for entry in archive.getmembers():
            assert not Path(entry.name).is_absolute() and ".." not in Path(entry.name).parts
            if entry.issym() or entry.islnk():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(entry.name) if entry.issym() else "", entry.linkname))
                assert target.startswith("mesa-26.2.2/") and not entry.linkname.startswith("/")
            else:
                assert entry.isdir() or entry.isfile()
        archive.extractall(args.output)
    header = source / "src/mesa/main/consts_exts.h"
    text = header.read_text()
    anchor = "   GLboolean EXT_texture_sRGB_decode;"
    assert text.count(anchor) == 1
    header.write_text(text.replace(anchor, "   GLboolean EXT_texture_border_clamp;\n" + anchor))
    table = source / "src/mesa/main/extensions_table.h"
    lines = table.read_text().splitlines(keepends=True)
    names = ("EXT_texture_border_clamp", "OES_texture_border_clamp")
    for name in names:
        matches = [i for i, line in enumerate(lines) if line.startswith("EXT(" + name + " ")]
        assert len(matches) == 1
        i = matches[0]
        assert "dummy_true" in lines[i]
        lines[i] = lines[i].replace("dummy_true", "EXT_texture_border_clamp")
    table.write_text("".join(lines))
    extensions = source / "src/mesa/main/extensions.c"
    text = extensions.read_text()
    anchor = "   extensions->dummy_true = GL_TRUE;"
    assert text.count(anchor) == 1
    extensions.write_text(text.replace(anchor, anchor + "\n   extensions->EXT_texture_border_clamp = GL_TRUE;"))
    # GBM maps buffers with an internal desktop context. Retain that code while
    # exposing only the browser-qualified GLES API through EGL configurations.
    egl = source / "src/egl/drivers/dri2/egl_dri2.c"
    text = egl.read_text()
    anchor = "   if ((api_mask & (1 << __DRI_API_OPENGL)) && _eglIsApiValid(EGL_OPENGL_API))\n      disp->ClientAPIs |= EGL_OPENGL_BIT;"
    assert text.count(anchor) == 1
    egl.write_text(text.replace(anchor, "   /* wasm-vm exposes qualified GLES; GBM retains internal GL mapping. */"))
    changed = ["src/mesa/main/consts_exts.h", "src/mesa/main/extensions_table.h", "src/mesa/main/extensions.c", "src/egl/drivers/dri2/egl_dri2.c"]
    pristine = args.output / "pristine"
    pristine.mkdir()
    with tarfile.open(args.archive) as archive:
        for name in changed:
            original = pristine / name
            original.parent.mkdir(parents=True, exist_ok=True)
            original.write_bytes(archive.extractfile("mesa-26.2.2/" + name).read())
    # Only retain changed files; avoid listing the full source tree.
    patch = b""
    for name in changed:
        result = subprocess.run(["diff", "-u", "--label", "a/" + name, "--label", "b/" + name, str(pristine / name), str(source / name)], capture_output=True)
        assert result.returncode == 1
        patch += result.stdout
    (args.output / "profile.patch").write_bytes(patch)

# EGL_NO_CONFIG_KHR bypasses config RenderableType checks. Reject unqualified
# public APIs explicitly, without affecting GBM's direct internal DRI context.
egl = source / "src/egl/drivers/dri2/egl_dri2.c"
text = egl.read_text()
anchor = "   if (!_eglInitContext(&dri2_ctx->base, disp, conf, share_list, attrib_list))\n      goto cleanup;\n"
guard = anchor + '\n   if (dri2_ctx->base.ClientAPI != EGL_OPENGL_ES_API) {\n      _eglError(EGL_BAD_MATCH, "wasm-vm qualified GLES profile");\n      goto cleanup;\n   }\n'
if guard not in text:
    assert text.count(anchor) == 1
    egl.write_text(text.replace(anchor, guard))
changed = ["src/mesa/main/consts_exts.h", "src/mesa/main/extensions_table.h", "src/mesa/main/extensions.c", "src/egl/drivers/dri2/egl_dri2.c"]
# The original VirGL flag describes multisample *textures*. GLES 3.0 only
# needs multisample renderbuffers; keep texture/image queries disabled while
# admitting attachment-only queries against the real host format/sample mask.
name = "src/gallium/drivers/virgl/virgl_screen.c"
virgl = source / name
text = virgl.read_text()
anchor = "      if (!caps->v1.bset.texture_multisample)\n         return false;"
replacement = """      if (!caps->v1.bset.texture_multisample &&
          (target != PIPE_TEXTURE_2D ||
           !(bind & (PIPE_BIND_RENDER_TARGET | PIPE_BIND_DEPTH_STENCIL)) ||
           (bind & ~(PIPE_BIND_RENDER_TARGET | PIPE_BIND_DEPTH_STENCIL))))
         return false;"""
if replacement not in text:
    assert text.count(anchor) == 1
    virgl.write_text(text.replace(anchor, replacement))
original = args.output / "pristine" / name
if not original.exists():
    original.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.archive) as archive:
        original.write_bytes(archive.extractfile("mesa-26.2.2/" + name).read())
changed.append(name)
patch = b""
for name in changed:
    result = subprocess.run(["diff", "-u", "--label", "a/" + name, "--label", "b/" + name, str(args.output / "pristine" / name), str(source / name)], capture_output=True)
    assert result.returncode == 1
    patch += result.stdout
(args.output / "profile.patch").write_bytes(patch)

sysroot = args.sysroot.resolve()
libraries = sysroot / "usr/lib"
for name in ("lib", "lib64"):
    target = sysroot / name
    if not target.exists():
        target.symlink_to("usr/lib")
flags = ["--sysroot=" + str(sysroot), "-B" + str(libraries)]
cross = args.output / "riscv.ini"
cross.write_text("""[binaries]
c = 'riscv64-linux-gnu-gcc'
cpp = 'riscv64-linux-gnu-g++'
ar = 'riscv64-linux-gnu-ar'
strip = 'riscv64-linux-gnu-strip'
pkg-config = 'pkg-config'
[host_machine]
system = 'linux'
cpu_family = 'riscv64'
cpu = 'rv64gc'
endian = 'little'
[properties]
needs_exe_wrapper = true
sys_root = '""" + str(sysroot) + "'\n[built-in options]\nc_args = " + repr(flags) + "\ncpp_args = " + repr(flags) + "\nc_link_args = " + repr(flags + ["-Wl,-rpath-link," + str(libraries)]) + "\ncpp_link_args = " + repr(flags + ["-Wl,-rpath-link," + str(libraries)]) + "\n")
cross.write_text(cross.read_text().replace("[built-in options]", "pkg_config_libdir = " + repr([str(libraries / "pkgconfig")]) + "\n[built-in options]"))
env = {k: v for k, v in os.environ.items() if not k.startswith("PKG_CONFIG_")}
build = args.output / "build"
meson = "/capture/mesa-build-tools/bin/meson"
command = [meson, "setup", str(build), str(source), "--cross-file", str(cross), "--prefix=/usr", "--libdir=lib", "--buildtype=release",
           "-Dgallium-drivers=virgl", "-Dvulkan-drivers=[]", "-Dplatforms=wayland", "-Dopengl=true", "-Dgles1=disabled", "-Dgles2=enabled",
           "-Dglx=disabled", "-Degl=enabled", "-Dgbm=enabled", "-Dllvm=disabled", "-Dvideo-codecs=[]", "-Dgallium-va=disabled",
           "-Dgallium-rusticl=false", "-Dbuild-tests=false"]
if not (build / "meson-private/coredata.dat").exists():
    subprocess.run(command, env=env, check=True)
subprocess.run(["ninja", "-C", str(build), "-j12"], env=env, check=True)
stage = args.output / "stage"
subprocess.run([meson, "install", "-C", str(build), "--destdir", str(stage), "--no-rebuild"], env=env, check=True)
files = {}
for entry in sorted((stage / "usr/lib").rglob("*")):
    relative = str(entry.relative_to(stage))
    if entry.is_symlink():
        files[relative] = {"symlink": os.readlink(entry)}
    elif entry.is_file():
        files[relative] = {"sha256": hashlib.sha256(entry.read_bytes()).hexdigest(), "bytes": entry.stat().st_size}
receipt = {"archiveSha512": expected, "patchSha256": hashlib.sha256((args.output / "profile.patch").read_bytes()).hexdigest(), "configure": command,
           "compiler": subprocess.check_output(["riscv64-linux-gnu-gcc", "--version"], text=True).splitlines()[0], "profile": "virgl-gles3-only-overridable-border", "files": files}
(args.output / "build.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
