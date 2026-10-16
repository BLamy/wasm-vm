#!/usr/bin/env python3
"""Independent arithmetic/provenance audit; does not execute emulator code."""
import ast
import hashlib
import json
from pathlib import Path
import re
import statistics
import subprocess

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda p: json.loads((root / p).read_text())
git = lambda spec: subprocess.check_output(["git", "show", spec], cwd=root)
u64 = (1 << 64) - 1
report = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()}

# The only retained source hunk is inside cfg(test); check real shipped bytes too.
regs = (root / "crates/core/src/hart/regs.rs").read_bytes()
original = git("ec178d57:crates/core/src/hart/regs.rs")
assert regs.split(b"#[cfg(test)]", 1)[0] == original.split(b"#[cfg(test)]", 1)[0]
wasm = (root / "web/dist/pkg/wasm_vm_wasm_bg.wasm").read_bytes()
assert wasm == git("ec178d57:web/dist/pkg/wasm_vm_wasm_bg.wasm")
assert wasm == git("0a5f7bd7:web/dist/pkg/wasm_vm_wasm_bg.wasm")
report["restoration"] = {"productionPrefixEqual": True, "wasmSha256": sha(wasm), "wasmBytes": len(wasm)}

selection_path = "evidence/omarchy-profile/sparse-handoff-final/selection.json"
selection = read(selection_path)
report["selectionSha256"] = sha((root / selection_path).read_bytes())
report["candidates"] = []
binary_receipts = []
for index, selected in enumerate(selection["candidates"]):
    name = selected["report"]
    path = root / name
    data = json.loads(path.read_text())
    assert sha(path.read_bytes()) == selected["reportSha256"]
    if index == 0:
        source = (path.parent / "candidate-regs.rs").read_bytes()
        harness = (path.parent / "candidate-harness.mjs").read_bytes()
    elif index == 1:
        source = git("2f9b5b36:crates/core/src/hart/regs.rs")
        harness = git("6fb20757:tools/verify/jit-sparse-handoff-benchmark.mjs")
    else:
        candidate_dir = root / "evidence/omarchy-profile" / ("sparse-handoff-r" + str(min(index, 5)))
        source = (candidate_dir / "candidate-regs.rs").read_bytes()
        harness = (git("29980ba5:tools/verify/jit-sparse-handoff-benchmark.mjs") if index == 6 else (candidate_dir / "candidate-harness.mjs").read_bytes())
    assert sha(source) == data["sourceSha256"] == selected["sourceSha256"]
    assert sha(harness) == data["harnessSha256"] == selected["harnessSha256"]
    assert data["wasm"]["candidate"] == selected["wasmSha256"]
    assert data["wasm"]["baseline"] == report["restoration"]["wasmSha256"]
    assert data["passed"] and data["errors"] == []
    native_rows = []
    for row in data["native"]:
        all_runs = row["warmups"] + [r for pair in row["pairs"] for r in pair["runs"]]
        expected = [0 if reg == 0 or (row["mask"] >> reg) & 1 == 0 else 0xfedcba9876540000 | reg for reg in range(32)]
        for run in all_runs:
            # The JS collector parses native u64 JSON into Number, so this is only
            # a lossy preview. Exact words are asserted in the Rust producer and
            # independently checked by the shared fixture/digest below.
            assert [float(v) for v in run["words"]] == [float(v) for v in expected]
            assert run["version"] == run["iterations"] * bool(row["mask"] >> 1)
        ratios = []
        for pair in row["pairs"]:
            by_arm = {r["arm"]: r for r in pair["runs"]}
            ratios.append(by_arm["baseline"]["seconds"] / by_arm["candidate"]["seconds"])
        assert statistics.median(ratios) == row["pairedSpeedup"]
        native_rows.append({"mask": row["mask"], "pairedSpeedup": statistics.median(ratios)})
    for arm, expected_sha in data["nativeBinaries"].items():
        binary = path.parent / ("native-" + arm)
        # Large native binaries are retained locally, outside the text evidence archive.
        if binary.exists():
            assert sha(binary.read_bytes()) == expected_sha
        binary_receipts.append({"path": str(binary.relative_to(root)), "sha256": expected_sha, "bytesInspected": binary.exists()})
    browser_rows = []
    for row in data["browser"]:
        assert len(row["pairs"]) == 7 and len(row["warmups"]) == 4
        assert row["oracle"][0]["state"] == row["oracle"][1]["state"]
        times = {"baseline": [], "candidate": []}
        ratios = []
        all_runs = row["warmups"] + [r for pair in row["pairs"] for r in pair["runs"]]
        for run in all_runs:
            assert run["state"] == all_runs[0]["state"]
            assert run["result"]["retired"] in [40_000_000, 400_000_000]
            assert run["jit"]["guestRetired"] == run["result"]["retired"] + 20_000
            assert run["jit"]["retiredViaJit"] > run["result"]["retired"] - 100_000
        for pair in row["pairs"]:
            expected_order = ["candidate", "baseline"] if pair["pair"] % 2 else ["baseline", "candidate"]
            assert pair["order"] == expected_order == [r["arm"] for r in pair["runs"]]
            by_arm = {r["arm"]: r for r in pair["runs"]}
            for arm in times:
                times[arm].append(by_arm[arm]["elapsedMs"])
            ratios.append(by_arm["baseline"]["elapsedMs"] / by_arm["candidate"]["elapsedMs"])
        paired = statistics.median(ratios)
        ratio_of_medians = statistics.median(times["baseline"]) / statistics.median(times["candidate"])
        assert paired == row["pairedSpeedup"] == selected["pairedRatios"][row["config"]["name"]]
        assert ratio_of_medians == row["speedup"]
        browser_rows.append({"shape": row["config"]["name"], "pairedSpeedup": paired, "ratioOfMedians": ratio_of_medians, "samplesMs": times})
    sparse = next(r["pairedSpeedup"] for r in browser_rows if r["shape"] == "sparse")
    worst = min(r["pairedSpeedup"] for r in browser_rows)
    gate = sparse > 1.02 and worst >= 0.98
    report["candidates"].append({"name": selected["name"], "report": name, "reportSha256": selected["reportSha256"], "sourceSha256": sha(source), "harnessSha256": sha(harness), "browserVersion": data["browserVersion"], "gateRecomputed": gate, "sparsePaired": sparse, "worstDensity": worst, "native": native_rows, "browser": browser_rows})
