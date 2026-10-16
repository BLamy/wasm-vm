#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN textured-scene'
pacman -Q > '/hostcapture/verifier-textured-scene/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '/hostcapture/verifier-textured-scene/guest-libraries.sha256'
dmesg > '/hostcapture/verifier-textured-scene/guest-dmesg.txt'
cat /proc/cmdline > '/hostcapture/verifier-textured-scene/guest-cmdline.txt'
timeout -k 3s 30s /hostcapture/workloads/bin/virgl-textured-scene /dev/dri/renderD128 > '/hostcapture/verifier-textured-scene/workload.log' 2>&1
result=$?
cat '/hostcapture/verifier-textured-scene/workload.log'
echo "$result" > '/hostcapture/verifier-textured-scene/guest-exit-code.txt'
echo "VIRGL_CORPUS_END textured-scene status=$result"
sync
/sbin/poweroff -f
