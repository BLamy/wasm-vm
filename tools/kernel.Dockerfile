# E2-T12: reproducible riscv64 kernel-build environment. Debian stable + the distro cross
# toolchain — the HOST toolchain never matters. Apt packages are unpinned-but-documented
# (docs/kernel.md); the kernel tarball itself is pinned by sha256 in build-kernel.sh.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-riscv64-linux-gnu \
    gcc g++ perl \
    make flex bison bc libssl-dev libelf-dev \
    xz-utils ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

# Reproducibility: neutralize build-time identity (timestamps pinned in build-kernel.sh).
ENV KBUILD_BUILD_USER=wasmvm \
    KBUILD_BUILD_HOST=wasmvm \
    ARCH=riscv \
    CROSS_COMPILE=riscv64-linux-gnu-

WORKDIR /build
