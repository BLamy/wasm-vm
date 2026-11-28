#!/usr/bin/env python3
"""E4-T40g verifier sabotage variants, applied to a scratch worktree (argv[1]) only.
  S1: drop the successor-memo touch in Machine::enter_block (restores the E4-T40f gap)
  S2: eviction scan never clears the bit (replace(false) -> get())
"""
import sys, pathlib
root = pathlib.Path(sys.argv[1]); which = sys.argv[2]
lib = root / "crates/core/src/lib.rs"; disp = root / "crates/core/src/dispatch.rs"
def sub(p, a, b):
    s = p.read_text(); assert s.count(a) == 1, (p, a); p.write_text(s.replace(a, b))
if which == "S1":
    sub(lib, "            block.touch();\n        }\n        let discover", "            let _ = block;\n        }\n        let discover")
elif which == "S2":
    sub(disp, ".is_some_and(|b| b.referenced.replace(false))", ".is_some_and(|b| b.referenced.get())")
else:
    raise SystemExit("unknown")
print("applied", which)
