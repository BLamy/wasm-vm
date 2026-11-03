#!/usr/bin/env python3
"""Read-only integrity check for the retained, locally built RISC-V browser."""
import hashlib
import json
from pathlib import Path
import re
import struct
import tarfile


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tools/chromium/built/manifest.json"


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def identity(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def checked_path(relative):
    path = (ROOT / relative).resolve()
    require(path.is_relative_to(ROOT), "Artifact escapes the project: " + relative)
    require(path.is_file(), "Required local artifact is missing: " + relative)
    return path


def main():
    data = json.loads(MANIFEST.read_text())
    require(data["version"] == 1, "Unsupported build-record format")
    require(data["sourceRevision"] == "f2472ba7bee0ed0d91736df49035af867cce6692",
            "Unexpected Replay source revision")
    for group in ("archive", "localArtifacts"):
        for relative, expected in data[group].items():
            require(identity(checked_path(relative)) == expected,
                    "Artifact digest mismatch: " + relative)

    for role in ("chrome", "sandboxTests"):
        with checked_path(data["executables"][role]).open("rb") as stream:
            header = stream.read(64)
        require(len(header) == 64 and header[:6] == b"\x7fELF\x02\x01",
                "Expected a little-endian ELF64 executable: " + role)
        require(struct.unpack_from("<H", header, 18)[0] == 243,
                "Executable is not RISC-V: " + role)

    runtime = json.loads((ROOT / "tools/chromium/built/runtime-files.json").read_text())
    require(runtime["source_revision"] == data["sourceRevision"], "Runtime source pin mismatch")
    seen = set()
    with tarfile.open(checked_path(data["runtimeBundle"]), "r:gz") as archive:
        for member in archive:
            if member.isdir():
                continue
            require(member.isfile() and member.name.startswith("replay-chromium/"),
                    "Unexpected runtime archive entry: " + member.name)
            name = member.name.removeprefix("replay-chromium/")
            require(name not in seen, "Duplicate runtime entry: " + name)
            seen.add(name)
            stream = archive.extractfile(member)
            if name == "SHA256SUMS":
                expected = "".join(digest + "  " + path + "\n"
                                   for path, digest in runtime["files"].items())
                require(stream.read() == expected.encode(), "Runtime checksum list differs")
            else:
                require(name in runtime["files"], "Unlisted runtime file: " + name)
                digest = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
                require(digest.hexdigest() == runtime["files"][name],
                        "Runtime bundle file differs: " + name)
    require(seen == set(runtime["files"]) | {"SHA256SUMS"}, "Runtime bundle is incomplete")

    built = ROOT / "tools/chromium/built"
    source = json.loads((built / "source-inputs.json").read_text())
    native = json.loads((built / "native-source-check.json").read_text())
    require(source["sourceRevision"] == data["sourceRevision"], "Source pin mismatch")
    require(source["files"] == native["files"] and len(source["files"]) == 92,
            "Archived source/native build correspondence differs")

    record = checked_path(data["referenceTranscript"]).read_text()
    suite = record.split("\nSANDBOX_FULL_LOG_BEGIN\n", 1)[1].split(
        "\nSANDBOX_FULL_LOG_END\n", 1)[0]
    indices = [int(value) for value in re.findall(r"^\[(\d+)/338\]", suite, re.M)]
    require(indices == list(range(1, 339)) and "SUCCESS: all tests passed." in suite,
            "The archived reference suite did not complete all 338 cases")
    require("Linux replay-riscv 6.6.63" in record and "riscv64 GNU/Linux" in record,
            "Missing reference kernel identity")
    for role in ("chrome", "sandboxTests"):
        digest = data["localArtifacts"][data["executables"][role]]["sha256"]
        require(digest in record, "Reference transcript has a different binary: " + role)
    statuses = re.findall(
        r"^RENDERER_STATUS=[^\n]+\n(.*?)(?=^RENDERER_STATUS=|^REFERENCE_IDENTITY_END)",
        record, re.M | re.S)
    require(len(statuses) == 2, "Expected two archived renderer status observations")
    for status in statuses:
        require(re.search(r"^NoNewPrivs:\s+1$", status, re.M)
                and re.search(r"^Seccomp:\s+2$", status, re.M),
                "Renderer observation lacks the recorded sandbox state")
    print(f"OK: {len(data['archive'])} archived files and "
          f"{len(data['localArtifacts'])} retained build artifacts match their digests")
    print("OK: ELF64 RISC-V browser and sandbox tests; 92 source inputs match the native-build record")
    print("OK: preserved QEMU reference transcript: 338 suite cases and two seccomp observations")
    print("Scope: archival integrity; no browser execution or wasm-vm integration is claimed by this check")


if __name__ == "__main__":
    main()
