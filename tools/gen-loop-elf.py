#!/usr/bin/env python3
# Perf microbenchmark generator: a bare-metal RV64 ELF that runs a tight infinite ALU loop
# (5 register ALU ops + a backward jal) linked at the guest RAM base 0x8000_0000. NO toolchain
# needed — the machine code + a minimal ELF64 header are emitted directly.
#
#   python3 tools/gen-loop-elf.py /tmp/loop64.elf
#   /usr/bin/time -p target/release/wasm-vm run /tmp/loop64.elf --max-instrs 2000000000
#   # host wall-clock / instrs = host M-instr/s  (PURE interpreter dispatch: no boot, no idle,
#   # no device-sync — the clean way to measure/profile compute-path interpreter speed)
#
# WHY THIS EXISTS: CoreMark's iterations/sec is a GUEST-deterministic metric (guest mtime =
# retired-instrs/clock_div) — BLIND to host interpreter speed. bench.py's timing_check.ratio is
# host-side but boot-inclusive and device-sync-heavy. This isolates pure dispatch. Baseline on an
# M-series Mac (2026-08): ~13 M-instr/s — dominated by per-instruction re-fetch/translate/pmp_ok/
# decode (`hart::execute` is ~1%). The E4-T05 predecode block cache made it SLOWER here (9 M/s).
import struct, sys

BASE = 0x8000_0000

def jal(rd, off):  # off = target - pc, even, 21-bit signed
    o = off & 0x1F_FFFF
    return ((((o >> 20) & 1) << 31) | (((o >> 1) & 0x3FF) << 21) | (((o >> 11) & 1) << 20)
            | (((o >> 12) & 0xFF) << 12) | (rd << 7) | 0x6F)

def main(out):
    alu = [
        0x0012_8293,                                    # addi t0,t0,1
        (5 << 20) | (6 << 15) | (0 << 12) | (6 << 7) | 0x33,   # add  t1,t1,t0
        (5 << 20) | (7 << 15) | (4 << 12) | (7 << 7) | 0x33,   # xor  t2,t2,t0
        (1 << 20) | (28 << 15) | (1 << 12) | (28 << 7) | 0x13, # slli t3,t3,1
        (7 << 20) | (10 << 15) | (0 << 12) | (10 << 7) | 0x33, # add  a0,a0,t2
    ]
    instrs = alu + [jal(0, -4 * len(alu))]              # loop back to BASE
    code = b''.join(struct.pack('<I', i) for i in instrs)
    EH, PH = 64, 56
    ehdr = (b'\x7fELF' + bytes([2, 1, 1, 0]) + b'\x00' * 8
            + struct.pack('<HHIQQQIHHHHHH', 2, 0xF3, 1, BASE, EH, 0, 0, EH, PH, 1, 0, 0, 0))
    phdr = struct.pack('<IIQQQQQQ', 1, 5, EH + PH, BASE, BASE, len(code), len(code), 0x1000)
    open(out, 'wb').write(ehdr + phdr + code)
    print(f"wrote {out} ({len(ehdr + phdr + code)} bytes): 5 ALU + jal, infinite loop at {BASE:#x}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'loop64.elf')
