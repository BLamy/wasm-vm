# E2-T18: pinned build environment for the Alpine riscv64 rootfs. Host-arch Alpine + the
# static apk cross-installer + e2fsprogs (mke2fs -d / fsck) + file (foreign-ELF scan). No
# riscv64 EXECUTION happens here: apk.static --arch riscv64 only UNPACKS packages into a
# root dir, so the build needs no binfmt/qemu-user and no privileges.
#
# Pinned by DIGEST (not the floating :3.20 tag) and each tool by EXACT version, so the builder
# — including its busybox, whose applet list we reuse — cannot drift (critic E2-T18 #3).
FROM alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

RUN apk add --no-cache \
      apk-tools-static=2.14.4-r1 \
      e2fsprogs=1.47.0-r5 \
      e2fsprogs-extra=1.47.0-r5 \
      file=5.45-r1 \
      bash

ENTRYPOINT ["/bin/bash"]
