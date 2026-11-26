#!/usr/bin/env bash
# E5-T37a round-3 verifier — COVERAGE with hit counts instead of inference.
#
# Builds the core test binary with source-based coverage in its own target directory, runs the
# WORKER's tests only (`cargo test -p wasm-vm-core --lib paced_idle`, 24 tests), and lists every
# line the task added to non-test code (git diff -U0 ee5582ac6 7fd2e0160) with the number of times
# those tests executed it. Lines llvm-cov attaches no count to (comments, attributes, signatures,
# struct fields) are not code regions and are left out.
#
#   bash evidence/e5-t37a/verifier-r3/coverage.sh > evidence/e5-t37a/verifier-r3/coverage.log
set -euo pipefail
cd "$(dirname "$0")/../../.."
T=target/verifier-r3-cov
TOOLS=$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/^host: //p')/bin
rm -rf "$T/prof"
RUSTFLAGS="-C instrument-coverage" CARGO_TARGET_DIR=$T LLVM_PROFILE_FILE="$PWD/$T/prof/%p-%m.profraw" \
  cargo test -p wasm-vm-core --lib paced_idle 2>&1 | grep -E "test result|^error" >&2
"$TOOLS/llvm-profdata" merge -sparse "$T"/prof/*.profraw -o "$T/paced.profdata"
BIN=$(find "$T/debug/deps" -maxdepth 1 -type f -perm +111 -name 'wasm_vm_core-*' | head -1)
echo "# worker's 24 tests, head $(git rev-parse --short HEAD); line: hits: source"
for f in crates/core/src/lib.rs crates/core/src/time.rs crates/core/src/csr.rs; do
  "$TOOLS/llvm-cov" show "$BIN" -instr-profile="$T/paced.profdata" "$PWD/$f" > "$T/cov.txt"
  python3 - "$f" "$T/cov.txt" <<'EOF'
import re, subprocess, sys
path, cov = sys.argv[1], sys.argv[2]
diff = subprocess.run(["git", "diff", "-U0", "ee5582ac6", "7fd2e0160", "--", path],
                      capture_output=True, text=True, check=True).stdout
added, line = set(), 0
for l in diff.splitlines():
    m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", l)
    if m:
        line = int(m.group(1))
        continue
    if l.startswith("+") and not l.startswith("+++"):
        added.add(line)
        line += 1
src = open(path).read().splitlines()
# time.rs: the unit tests live in the same file, from `mod tests` on.
limit = next((i + 1 for i, s in enumerate(src) if s.startswith("mod tests")), len(src) + 1)
counts = {}
for l in open(cov):
    m = re.match(r"\s*(\d+)\|\s*([0-9.]+[kKMG]?)?\|(.*)", l)
    if m and m.group(2) is not None:
        counts[int(m.group(1))] = m.group(2)
code = sorted(n for n in added if n < limit and n in counts)
zero = [n for n in code if counts[n] == "0"]
print(f"## {path}: {len([n for n in added if n < limit])} added non-test lines, "
      f"{len(code)} with a code region, {len(zero)} never executed")
for n in code:
    mark = "  NEVER" if counts[n] == "0" else ""
    print(f"{n:6}: {counts[n]:>7}: {src[n - 1].strip()[:110]}{mark}")
EOF
done
