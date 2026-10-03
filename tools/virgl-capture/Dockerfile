FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# This is a native ARM64 Linux reference host. RISC-V runs under system TCG;
# no binfmt installation, privileged container, or host-global change is needed.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    qemu-system-misc=1:7.2+dfsg-7+deb12u18+b3 \
    qemu-system-gui=1:7.2+dfsg-7+deb12u18+b3 \
    qemu-utils=1:7.2+dfsg-7+deb12u18+b3 \
    libgl1-mesa-dri=22.3.6-1+deb12u2 xvfb=2:21.1.7-3+deb12u13 \
    xauth mesa-utils libegl1-mesa libepoxy-dev libgbm-dev libegl1-mesa-dev \
    libgl1-mesa-dev libdrm-dev libssl-dev meson ninja-build build-essential \
    pkg-config python3 python3-yaml opensbi git ca-certificates \
    gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu zstd e2fsprogs curl \
    && rm -rf /var/lib/apt/lists/*

RUN git init /virglrenderer-1.3.0 \
    && git -C /virglrenderer-1.3.0 remote add origin https://gitlab.freedesktop.org/virgl/virglrenderer.git \
    && git -C /virglrenderer-1.3.0 fetch --depth 1 origin ca50e008863837e094747a69974dde3ae148aeaa \
    && git -C /virglrenderer-1.3.0 checkout --detach FETCH_HEAD \
    && test "$(git -C /virglrenderer-1.3.0 rev-parse HEAD)" = ca50e008863837e094747a69974dde3ae148aeaa \
    && meson setup /build-virgl-1.3.0 /virglrenderer-1.3.0 \
       -Dplatforms=egl,glx -Dvenus=false -Dvideo=false -Dtests=false -Dbuildtype=debugoptimized \
    && ninja -C /build-virgl-1.3.0

COPY tools/virgl-capture /opt/virgl-capture
RUN mkdir -p /capture/recorder-source \
    && cp /opt/virgl-capture/recorder.c /opt/virgl-capture/recorder.build.sh /capture/recorder-source/ \
    && sh /capture/recorder-source/recorder.build.sh /virglrenderer-1.3.0 /capture/recorder.so /build-virgl-1.3.0 \
    && cp /opt/virgl-capture/capture.py /capture/capture.py
CMD ["sleep", "infinity"]
