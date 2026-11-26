#!/usr/bin/env python3
"""E5-T37a round-5 verifier — the incremental premise, checked my own way.

Question: between the head round 4 examined (cc7dfef69) and the head under test, is every change
under crates/ confined to test code?  Three independent checks, none of which prints (or needs me
to read) the changed test text:

 1. blob identity: for each changed file, `git rev-parse <rev>:<path>` at both ends; for files
    that are not wholly test modules, the BYTES before the test module's opening line must be
    identical (not "comment-insensitive": identical), and the test module must run to the end
    of the file (its closing brace is the last non-blank line and the brace depth never returns
    to zero in between), so that "after the cut" really is "inside mod tests".
 2. hunk positions: every hunk of `git diff -U0` must start, on both sides, after the line that
    opens the test module.
 3. the module gate: a file that is test code as a whole must be declared in lib.rs under a
    `#[cfg(...)]` that requires `test`, at both commits, and nothing else may `include!` or
    `#[path]` it.

Also prints what else changed outside crates/ (only names), so the reader sees whether any
build input of the crate (Cargo.toml, Cargo.lock, build.rs, rust-toolchain, .cargo/) moved.

  python3 evidence/e5-t37a/verifier-r5/premise.py cc7dfef69 61c4fcb44
"""
import re
import subprocess
import sys

OLD, NEW = sys.argv[1], sys.argv[2]
CUT = "#[cfg(test)]\nmod tests {"


def git(*args, text=True):
    return subprocess.run(["git", *args], capture_output=True, text=text, check=True).stdout


def brace_depth_ok(tail):
    """True if `tail` (starting at `mod tests {`) is one brace-balanced item reaching EOF.

    Comments, strings and char literals are skipped so braces inside them do not count.
    """
    i, n, depth, opened = 0, len(tail), 0, False
    while i < n:
        c = tail[i]
        if tail.startswith("//", i):
            j = tail.find("\n", i)
            i = n if j < 0 else j
            continue
        if tail.startswith("/*", i):
            d, i = 1, i + 2
            while i < n and d:
                if tail.startswith("/*", i):
                    d += 1
                    i += 2
                elif tail.startswith("*/", i):
                    d -= 1
                    i += 2
                else:
                    i += 1
            continue
        m = re.match(r'r(#*)"', tail[i:])
        if m and not (tail[i - 1].isalnum() or tail[i - 1] == "_"):
            end = tail.find('"' + m.group(1), i + len(m.group(0)))
            i = end + 1 + len(m.group(1))
            continue
        if c == '"':
            j = i + 1
            while tail[j] != '"':
                j += 2 if tail[j] == "\\" else 1
            i = j + 1
            continue
        if c == "'":
            m = re.match(r"'(\\.[^']*|[^'\\])'", tail[i:])
            if m:
                i += len(m.group(0))
                continue
        if c == "{":
            depth += 1
            opened = True
        elif c == "}":
            depth -= 1
            if opened and depth == 0:
                return tail[i + 1:].strip() == ""
        i += 1
    return False


bad = 0
changed = git("diff", "--name-only", OLD, NEW, "--", "crates").split()
print(f"files under crates/ that differ {OLD}..{NEW}: {len(changed)}")
print(git("diff", "--numstat", OLD, NEW, "--", "crates"), end="")

for path in changed:
    print(f"\n{path}")
    print(f"  blob {git('rev-parse', f'{OLD}:{path}').strip()[:12]} -> "
          f"{git('rev-parse', f'{NEW}:{path}').strip()[:12]}")
    stem = path.rsplit("/", 1)[-1][:-3]
    whole_test = True
    for rev in (OLD, NEW):
        lib = git("show", f"{rev}:crates/core/src/lib.rs")
        gate = re.search(r"#\[cfg\((test|all\(test,[^\n]*)\)\]\nmod " + re.escape(stem) + ";", lib)
        decls = re.findall(r"^\s*(?:pub(?:\([a-z]+\))?\s+)?mod " + re.escape(stem) + r"\s*;", lib, re.M)
        if gate and len(decls) == 1:
            print(f"  {rev}: declared once in lib.rs, under `{gate.group(0).splitlines()[0]}`")
        else:
            whole_test = False
    # anything else pulling the file in by path?
    # Anything else pulling the file in by path?  Only lines that can do that count: an
    # `include!`, a `#[path = …]`, or a Cargo manifest.  (The file naming itself in its own
    # `//!` header is not a reference; my first version of this check tripped on that.)
    raw = subprocess.run(["git", "grep", "-n", "-e", stem + r"\.rs", NEW, "--", "crates", "*.toml"],
                         capture_output=True, text=True).stdout.splitlines()  # exit 1 = no match
    others = "; ".join(l for l in raw
                       if "include!" in l or "#[path" in l or ".toml:" in l)
    print(f"  lines naming `{stem}.rs` at {NEW}: {len(raw)}, of which include!/#[path]/Cargo: "
          f"{len([l for l in raw if 'include!' in l or '#[path' in l or '.toml:' in l])}")
    print(f"  other references to `{stem}.rs` at {NEW} (include!/#[path]/Cargo): "
          f"{others if others else 'none'}")
    if whole_test and not others:
        print("  => the whole file is a test-only module: any change in it is test code")
        continue
    a, b = git("show", f"{OLD}:{path}"), git("show", f"{NEW}:{path}")
    ca, cb = a.find(CUT), b.find(CUT)
    if ca < 0 or cb < 0:
        print("  NO TEST MODULE — every change here is machine code")
        bad = 1
        continue
    head_same = a[:ca] == b[:cb]
    line_cut_a, line_cut_b = a[:ca].count("\n") + 1, b[:cb].count("\n") + 1
    print(f"  `#[cfg(test)] mod tests {{` opens at line {line_cut_a} -> {line_cut_b}; "
          f"bytes before it {ca} -> {cb}: {'BYTE-IDENTICAL' if head_same else 'DIFFER'}")
    ra, rb = brace_depth_ok(a[ca + len("#[cfg(test)]\n"):]), brace_depth_ok(b[cb + len("#[cfg(test)]\n"):])
    print(f"  the test module is one balanced item that ends the file: {ra} -> {rb}")
    hunks = re.findall(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@",
                       git("diff", "-U0", OLD, NEW, "--", path), re.M)
    inside = all(int(h[0]) >= line_cut_a and int(h[2]) > line_cut_b for h in hunks)
    for h in hunks:
        print(f"    hunk old {h[0]},{h[1] or 1}  new {h[2]},{h[3] or 1}")
    print(f"  every hunk starts after the test module's opening line: {inside}")
    if not (head_same and ra and rb and inside):
        bad = 1

print("\nbuild inputs of the crate that differ (must be none):")
inputs = git("diff", "--name-only", OLD, NEW, "--", "Cargo.toml", "Cargo.lock", "rust-toolchain",
             "rust-toolchain.toml", ".cargo", "crates/*/Cargo.toml", "crates/*/build.rs").split()
print("  " + (", ".join(inputs) if inputs else "none"))
bad |= bool(inputs)

print("\neverything that differs outside crates/ and evidence/ (names only):")
for l in git("diff", "--name-only", OLD, NEW, "--", ".", ":!crates", ":!evidence").split():
    print("  " + l)
print("\nshipped wasm (web/dist/**/*.wasm) blobs that differ:")
w = [l for l in git("diff", "--name-only", OLD, NEW, "--", "web").split() if l.endswith(".wasm")]
print("  " + (", ".join(w) if w else "none"))

print("\nPREMISE HOLDS" if not bad else "\nPREMISE FAILS")
sys.exit(bad)
