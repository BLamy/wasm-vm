#!/usr/bin/env python3
"""E2-T14: map PCs to kernel symbols via a System.map.

Usage:
  tools/symbolize.py System.map 0xffffffff80001234           # one PC
  wasm-vm run ... --pc-histogram 20 2>&1 | tools/symbolize.py System.map -   # annotate a stream

Reads a System.map (`<hex> <type> <symbol>` lines), then for each hex address on the
command line (or embedded in stdin lines when the path is `-`) prints the nearest symbol at
or below it as `symbol+0xoffset`. Handles the modules-less kernel range; a PC below the
first symbol or in userspace prints `<unknown>` rather than crashing.
"""
import re
import sys
from bisect import bisect_right


def load_symbols(path):
    addrs, names = [], []
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 3:
                try:
                    addrs.append(int(parts[0], 16))
                except ValueError:
                    continue
                names.append(parts[2])
    order = sorted(range(len(addrs)), key=lambda i: addrs[i])
    return [addrs[i] for i in order], [names[i] for i in order]


def symbolize(addr, addrs, names):
    if not addrs or addr < addrs[0]:
        return "<unknown>"
    i = bisect_right(addrs, addr) - 1
    off = addr - addrs[i]
    return f"{names[i]}+{off:#x}" if off else names[i]


HEX = re.compile(r"0x[0-9a-fA-F]+")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    addrs, names = load_symbols(sys.argv[1])
    if sys.argv[2] == "-":
        for line in sys.stdin:
            def repl(m):
                return f"{m.group(0)} ({symbolize(int(m.group(0), 16), addrs, names)})"
            sys.stdout.write(HEX.sub(repl, line))
    else:
        for a in sys.argv[2:]:
            addr = int(a, 16)
            print(f"{addr:#018x}  {symbolize(addr, addrs, names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
