#!/usr/bin/env python3
"""Audit sealed worker evidence, exact source, cold build and public receipts."""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = ROOT / "evidence/omarchy-profile/fp-arithmetic-r1"
WASM = "e84c821a12fa5782e229614b9bd3f5a37713e7f3e4d1d38788ac194a7a039db4"
RUNTIME = "357dd1a0f9f984747f3f92ad83b0ae556e6689f5"
REPAIR = "d64b037b362b36490d58b82663a448ac0532b025"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def git(*args, cwd=ROOT):
    return subprocess.check_output(["git", *args], cwd=cwd)


head = git("rev-parse", "HEAD").decode().strip()
seal = WORKER / "sha256.txt"
sealed = []
for line in seal.read_text().splitlines():
    digest, name = line.split(None, 1)
    name = name.lstrip(" *")
    path = (WORKER / name).resolve()
    assert path.is_relative_to(WORKER.resolve()), name
    assert sha(path) == digest, name
    sealed.append(name)
assert len(sealed) >= 30

sources = [
    "crates/core/src/jit.rs", "crates/core/src/softfloat.rs",
    "crates/jit-translate/src/lib.rs", "crates/jit-runtime/src/lib.rs",
    "crates/wasm/src/jit_browser.rs", "tests/support/jit_fp_arithmetic_verifier.rs",
    "crates/jit-runtime/tests/fp_arithmetic_verifier.rs",
    "crates/wasm/tests/jit_fp_arithmetic_verifier.rs",
    "tools/verify/omarchy-fp-arithmetic-browser.mjs", "Makefile",
]
source_hashes = {}
for path in sources:
    actual = (ROOT / path).read_bytes()
    assert actual == git("show", RUNTIME + ":" + path), path
    source_hashes[path] = hashlib.sha256(actual).hexdigest()
assert (ROOT / "crates/wasm/src/lib.rs").read_bytes() == git("show", REPAIR + ":crates/wasm/src/lib.rs")
source_hashes["crates/wasm/src/lib.rs"] = sha(ROOT / "crates/wasm/src/lib.rs")
assert sha(ROOT / "web/dist/pkg/wasm_vm_wasm_bg.wasm") == WASM

cold = read(WORKER / "cold/report.json")
assert cold["passed"] and cold["pristineBeforeBuild"]
assert cold["committedWasmSha256"] == cold["rebuiltWasmSha256"] == WASM
assert all(row["code"] == 0 for row in cold["commands"])
clone = Path(cold["clone"])
assert git("rev-parse", "HEAD", cwd=clone).decode().strip() == cold["head"]
for path in sources + ["crates/wasm/src/lib.rs"]:
    assert (clone / path).read_bytes() == (ROOT / path).read_bytes(), path
assert sha(clone / "web/dist/pkg/wasm_vm_wasm_bg.wasm") == WASM
cold_acceptance = (WORKER / "cold/acceptance.log").read_text()
for expected in [
    "CRITIC_NATIVE_ARITHMETIC_GOLDENS Receipt { cases: 8832, disabled: 0, digest: 17621813032391191516 }",
    "CRITIC_PRIVATE_ARITHMETIC_GOLDENS Receipt { cases: 8832, disabled: 0, digest: 17621813032391191516 }",
    "CRITIC_SHARED_ARITHMETIC_GOLDENS Receipt { cases: 8832, disabled: 0, digest: 17621813032391191516 }",
    "CRITIC_ARITHMETIC_IMPORT cases=1024 legal_helper_calls=540 illegal_helper_calls=0",
    "test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out",
    "test result: ok. 6 passed; 0 failed; 0 ignored; 0 filtered out",
]:
    assert expected in cold_acceptance, expected

browsers = []
for relative in ["browser-final", "cold/browser"]:
    directory = WORKER / relative
    report = read(directory / "report.json")
    assert report["passed"] and report["errors"] == []
    assert report["wasmSha256"] == WASM
    assert report["elfSha256"] == sha(directory / "fp-arithmetic.elf")
    assert report["suite"] == {"metric-pass": "127", "metric-fail": "0", "metric-done": "127"}
    oracle, compiled = report["runs"]
    assert not oracle["jit"] and compiled["jit"]
    assert oracle["registers"] == compiled["registers"]
    assert oracle["stats"] == compiled["stats"]
    assert oracle["digest"] == compiled["digest"]
    assert compiled["stats"]["retired"] == 4000
    assert compiled["jitStats"]["retiredViaJit"] == 3649
    for register, expected in [(13, "b"), (14, "3"), (16, "ffffffff3f800000"),
                               (17, "ffffffff3f800001"), (18, "ffffffff27800000"),
                               (19, "ffffffff00000001")]:
        assert compiled["registers"][register + 1] == expected
    assert sha(directory / "suite.png") == report["suiteScreenshotSha256"]
    assert sha(directory / "built-page.png") == report["screenshotSha256"]
    assert sha(directory / "capability-inspection.png") == report["capabilityInspection"]["sha256"]
    browsers.append({"report": relative + "/report.json", "sha256": sha(directory / "report.json"),
                     "head": report["head"], "guest_ram_digest": compiled["digest"],
                     "retired_via_jit": compiled["jitStats"]["retiredViaJit"], "suite": "127/127"})

