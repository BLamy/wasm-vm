#!/usr/bin/env python3
"""Check sensitivity using an isolated copy of only the critic's test sources."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
scratch = Path(tempfile.mkdtemp(prefix="e5.5-t03w-wrong-golden-"))
support = ROOT / "tests/support/jit_fp_arithmetic_verifier.rs"
wrapper = ROOT / "crates/jit-runtime/tests/fp_arithmetic_verifier.rs"
original = support.read_text()
mutated, count = re.subn(
    r'BOX \| 0x3f80_0000,(\s*"CRITIC_FADD_HALF_ULP_GOLDEN")',
    r'BOX | 0x3f80_0001,\1',
    original,
)
assert count == 1
(scratch / "proof.rs").write_text(mutated)
(scratch / "verifier.rs").write_text(
    wrapper.read_text().replace(
        '#[path = "../../../tests/support/jit_fp_arithmetic_verifier.rs"]',
        '#[path = "proof.rs"]',
    )
)
(scratch / "Cargo.toml").write_text(f'''[workspace]
[package]
name = "wasm-vm-arithmetic-critic-sabotage"
version = "0.0.0"
edition = "2024"
[dependencies]
wasm-vm-core = {{ path = "{ROOT}/crates/core", default-features = false, features = ["std"] }}
jit_runtime = {{ package = "wasm-vm-jit-runtime", path = "{ROOT}/crates/jit-runtime" }}
jit_translate = {{ package = "wasm-vm-jit-translate", path = "{ROOT}/crates/jit-translate" }}
wasmtime = {{ version = "35", default-features = false, features = ["cranelift", "runtime"] }}
wasmparser = "0.235"
[[test]]
name = "fp_arithmetic_verifier"
path = "verifier.rs"
''')
shutil.copyfile(ROOT / "Cargo.lock", scratch / "Cargo.lock")
command = ["cargo", "test", "--offline", "--manifest-path", str(scratch / "Cargo.toml"),
           "--test", "fp_arithmetic_verifier", "verifier_native_literal_arithmetic_goldens",
           "--", "--exact", "--nocapture"]
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools",
           CARGO_TARGET_DIR=str(ROOT / "target"))
report = {"scratch": str(scratch), "command": command, "expected_changed_only":
          "FADD.S(+1,+2^-24), RNE result changed from 0x3f800000 to 0x3f800001",
          "original_sha256": hashlib.sha256(original.encode()).hexdigest(),
          "mutated_sha256": hashlib.sha256(mutated.encode()).hexdigest(), "runs": []}
for label, contents, expected in [("wrong", mutated, 101), ("restored", original, 0)]:
    (scratch / "proof.rs").write_text(contents)
    start = time.monotonic()
    with (OUT / f"wrong-golden-{label}.log").open("w") as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    report["runs"].append({"case": label, "exit_code": result.returncode,
                           "expected_exit_code": expected, "seconds": time.monotonic() - start})
    (OUT / "wrong-golden-result.json").write_text(json.dumps(report, indent=2) + "\n")
    assert result.returncode == expected, report
assert "CRITIC_FADD_HALF_ULP_GOLDEN" in (OUT / "wrong-golden-wrong.log").read_text()
assert support.read_text() == original, "shared test must remain unchanged"
report["shared_test_unchanged"] = True
(OUT / "wrong-golden-result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
