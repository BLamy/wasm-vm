#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN glmark2-es2'
pacman -Q > '/hostcapture/final-corpus/glmark2-es2/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '/hostcapture/final-corpus/glmark2-es2/guest-libraries.sha256'
dmesg > '/hostcapture/final-corpus/glmark2-es2/guest-dmesg.txt'
cat /proc/cmdline > '/hostcapture/final-corpus/glmark2-es2/guest-cmdline.txt'
mkdir -p /run/user/0
chmod 700 /run/user/0
export XDG_RUNTIME_DIR=/run/user/0 LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES=/dev/dri/card0
SEATD_VTBOUND=0 seatd -g root > '/hostcapture/final-corpus/glmark2-es2/seatd.log' 2>&1 &
cat > /tmp/corpus-hyprland.conf <<'CONF'
monitor = Virtual-1,1024x768@60,0x0,1
animations {
 enabled = false
}
misc {
 disable_hyprland_logo = true
 disable_splash_rendering = true
}
debug {
 disable_logs = false
}
CONF
Hyprland --i-am-really-stupid --config /tmp/corpus-hyprland.conf > '/hostcapture/final-corpus/glmark2-es2/hyprland.stdout.log' 2>&1 &
hypr_pid=$!
found=0
for attempt in $(seq 1 100); do
 if grep -q 'Renderer: virgl' /run/user/0/hypr/*/hyprland.log 2>/dev/null; then found=1; break; fi
 sleep 0.1
done
instance=$(basename /run/user/0/hypr/*)
ipc_ready=0
for attempt in $(seq 1 100); do
 if test -S "/run/user/0/hypr/$instance/.socket.sock" && hyprctl -i "$instance" monitors -j > '/hostcapture/final-corpus/glmark2-es2/monitors.json' 2>/dev/null; then ipc_ready=1; break; fi
 sleep 0.1
done
for socket_path in /run/user/0/wayland-*; do
 if test -S "$socket_path"; then export WAYLAND_DISPLAY=$(basename "$socket_path"); break; fi
done
stop_compositor() {
 instance=$(basename /run/user/0/hypr/*)
 timeout -k 1s 3s hyprctl -i "$instance" dispatch exit > '/hostcapture/final-corpus/glmark2-es2/hyprctl-exit.log' 2>&1
 hyprctl_result=$?
 wait "$hypr_pid"
 hypr_result=$?
 cat /run/user/0/hypr/*/hyprland.log > '/hostcapture/final-corpus/glmark2-es2/hyprland.log'
 test "$found" = 1 && test "$ipc_ready" = 1 && test "$hyprctl_result" = 0 && test "$hypr_result" = 0
}
timeout -k 3s 30s /hostcapture/workloads/usr/bin/glmark2-es2-wayland --data-path /hostcapture/workloads/usr/share/glmark2 --size 800x600 --off-screen --frame-end finish --validate -b texture:texture-filter=nearest > '/hostcapture/final-corpus/glmark2-es2/workload.log' 2>&1
result=$?
stop_compositor || result=1
cat '/hostcapture/final-corpus/glmark2-es2/workload.log'
echo "$result" > '/hostcapture/final-corpus/glmark2-es2/guest-exit-code.txt'
echo "VIRGL_CORPUS_END glmark2-es2 status=$result"
sync
/sbin/poweroff -f
