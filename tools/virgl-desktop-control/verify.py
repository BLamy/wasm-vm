#!/usr/bin/env python3
"""Record the selected native-control gate at a frozen, clean source head."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

repo = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
args = parser.parse_args()
root = pathlib.Path(args.output).resolve()
root.mkdir(parents=True, exist_ok=True)
receipt_path = root / "receipt.json"
receipt_path.unlink(missing_ok=True)
base = "cf184d42823dd4d0d3640482d9b1379181d364fe"
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
env = {k: v for k, v in os.environ.items() if not k.startswith(("CARGO_", "RUST", "LLVM_PROFILE"))}
steps = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(name, command, overrides=None, expected=0, cwd=repo, timeout=900):
    print(f"{name}: running", flush=True)
    began = time.monotonic()
    result = subprocess.run(command, cwd=cwd, env={**env, **(overrides or {})},
                            capture_output=True, timeout=timeout)
    (root / f"{name}.stdout").write_bytes(result.stdout)
    (root / f"{name}.stderr").write_bytes(result.stderr)
    steps.append({"name": name, "command": command, "cwd": str(cwd),
                  "overrides": overrides or {}, "exitCode": result.returncode,
                  "expected": expected, "elapsedSeconds": time.monotonic() - began,
                  "stdoutSha256": sha(result.stdout), "stderrSha256": sha(result.stderr)})
    assert result.returncode == expected, (name, result.stderr[-3000:].decode(errors="replace"))
    print(f"{name}: expected exit {expected}", flush=True)
    return result


run("policy", ["python3", "tools/check_task_policy.py"])
run("format", ["cargo", "fmt", "--check", "-p", "wasm-vm-core"])
run("clippy-default", ["cargo", "clippy", "--offline", "-p", "wasm-vm-core", "--lib", "--", "-D", "warnings"])
features = "virgl-control-proof,gpu-trace,trace"
run("clippy-selected", ["cargo", "clippy", "--offline", "-p", "wasm-vm-core", "--lib",
                       "--test", "virtio_gpu_control3d", "--test", "virtio_gpu_machine",
                       "--features", features, "--", "-D", "warnings"])
generated = root / "packets.rs"
run("authenticated-fixtures", ["python3", "tools/virgl-desktop-control/packets.py", str(generated)])
assert generated.read_bytes() == (repo / "tools/virgl-desktop-control/packets.rs").read_bytes()
coverage_root = root / "coverage"
coverage_root.mkdir()
instrument = {"RUSTFLAGS": "-C instrument-coverage", "CARGO_TARGET_DIR": str(repo / "target/virgl-desktop-control-coverage"),
              "LLVM_PROFILE_FILE": str(coverage_root / "%m-%p.profraw")}
native_command = ["cargo", "test", "--offline", "-p", "wasm-vm-core", "--features", features,
                  "--test", "virtio_gpu_control3d"]
artifact = run("native-artifact", native_command + ["--no-run", "--message-format=json"], instrument)
artifacts = [json.loads(l) for l in artifact.stdout.splitlines() if l.startswith(b"{")]
binary = pathlib.Path(next(v["executable"] for v in artifacts if v.get("executable") and v.get("target", {}).get("name") == "virtio_gpu_control3d"))
binary_pin = {"path": str(binary), "bytes": binary.stat().st_size, "sha256": sha(binary.read_bytes())}
run("native-control", native_command + ["--", "--nocapture", "--test-threads=1"], instrument)
run("native-gpu", ["cargo", "test", "--offline", "-p", "wasm-vm-core", "--features", features,
                   "--lib", "dev::virtio::gpu::", "--", "--test-threads=1"])
run("native-machine", ["cargo", "test", "--offline", "-p", "wasm-vm-core", "--features", features,
                       "--test", "virtio_gpu_machine", "--", "--test-threads=1"])
for suffix, extra in [("default", []), ("selected", ["--features", "virgl-control-proof"])]:
    run("wasm-core-" + suffix, ["cargo", "build", "--offline", "-p", "wasm-vm-core",
                               "--no-default-features", "--target", "wasm32-unknown-unknown", *extra])
run("default-dist-build", ["make", "web-dist"], timeout=1200)
run("default-demo", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(root / "default-demo"),
                     "--task", "E6-T11d51"], timeout=700)
sysroot = pathlib.Path(subprocess.check_output(["rustc", "--print", "sysroot"], cwd=repo, text=True).strip())
host = subprocess.check_output(["rustc", "-vV"], cwd=repo, text=True).split("host: ")[1].splitlines()[0]
llvm = sysroot / "lib/rustlib" / host / "bin"
run("coverage-merge", [str(llvm / "llvm-profdata"), "merge", "-sparse", *map(str, coverage_root.glob("*.profraw")),
                       "-o", str(root / "native.profdata")])
export = run("coverage-export", [str(llvm / "llvm-cov"), "export", str(binary),
                                "--instr-profile=" + str(root / "native.profdata")])
(root / "native-coverage.json").write_bytes(export.stdout)
run("changed-coverage", ["python3", "tools/virgl-desktop-control/coverage.py", str(root)])
run("native-audit", ["python3", "tools/virgl-desktop-control/audit.py", str(root)])

# Deliberately mutate a detached copy, never the frozen working tree.
scratch = pathlib.Path(tempfile.mkdtemp(prefix="wasm-vm-desktop-control-fault-")) / "repo"
run("fault-clone", ["git", "clone", "--shared", "--no-checkout", str(repo), str(scratch)])
run("fault-checkout", ["git", "checkout", "--detach", head], cwd=scratch)
control_path = pathlib.Path("crates/core/src/dev/virtio/gpu/control3d.rs")
before = (scratch / control_path).read_bytes()
anchor = b"self.resources.len() >= max_resources"
assert before.count(anchor) == 1
after = before.replace(anchor, b"self.resources.len() > max_resources")
(scratch / control_path).write_bytes(after)
(root / "fault-source-original.rs").write_bytes(before)
(root / "fault-source-served.rs").write_bytes(after)
fault_command = ["cargo", "test", "--offline", "-p", "wasm-vm-core", "--features", features,
                 "--test", "virtio_gpu_control3d", "desktop_control_selected_counts_and_host_failure_rollback",
                 "--", "--nocapture", "--test-threads=1"]
run("fault-count", fault_command, {"CARGO_TARGET_DIR": str(repo / "target/virgl-desktop-control-fault")}, expected=101, cwd=scratch)
from audit import records, state
fault_rows = records(root / "fault-count.stderr")
fault_row = next(r for r in fault_rows if r["case"] == "desktop-count-65-refused")
fault_state = state(fault_row["transportCanonical"], fault_row["transportDigest"])
assert int.from_bytes(bytes.fromhex(fault_row["response"])[:4], "little") == 0x1100
assert len(fault_state["resources"]) == 65 and fault_row["sinkEvents"] == 65
assert (fault_state["logical"], fault_state["gpu"]) == (520, 520)
fault = {"sourcePath": str(control_path), "originalSha256": sha(before), "servedSha256": sha(after),
         "actualAllocatedTransportResources": 65, "actualSinkEvents": 65,
         "response": fault_row["response"], "transportDigest": fault_row["transportDigest"],
         "expectedOracleFailure": "desktop-count-65-refused entire independent response"}
(root / "fault-audit.json").write_text(json.dumps(fault, indent=2) + "\n")

# Resolve and authenticate both external evidence seals. Retain the exact D50
# receipt from its archive so this gate also works from a fresh clone.
import tarfile
dependency_seals = []
held = None
for role in ["worker", "verifier"]:
    directory = repo / "evidence/virgl-resource-capacity" / role
    manifest_raw = (directory / "manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    index_raw = (directory / "records.json").read_bytes()
    index = json.loads(index_raw)
    archive = directory / "recording.tar.gz"
    assert sha(index_raw) == manifest["recordIndexSha256"]
    assert sha(archive.read_bytes()) == manifest["archiveSha256"]
    bodies = index["records"] if isinstance(index, dict) else index
    expected = {v["path"]: v for v in bodies}
    with tarfile.open(archive, "r:gz") as packed:
        members = {m.name: m for m in packed.getmembers()}
        assert set(members) == set(expected)
        for name, item in expected.items():
            raw = packed.extractfile(members[name]).read()
            assert len(raw) == item["bytes"] and sha(raw) == item["sha256"]
            if role == "worker" and name == "hot/receipt.json":
                held = json.loads(raw)
                (root / "held-host-receipt.json").write_bytes(raw)
    dependency_seals.append({"role": role, "manifestSha256": sha(manifest_raw),
                             "indexSha256": sha(index_raw), "archiveSha256": manifest["archiveSha256"],
                             "reopenedBodies": len(expected)})
assert held is not None
carried = {k: v for k, v in {**held["sources"], **held["carriedSources"]}.items() if k.startswith("renderer/")}
for path, digest in carried.items():
    assert sha((repo / path).read_bytes()) == digest, ("changed carried host boundary", path)

source_paths = subprocess.check_output(["git", "ls-files", "crates/core", "tools/virgl-desktop-control",
                                      "tools/verify-virgl-default-demo.mjs", "Cargo.toml", "Cargo.lock", "Makefile"], cwd=repo, text=True).splitlines()
pins = {}
source_dir = root / "sources"
for relative in source_paths:
    path = repo / relative
    if not path.is_file():
        continue
    raw = path.read_bytes()
    pins[relative] = {"bytes": len(raw), "sha256": sha(raw)}
    destination = source_dir / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
for name in ["compositor", "kmscube", "glmark2-es2"]:
    for filename in ["manifest.json", "events.jsonl"]:
        destination = root / "original" / name / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / "evidence/virgl-corpus/captures" / name / filename, destination)
boundary_paths = subprocess.check_output(["git", "ls-files", "web", "crates/wasm", "crates/wasm-web", "tools/guest"], cwd=repo, text=True).splitlines()
unchanged = {}
for relative in boundary_paths:
    if relative.startswith("web/dist/"):
        continue
    before_raw = subprocess.check_output(["git", "show", f"{base}:{relative}"], cwd=repo)
    assert sha((repo / relative).read_bytes()) == sha(before_raw), relative
    unchanged[relative] = sha(before_raw)
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
receipt = {"schema": "desktop-control-worker-receipt-v1", "task": "E6-T11d51", "head": head, "base": base,
           "commands": steps, "sources": pins, "binary": binary_pin, "fault": fault,
           "carriedHostSources": carried, "dependencySeals": dependency_seals,
           "unchangedDefaultWebGuestSources": unchanged,
           "nativeAuditSha256": sha((root / "native-audit.json").read_bytes()),
           "coverageAuditSha256": sha((root / "changed-coverage.json").read_bytes()),
           "guestExecution": False, "productionAuthority": False}
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"head": head, "commands": len(steps), "carriedHostSources": len(carried),
                  "dependencyBodies": sum(s["reopenedBodies"] for s in dependency_seals), "receipt": str(receipt_path)}), flush=True)
