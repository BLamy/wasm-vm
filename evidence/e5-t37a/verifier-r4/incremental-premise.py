#!/usr/bin/env python3
"""E5-T37a round-4 verifier — the incremental premise, checked mechanically.

For every file under crates/ that differs between the head round 3 verified (7fd2e0160; the
crates at 7d25929a7 are identical) and the head under test, print whether the file is test
code, and for the others compare the NON-TEST, NON-COMMENT text: the file cut at its
`#[cfg(test)]\nmod tests {`, with every line whose first non-blank characters are `//` removed.
An empty comparison means nothing the machine executes changed. Run from the repo root:

  python3 evidence/e5-t37a/verifier-r4/incremental-premise.py 7fd2e0160 b815d68ca
"""
import re
import subprocess
import sys

OLD, NEW = sys.argv[1], sys.argv[2]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def machine_text(rev, path):
    src = git("show", f"{rev}:{path}")
    cut = src.find("#[cfg(test)]\nmod tests {")
    body = src if cut < 0 else src[:cut]
    return [l for l in body.splitlines() if not l.lstrip().startswith("//")], cut >= 0


changed = git("diff", "--name-only", OLD, NEW, "--", "crates").split()
print(f"files under crates/ that differ {OLD}..{NEW}: {len(changed)}")
bad = 0
for path in changed:
    lib = git("show", f"{NEW}:crates/core/src/lib.rs")
    stem = path.rsplit("/", 1)[-1][:-3]
    # A module file is test code when its `mod <stem>;` line in lib.rs sits directly under a
    # `#[cfg(...)]` whose condition requires `test` (`test` or `all(test, …)`).
    gate = re.search(r"#\[cfg\((test|all\(test,[^\n]*)\)\]\nmod " + re.escape(stem) + ";", lib)
    if gate:
        print(f"  {path}: test code — `{gate.group(0).splitlines()[0]}` on its `mod {stem};`")
        continue
    a, _ = machine_text(OLD, path)
    b, has_tests = machine_text(NEW, path)
    same = a == b
    bad += not same
    print(f"  {path}: non-test non-comment lines {len(a)} -> {len(b)}: "
          f"{'IDENTICAL' if same else 'DIFFER'} (test module cut: {has_tests})")
    if not same:
        import difflib
        sys.stdout.writelines(l + "\n" for l in difflib.unified_diff(a, b, lineterm="", n=1))
print("numstat:")
print(git("diff", "--numstat", OLD, NEW, "--", "crates"), end="")
print("PREMISE HOLDS" if not bad else "PREMISE FAILS")
sys.exit(1 if bad else 0)
