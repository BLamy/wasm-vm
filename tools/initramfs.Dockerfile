# E2-T13: reproducible static riscv64 busybox build environment. Same Debian + cross
# toolchain family as the kernel (tools/kernel.Dockerfile); the host toolchain never matters.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-riscv64-linux-gnu libc6-dev-riscv64-cross \
    gcc libc6-dev make bzip2 xz-utils ca-certificates curl \
    cpio gzip findutils \
    && rm -rf /var/lib/apt/lists/*

ENV ARCH=riscv \
    CROSS_COMPILE=riscv64-linux-gnu-

WORKDIR /build
