# E0-T13 reference toolchain: pinned riscv64-unknown-elf-gcc, Spike, qemu-system-riscv64.
# All versions come from build args wired to versions.env — no `latest`/`master`/HEAD.
# syntax=docker/dockerfile:1

ARG UBUNTU_DIGEST
FROM ${UBUNTU_DIGEST}

ARG GCC_RISCV64_VERSION
ARG QEMU_SYSTEM_MISC_VERSION
ARG SPIKE_COMMIT

ENV DEBIAN_FRONTEND=noninteractive

# apt packages, VERSION-PINNED (=${...}). Spike build deps (device-tree-compiler,
# build-essential, git) plus the gcc cross toolchain and QEMU. `--no-install-recommends`
# keeps the image lean and the dependency set explicit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "gcc-riscv64-unknown-elf=${GCC_RISCV64_VERSION}" \
      "qemu-system-misc=${QEMU_SYSTEM_MISC_VERSION}" \
      build-essential \
      device-tree-compiler \
      git \
      ca-certificates \
      python3 \
 && rm -rf /var/lib/apt/lists/*

# Spike from the pinned commit — clone, hard-checkout the SHA (fail if it moved),
# configure + build + install to /opt/riscv, then drop the source tree.
RUN git clone https://github.com/riscv-software-src/riscv-isa-sim.git /tmp/spike \
 && cd /tmp/spike \
 && git checkout "${SPIKE_COMMIT}" \
 && git rev-parse HEAD | grep -qx "${SPIKE_COMMIT}" \
 && mkdir build && cd build \
 && ../configure --prefix=/opt/riscv \
 && make -j"$(nproc)" \
 && make install \
 && echo "${SPIKE_COMMIT}" > /opt/riscv/SPIKE_COMMIT \
 && rm -rf /tmp/spike

ENV PATH="/opt/riscv/bin:${PATH}"

# Non-interactive default; run.sh overrides user/cwd.
WORKDIR /work
CMD ["/bin/bash"]
