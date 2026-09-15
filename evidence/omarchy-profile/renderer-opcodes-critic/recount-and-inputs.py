#!/usr/bin/env python3
"""Independent T03s evidence/input audit; never starts or mutates a guest."""
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import struct
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "evidence/omarchy-profile/renderer-opcodes-r1"
HEAD = "fdae798ca28b94cc1551a8dc8a634e5ad99858e7"
PINS = {
    "kernel": (24208896, "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"),
    "bootSnapshot": (205050833, "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5"),
    "overlayDelta": (1209196, "1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da"),
    "chunkManifest": (1097812, "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44"),
    "image": (4294967296, "2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c"),
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_digest(filename):
    result = hashlib.sha256()
    with open(filename, "rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def u32(data, at):
    return struct.unpack_from("<I", data, at)[0]

def u64(data, at):
    return struct.unpack_from("<Q", data, at)[0]

report = json.loads((EVIDENCE / "report.json").read_text())
assert report["head"] == HEAD
assert report["desktopAcceptance"] is False
assert report["result"] == "opcode-measurement-complete"
sources = {}
for role, (size, pinned_sha) in PINS.items():
    source = report["sources"][role]
    filename = pathlib.Path(source["path"])
    observed = (filename.stat().st_size, file_digest(filename))
    assert observed == (size, pinned_sha) == (source["size"], source["sha256"]), role
    sources[role] = {"size": size, "sha256": pinned_sha, "sourceUnchanged": True}

original = gzip.decompress(pathlib.Path(report["sources"]["bootSnapshot"]["path"]).read_bytes())
private = pathlib.Path(report["privateInputs"]["snapshot"]).read_bytes()
assert len(original) == len(private)
assert original[:12] == private[:12] and original[76:] == private[76:]
assert private[12:76] == bytes(64)
assert original[:8] == b"WVMRESU1" and u32(original, 8) == 1
assert original[12:44] == b"0.0.1".ljust(32, b"\0")
assert u64(original, 76) == 0
adaptation = report["snapshotAdaptation"]
assert digest(original) == adaptation["before"]["sha256"]
assert digest(private) == adaptation["afterSha256"]
assert digest(original[:12]) == adaptation["before"]["prefix"]
assert digest(original[76:]) == adaptation["before"]["suffix"]
changed = [offset for offset in range(12, 76) if original[offset] != private[offset]]
sections = {}
at = 84
while at < len(original):
    assert at + 8 <= len(original)
    tag, length = u32(original, at), u32(original, at + 4)
    assert tag not in sections and 1 <= tag <= 16 and at + 8 + length <= len(original)
    sections[tag] = memoryview(original)[at + 8:at + 8 + length]
    at += 8 + length
assert at == len(original)
clock = sections[9]
assert len(clock) == 24 and u64(clock, 8) == 64 and u64(clock, 0) < 64

manifest = json.loads(pathlib.Path(report["sources"]["chunkManifest"]["path"]).read_text())
canonical = {key: manifest[key] for key in ["version", "image_len", "chunk_size", "layout", "chunks"]}
base_binding = digest(json.dumps(canonical, separators=(",", ":")).encode())
assert original[44:76].hex() == base_binding == report["pair"]["base"]
assert manifest["version"] == 1 and manifest["layout"] == "split"
assert manifest["image_len"] == 4294967296 and manifest["chunk_size"] == 262144
assert len(manifest["chunks"]) == 16384

delta = gzip.decompress(pathlib.Path(report["sources"]["overlayDelta"]["path"]).read_bytes())
assert delta[:5] == b"WVOD1" and u32(delta, 5) == 4096
assert u64(delta, 9) == manifest["image_len"]
assert delta[17:49].hex() == base_binding and u64(delta, 49) == u64(original, 76)
count = u32(delta, 57)
assert len(delta) == 61 + count * 4104 and count == report["pair"]["blocks"]
blocks, indices = {}, []
for record in range(count):
    position = 61 + record * 4104
    index = u64(delta, position)
    assert 0 <= index < 1048576 and index not in blocks
    indices.append(index)
    blocks[index] = delta[position + 8:position + 4104]
assert sorted(indices) == indices
expected_hash, before_hash, base_hash = hashlib.sha256(), hashlib.sha256(), hashlib.sha256()
matched_blocks = 0
with open(report["sources"]["image"]["path"], "rb") as base, open(report["privateInputs"]["beforeDrive"], "rb") as before:
    for chunk, expected_chunk_sha in enumerate(manifest["chunks"]):
        chunk_bytes = base.read(262144)
        assert len(chunk_bytes) == 262144 and digest(chunk_bytes) == expected_chunk_sha
        base_hash.update(chunk_bytes)
        expected = bytearray(chunk_bytes)
        for block in range(64):
            key = chunk * 64 + block
            if key in blocks:
                expected[block * 4096:(block + 1) * 4096] = blocks[key]
                matched_blocks += 1
        actual = before.read(262144)
        assert actual == expected, f"private pre-run image differs at chunk {chunk}"
        expected_hash.update(expected)
        before_hash.update(actual)
    assert not base.read(1) and not before.read(1)
assert matched_blocks == count
assert base_hash.hexdigest() == PINS["image"][1]
assert expected_hash.hexdigest() == before_hash.hexdigest() == report["privateInputs"]["driveSha256"]
assert file_digest(report["binary"]["path"]) == report["binary"]["sha256"]

stderr = (EVIDENCE / "native.stderr").read_text()
rows = [line[len("FP_SHARE_JSON "):] for line in stderr.splitlines() if line.startswith("FP_SHARE_JSON ")]
assert len(rows) == 1
profile = json.loads((EVIDENCE / "profile.json").read_text())
assert profile == json.loads(rows[0]), "detached profile differs from original process output"
assert not re.search(r"panicked at|fatal runtime|unreachable executed", stderr, re.I)
def histogram(mapping):
    result = {}
    for raw, count in mapping.items():
        assert re.fullmatch(r"0x[0-7][0-9a-f]", raw)
        assert type(count) is int and count > 0
        result[int(raw, 16)] = count
    return result
opcodes = histogram(profile["opcode7"])
functions = histogram(profile["op_fp_funct7"])
fmas = histogram(profile["fma_opcode7"])
total = sum(opcodes.values())
compute = sum(count for opcode, count in opcodes.items() if opcode in (0x43, 0x47, 0x4b, 0x4f, 0x53))
assert total == profile["total_retired"] == profile["trace_retired"]
assert 99000000 < total <= report["instructionBudget"] == 100000000
assert compute == profile["fp_compute"]
assert sum(functions.values()) == opcodes.get(0x53, 0)
for opcode in (0x43, 0x47, 0x4b, 0x4f):
    assert fmas.get(opcode, 0) == opcodes.get(opcode, 0)
assert not (set(fmas) - {0x43, 0x47, 0x4b, 0x4f})
assert profile["fp"] == profile["fp_ldst"] + compute
regions = profile["fp_region64"]
assert len(regions) == profile["fp_region64_distinct"] <= 65536
assert len({region["pc"] for region in regions}) == len(regions)
for region in regions:
    assert int(region["pc"], 16) % 64 == 0
    assert type(region["fp_compute"]) is int and 0 <= region["fp_compute"] <= region["total"]
assert profile["fp_region64_dropped"] == 0
assert sum(region["total"] for region in regions) == total
assert sum(region["fp_compute"] for region in regions) == compute
hot = sorted(regions, key=lambda region: -region["fp_compute"])[:8]
assert len(profile["pc_insn_top32"]) <= 32 and len(profile["fp_pc_insn_top32"]) <= 32
assert 0 <= profile["pair_hist_dropped"] <= total
assert profile["pair_hist_distinct"] <= 65536
guest = (EVIDENCE / "guest-evidence.txt").read_text().splitlines()
assert guest[1] == "trace fnv64=" + profile["trace_fnv64"]
assert guest[2] == "trace retired=" + str(total)
assert guest[3] == "trace mode=retirement-records"
assert re.fullmatch(r"state sha256=[0-9a-f]{64}", guest[4])
assert guest[5] == "outcome=MaxInstrs"
run = report["run"]
assert run["code"] == 102 and run["signal"] is None and not run["timedOut"]
elapsed = (datetime.datetime.fromisoformat(run["finishedAt"].replace("Z", "+00:00")) - datetime.datetime.fromisoformat(run["startedAt"].replace("Z", "+00:00"))).total_seconds()
assert 0 < elapsed < 300
assert report["build"]["code"] == 0 and not report["build"]["timedOut"]
args = run["args"]
assert "--no-input" in args and "--no-reboot" in args
assert not set(args).intersection({"--keyboard-proof", "--agent-proof", "--display-workload"})
assert args[args.index("--icount-divider") + 1] == "64"
assert args[args.index("--max-instrs") + 1] == "100000000"
assert args[args.index("--resume-from") + 1] == report["privateInputs"]["snapshot"]
assert run["command"] == report["binary"]["path"]
for source in ("tools/verify/omarchy-renderer-opcodes.mjs", "tools/verify/omarchy-renderer-opcodes.test.mjs", "crates/cli/src/boot.rs"):
    frozen = subprocess.check_output(["git", "show", f"{HEAD}:{source}"], cwd=ROOT)
    assert frozen == (ROOT / source).read_bytes(), "changed frozen source: " + source

result = {
    "result": "HELD",
    "frozenHead": HEAD,
    "sources": sources,
    "snapshot": {"rawBytes": len(original), "rawSha256": digest(original), "privateSha256": digest(private),
        "actualChangedOffsets": changed, "equalEveryByteOutside": [12, 76], "clockDivider": u64(clock, 8),
        "clockPhase": u64(clock, 0), "coreId": original[12:44].hex(), "baseBinding": base_binding, "generation": u64(original, 76)},
    "privateDisk": {"everyByteMatched": True, "everyManifestChunkMatched": True, "overlayRecords": count,
        "sha256": expected_hash.hexdigest()},
    "execution": {"pid": run["pid"], "elapsedSeconds": elapsed, "exit": 102,
        "binarySha256": report["binary"]["sha256"], "traceFnv64": profile["trace_fnv64"], "finalState": guest[4]},
    "counts": {"retired": total, "compute": compute, "computePercent": 100 * compute / total,
        "opFpFunct7": profile["op_fp_funct7"], "fmaOpcodes": profile["fma_opcode7"],
        "regionCount": len(regions), "hotComputeRegions": hot},
    "truncation": {"pairSlots": profile["pair_hist_distinct"], "pairDroppedSamples": profile["pair_hist_dropped"],
        "pairDroppedPercent": 100 * profile["pair_hist_dropped"] / total, "displayedPairLimit": 32, "regionDroppedSamples": 0},
    "limits": ["No independent compressed FP load/store recount from opcode7 aggregates.",
        "Zeroed private identity fields are not a restore-coherence claim.",
        "No native-throughput, browser-JIT-speedup or desktop-input claim.",
        "OS entropy and browser/native scheduling differences preclude cross-run trace-equivalence claims."],
    "evidenceDigests": {item.name: file_digest(item) for item in sorted(EVIDENCE.iterdir()) if item.is_file()},
}
print(json.dumps(result, indent=2))
