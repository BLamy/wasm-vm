import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import time

out = pathlib.Path(__file__).resolve().parent
root = out.parents[2]
provenance = json.loads((out / "perf-baseline-provenance.json").read_text())
baseline = [p for p in (pathlib.Path(provenance["directory"]) / "target/release/deps").glob("perf_baseline-*") if p.is_file() and p.suffix == ""]
assert len(baseline) == 1
candidate = root / "target/release/deps/perf_baseline-192935589b9a066d"
for _ in range(1200):
    if (out / "native-remaining.log").read_text().rstrip().endswith(("EXIT_CODE=0", "EXIT_CODE=101")):
        break
    time.sleep(1)
else:
    raise RuntimeError("Affected JIT tests still active; no comparison started")

report = {
    "note": "Sequential baseline-candidate-candidate-baseline after task-owned builds and tests finish. Original baseline lock copied, unused graph pruned; retained dependencies audited independently. No desktop responsiveness claim.",
    "host": subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip(),
    "runs": [],
}
for label, binary in [("baseline", baseline[0]), ("candidate", candidate), ("candidate", candidate), ("baseline", baseline[0])]:
    index = len(report["runs"])
    command = [str(binary), "perf_smoke_alu_above_floor", "--ignored", "--nocapture"]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = out / f"perf-comparison-{index}-{label}.log"
    log.write_text(result.stdout)
    value = re.search(r"(?:ALU MIPS |alu median )([0-9.]+)", result.stdout)
    assert value is not None, result.stdout
    report["runs"].append({"label": label, "binary": str(binary), "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "command": command, "exitCode": result.returncode, "medianMips": float(value[1]), "log": log.name, "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    (out / "perf-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
