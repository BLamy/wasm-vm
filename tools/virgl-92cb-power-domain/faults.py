#!/usr/bin/env python3
"""Mutate one authenticated original geometry word for negative native/Wasm probes."""
from pathlib import Path
import struct
import sys


def main(source, destination, fault):
    binary = bytearray(source.read_bytes())
    if len(binary) != 2040:
        raise ValueError('expected complete original geometry')
    changes = {
        'geometry': (8 + 6 * 4, 0x3f000000),
        'bank': (136 + 24 * 4, 0x40400000),
        'negative': (136 + 16 * 4, 0xbf800000),
        'nonfinite': (136 + 16 * 4, 0x7fc00000),
        'zero-crossing': (72 + 8 * 4, 0xbe9b8000),
    }
    if fault not in changes:
        raise ValueError('unknown original geometry fault')
    offset, value = changes[fault]
    struct.pack_into('<I', binary, offset, value)
    destination.write_bytes(binary)


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
