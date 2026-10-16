#!/bin/bash
set -u
export PATH=/usr/bin:/bin
unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER LP_NUM_THREADS
export MESA_SHADER_CACHE_DISABLE=true
echo 'VIRGL_CORPUS_BEGIN kmscube'
pacman -Q > '/hostcapture/final-corpus/kmscube/guest-packages.txt'
sha256sum /usr/lib/libgallium-*.so /usr/bin/Hyprland /usr/lib/libEGL_mesa.so.0 /usr/lib/libdrm.so.2 > '/hostcapture/final-corpus/kmscube/guest-libraries.sha256'
dmesg > '/hostcapture/final-corpus/kmscube/guest-dmesg.txt'
cat /proc/cmdline > '/hostcapture/final-corpus/kmscube/guest-cmdline.txt'
timeout -k 3s 30s /hostcapture/workloads/bin/kmscube --device=/dev/dri/card0 --mode=rgba --count=8 --nonblocking > '/hostcapture/final-corpus/kmscube/workload.log' 2>&1
result=$?
cat '/hostcapture/final-corpus/kmscube/workload.log'
echo "$result" > '/hostcapture/final-corpus/kmscube/guest-exit-code.txt'
echo "VIRGL_CORPUS_END kmscube status=$result"
sync
/sbin/poweroff -f
