#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN es2gears'
pacman -Q > '/hostcapture/gears-capture-a669aad0/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '/hostcapture/gears-capture-a669aad0/guest-libraries.sha256'
dmesg > '/hostcapture/gears-capture-a669aad0/guest-dmesg.txt'
cat /proc/cmdline > '/hostcapture/gears-capture-a669aad0/guest-cmdline.txt'
udev_ready=0
mkdir -p /run/udev
if /usr/lib/systemd/systemd-udevd --daemon > '/hostcapture/gears-capture-a669aad0/udev.log' 2>&1 &&
   udevadm trigger --type=subsystems --action=add >> '/hostcapture/gears-capture-a669aad0/udev.log' 2>&1 &&
   udevadm trigger --type=devices --action=add >> '/hostcapture/gears-capture-a669aad0/udev.log' 2>&1 &&
   udevadm settle --timeout=10 >> '/hostcapture/gears-capture-a669aad0/udev.log' 2>&1; then udev_ready=1; fi
printf 'coldplug=%s\n' "$udev_ready" > '/hostcapture/gears-capture-a669aad0/input-setup.log'
for node in /dev/input/event*; do
 test -c "$node" || continue
 printf '%s\n' "$node" >> '/hostcapture/gears-capture-a669aad0/input-setup.log'
 udevadm info --query=property --name="$node" >> '/hostcapture/gears-capture-a669aad0/input-setup.log'
done
mkdir -p /run/user/0
chmod 700 /run/user/0
export XDG_RUNTIME_DIR=/run/user/0 LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES=/dev/dri/card0
SEATD_VTBOUND=0 seatd -g root > '/hostcapture/gears-capture-a669aad0/seatd.log' 2>&1 &
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
Hyprland --i-am-really-stupid --config /tmp/corpus-hyprland.conf > '/hostcapture/gears-capture-a669aad0/hyprland.stdout.log' 2>&1 &
hypr_pid=$!
found=0
for attempt in $(seq 1 100); do
 if grep -q 'Renderer: virgl' /run/user/0/hypr/*/hyprland.log 2>/dev/null; then found=1; break; fi
 sleep 0.1
done
instance=$(basename /run/user/0/hypr/*)
ipc_ready=0
for attempt in $(seq 1 100); do
 if test -S "/run/user/0/hypr/$instance/.socket.sock" && hyprctl -i "$instance" monitors -j > '/hostcapture/gears-capture-a669aad0/monitors.json' 2>/dev/null; then ipc_ready=1; break; fi
 sleep 0.1
done
for socket_path in /run/user/0/wayland-*; do
 if test -S "$socket_path"; then export WAYLAND_DISPLAY=$(basename "$socket_path"); break; fi
done
stop_compositor() {
 instance=$(basename /run/user/0/hypr/*)
 timeout -k 1s 3s hyprctl -i "$instance" dispatch exit > '/hostcapture/gears-capture-a669aad0/hyprctl-exit.log' 2>&1
 hyprctl_result=$?
 wait "$hypr_pid"
 hypr_result=$?
 cat /run/user/0/hypr/*/hyprland.log > '/hostcapture/gears-capture-a669aad0/hyprland.log'
 test "$found" = 1 && test "$ipc_ready" = 1 && test "$hyprctl_result" = 0 && test "$hypr_result" = 0
}

