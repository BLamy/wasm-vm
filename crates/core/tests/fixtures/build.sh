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

# genuine/i386.elf — real class32+machine=3 ELF for class-vs-machine error precision
# (E0-T10 re-verification residual gap). Rebuild:
#   docker run --rm -v "$PWD:/w" alpine sh -c 'apk add clang lld && \
#     clang -target i386-unknown-elf -m32 -c -o /w/i386.o /w/genuine/i386.s && \
#     ld.lld -m elf_i386 -e _start -o /w/genuine/i386.elf /w/i386.o'
