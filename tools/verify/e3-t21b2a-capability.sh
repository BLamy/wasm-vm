#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
source_file="$repo/crates/file-agent-storage/src/lib.rs"

python3 - "$source_file" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
runtime = text.split("#[cfg(test)]", 1)[0]

required = [
    "libc::openat",
    "libc::O_NOFOLLOW",
    "libc::linkat",
    "MAX_CONCURRENT_TRANSFERS",
    "MAX_TRANSFER_BYTES",
    "AfterRecordSync",
    "AfterRename",
    "AfterDirectorySync",
]
for token in required:
    if token not in runtime:
        raise SystemExit(f"missing storage boundary token: {token}")

for forbidden in [
    "std::net",
    "std::process",
    "TcpListener",
    "TcpStream",
    "UdpSocket",
    "SocketAddr",
    "Command::",
]:
    if forbidden in runtime:
        raise SystemExit(f"forbidden ambient capability in storage runtime: {forbidden}")

signatures = re.findall(r"pub fn\s+\w+\s*\([^)]*\)(?:\s*->\s*[^{]+)?", runtime, re.S)
for signature in signatures:
    compact = " ".join(signature.split())
    if compact.startswith("pub fn open(config: Config)"):
        continue
    for forbidden in ["Path", "PathBuf", "OsStr", "CStr", "IpAddr", "Socket", "Command"]:
        if forbidden in compact:
            raise SystemExit(f"transfer API exposes {forbidden}: {compact}")

expected = {
    "begin_upload": ["name: &str", "total_len: u64", "expected_sha: [u8; 32]"],
    "open_download": ["name: &str"],
    "write_chunk": ["offset: u64", "bytes: &[u8]"],
    "read_chunk": ["max: usize"],
}
for name, fields in expected.items():
    match = re.search(rf"pub fn\s+{name}\s*\([^)]*\)", runtime, re.S)
    if not match:
        raise SystemExit(f"missing bounded API method: {name}")
    signature = " ".join(match.group(0).split())
    for field in fields:
        if field not in signature:
            raise SystemExit(f"{name} missing exact field {field}: {signature}")

print(f"E3-T21b2a capability: OK ({len(signatures)} public methods, no network/process/path transfer authority)")
PY