run_gears() {
 test "$udev_ready" = 1 || return 1
 stdbuf -oL -eL /hostcapture/gears-workload-a669aad0/bin/es2gears_wayland -info &
 gears_pid=$!
 ( sleep 45; kill -TERM "$gears_pid" 2>/dev/null ) &
 gears_watchdog=$!
 address=''
 rendered=0
 resized=0
 for attempt in $(seq 1 250); do
  if ! kill -0 "$gears_pid" 2>/dev/null; then break; fi
  hyprctl -i "$instance" clients -j > '/hostcapture/gears-capture-a669aad0/gears-clients.json' 2>/dev/null
  address=$(jq -er --argjson pid "$gears_pid" '[.[] | select(.pid == $pid and .title == "es2gears")][0].address' '/hostcapture/gears-capture-a669aad0/gears-clients.json' 2>/dev/null) || address=''
  if test -n "$address" && test "$resized" = 0; then
   if timeout -k 1s 3s hyprctl -i "$instance" dispatch setfloating "address:$address" > '/hostcapture/gears-capture-a669aad0/gears-window-setup.log' 2>&1 &&
      timeout -k 1s 3s hyprctl -i "$instance" dispatch resizewindowpixel "exact 300 300,address:$address" >> '/hostcapture/gears-capture-a669aad0/gears-window-setup.log' 2>&1; then resized=1; else break; fi
  fi
  if test -n "$address" && test "$resized" = 1 && grep -Eq '^[1-9][0-9]* frames in .* seconds = .* FPS$' '/hostcapture/gears-capture-a669aad0/workload.log'; then rendered=1; break; fi
  sleep 0.1
 done
 printf 'pid=%s\naddress=%s\nrendered=%s\nresized=%s\n' "$gears_pid" "$address" "$rendered" "$resized" > '/hostcapture/gears-capture-a669aad0/gears-control.log'
 client_identity=1
 readlink -f "/proc/$gears_pid/exe" > '/hostcapture/gears-capture-a669aad0/gears-executable.txt' || client_identity=0
 sha256sum "/proc/$gears_pid/exe" > '/hostcapture/gears-capture-a669aad0/gears-executable.sha256' || client_identity=0
 cat "/proc/$gears_pid/maps" > '/hostcapture/gears-capture-a669aad0/gears-library-maps.txt' || client_identity=0
 awk '/\/usr\/lib\/.*\.so/ {print $NF}' '/hostcapture/gears-capture-a669aad0/gears-library-maps.txt' | sort -u | xargs -r sha256sum > '/hostcapture/gears-capture-a669aad0/gears-library-hashes.txt' || client_identity=0
 cat "/proc/$gears_pid/comm" > '/hostcapture/gears-capture-a669aad0/gears-comm.txt' || client_identity=0
 cat "/proc/$gears_pid/environ" > '/hostcapture/gears-capture-a669aad0/gears-environ.bin' || client_identity=0
 : > '/hostcapture/gears-capture-a669aad0/gears-drm-driver.txt'
 for driver in /sys/class/drm/renderD128/device/virtio*/driver; do
  test -L "$driver" && readlink -f "$driver" >> '/hostcapture/gears-capture-a669aad0/gears-drm-driver.txt'
 done
 grep -qx '/sys/bus/virtio/drivers/virtio_gpu' '/hostcapture/gears-capture-a669aad0/gears-drm-driver.txt' || client_identity=0
 : > '/hostcapture/gears-capture-a669aad0/gears-fds.txt'
 for descriptor in "/proc/$gears_pid/fd/"*; do
  printf '%s ' "$descriptor" >> '/hostcapture/gears-capture-a669aad0/gears-fds.txt'
  readlink "$descriptor" >> '/hostcapture/gears-capture-a669aad0/gears-fds.txt'
  cat "/proc/$gears_pid/fdinfo/${descriptor##*/}" >> '/hostcapture/gears-capture-a669aad0/gears-fds.txt'
 done 2> '/hostcapture/gears-capture-a669aad0/gears-process-read-errors.log'
 close_result=1
 if test "$rendered" = 1 && test "$client_identity" = 1; then
  timeout -k 1s 3s hyprctl -i "$instance" dispatch closewindow "address:$address" > '/hostcapture/gears-capture-a669aad0/gears-close.log' 2>&1
  close_result=$?
 else
  kill -TERM "$gears_pid" 2>/dev/null || true
 fi
 wait "$gears_pid"
 gears_result=$?
 kill "$gears_watchdog" 2>/dev/null || true
 wait "$gears_watchdog" 2>/dev/null || true
 printf 'window-close=%s\nclient-exit=%s\nidentity=%s\n' "$close_result" "$gears_result" "$client_identity" >> '/hostcapture/gears-capture-a669aad0/gears-control.log'
 test "$rendered" = 1 && test "$client_identity" = 1 && test "$close_result" = 0 && test "$gears_result" = 0
}
run_gears > '/hostcapture/gears-capture-a669aad0/workload.log' 2>&1
result=$?
stop_compositor || result=1
cat '/hostcapture/gears-capture-a669aad0/workload.log'
echo "$result" > '/hostcapture/gears-capture-a669aad0/guest-exit-code.txt'
echo "VIRGL_CORPUS_END es2gears status=$result"
sync
/sbin/poweroff -f
