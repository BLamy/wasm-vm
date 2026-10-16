#!/usr/bin/env python3
"""Sabotage only temporary copies of the register module, never product files."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
product = root / "crates/core/src/hart/regs.rs"
original = product.read_bytes()
sha = lambda data: hashlib.sha256(data).hexdigest()
body = original.decode()
needle = "if mask & (1_u32 << register) != 0 {"
assert body.count(needle) == 1
mutant = body.replace(needle, "if mask & 0x7fff_ffff & (1_u32 << register) != 0 {")
report = {"productSha256Before": sha(original), "runs": []}
dependencies = root / "target/debug/deps"
proptest = max(dependencies.glob("libproptest-*.rlib"), key=lambda p: p.stat().st_mtime)
for name, source, should_pass in [("control", body, True), ("drop-bit31", mutant, False)]:
    (out / ("sabotage-" + name + ".rs.txt")).write_text(source)
    with tempfile.TemporaryDirectory(prefix="handoff-critic-sabotage-") as temp:
        scratch = Path(temp)
        (scratch / "regs.rs").write_text(source)
        (scratch / "wrapper.rs").write_text('extern crate alloc;\n#[path="regs.rs"] mod regs;\n')
        compile_cmd = ["rustc", "--edition=2024", "--test", str(scratch / "wrapper.rs"), "-L", "dependency=" + str(dependencies), "--extern", "proptest=" + str(proptest), "-o", str(scratch / "tests")]
        compiled = subprocess.run(compile_cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert compiled.returncode == 0, compiled.stdout
        command = [str(scratch / "tests"), "--exact", "regs::tests::sparse_mask_stamp_wraps_once_and_empty_masks_do_not_mutate", "--nocapture"]
        run = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = out / ("sabotage-" + name + ".log")
        log.write_text("Compile: " + repr(compile_cmd) + "\n" + compiled.stdout + "\nRun: " + repr(command) + "\n" + run.stdout)
        assert (run.returncode == 0) == should_pass, run.stdout
        if not should_pass:
            assert "left: 0" in run.stdout
            assert "right: 18446744073709551615" in run.stdout
        report["runs"].append({"name": name, "sourceSha256": sha(source.encode()), "exitCode": run.returncode, "expectedPass": should_pass, "log": str(log.relative_to(root)), "logSha256": sha(log.read_bytes())})
assert product.read_bytes() == original, "production source changed during scratch sabotage"
report["productSha256After"] = sha(product.read_bytes())
report["held"] = True
(out / "sabotage.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
