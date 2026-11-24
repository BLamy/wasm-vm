# E5-T34b: assembly tool image for the minimal Replay desktop rootfs.
# arm64 host userland; riscv64 packages are only downloaded and unpacked (dpkg-deb -x), never
# installed into this image. qemu-user is used solely for the optional pre-check that the staged
# binaries resolve their libraries (`qemu-riscv64 -L <stage>`), not as acceptance evidence.
FROM ubuntu:24.04
RUN dpkg --add-architecture riscv64 \
 && sed -i 's#^URIs: .*#URIs: http://ports.ubuntu.com/ubuntu-ports/#' /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates e2fsprogs python3 xz-utils gzip qemu-user binutils-riscv64-linux-gnu file \
 && rm -rf /var/cache/apt/archives/*.deb
