#!/usr/bin/env python3
"""Assemble the bounded RV64 session-block DMA browser fixture without a cross toolchain."""
from pathlib import Path
import hashlib
import json
import struct

root = Path(__file__).resolve().parents[2]
words = []
listing = []
B = 0x80000000


def emit(word, comment):
    words.append(word & 0xffffffff)
    listing.append(f"{B + (len(words) - 1) * 4:08x} {word & 0xffffffff:08x}  {comment}")


def addi(rd, rs, value):
    emit((value & 4095) << 20 | rs << 15 | rd << 7 | 0x13, f"addi x{rd},x{rs},{value}")


def li(rd, value):
    value &= 0xffffffff
    high = ((value + 0x800) >> 12) & 0xfffff
    low = ((value - (high << 12) + 2048) & 4095) - 2048
    emit(high << 12 | rd << 7 | 0x37, f"lui x{rd},0x{high:x}")
    addi(rd, rd, low)
    emit(32 << 20 | rd << 15 | 1 << 12 | rd << 7 | 0x13, f"slli x{rd},x{rd},32")
    emit(32 << 20 | rd << 15 | 5 << 12 | rd << 7 | 0x13, f"srli x{rd},x{rd},32")


def load(rd, base, offset, width):
    emit((offset & 4095) << 20 | base << 15 | width << 12 | rd << 7 | 3,
         f"load{width} x{rd},{offset}(x{base})")


def store(rs, base, offset, width):
    emit(((offset & 4095) >> 5) << 25 | rs << 20 | base << 15 | width << 12
         | (offset & 31) << 7 | 0x23, f"store{width} x{rs},{offset}(x{base})")


def write(base, offset, value, width=2):
    li(5, value)
    store(5, base, offset, width)


def memory(address, fields):
    li(10, address)
    for offset, value, width in fields:
        write(10, offset, value, width)


def descriptor(table, index, address, length, flags, next_index=0):
    memory(table + index * 16, [(0, address, 2), (4, 0, 2), (8, length, 2),
                                (12, flags, 1), (14, next_index, 1)])


def bne(rs1, rs2, delta):
    assert delta % 2 == 0 and -4096 <= delta < 4096
    bits = delta & 8191
    emit(((bits >> 12) & 1) << 31 | ((bits >> 5) & 63) << 25 | rs2 << 20
         | rs1 << 15 | 1 << 12 | ((bits >> 1) & 15) << 8
         | ((bits >> 11) & 1) << 7 | 0x63, f"bne x{rs1},x{rs2},{delta}")


def wait_used(index, used):
    li(10, used + 2)
    li(7, index)
    loop = len(words)
    load(6, 10, 0, 5)  # lhu used.idx
    bne(6, 7, (loop - len(words)) * 4)


slot = 0x10001000
desc = B + 0x10000
avail = B + 0x11000
used = B + 0x12000
header = B + 0x13000
status = B + 0x14000
report = B + 0x15000
data = B + 0x300000
readback = B + 0x500000
length = 1179648
sector = 20000

li(3, slot)
for offset, value in [(0x70, 1), (0x70, 3), (0x24, 0), (0x20, 0),
                      (0x24, 1), (0x20, 1), (0x70, 11), (0x30, 0),
                      (0x38, 8), (0x80, desc), (0x84, 0), (0x90, avail),
                      (0x94, 0), (0xa0, used), (0xa4, 0), (0x44, 1),
                      (0x70, 15)]:
    write(3, offset, value)

memory(header, [(0, 1, 2), (4, 0, 2), (8, sector, 3)])
descriptor(desc, 0, header, 16, 1, 1)
descriptor(desc, 1, data, length // 2, 1, 2)
descriptor(desc, 2, data + length // 2, length // 2, 1, 3)
descriptor(desc, 3, status, 1, 2)
memory(avail, [(4, 0, 1), (2, 1, 1)])
li(3, slot)
write(3, 0x50, 0)
wait_used(1, used)
li(10, status)
load(6, 10, 0, 4)
li(11, report)
store(6, 11, 0, 2)

memory(header, [(0, 0, 2)])
descriptor(desc, 1, readback, length // 2, 3, 2)
descriptor(desc, 2, readback + length // 2, length // 2, 3, 3)
memory(avail, [(6, 0, 1), (2, 2, 1)])
li(3, slot)
write(3, 0x50, 0)
wait_used(2, used)
li(10, status)
load(6, 10, 0, 4)
li(11, report)
store(6, 11, 4, 2)
write(11, 8, 0xb10c)
emit(0x0000006f, "jal x0,0")

body = b"".join(struct.pack("<I", word) for word in words)
ident = b"\x7fELF" + bytes([2, 1, 1]) + bytes(9)
elf_header = ident + struct.pack("<HHIQQQIHHHHHH", 2, 243, 1, B, 64, 0, 0, 64, 56, 1, 0, 0, 0)
segment = struct.pack("<IIQQQQQQ", 1, 7, 120, B, B, len(body), len(body), 4)
assets = root / "web/assets"
(assets / "e9-block-transfer.elf").write_bytes(elf_header + segment + body)
metadata = {"version": 1, "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body), "reportAddress": str(report), "usedAddress": str(used + 2),
            "readbackAddress": str(readback), "length": length, "sector": sector,
            "scope": "RV64 guest posts split 1,179,648-byte virtio OUT and IN through the real session block adapter"}
(assets / "e9-block-transfer.json").write_text(json.dumps(metadata, indent=2) + "\n")
(root / "tools/verify/e9-block-transfer-guest.listing").write_text("\n".join(listing) + "\n")
print(json.dumps(metadata))
