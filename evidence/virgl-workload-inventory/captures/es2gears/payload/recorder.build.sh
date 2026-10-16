#!/bin/sh
set -eu
# Native Linux reference host only. Source/build paths are explicit scratch paths.
source_dir=${1:?pinned virglrenderer source directory required}
output=${2:?output shared library required}
build_dir=${3:?pinned virglrenderer build directory required}
cc -std=gnu11 -O2 -g -fPIC -shared -Wall -Wextra -Werror \
  -I "$source_dir/src" -I "$build_dir/src" "$(dirname "$0")/recorder.c" \
  -o "$output" -lcrypto -ldl -pthread
