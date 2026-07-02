#!/bin/sh
# Provenance/rebuild script for crates/core/tests/fixtures/minimal.elf (E0-T10).
# Run from this directory; requires docker.
set -e
docker run --rm -v "$PWD:/w" alpine:latest sh -c '
  apk add --no-cache clang llvm lld >/dev/null 2>&1
  clang -target riscv64-unknown-elf -march=rv64i -mno-relax -nostdlib -static \
        -fuse-ld=lld -Wl,-T/w/link.ld -o /w/minimal.elf /w/minimal.s
  llvm-readelf -l -h /w/minimal.elf > /w/minimal.readelf.txt
  llvm-objdump -s /w/minimal.elf > /w/minimal.objdump.txt
  llvm-readelf -s /w/minimal.elf >> /w/minimal.readelf.txt
'
