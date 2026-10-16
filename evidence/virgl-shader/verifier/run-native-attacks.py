#!/usr/bin/env python3
"""Replay the verifier's independent seeds and defensive fault injection."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

out = Path(__file__).resolve().parent
root = out.parents[2]
module = root / "renderer/virgl-shader"
with tempfile.TemporaryDirectory(prefix="virgl-verifier-native-") as temporary:
    temporary = Path(temporary)
    for name, test, omit_bridge in [
        ("independent", out / "independent-hostile.c", False),
        ("fault", out / "fault-guards.c", True),
    ]:
        script = (module / "build.sh").read_text()
        script = script.replace('cd "$(dirname "$0")"', "cd " + shlex.quote(str(module)))
        script = script.replace("-g -O1 -fno-omit-frame-pointer", "-g -O1 -fprofile-instr-generate -fcoverage-mapping -fno-omit-frame-pointer")
        if omit_bridge:
            script = script.replace("sources=(bridge.c generated/", "sources=(generated/")
        binary = temporary / (name + "-test")
        script = script.replace("native_tests/hostile.c", shlex.quote(str(test)))
        script = script.replace("build/sanitize/hostile-test", shlex.quote(str(binary)))
        runner = temporary / (name + ".sh")
        runner.write_text(script)
        raw = temporary / (name + ".profraw")
        env = {**os.environ, "LLVM_PROFILE_FILE": str(raw)}
        logfile = out / ("independent-sanitizers.log" if name == "independent" else "fault-guards.log")
        with logfile.open("w") as log:
            subprocess.run(["bash", str(runner), "sanitize"], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        profile = temporary / (name + ".profdata")
        subprocess.run(["xcrun", "llvm-profdata", "merge", "-sparse", str(raw), "-o", str(profile)], check=True)
        coverage = out / ("bridge-coverage.txt" if name == "independent" else "fault-coverage.txt")
        with coverage.open("w") as log:
            subprocess.run(["xcrun", "llvm-cov", "show", str(binary), "-instr-profile=" + str(profile), str(module / "bridge.c")], stdout=log, check=True)
print("Independent sanitizer seeds and injected defensive faults passed.")
