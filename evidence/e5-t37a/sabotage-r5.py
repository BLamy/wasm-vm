#!/usr/bin/env python3
"""Mutation run for E5-T37a round 5: the 40 mutations of sabotage-r4.py plus the round-4
verifier's five (M1, M2, M3, MY1, MY2), each applied alone against the worker's `paced_idle`
tests, then restored. Run from the repo root:

  python3 evidence/e5-t37a/sabotage-r5.py            # all 45
  python3 evidence/e5-t37a/sabotage-r5.py M1 MY1     # by name prefix
"""
import os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LIB, TIME = 'crates/core/src/lib.rs', 'crates/core/src/time.rs'
# The round-4 list, read as data (its file runs its mutations at import).
r4 = open(os.path.join(HERE, 'sabotage-r4.py')).read()
ns = {}
exec(r4[r4.index('LIB, TIME ='):r4.index('only = sys.argv')], ns)
M = [(name, [(path, old, new)]) for name, path, old, new in ns['M']]
STIP = "level(5, c.mtime >= self.sbi_state.stimecmp);"
CAP = "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));"
M += [
 ("M1 (round-4 verifier) the owed-time cap judged before the jump (ceiling - limited -> ceiling - current)",
  [(TIME, "            .min(ceiling.saturating_sub(limited));", "            .min(ceiling.saturating_sub(current));")]),
 ("M2 (round-4 verifier) the S-timer level one tick early (mtime + 1 >= stimecmp)",
  [(LIB, STIP, "level(5, c.mtime.saturating_add(1) >= self.sbi_state.stimecmp);")]),
 ("M3 (round-4 verifier) the jump is taken from what was owed before this consultation's waiting time is added",
  [(TIME, "        } else {\n            self.owed_wait_ticks = self\n                .owed_wait_ticks\n"
          "                .saturating_add(ticks_of(self.latest_host_ns - before));\n        }\n",
          "        }\n        let waited_now = if worked {\n            0\n        } else {\n"
          "            ticks_of(self.latest_host_ns - before)\n        };\n"),
   (TIME, CAP, "            .saturating_sub(limited - current)\n            .saturating_add(waited_now)\n"
               "            .min(ceiling.saturating_sub(limited));")]),
 ("MY1 (round-4 verifier) the S-timer level only AT its deadline (>= -> ==)",
  [(LIB, STIP, "level(5, c.mtime == self.sbi_state.stimecmp);")]),
 ("MY2 (round-4 verifier) a guest that worked may skip max(owed, bound), not owed + bound",
  [(TIME, "            let bounded = current\n                .saturating_add(self.owed_wait_ticks)\n"
          "                .saturating_add(self.max_busy_lag_ticks);",
          "            let bounded = current\n"
          "                .saturating_add(self.owed_wait_ticks.max(self.max_busy_lag_ticks));")]),
]
only = sys.argv[1:]
killed = survived = 0
for name, edits in M:
    if only and not any(name.startswith(o) for o in only): continue
    paths = sorted({p for p, _, _ in edits})
    src = {p: open(p).read() for p in paths}
    out_src = dict(src)
    bad = [old for p, old, _ in edits if out_src[p].count(old) != 1]
    if bad:
        print(f"{name}: PATTERN not found exactly once — not applied"); continue
    for p, old, new in edits: out_src[p] = out_src[p].replace(old, new)
    for p in paths: shutil.copy(p, p + '.keep'); open(p, 'w').write(out_src[p])
    try:
        out = subprocess.run(['cargo', 'test', '-p', 'wasm-vm-core', '--lib', 'paced_idle'], capture_output=True, text=True)
        text = out.stdout + out.stderr
        failed = [l.split()[1].split('::')[-1] for l in text.splitlines() if l.startswith('test ') and l.rstrip().endswith('FAILED')]
        built = 'test result' in text
        if built and failed: killed += 1
        elif built: survived += 1
        print(f"{name}: " + ("DID NOT BUILD" if not built else (f"KILLED by {len(failed)}: " + ", ".join(failed) if failed else "SURVIVED")))
        if built and failed:
            m = re.search(r"panicked at ([^\n]+)\n([^\n]+)", text)
            if m: print(f"    first panic: {m.group(1).strip()} {m.group(2).strip()[:160]}")
    finally:
        for p in paths:
            shutil.move(p + '.keep', p)
            os.utime(p, None)  # cargo fingerprints by mtime: make the restore visible
    sys.stdout.flush()
print(f"TOTAL killed {killed}, survived {survived}")