public = read(WORKER / "cloudflare-public.json")
independent_public = read(OUT / "independent-public-bytes.json")
for rows in [public, independent_public]:
    assert len(rows) == 8
    assert {urlsplit(row["url"]).hostname for row in rows} == {"52209836.wasm-vm.pages.dev", "wasm-vm.pages.dev"}
    for row in rows:
        assert row["status"] == 200 and row["sha256"] == row["expectedSha256"]
        filename = urlsplit(row["url"]).path.lstrip("/")
        assert row["sha256"] == sha(ROOT / "web/dist" / filename)

physical = read(OUT / "physical-input-audit.json")
assert physical["reportSha256"] == sha(WORKER / "physical-input/desktop/report.json")
assert physical["wasmSha256"] == WASM and physical["deadlineMs"] == 120000
assert physical["trustedEvents"] == physical["acceptedEvents"] == 128
assert physical["frames"] == [2, 2] and not physical["nonceVerified"]
assert physical["beforeSha256"] == physical["afterSha256"]
q = list((ROOT / "tasks").rglob("E5.5-T03q-*.md"))
assert len(q) == 1 and "\nstatus: pending\n" in q[0].read_text()

sabotage = read(OUT / "wrong-golden-result.json")
assert [row["exit_code"] for row in sabotage["runs"]] == [101, 0]
assert sabotage["shared_test_unchanged"]
assert sabotage["original_sha256"] == sha(ROOT / "tests/support/jit_fp_arithmetic_verifier.rs")
repair = read(WORKER / "repair-commands.json")
assert repair["allPassed"] and all(row["code"] == 0 for row in repair["commands"])
ci = read(WORKER / "ci-commands.json")
assert not ci["allPassed"] and [row["code"] for row in ci["commands"]] == [2]
ci_log = (WORKER / "ci.log").read_text()
failed_targets = re.findall(r"^make: \*\*\* \[([^] ]+)\] Error \d+$", ci_log, re.M)
assert failed_targets == ["clippy", "test", "wasm", "test-riscv", "determinism"], failed_targets
assert "perf-smoke: alu median 25.3 MIPS ≥ floor 15" in ci_log
inherited = read(OUT / "inherited-gates-audit.json")
assert inherited["allIdentical"]
for row in inherited["files"]:
    assert sha(ROOT / row["path"]) == row["sha256"]
    assert hashlib.sha256(git("show", row["sourceBase"] + ":" + row["path"])).hexdigest() == row["sha256"]
carried = read(OUT / "carried-boundaries.json")
for row in carried["boundaries"]:
    content = (ROOT / row["path"]).read_bytes()
    if "boundary" in row:
        content = content.split(b"pub mod abi {", 1)[1]
    assert hashlib.sha256(content).hexdigest() == row["sha256"], row["path"]

report = {
    "audited_at": datetime.now(timezone.utc).isoformat(), "submission_commit": head,
    "worker_seal_sha256": sha(seal), "sealed_files_verified": len(sealed),
    "runtime_head": RUNTIME, "repair_head": REPAIR, "runtime_source_sha256": source_hashes,
    "runtime_wasm_sha256": WASM, "cold_head": cold["head"],
    "cold_pristine_before_build": True, "cold_source_diff_empty": True,
    "cold_acceptance_exit_codes": [row["code"] for row in cold["commands"]],
    "browsers": browsers, "public_exact_byte_receipts": len(public),
    "independent_public_exact_byte_receipts": len(independent_public),
    "physical_input": physical, "desktop_responsive": False,
    "broad_ci_passed": ci["allPassed"],
    "broad_ci_exit_codes": [row["code"] for row in ci["commands"]],
    "broad_ci_failed_targets": failed_targets, "inherited_gate_files_rechecked": len(inherited["files"]),
    "carried_held_boundaries_rechecked": len(carried["boundaries"]),
    "wrong_golden_failed_then_restored": True, "T03q_status": "pending",
    "audit_passed": True,
}
(OUT / "final-audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
