#!/usr/bin/env python3
"""Normalize a QEMU ``-d exec,nochain -accel tcg,one-insn-per-tb=on`` log into a bare PC
sequence (E0-T20 secondary cross-check). QEMU's exec trace gives only the PC per executed
block — no instruction word, no register writeback — so this is a **pc-level-only** check,
strictly coarser than the Spike differential. It exists to catch control-flow divergence
from a second independent implementation.

Each QEMU line looks like:
    Trace 0: 0x... [<as>/<pc>/<flags>/<hash>]
We extract the second bracketed field (pc), trim QEMU's reset-ROM up to --entry (same
boot-trim contract as the Spike normalizer, with the trimmed count on stderr and a hard
error if entry never appears), and emit one ``0x{pc:016x}`` per line.
"""
import argparse
import re
import sys

TRACE = re.compile(r"\[[0-9a-fA-F]+/([0-9a-fA-F]+)/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entry", required=True, help="ELF entry pc (hex).")
    args = ap.parse_args()
    entry = int(args.entry, 16)

    started = False
    trimmed = 0
    emitted = 0
    for line in sys.stdin:
        m = TRACE.search(line)
        if not m:
            continue
        pc = int(m.group(1), 16)
        if not started:
            if pc != entry:
                trimmed += 1
                continue
            started = True
        print(f"0x{pc:016x}")
        emitted += 1

    if not started:
        print(
            f"normalize_qemu: entry pc {entry:#018x} never appears in QEMU's log "
            f"(saw {trimmed} trace lines)",
            file=sys.stderr,
        )
        return 3
    print(
        f"normalize_qemu: trimmed {trimmed} reset-ROM line(s); emitted {emitted} pc(s)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
