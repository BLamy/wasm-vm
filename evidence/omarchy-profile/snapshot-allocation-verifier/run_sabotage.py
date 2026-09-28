#!/usr/bin/env python3
"""Remove only the reservation in an isolated copy; require the exact same test to fail."""
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

here = Path(__file__).resolve().parent
repo = here.parents[2]
out = here / "reservation-removed-sabotage"
assert not out.exists()
out.mkdir()
env = os.environ.copy()
env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
for key in list(env):
    if key in {"RUSTFLAGS", "RUST_LOG"} or key.startswith("CARGO_"):
        env.pop(key)
head = "512ba6acc9b0293d04d96115372ddef2b1cccfab"
source = subprocess.check_output(["git", "show", f"{head}:crates/core/src/resume.rs"], cwd=repo, env=env)
baseline = subprocess.check_output(["git", "show", "d52e8eaa:crates/core/src/resume.rs"], cwd=repo, env=env)
reservation = b'''        // A RAM section can approach a GiB. Reserving geometrically again for
        // its trailing device sections can require a second GiB of unused
        // capacity and exhaust wasm32 memory while the live RAM is retained.
        self.buf.reserve_exact(
            SECTION_HEADER_LEN
                .checked_add(payload.len())
                .expect("snapshot section size overflow"),
        );
'''
assert source.count(reservation) == 1
mutant = source.replace(reservation, b"", 1)
assert mutant == baseline, "Only the exact runtime change may be removed"
(out / "candidate-resume.rs").write_bytes(mutant)
(out / "mutation.diff").write_text("".join(difflib.unified_diff(source.decode().splitlines(True), mutant.decode().splitlines(True), fromfile="candidate/resume.rs", tofile="mutant/resume.rs")))
shutil.copyfile(here / "serialization_attack.rs", out / "serialization_attack.rs")
report = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "head": head,
          "originalSha256": hashlib.sha256(source).hexdigest(), "mutantSha256": hashlib.sha256(mutant).hexdigest(),
          "mutation": "Remove only the 8-line exact-reservation change; resulting module is byte-identical to baseline",
          "commands": []}
for name, argv in [
    ("compile", ["rustc", "--edition=2024", "-O", "serialization_attack.rs", "-o", "serialization-attack"]),
    ("attack", ["./serialization-attack"]),
]:
    result = subprocess.run(argv, cwd=out, env=env, capture_output=True, text=True)
    output = result.stdout + result.stderr
    (out / f"{name}.log").write_text(output)
    report["commands"].append({"name": name, "argv": argv, "exitCode": result.returncode})
    if name == "compile":
        assert result.returncode == 0, output
    else:
        assert result.returncode != 0 and "geometric spare capacity" in output
        assert "length 131171, capacity 262326" in output
report["sabotageDetected"] = True
report["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
