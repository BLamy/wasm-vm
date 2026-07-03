#!/usr/bin/env python3
"""Normalize a Spike ``-l --log-commits`` log into the E0-T16 canonical trace grammar
(E0-T20). Pure function of the log text: stdin -> stdout, diagnostics -> stderr.

Spike emits, per retired instruction, a *fetch* line (with disassembly, no privilege
field) and a *commit* line (privilege field + pc + insn + optional ``x{rd} val`` +
optional ``mem addr [val]``). We keep ONLY the commit lines and re-emit them in the exact
canonical grammar the CLI ``--trace`` produces:

    core 0: 0x{pc:016x} (0x{insn:08x})[ x{rd} 0x{val:016x}][ mem 0x{addr:016x}[ 0x{sval}]]

Two Spike quirks are owned explicitly:
  (a) Spike runs a boot-ROM reset sequence at 0x1000 before jumping to the ELF entry.
      Output starts at the FIRST commit whose pc == --entry; the number of trimmed
      boot-ROM commits is printed to stderr so it can never hide early divergence. If
      --entry never appears, this exits non-zero (a hard error, never a silent empty
      diff).
  (b) The disassembly text is discarded — only pc, raw insn bits, and rd/mem writebacks
      survive. Values pass through byte-for-byte (a corrupted rd value must still diverge).
"""
import argparse
import re
import sys

# Commit line: "core   0: 3 0x{pc} (0x{insn}){tail}". The privilege digit after the colon
# is what distinguishes a commit line from a fetch/disassembly line ("core 0: 0x{pc} ...").
COMMIT = re.compile(r"^core\s+\d+:\s+\d+\s+0x([0-9a-fA-F]+)\s+\(0x([0-9a-fA-F]+)\)(.*)$")


def canonical(pc: int, insn: int, tail: str) -> str:
    """Rebuild one commit line in canonical grammar from Spike's writeback tail."""
    out = f"core 0: 0x{pc:016x} (0x{insn:08x})"
    toks = tail.split()
    i = 0
    # Optional register writeback: "x{n} 0x{val}". x0 is never emitted by Spike (matches
    # our x0-omit rule). The value is passed through verbatim (16 hex, same as ours).
    if i < len(toks) and re.fullmatch(r"x\d+", toks[i]):
        out += f" {toks[i]} {toks[i + 1]}"
        i += 2
    # Optional memory op: "mem 0x{addr}" (load) or "mem 0x{addr} 0x{sval}" (store, value
    # already width-masked by Spike exactly as our canonical form masks it).
    if i < len(toks) and toks[i] == "mem":
        out += f" mem {toks[i + 1]}"
        i += 2
        if i < len(toks) and toks[i].startswith("0x"):
            out += f" {toks[i]}"
            i += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Normalize a Spike --log-commits log.")
    ap.add_argument(
        "--entry",
        required=True,
        help="ELF entry pc (hex, e.g. 0x80000000): trim Spike boot-ROM up to here.",
    )
    args = ap.parse_args()
    entry = int(args.entry, 16)

    started = False
    trimmed = 0
    emitted = 0
    for line in sys.stdin:
        m = COMMIT.match(line)
        if not m:
            continue  # fetch/disassembly/marker lines carry no writeback — drop them
        pc = int(m.group(1), 16)
        if not started:
            if pc != entry:
                trimmed += 1
                continue
            started = True
        insn = int(m.group(2), 16)
        print(canonical(pc, insn, m.group(3)))
        emitted += 1

    if not started:
        print(
            f"normalize_spike: entry pc {entry:#018x} never appears in Spike's log — "
            f"refusing to emit a possibly-misanchored trace (saw {trimmed} commit lines)",
            file=sys.stderr,
        )
        return 3
    print(
        f"normalize_spike: trimmed {trimmed} boot-ROM commit line(s) before entry "
        f"{entry:#018x}; emitted {emitted} canonical line(s)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
