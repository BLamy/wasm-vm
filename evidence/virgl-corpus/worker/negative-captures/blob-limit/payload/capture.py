#!/usr/bin/env python3
"""Run one real RISC-V guest workload on the disposable Linux reference host.

Run inside the prepared container. Output and guest tools reside below /capture;
the source ext4 and kernel mounts must be read-only. No host binfmt is required.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import shutil
import signal
import socket
import subprocess
import time


def digest(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return {"sha256": h.hexdigest(), "bytes": path.stat().st_size}


def run(args):
    output = Path(args.output).resolve()
    relative = output.relative_to("/capture")
    output.mkdir(parents=True, exist_ok=False)
    source = Path(args.source_image)
    # Refuse writable source mounts. Resolve the longest enclosing Linux mount.
    mounts = []
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split()
        mount = Path(fields[4].replace("\\040", " "))
        if source == mount or mount in source.parents:
            mounts.append((len(str(mount)), fields[5].split(",")))
    if not mounts or "ro" not in max(mounts)[1]:
        raise RuntimeError("source image must be a read-only mount")

    overlay = output / "overlay.qcow2"
    subprocess.run(["qemu-img", "create", "-f", "qcow2", "-F", "raw", "-b", str(source), str(overlay)], check=True, stdout=subprocess.DEVNULL)
    guest_output = "/hostcapture/" + str(relative)
    guest_script = output / "guest.sh"
    common = f"""#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN {args.workload}'
pacman -Q > '{guest_output}/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '{guest_output}/guest-libraries.sha256'
dmesg > '{guest_output}/guest-dmesg.txt'
cat /proc/cmdline > '{guest_output}/guest-cmdline.txt'
"""
    if args.workload in ("compositor", "glmark2-es2"):
        common += f"""mkdir -p /run/user/0
chmod 700 /run/user/0
export XDG_RUNTIME_DIR=/run/user/0 LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES=/dev/dri/card0
SEATD_VTBOUND=0 seatd -g root > '{guest_output}/seatd.log' 2>&1 &
cat > /tmp/corpus-hyprland.conf <<'CONF'
monitor = Virtual-1,1024x768@60,0x0,1
animations {{
 enabled = false
}}
misc {{
 disable_hyprland_logo = true
 disable_splash_rendering = true
}}
debug {{
 disable_logs = false
}}
CONF
Hyprland --i-am-really-stupid --config /tmp/corpus-hyprland.conf > '{guest_output}/hyprland.stdout.log' 2>&1 &
hypr_pid=$!
found=0
for attempt in $(seq 1 100); do
 if grep -q 'Renderer: virgl' /run/user/0/hypr/*/hyprland.log 2>/dev/null; then found=1; break; fi
 sleep 0.1
done
instance=$(basename /run/user/0/hypr/*)
ipc_ready=0
for attempt in $(seq 1 100); do
 if test -S "/run/user/0/hypr/$instance/.socket.sock" && hyprctl -i "$instance" monitors -j > '{guest_output}/monitors.json' 2>/dev/null; then ipc_ready=1; break; fi
 sleep 0.1
done
for socket_path in /run/user/0/wayland-*; do
 if test -S "$socket_path"; then export WAYLAND_DISPLAY=$(basename "$socket_path"); break; fi
done
stop_compositor() {{
 instance=$(basename /run/user/0/hypr/*)
 timeout -k 1s 3s hyprctl -i "$instance" dispatch exit > '{guest_output}/hyprctl-exit.log' 2>&1
 hyprctl_result=$?
 wait "$hypr_pid"
 hypr_result=$?
 cat /run/user/0/hypr/*/hyprland.log > '{guest_output}/hyprland.log'
 test "$found" = 1 && test "$ipc_ready" = 1 && test "$hyprctl_result" = 0 && test "$hypr_result" = 0
}}
"""
    if args.workload == "textured-scene":
        command = "timeout -k 3s 30s " + shlex.quote(args.textured_binary) + " /dev/dri/renderD128"
    elif args.workload == "kmscube":
        command = "timeout -k 3s 30s /hostcapture/workloads/bin/kmscube --device=/dev/dri/card0 --mode=rgba --count=8 --nonblocking"
    elif args.workload == "glmark2-es2":
        command = "timeout -k 3s 30s /hostcapture/workloads/usr/bin/glmark2-es2-wayland --data-path /hostcapture/workloads/usr/share/glmark2 --size 800x600 --off-screen --frame-end finish --validate -b texture:texture-filter=nearest"
    else:
        command = "sleep 1; test \"$found\" = 1"
    teardown = ""
    if args.workload in ("compositor", "glmark2-es2"):
        teardown = "stop_compositor || result=1\n"
    script = common + f"""{command} > '{guest_output}/workload.log' 2>&1
