#!/usr/bin/env python3
"""Compare our canonical trace against a normalized Spike trace (E0-T20) and report the
first divergence with context. Our trace is authoritative on length: it ends when the
guest halts via HTIF, so every instruction WE retired must match Spike's corresponding
one (our trace must be a prefix of Spike's). Spike may run longer (it spins on the guest's
post-exit tail); those extra lines are irrelevant.

Levels:
  commit  full canonical line (pc + insn + rd writeback + mem) — the default, capstone bar
  pc      only "core 0: 0x{pc} (0x{insn})" — a coarser cross-check (QEMU's ceiling)

Exit 0 on match (prints the compared-line count), 1 on divergence (prints context), 2 on
a usage/precondition error. `cmp`-grade: exact string equality, never whitespace-fuzzy.
"""
import argparse
import sys

PC_PREFIX_LEN = len("core 0: 0x0000000000000000 (0x00000000)")


def load(path: str, level: str, max_n: int | None) -> list[str]:
    with open(path, encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f]
    if level == "pc":
        lines = [ln[:PC_PREFIX_LEN] for ln in lines]
    if max_n is not None:
        lines = lines[:max_n]
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ours")
    ap.add_argument("spike")
    ap.add_argument("--level", choices=("pc", "commit"), default="commit")
    ap.add_argument("--max", type=int, default=None)
    args = ap.parse_args()

    ours = load(args.ours, args.level, args.max)
    spike = load(args.spike, args.level, args.max)

    if not ours:
        print("report: our trace is empty — nothing to compare", file=sys.stderr)
        return 2

    for i, line in enumerate(ours):
        theirs = spike[i] if i < len(spike) else None
        if theirs == line:
            continue
        # Divergence at line i (0-based). Print context.
        print(
            f"DIVERGENCE at instruction {i + 1} (level={args.level})", file=sys.stderr
        )
        lo = max(0, i - 20)
        print(f"--- last {i - lo} matching line(s) ---", file=sys.stderr)
        for j in range(lo, i):
            print(f"  {ours[j]}", file=sys.stderr)
        print("--- ours   > | spike  < ---", file=sys.stderr)
        print(f"> {line}", file=sys.stderr)
        print(f"< {theirs if theirs is not None else '(Spike trace ended early)'}",
              file=sys.stderr)
        print("--- next 5 (ours) ---", file=sys.stderr)
        for j in range(i + 1, min(i + 6, len(ours))):
            print(f"  {ours[j]}", file=sys.stderr)
        print("--- next 5 (spike) ---", file=sys.stderr)
        for j in range(i + 1, min(i + 6, len(spike))):
            print(f"  {spike[j]}", file=sys.stderr)
        return 1

    print(f"MATCH: {len(ours)} instruction(s) compared at {args.level} level")
    return 0


if __name__ == "__main__":
    sys.exit(main())