assert [r["gateRecomputed"] for r in report["candidates"]] == [False, False, False, False, False, True, False]

# Rebuild both pure-Rust fixtures' digests in Python, without calling handoff code.
masks = [0, 1, 0xffffffff, 0xfffffffe, 0xaaaaaaaa, 0x55555555]
for count in range(32):
    mask = ((1 << count) - 1) << 1
    masks.extend([mask, mask | 1])
for first in range(32):
    masks.append(1 << first)
    for second in range(first + 1, 32):
        masks.append((1 << first) | (1 << second))
random = 0x47554553545f4a49
for _ in range(10_000):
    random = (random * 6364136223846793005 + 1442695040888963407) & u64
    masks.append(random >> 32)
state = [0] * 32
digest = hashlib.sha256()
for round_number, mask in enumerate(masks):
    for reg in range(1, 32):
        if (mask >> reg) & 1:
            word = (0x9182736455463728 * (reg + 1)) & u64
            shift = round_number & 63
            state[reg] = (((word << shift) | (word >> ((64 - shift) % 64))) & u64) ^ round_number
    for value in state:
        digest.update(value.to_bytes(8, "little"))
    digest.update(mask.to_bytes(4, "little"))
assert len(masks) == 10598
assert digest.hexdigest() == "4dace58378d14297762d010665b9d3bf1ac0fd376e5565ccbe4f122f34e6d1f2"
report["arrayOracle"] = {"masks": len(masks), "independentDigest": digest.hexdigest()}
digest = hashlib.sha256()
cases = 0
for random in [0x61da209f4bc8e357, 0xb04397ac82ef165d, 0x9c17fba56d3042e9]:
    def next_word():
        global random
        random ^= (random << 13) & u64
        random ^= random >> 7
        random ^= (random << 17) & u64
        return random
    for count in range(32):
        for rotation in range(31):
            for bit0 in [0, 1]:
                for _ in range(32):
                    next_word()
                words = [next_word() for _ in range(32)]
                pc = next_word()
                mask = bit0
                for offset in range(count):
                    mask |= 1 << ((rotation + offset) % 31 + 1)
                for reg, word in enumerate(words):
                    digest.update((word if reg else 0).to_bytes(8, "little"))
                digest.update(mask.to_bytes(4, "little"))
                digest.update(pc.to_bytes(8, "little"))
                cases += 1
assert cases == 5952
assert digest.hexdigest() == "091a8d5c6853b91d309bae75e9c8b6f7a88b6291f5fd9771e48127942f567d64"
report["compositionOracle"] = {"cases": cases, "independentDigest": digest.hexdigest()}

# Reconstruct each guest ADDI/JAL retirement's hash independently from the ISA.
log_path = out / "novel-wasm.log"
observed = []
for line_number, line in enumerate(log_path.read_text().splitlines(), 1):
    match = re.match(r"HANDOFF_GUEST regs=(\[.*\]) budget=(\d+) total=(\d+) trace=([0-9a-f]+) state=([0-9a-f]+)", line)
    if match:
        observed.append((line_number, ast.literal_eval(match[1]), int(match[2]), int(match[3]), int(match[4], 16), match[5]))
