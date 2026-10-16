#!/usr/bin/env python3
"""Independent receipt recount; never execute the collector's validation code."""
import hashlib
import json
import math
import re
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "evidence/omarchy-profile/clock-investigation-r1"
OUT = Path(__file__).resolve().parent
FROZEN = "37a269d490543b3c2970de600d60f7f055c6acac"
MAIN = "0a5f7bd7a1f4e55878d314cd4d65420a6ba1ff98"
BASE = Path("/tmp/wasm-vm-clock-current-baseline")
MASK = (1 << 64) - 1


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(p):
    return json.loads(p.read_text())


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def close(a, b):
    assert math.isclose(a, b, rel_tol=1e-14, abs_tol=1e-14), (a, b)


def median(xs):
    assert len(xs) == 5 and all(math.isfinite(x) and x > 0 for x in xs)
    return sorted(xs)[2]


receipt = load(WORKER / "final/artifact-receipt.json")
assert receipt["frozenHead"] == FROZEN and receipt["runtimeBase"] == MAIN
for name, digest in receipt["files"].items():
    assert sha((WORKER / "final" / name).read_bytes()) == digest, name
for name, field in [("crates/core/src/lib.rs", "coreSourceSha256"),
                    ("tools/verify/clock-fast-path-benchmark.mjs", "harnessSha256"),
                    ("crates/core/examples/clock_loop_probe.rs", "producerSha256")]:
    assert sha(git("show", f"{FROZEN}:{name}")) == receipt[field], name
    assert sha((ROOT / name).read_bytes()) == receipt[field], name

main_lib = git("show", f"{MAIN}:crates/core/src/lib.rs")
current_lib = (ROOT / "crates/core/src/lib.rs").read_bytes()
addition = b'#[cfg(all(test, not(feature = "zicsr-stub")))]\nmod clock_advance_tests;\n\n'
assert current_lib.count(addition) == 1
assert current_lib.replace(addition, b"") == main_lib
runtime_changed = git("diff", "--name-only", f"{MAIN}..{FROZEN}", "--",
                      "crates/core/src", "crates/wasm/src", "web/dist/pkg").decode().splitlines()
assert runtime_changed == ["crates/core/src/clock_advance_tests.rs", "crates/core/src/lib.rs"]
wasm_path = "web/dist/pkg/wasm_vm_wasm_bg.wasm"
wasm_checks = {"current": sha((ROOT / wasm_path).read_bytes()),
               "frozen": sha(git("show", f"{FROZEN}:{wasm_path}")),
               "main": sha(git("show", f"{MAIN}:{wasm_path}")),
               "preserved": sha((BASE / "pkg/wasm_vm_wasm_bg.wasm").read_bytes()),
               "rebuilt": sha((BASE / "pkg-rebuilt/wasm_vm_wasm_bg.wasm").read_bytes())}
assert set(wasm_checks.values()) == {receipt["wasmSha256"]}
meta = load(BASE / "baseline.json")
assert sha((BASE / "libwasm_vm_core.rlib").read_bytes()) == meta["rlibSha256"]
assert sha(git("show", f'{meta["head"]}:crates/core/src/lib.rs')) == meta["coreSourceSha256"]

words = [0xc01022f3, 0x00130313, 0xff9ff06f]
lines = []
for i in range(192):
    part = i % 3
    s = f"core 0: 0x{0x80000000 + 4 * part:016x} (0x{words[part]:08x})"
    if part == 0:
        s += f" x5 0x{i // 64:016x}"
    elif part == 1:
        s += f" x6 0x{i // 3 + 1:016x}"
    lines.append(s)
expected_trace = ("\n".join(lines) + "\n").encode()
trace_sha = sha(expected_trace)
assert trace_sha == "f8cb47ab87213e6d1f0e613d6130babdc3af7fb91a749e9a51c66117143701a9"

investigation = load(WORKER / "investigation.json")
report_paths = [WORKER / row["variant"] / "report.json" for row in investigation["candidates"]]
report_paths.append(WORKER / "final/control/report.json")
report_paths.append(OUT / "runtime-control/report.json")
# The exploratory collector predates the final non-accepting control branch.
# Reconstruct its exact bytes from the submitted source; its SHA binds the old logs.
exploratory_source = (ROOT / "tools/verify/clock-fast-path-benchmark.mjs").read_text()
start = exploratory_source.index("  const speedup = report.browser.find")
end = exploratory_source.index("  assert.deepEqual(report.errors, []);", start)
exploratory_source = (exploratory_source[:start] +
    '  assert.ok(report.browser.find(r => r.config.fast && !r.config.jit && r.config.divider === 64).speedup > 1, "browser divider-64 median must improve");\n' + exploratory_source[end:])
