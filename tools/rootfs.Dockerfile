# E2-T18: pinned build environment for the Alpine riscv64 rootfs. Host-arch Alpine + the
# static apk cross-installer + e2fsprogs (mke2fs -d / fsck) + file (x86-ELF scan). No
# riscv64 EXECUTION happens here: apk.static --arch riscv64 only UNPACKS packages into a
# root dir, so the build needs no binfmt/qemu-user and no privileges.
FROM alpine:3.20

RUN apk add --no-cache \
      apk-tools-static \
      e2fsprogs \
      e2fsprogs-extra \
      file \
      bash

ENTRYPOINT ["/bin/bash"]
