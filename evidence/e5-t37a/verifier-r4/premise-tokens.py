#!/usr/bin/env python3
"""E5-T37a round-4 verifier, second session — the incremental premise, a second way.

incremental-premise.py (first session) drops whole comment LINES. This one strips every
comment (line, trailing, nested block) outside string and char literals from the NON-TEST
part of each changed file (cut at its `#[cfg(test)]\nmod tests {`) at both commits and compares
the whitespace-separated token streams. Identical streams = nothing the machine compiles
outside test code changed. Run from the repo root:

  python3 evidence/e5-t37a/verifier-r4/premise-tokens.py 7fd2e0160 b815d68ca
"""
import subprocess, sys, re
OLD, NEW = sys.argv[1], sys.argv[2]
def git(*a): return subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout
def strip(src):
    # remove comments while respecting string/char literals (good enough for these files:
    # raw strings are handled; lifetimes are not mistaken for chars because we only skip
    # a quote-delimited char literal when it closes within 4 chars or is an escape).
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            j = src.find("\n", i); j = n if j < 0 else j; i = j; continue
        if src.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if src.startswith("/*", i): depth += 1; i += 2
                elif src.startswith("*/", i): depth -= 1; i += 2
                else: i += 1
            continue
        m = re.match(r'r(#*)"', src[i:])
        if m and (i == 0 or not (src[i-1].isalnum() or src[i-1] == '_')):
            end = src.find('"' + m.group(1), i + len(m.group(0)))
            out.append(src[i:end + 1 + len(m.group(1))]); i = end + 1 + len(m.group(1)); continue
        if c == '"':
            j = i + 1
            while src[j] != '"':
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1]); i = j + 1; continue
        if c == "'":
            m = re.match(r"'(\\.[^']*|[^'\\])'", src[i:])
            if m: out.append(m.group(0)); i += len(m.group(0)); continue
        out.append(c); i += 1
    return "".join(out).split()
bad = 0
for path in git("diff", "--name-only", OLD, NEW, "--", "crates").split():
    a, b = git("show", f"{OLD}:{path}"), git("show", f"{NEW}:{path}")
    cut = "#[cfg(test)]\nmod tests {"
    ca, cb = a.find(cut), b.find(cut)
    ta, tb = strip(a if ca < 0 else a[:ca]), strip(b if cb < 0 else b[:cb])
    print(f"{path}: test-module cut at byte {ca} -> {cb}; non-test tokens {len(ta)} -> {len(tb)}: {'IDENTICAL' if ta == tb else 'DIFFER'}")
    if path.endswith("turbo_equivalence_tests.rs"):
        print("   (whole file is a #[cfg(all(test, ...))] module; a difference here is test code)")
    elif ta != tb: bad = 1
sys.exit(bad)