exploratory_source = exploratory_source.replace("passed: true, performance: report.performance, native:", "passed: true, native:")
exploratory_source = exploratory_source.replace(
    '  report.identicalBrowserBinary = report.browserArtifacts.baseline["pkg/wasm_vm_wasm_bg.wasm"] === report.browserArtifacts.candidate["pkg/wasm_vm_wasm_bg.wasm"];',
    '  assert.notEqual(report.browserArtifacts.baseline["pkg/wasm_vm_wasm_bg.wasm"], report.browserArtifacts.candidate["pkg/wasm_vm_wasm_bg.wasm"]);')
exploratory_sha = sha(exploratory_source.encode())
assert exploratory_sha == "8d88939b4357db3a2a958f0cf034d054fbf7e3ba9e94ee3096f43829905db142"
summaries = []
for p in report_paths:
    r = load(p)
    is_control = p.parent.name in ("control", "runtime-control")
    assert r["baseline"] == meta and r["errors"] == []
    assert r["producerSha256"] == receipt["producerSha256"]
    if is_control:
        assert r["head"] in (FROZEN, git("rev-parse", "a4df45de").decode().strip())
        assert r["harnessSha256"] == receipt["harnessSha256"]
        assert r["passed"] is True and "failure" not in r
    else:
        assert r["head"] == meta["head"]
        assert r["harnessSha256"] == exploratory_sha
        assert r["passed"] is False
        assert r["failure"] == "AssertionError [ERR_ASSERTION]: browser divider-64 median must improve"
    assert r["nativeCompilerFlags"] == ["--edition=2024", "-O", "-C", "lto=fat", "-C", "codegen-units=1"]
    assert r["nativeLibraries"]["baseline"] == meta["rlibSha256"]
    if p.parent.name == "runtime-control":
        for arm, digest in r["nativeBinaries"].items():
            assert sha((p.parent / f"native-{arm}").read_bytes()) == digest
        build = [json.loads(line) for line in (p.parent / "native-build.jsonl").read_text().splitlines()]
        for name, field in [("wasm_vm_core", "candidate"), ("sha2", "sha2")]:
            artifact = next(row for row in build if row.get("reason") == "compiler-artifact" and row["target"]["name"] == name)
            library = next(Path(filename) for filename in artifact["filenames"] if filename.endswith(".rlib"))
            assert sha(library.read_bytes()) == r["nativeLibraries"][field]
    assert len(r["native"]) == 5 and len(r["browser"]) == 5
    assert [(row["cached"], row["divider"]) for row in r["native"]] == [(True, 0), (False, 64), (True, 1), (True, 64), (True, 1024)]
    native_summary = []
    for row in r["native"]:
        assert len(row["warmups"]) == 2 and len(row["pairs"]) == 5
        assert [x["arm"] for x in row["warmups"]] == ["baseline", "candidate"]
        all_runs = row["warmups"] + [x for pair in row["pairs"] for x in pair["runs"]]
        state = {k: v for k, v in all_runs[0].items() if k not in ("arm", "seconds")}
        d = row["divider"]
        for pair_index, pair in enumerate(row["pairs"]):
            order = ["candidate", "baseline"] if pair_index % 2 else ["baseline", "candidate"]
            assert pair["pair"] == pair_index and pair["order"] == order
            assert [x["arm"] for x in pair["runs"]] == order
        for run in all_runs:
            assert {k: v for k, v in run.items() if k not in ("arm", "seconds")} == state
            assert run["retired"] == 8_000_000 and run["pc"] == 0x80000000
            expected_regs = [0] * 32
            expected_regs[5:8] = [2_000_000, 4_000_000, 6_000_000]
            assert run["xregs"] == expected_regs
            assert run["mtime"] == (8_000_000 // d if d else 0)
            assert run["phase"] == (8_000_000 % d if d else 0)
            assert run["cached"] == row["cached"] and run["divider"] == d
            assert run["traceSha256"] == sha(b"")
        b, c = [median([x["seconds"] for pair in row["pairs"] for x in pair["runs"] if x["arm"] == arm])
                for arm in ("baseline", "candidate")]
        close(b, row["baselineSeconds"]); close(c, row["candidateSeconds"]); close(b / c, row["speedup"])
        native_summary.append({"cached": row["cached"], "divider": d, "baselineSeconds": b, "candidateSeconds": c, "ratio": b / c})
    for arm in ("baseline", "candidate"):
        trace = (p.parent / f"{arm}-guest-trace64.txt").read_bytes()
        assert trace == expected_trace and r["guestTraces"][arm]["traceSha256"] == trace_sha
        run = r["guestTraces"][arm]
        assert (run["mtime"], run["phase"], run["retired"], run["pc"]) == (3, 0, 192, 0x80000000)
        assert run["xregs"][5:7] == [2, 64]
        assert run["snapshotSha256"] == "38d6ede041ba09b56aea2905768d601b94ec2ae4508e724ec905dbb7eab374f0"
    assert r["browserArtifacts"]["baseline"]["pkg/wasm_vm_wasm_bg.wasm"] == meta["wasmSha256"]
    same_bytes = r["browserArtifacts"]["baseline"]["pkg/wasm_vm_wasm_bg.wasm"] == r["browserArtifacts"]["candidate"]["pkg/wasm_vm_wasm_bg.wasm"]
    if is_control:
        assert r["identicalBrowserBinary"] is same_bytes
    else:
        assert not same_bytes
    browser_summary = []
    assert [(row["config"]["fast"], row["config"]["divider"], row["config"]["jit"]) for row in r["browser"]] == [(False, 64, False), (True, 1, False), (True, 64, False), (True, 1024, False), (True, 64, True)]
    for row in r["browser"]:
        cfg = row["config"]
        assert len(row["warmups"]) == 4 and len(row["pairs"]) == 5
        assert [x["arm"] for x in row["warmups"]] == ["baseline", "candidate", "candidate", "baseline"]
        assert cfg["budget"] == (40_000_000 if cfg["jit"] else 4_000_000)
        total = cfg["budget"] + 20_000
        all_runs = row["warmups"] + [x for pair in row["pairs"] for x in pair["runs"]]
        state_keys = ["clock", "phase", "cpuSha256", "clintSha256", "clockSha256", "ramSha256"]
        expected = {k: all_runs[0][k] for k in state_keys}
        for pair_index, pair in enumerate(row["pairs"]):
            order = ["candidate", "baseline"] if pair_index % 2 else ["baseline", "candidate"]
            assert pair["pair"] == pair_index and pair["order"] == order
            assert [x["arm"] for x in pair["runs"]] == order
        for run in all_runs:
            assert run["prefix"] == {"done": False, "state": None, "retired": 20_000}
            assert run["result"] == {"done": False, "state": None, "retired": cfg["budget"]}
            assert run["clock"] == {"mode": "icount", "mtime": str(total // cfg["divider"]), "timebaseHz": 10_000_000, "clockDiv": cfg["divider"]}
            assert run["phase"] == str(total % cfg["divider"])
            assert {k: run[k] for k in state_keys} == expected
            assert run["jit"]["guestRetired"] == total
            if cfg["jit"]:
                assert run["jit"]["hasExecutor"] is True and run["jit"]["compiledBlocks"] > 0
                assert run["jit"]["executedBlocks"] > 0 and run["jit"]["jitEngineCalls"] > 0
                assert run["jit"]["retiredViaJit"] > cfg["budget"] * 0.99
            else:
                assert run["jit"]["retiredViaJit"] == 0
        b, c = [median([x["elapsedMs"] for pair in row["pairs"] for x in pair["runs"] if x["arm"] == arm])
                for arm in ("baseline", "candidate")]
        close(b, row["baselineMs"]); close(c, row["candidateMs"]); close(b / c, row["speedup"])
        browser_summary.append({"config": cfg, "baselineMs": b, "candidateMs": c, "ratio": b / c,
                                "minimumCompiledRetirements": min(x["jit"]["retiredViaJit"] for x in all_runs)})
    gate = browser_summary[2]["ratio"]
    if same_bytes:
        assert r["performance"] == {"cachedDivider64Speedup": gate, "decision": "unchanged-runtime-control", "acceptanceHeld": False}
        assert r["nativeLibraries"]["candidate"] == meta["rlibSha256"]
    else:
        row = next(x for x in investigation["candidates"] if x["variant"] == p.parent.name)
        assert row["reportSha256"] == sha(p.read_bytes()) and row["decision"] == "rejected" and gate < 1
        close(row["speedup"], gate); close(row["baselineMs"], browser_summary[2]["baselineMs"]); close(row["candidateMs"], browser_summary[2]["candidateMs"])
    summaries.append({"report": str(p.relative_to(ROOT)), "sha256": sha(p.read_bytes()), "native": native_summary,
                      "browser": browser_summary, "identicalBrowserBinary": same_bytes, "gateRatio": gate})

# Predict each native fixture's FNV fingerprint from the instruction encodings and arithmetic.
ram = bytearray(4096)
for index, word in enumerate(words):
    struct.pack_into("<I", ram, index * 4, word)
ram_digest = sha(ram)
fixture_rows = []
fixture_pattern = re.compile(r"clock-guest div=(\d+) phase=(\d+) start=(\d+) cached=(true|false) batched=(true|false) trace=([0-9a-f]{16}) state=([0-9a-f]{64})")
for logfile in ("focused-gates.log", "cold-clone-focused-gates.log"):
    observed = []
    for line_number, line in enumerate((WORKER / "final" / logfile).read_text().splitlines(), 1):
        match = fixture_pattern.fullmatch(line)
        if not match:
            continue
        div, phase, start = map(int, match.groups()[:3])
        value = 0xcbf29ce484222325
        for index in range(192):
            fields = [0x80000000 + (index % 3) * 4, words[index % 3]]
            if index % 3 == 0:
                fields += [0x0100000000000005, (start + (phase + index) // div) & MASK]
            elif index % 3 == 1:
                fields += [0x0100000000000006, index // 3 + 1]
            else:
                fields += [0x0200000000000000]
            fields += [0x0400000000000000]
            for field in fields:
                value = ((value ^ field) * 0x100000001b3) & MASK
        assert match.group(6) == f"{value:016x}" and match.group(7) == ram_digest
        observed.append({"line": line_number, "divider": div, "startPhase": phase, "startTime": start,
                         "cached": match.group(4), "batched": match.group(5), "traceHash": f"{value:016x}",
                         "finalMtime": str((start + (phase + 192) // div) & MASK), "finalPhase": str((phase + 192) % div)})
    assert len(observed) == 72
    fixture_rows.append({"log": logfile, "configurations": len(observed), "rows": observed})
cold = load(WORKER / "final/cold-clone.json")
assert cold["head"] == FROZEN and cold["exitCode"] == 0 and cold["command"] == ["make", "verify-E5.5-T03bd"]
demo = load(WORKER / "final/demo/demo-suite.json")
assert demo["metrics"] == {"metric-pass": "127", "metric-fail": "0", "metric-done": "127"}
assert demo["errors"] == [] and demo["httpErrors"] == []
assert demo["screenshotSha256"] == sha((WORKER / "final/demo/demo-suite.png").read_bytes())
result = {"passed": True, "frozenHead": FROZEN, "runtimeBase": MAIN, "wasmChecks": wasm_checks,
          "sealFilesChecked": len(receipt["files"]), "nativePairs": 25 * len(report_paths), "browserPairs": 25 * len(report_paths),
          "nativeRunsIncludingWarmups": 60 * len(report_paths), "browserRunsIncludingWarmups": 70 * len(report_paths),
          "canonicalTraceSha256": trace_sha, "ramFixtureSha256": ram_digest,
          "reports": summaries, "nativeFixtures": fixture_rows, "coldCloneCarriedForward": cold,
          "demo": {"metrics": demo["metrics"], "errors": demo["errors"], "httpErrors": demo["httpErrors"], "screenshotSha256": demo["screenshotSha256"]}}
result["freshNativeBinaryDigestsChecked"] = load(OUT / "runtime-control/report.json")["nativeBinaries"]
(OUT / "audit.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({k: result[k] for k in ("passed", "sealFilesChecked", "nativePairs", "browserPairs", "nativeRunsIncludingWarmups", "browserRunsIncludingWarmups", "canonicalTraceSha256")}, indent=2))
