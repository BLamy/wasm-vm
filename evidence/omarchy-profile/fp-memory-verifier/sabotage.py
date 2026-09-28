#!/usr/bin/env python3
"""Prove one critic assertion rejects a wrong payload without editing runtime."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
runtime = [
    "crates/core/src/hart/mod.rs",
    "crates/jit-translate/src/lib.rs",
    "crates/wasm/src/jit_browser.rs",
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


before = {name: sha((repo / name).read_bytes()) for name in runtime}
scratch = Path(tempfile.mkdtemp(prefix="fp-memory-assertion-", dir="/private/tmp"))
(scratch / "src").mkdir()
original = (repo / "tests/support/jit_fp_memory_verifier.rs").read_text()
needle = '                boxed,\n                "VERIFIER_SEEDED_RAW_PAYLOAD"'
assert original.count(needle) == 1
changed = original.replace(
    needle, '                boxed ^ 1,\n                "VERIFIER_SEEDED_RAW_PAYLOAD"'
)
(scratch / "src/proof.rs").write_text(changed)
(out / "sabotaged-proof.rs").write_text(changed)
(scratch / "Cargo.toml").write_text(
    '[package]\nname = "fp-memory-verifier-assertion-check"\n'
    'version = "0.0.0"\nedition = "2024"\n'
    '[dependencies]\n'
    f'wasm-vm-core = {{ path = "{repo}/crates/core", default-features = false, features = ["std"] }}\n'
    f'wasm-vm-jit-runtime = {{ path = "{repo}/crates/jit-runtime" }}\n'
)
(scratch / "src/lib.rs").write_text(
    '#![allow(dead_code)]\nmod proof;\n'
    'fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {\n'
    '    Box::new(jit_runtime::WasmtimeExecutor::new())\n}\n'
    '#[test]\nfn critic_payload_bit_flip_is_detected() {\n'
    '    proof::seeded_raw_aliases(native, false);\n}\n'
)
shutil.copyfile(repo / "Cargo.lock", scratch / "Cargo.lock")
command = [
    "cargo", "test", "--offline", "--manifest-path", str(scratch / "Cargo.toml"),
    "--target-dir", str(repo / "target"), "--", "--nocapture",
]
env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools")
completed = subprocess.run(command, cwd=repo, env=env, capture_output=True, text=True)
log = completed.stdout + completed.stderr
(out / "sabotage.log").write_text(log)
after = {name: sha((repo / name).read_bytes()) for name in runtime}
result = {
    "command": command,
    "scratch": str(scratch),
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, env=env, text=True).strip(),
    "sourceSha256": sha(original.encode()),
    "sabotagedSourceSha256": sha(changed.encode()),
    "returncode": completed.returncode,
    "expectedAssertionObserved": "VERIFIER_SEEDED_RAW_PAYLOAD" in log,
    "failedTestObserved": "test result: FAILED" in log,
    "runtimeBefore": before,
    "runtimeAfter": after,
}
(out / "sabotage.json").write_text(json.dumps(result, indent=2) + "\n")
assert completed.returncode == 101, result
assert result["expectedAssertionObserved"] and result["failedTestObserved"], result
assert before == after, "runtime files changed during isolated assertion check"
print(json.dumps(result, indent=2))
