#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN textured-scene'
pacman -Q > '/hostcapture/negative-final/blob-limit/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '/hostcapture/negative-final/blob-limit/guest-libraries.sha256'
dmesg > '/hostcapture/negative-final/blob-limit/guest-dmesg.txt'
cat /proc/cmdline > '/hostcapture/negative-final/blob-limit/guest-cmdline.txt'
timeout -k 3s 30s /hostcapture/workloads/bin/virgl-textured-scene /dev/dri/renderD128 > '/hostcapture/negative-final/blob-limit/workload.log' 2>&1
result=$?
cat '/hostcapture/negative-final/blob-limit/workload.log'
echo "$result" > '/hostcapture/negative-final/blob-limit/guest-exit-code.txt'
echo "VIRGL_CORPUS_END textured-scene status=$result"
sync
/sbin/poweroff -f
