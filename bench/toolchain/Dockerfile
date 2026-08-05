# E4-T03 benchmark toolchain: pinned riscv64-linux GLIBC static cross-gcc for building the
# CoreMark + Dhrystone guest ELFs reproducibly. All versions come from build args wired to
# versions.env — no `latest`/`master`/HEAD. Mirrors tools/toolchain/Dockerfile.
# syntax=docker/dockerfile:1

ARG UBUNTU_DIGEST
FROM ${UBUNTU_DIGEST}

ARG GCC_RISCV64_LINUX_VERSION
ARG LIBC6_DEV_RISCV64_VERSION

ENV DEBIAN_FRONTEND=noninteractive

# The riscv64-linux cross toolchain, VERSION-PINNED (=${...}). `gcc-13-riscv64-linux-gnu` is the
# concrete compiler (the unversioned metapackage merely depends on it); `libc6-dev-riscv64-cross`
# supplies the static glibc (crt*.o, libc.a) that `-static` links. `--no-install-recommends` keeps
# the image lean and the dependency set explicit. `make`/`coreutils` drive build.sh's compile loop.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "gcc-13-riscv64-linux-gnu=${GCC_RISCV64_LINUX_VERSION}" \
      "libc6-dev-riscv64-cross=${LIBC6_DEV_RISCV64_VERSION}" \
      make \
      coreutils \
      e2fsprogs \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-interactive default; build.sh overrides user/cwd.
WORKDIR /work
CMD ["/bin/bash"]
