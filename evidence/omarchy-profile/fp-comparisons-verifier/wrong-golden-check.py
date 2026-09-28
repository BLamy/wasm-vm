#!/usr/bin/env python3
"""Run only the critic's literal golden test, wrong then restored, in a temp crate."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
support = repo / "tests/support/jit_fp_comparisons_verifier.rs"
wrapper = repo / "crates/jit-runtime/tests/fp_comparisons_verifier.rs"
original = support.read_text()
needle = 'assert_eq!(m.hart().regs.read(31), 1, "CRITIC_FEQ_SIGNED_ZERO_GOLDEN");'
assert original.count(needle) == 1
mutant = original.replace(needle, needle.replace('read(31), 1,', 'read(31), 0,'))
with tempfile.TemporaryDirectory(prefix="fp-comparison-critic-") as temporary:
    scratch = Path(temporary)
    (scratch / "src").mkdir()
    (scratch / "Cargo.toml").write_text('''[package]
name = "fp-comparison-critic-sabotage"
version = "0.0.0"
edition = "2024"

[dependencies]
wasm-vm-core = { path = "''' + str(repo / "crates/core") + '''", default-features = false, features = ["std"] }
wasm-vm-jit-runtime = { path = "''' + str(repo / "crates/jit-runtime") + '''" }
''')
    shutil.copyfile(repo / "Cargo.lock", scratch / "Cargo.lock")
    (scratch / "src/lib.rs").write_text(wrapper.read_text().replace(
        '../../../tests/support/jit_fp_comparisons_verifier.rs', 'proof.rs'))
    env = dict(os.environ, CARGO_TARGET_DIR=str(repo / "target"), CARGO_TERM_COLOR="never")
    command = ["cargo", "test", "--offline", "--manifest-path", str(scratch / "Cargo.toml"),
               "verifier_native_literal_comparison_goldens", "--", "--nocapture"]
    runs = []
    for name, source in [("wrong", mutant), ("restored", original)]:
        (scratch / "src/proof.rs").write_text(source)
        result = subprocess.run(command, env=env, cwd=repo, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = out / f"wrong-golden-{name}.log"
        log.write_text("COMMAND: " + " ".join(command) + "\n" + result.stdout)
        print(result.stdout[-4000:])
        runs.append({"phase": name, "returncode": result.returncode,
                     "support_sha256": hashlib.sha256(source.encode()).hexdigest(),
                     "log": str(log.relative_to(repo))})
        if name == "wrong":
            assert result.returncode != 0 and 'CRITIC_FEQ_SIGNED_ZERO_GOLDEN' in result.stdout
            assert 'left: 1' in result.stdout and 'right: 0' in result.stdout
        else:
            assert result.returncode == 0 and '1 passed; 0 failed' in result.stdout
    (out / "wrong-golden-result.json").write_text(json.dumps({
        "mutation": "Only isolated critic expected FEQ(+0,-0) changed from 1 to 0; implementation untouched",
        "runtime_sha256": {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in [repo / "crates/core/src/jit.rs", repo / "crates/jit-translate/src/lib.rs"]},
        "runs": runs, "passed": True,
    }, indent=2) + "\n")