result=$?
{teardown}cat '{guest_output}/workload.log'
echo "$result" > '{guest_output}/guest-exit-code.txt'
echo "VIRGL_CORPUS_END {args.workload} status=$result"
sync
/sbin/poweroff -f
"""
    guest_script.write_text(script)
    serial_path = output / "serial.sock"
    argv = ["qemu-system-riscv64", "-machine", "virt", "-accel", "tcg", "-cpu", "rv64", "-smp", "4", "-m", "2048", "-global", "virtio-mmio.force-legacy=false", "-bios", "default", "-kernel", args.kernel, "-append", "root=/dev/vda rw console=ttyS0 init=/bin/bash", "-drive", f"file={overlay},format=qcow2,if=none,id=root", "-device", "virtio-blk-device,drive=root", "-device", "virtio-gpu-gl-device", "-device", "virtio-keyboard-device", "-device", "virtio-tablet-device", "-fsdev", "local,id=capture,path=/capture,security_model=none", "-device", "virtio-9p-device,fsdev=capture,mount_tag=capture", "-display", "gtk,gl=on,show-cursor=on", "-serial", f"unix:{serial_path},server=on,wait=on", "-monitor", "none", "-no-reboot"]
    env_override = {"DISPLAY": args.display, "LIBGL_ALWAYS_SOFTWARE": "1", "GALLIUM_DRIVER": "llvmpipe", "LD_LIBRARY_PATH": args.renderer_build + "/src", "LD_PRELOAD": args.recorder, "VIRGL_CAPTURE_REAL_LIBRARY": args.renderer_build + "/src/libvirglrenderer.so.1", "VIRGL_CAPTURE_DIR": str(output), "VIRGL_CAPTURE_WORKLOAD": args.workload, "VIRGL_CAPTURE_MAX_EVENTS": str(args.max_events), "VIRGL_CAPTURE_MAX_BLOB_BYTES": str(args.max_blob_bytes), "VIRGL_CAPTURE_MAX_EVENT_BYTES": str(args.max_event_bytes)}
    env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "LANG": "C.UTF-8", "MESA_SHADER_CACHE_DISABLE": "true"}
    env.update(env_override)
    (output / "command.json").write_text(json.dumps({"argv": argv, "env": env, "guestScript": "guest.sh"}, indent=2) + "\n")
    inputs = []
    for role, filename in [("rootfs", args.source_image), ("kernel", args.kernel), ("hostRenderer", args.renderer_build + "/src/libvirglrenderer.so.1.11.0"), ("recorder", args.recorder), ("qemu", shutil.which("qemu-system-riscv64")), ("qemuGpuModule", "/usr/lib/aarch64-linux-gnu/qemu/hw-display-virtio-gpu-gl.so")]:
        inputs.append({"role": role, "sourcePath": filename, **digest(filename)})
    versions = {"host": {"virglrenderer": "1.3.0", "virglCommit": "ca50e008863837e094747a69974dde3ae148aeaa", "architecture": os.uname().machine, "renderer": "llvmpipe"}, "guest": {"mesa": "1:26.2.2-1", "hyprland": "0.56.2-3", "architecture": "riscv64"}}
    payload = output / "payload"
    payload.mkdir()
    shutil.copy2(args.recorder, payload / "recorder.so")
    shutil.copy2(__file__, payload / "capture.py")
    recorder_source = Path(args.recorder).parent / "recorder-source"
    for name in ("recorder.c", "recorder.build.sh"):
        shutil.copy2(recorder_source / name, payload / name)
    shutil.copy2("/capture/workloads/build-manifest.json", payload / "workloads-build-manifest.json")
    textured_host = "/capture/" + str(Path(args.textured_binary).relative_to("/hostcapture"))
    binaries = {"textured-scene": textured_host, "kmscube": "/capture/workloads/bin/kmscube", "glmark2-es2": "/capture/workloads/usr/bin/glmark2-es2-wayland"}
    if args.workload in binaries:
        shutil.copy2(binaries[args.workload], payload / Path(binaries[args.workload]).name)
    mutable_before = {str(p): digest(p) for p in [Path(item["sourcePath"]) for item in inputs if item["role"] not in ("rootfs", "kernel")] + [Path(__file__), recorder_source / "recorder.c", recorder_source / "recorder.build.sh", Path("/capture/workloads/build-manifest.json")] + ([Path(binaries[args.workload])] if args.workload in binaries else [])}
    host_log = (output / "host.log").open("wb")
    serial_log = (output / "guest-serial.log").open("wb")
    process = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=host_log, stderr=host_log)
    deadline = time.monotonic() + args.timeout
    connected = None
    setup_sent = False
    transcript = bytearray()
    error = None
    selector = selectors.DefaultSelector()
    try:
        while process.poll() is None:
            if time.monotonic() >= deadline:
                raise RuntimeError("reference workload timed out")
            if (output / "FAILED").exists():
                raise RuntimeError("recorder failed: " + (output / "FAILED").read_text().strip())
            if host_log.tell() > args.max_log_bytes or serial_log.tell() > args.max_log_bytes:
                raise RuntimeError("reference log size limit exceeded")
            if connected is None and serial_path.exists():
                connected = socket.socket(socket.AF_UNIX)
                connected.connect(str(serial_path))
                connected.setblocking(False)
                selector.register(connected, selectors.EVENT_READ)
            for key, _ in selector.select(0.05):
                data = key.fileobj.recv(65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                serial_log.write(data)
                serial_log.flush()
                transcript.extend(data)
                if len(transcript) > 131072:
                    del transcript[:-131072]
                if not setup_sent and b"[root@" in transcript and b"# " in transcript:
                    command = "mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t devtmpfs devtmpfs /dev; mkdir -p /dev/shm /hostcapture; mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /dev/shm; mount -t 9p -o trans=virtio,version=9p2000.L capture /hostcapture; bash " + guest_output + "/guest.sh\n"
                    connected.sendall(command.encode())
                    setup_sent = True
                maps = Path(f"/proc/{process.pid}/maps")
                if maps.exists():
                    selected = [line for line in maps.read_text().splitlines() if "libvirglrenderer" in line or "recorder.so" in line or "hw-display-virtio-gpu-gl.so" in line]
                    if selected:
                        (output / "host-library-maps.txt").write_text("\n".join(selected) + "\n")
        process.wait(timeout=3)
    except Exception as exc:
        error = str(exc)
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    finally:
        selector.close()
        if connected:
            connected.close()
        host_log.close()
        serial_log.close()
        serial_path.unlink(missing_ok=True)
    exit_file = output / "guest-exit-code.txt"
    guest_exit = int(exit_file.read_text().strip()) if exit_file.exists() else None
    if (output / "FAILED").exists():
        error = "recorder failed: " + (output / "FAILED").read_text().strip()
    serial_text = (output / "guest-serial.log").read_text(errors="replace")
    serial_lines = serial_text.replace("\r", "").splitlines()
    guest_begin = f"VIRGL_CORPUS_BEGIN {args.workload}" in serial_lines
    guest_end = f"VIRGL_CORPUS_END {args.workload} status=0" in serial_lines
    workload_text = (output / "workload.log").read_text(errors="replace") if (output / "workload.log").exists() else ""
    if args.workload == "compositor":
        workload_text += (output / "hyprland.log").read_text(errors="replace") if (output / "hyprland.log").exists() else ""
    markers = {"textured-scene": "TEXTURED_SCENE_END status=pass draws=3 checked_pixels=768", "kmscube": "Rendered 7 frames", "glmark2-es2": "Validation: Success", "compositor": "Renderer: virgl"}
    workload_pass = markers[args.workload] in workload_text and "virgl (" in workload_text
    complete = error is None and process.returncode == 0 and guest_exit == 0 and guest_begin and guest_end and workload_pass
    footer = None
    events_path = output / "events.jsonl"
    if events_path.exists():
        try:
            footer = json.loads(events_path.read_text().splitlines()[-1])
        except (ValueError, IndexError):
            pass
    complete = complete and footer is not None and footer.get("type") == "end" and footer.get("complete") is True
    # This image is a disposable execution artifact, not part of the corpus.
    overlay.unlink()
    host_versions = subprocess.run(["dpkg-query", "-W", "qemu-system-misc", "qemu-system-gui", "libgl1-mesa-dri", "xvfb", "libssl-dev"], text=True, capture_output=True, check=True).stdout
    (output / "host-packages.txt").write_text(host_versions)
    for filename, before in mutable_before.items():
        if digest(filename) != before:
            error = "mutable capture input changed during execution: " + filename
            complete = False
    artifacts = [{"role": p.name, "path": str(p.relative_to(output)), **digest(p)} for p in sorted(output.rglob("*")) if p.is_file() and "blobs" not in p.relative_to(output).parts and p.name not in ("events.jsonl", "manifest.json")]
    manifest = {"schema": "wasm-vm-virgl-capture-v1", "workload": args.workload, "versions": versions, "events": {"path": "events.jsonl", **digest(events_path)} if events_path.exists() else None, "artifacts": artifacts, "inputs": inputs, "command": {"argv": argv, "env": env, "guestScript": "guest.sh"}, "limits": {"timeoutSeconds": args.timeout, "events": args.max_events, "blobBytes": args.max_blob_bytes, "eventBytes": args.max_event_bytes, "logBytes": args.max_log_bytes}, "result": {"qemuExitCode": process.returncode, "guestExitCode": guest_exit, "guestBegin": guest_begin, "guestEnd": guest_end, "workloadPass": workload_pass, "complete": bool(complete), "error": error}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(output), "result": manifest["result"]}), flush=True)
    return 0 if complete else 1


def positive_limit(value):
    if not value.isascii() or not value.isdecimal() or not 0 < int(value) <= 0xffffffff:
        raise argparse.ArgumentTypeError("limit must be unsigned decimal in 1..4294967295")
    return int(value)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workload", choices=["textured-scene", "kmscube", "glmark2-es2", "compositor"], required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--source-image", default="/reference/omarchy.ext4")
    p.add_argument("--kernel", default="/kernel/Image")
    p.add_argument("--recorder", default="/capture/recorder.so")
    p.add_argument("--renderer-build", default="/build-virgl-1.3.0")
    p.add_argument("--display", default=":1")
    p.add_argument("--textured-binary", default="/hostcapture/workloads/bin/virgl-textured-scene", help="explicit alternate scene binary for the negative sabotage check")
    p.add_argument("--timeout", type=positive_limit, default=120)
    p.add_argument("--max-events", type=positive_limit, default=100000)
    p.add_argument("--max-blob-bytes", type=positive_limit, default=512 * 1024 * 1024)
    p.add_argument("--max-event-bytes", type=positive_limit, default=64 * 1024 * 1024)
    p.add_argument("--max-log-bytes", type=positive_limit, default=8 * 1024 * 1024)
    raise SystemExit(run(p.parse_args()))