assert len(observed) == 40
report["guestTrace"] = {"logSha256": sha(log_path.read_bytes()), "points": []}
for registers in [[0], [31], [1, 7, 31], list(range(1, 32))]:
    current = [0] + [u64 - r for r in range(1, 32)]
    hash_state = 0xcbf29ce484222325
    offset = (-4 * len(registers)) & 0xffffffff
    jal = ((offset >> 20 & 1) << 31) | ((offset >> 1 & 0x3ff) << 21) | ((offset >> 11 & 1) << 20) | ((offset >> 12 & 0xff) << 12) | 0x6f
    retired = 0
    for line_number, regs_list, budget, total, expected_hash, snapshot_hash in observed:
        if regs_list != registers:
            continue
        for _ in range(budget):
            index = retired % (len(registers) + 1)
            folds = [0x80000000 + index * 4]
            if index == len(registers):
                folds.extend([jal, 0x0200000000000000])
            else:
                reg = registers[index]
                folds.append((1 << 20) | (reg << 15) | (reg << 7) | 0x13)
                if reg:
                    current[reg] = (current[reg] + 1) & u64
                    folds.extend([0x0100000000000000 | reg, current[reg]])
                else:
                    folds.append(0x0200000000000000)
            folds.append(0x0400000000000000)
            for value in folds:
                hash_state = ((hash_state ^ value) * 0x100000001b3) & u64
            retired += 1
        assert retired == total and hash_state == expected_hash, (registers, budget, hex(hash_state), hex(expected_hash))
        report["guestTrace"]["points"].append({"line": line_number, "registers": registers, "budget": budget, "retired": retired, "traceHash": f"{hash_state:016x}", "snapshotSha256": snapshot_hash})
    assert retired == 8614
    report["guestTrace"]["points"][-1]["predictedFinalPc"] = f"{0x80000000 + (retired % (len(registers) + 1)) * 4:016x}"
    report["guestTrace"]["points"][-1]["independentFinalWords"] = current

workload_path = "evidence/omarchy-profile/sparse-handoff-r1/final/workloads/browser.json"
workloads = read(workload_path)
assert len(workloads["records"]) == 20
assert all(r["ok"] and r["bootOk"] and r["echoed"] for r in workloads["records"])
assert all(error == "Failed to load resource: the server responded with a status of 404 (Not Found)" for r in workloads["records"] for error in r["consoleErrors"])
report["workloads"] = {
    "reportSha256": sha((root / workload_path).read_bytes()),
    "timings": [],
    "recordedConsoleErrors": [
        {"case": r["case"], "arm": r["label"], "rep": r["rep"], "errors": r["consoleErrors"]}
        for r in workloads["records"] if r["consoleErrors"]
    ],
}
for case in ["busybox-jit", "busybox-nojit"]:
    rows = [r for r in workloads["records"] if r["case"] == case]
    for metric in ["readyMs", "regionMs"]:
        by_rep = {(r["rep"], r["label"]): r[metric] for r in rows}
        paired = statistics.median(by_rep[(i, "baseline")] / by_rep[(i, "candidate")] for i in range(5))
        assert paired >= 0.95
        report["workloads"]["timings"].append({"case": case, "metric": metric, "pairedSpeedup": paired})

report["held"] = True
report["nativeBinaryReceipts"] = binary_receipts
chrome = json.loads((out / "chrome-jit_sparse_handoff.json").read_text())
chrome_lines = [r["text"] for r in chrome["console"] if r["text"].startswith("HANDOFF_GUEST ")]
node_lines = [r for r in log_path.read_text().splitlines() if r.startswith("HANDOFF_GUEST ")]
assert chrome_lines == node_lines and len(chrome_lines) == 40
report["chromeGuestStateEqualsNode"] = True
report["exactNativeJson"] = []
for name in ["native-exact-words.json", "cold-native-exact-words.json"]:
    evidence = root / "evidence/omarchy-profile/sparse-handoff-final" / name
    data = json.loads(evidence.read_text())
    assert data["passed"] and len(data["cases"]) == 8
    for case in data["cases"]:
        expected = [0 if reg == 0 or not case["mask"] & (1 << reg) else 0xfedcba9876540000 | reg for reg in range(32)]
        assert [int(word, 16) for word in case["words"]] == expected
        assert case["version"] == case["iterations"] * bool(case["mask"] >> 1)
    report["exactNativeJson"].append({"file": name, "sha256": sha(evidence.read_bytes()), "exactWords": 256})
manifest = root / "evidence/omarchy-profile/sparse-handoff-final/SHA256SUMS"
count = 0
for line in manifest.read_text().splitlines():
    expected, name = line.split("  ", 1)
    assert sha((root / name).read_bytes()) == expected, name
    count += 1
report["workerManifest"] = {"sha256": sha(manifest.read_bytes()), "filesChecked": count}
(out / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"restoration": report["restoration"], "candidates": [{k: c[k] for k in ["name", "sparsePaired", "worstDensity", "gateRecomputed"]} for c in report["candidates"]], "arrayOracle": report["arrayOracle"], "compositionOracle": report["compositionOracle"], "guestTracePoints": len(report["guestTrace"]["points"]), "workloads": report["workloads"], "held": True}, indent=2))
