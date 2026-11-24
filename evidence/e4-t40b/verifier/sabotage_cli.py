#!/usr/bin/env python3
"""Build a CLI binary with one sabotage applied (see sabotage.py), copy it out, restore."""
import subprocess, sys, shutil, importlib.util
repo, out = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location("sab", __file__.replace("sabotage_cli.py", "sabotage.py"))
src = open(spec.origin).read()
# Reuse the SAB table without running the harness body.
ns = {}
head = src[:src.index("names = sys.argv[2:]")]
sys_argv = sys.argv
sys.argv = ["sabotage.py", repo]
exec(head, ns)
sys.argv = sys_argv
for name in sys.argv[3:]:
    path, old, new = ns["SAB"][name]
    full = f"{repo}/{path}"
    s = open(full).read()
    assert s.count(old) == 1, name
    open(full, "w").write(s.replace(old, new))
    try:
        r = subprocess.run(["cargo", "build", "--release", "-p", "wasm-vm-cli"], cwd=repo, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr[-2000:]
        shutil.copy(f"{repo}/target/release/wasm-vm", f"{out}/wasm-vm-sab-{name}")
        print("built", name)
    finally:
        subprocess.run(["git", "checkout", "--", path], cwd=repo)
print(subprocess.run(["git", "diff", "--stat", "--", "crates/core/src/turbo.rs", "crates/core/src/hart/turbo.rs"], cwd=repo, capture_output=True, text=True).stdout or "restored: no diff")
