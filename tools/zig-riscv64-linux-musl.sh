#!/bin/sh
set -eu
exec zig cc -target riscv64-linux-musl "$@"
