#!/bin/sh
set -eu
# Host-side launcher. Mount arguments are absolute paths to immutable releases.
container=${VIRGL_REFERENCE_CONTAINER:-wasm-vm-virgl-reference}
image=${VIRGL_REFERENCE_IMAGE:-wasm-vm-virgl-reference:1.3.0}
case "${1:-}" in
  build)
    context_dir=$(mktemp -d)
    trap 'rm -rf "$context_dir"' EXIT HUP INT TERM
    mkdir -p "$context_dir/tools"
    cp -R tools/virgl-capture "$context_dir/tools/virgl-capture"
    docker build -f "$context_dir/tools/virgl-capture/Dockerfile" -t "$image" "$context_dir"
    ;;
  start)
    rootfs=${2:?absolute sanitized ext4 path required}
    kernel=${3:?absolute release kernel directory required}
    docker run --detach --name "$container" \
      --mount "type=bind,source=$rootfs,target=/reference/omarchy.ext4,readonly" \
      --mount "type=bind,source=$kernel,target=/kernel,readonly" \
      "$image"
    docker exec "$container" sh -c 'Xvfb :1 -screen 0 1280x800x24 -nolisten tcp >/capture/xvfb.log 2>&1 &'
    ;;
  capture)
    workload=${2:?workload required}
    output=${3:?new container output directory below /capture required}
    docker exec "$container" python3 /capture/capture.py --workload "$workload" --output "$output"
    ;;
  *)
    echo 'usage: reference.sh build | start ABS_ROOTFS ABS_KERNEL_DIR | capture WORKLOAD /capture/NEW_DIR' >&2
    exit 2
    ;;
esac
