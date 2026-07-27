#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
doc="${1:-$repo_root/docs/design/file-transfer.md}"

python3 - "$doc" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(f"missing protocol document: {path}")
text = path.read_text(encoding="utf-8")
flat_text = re.sub(r"\s+", " ", text)

required_headings = [
    "## Decision",
    "### Alternatives considered",
    "## Transport and protocol constants",
    "## Frame envelope",
    "## Frame types and exact payloads",
    "## Name normalization",
    "## Host-to-guest upload state machine",
    "## Guest-to-host download state machine",
    "## Cancellation, interruption, and errors",
    "## Threat model and capability statement",
    "### Capabilities intentionally granted to guest code",
    "### Capabilities not granted",
    "## Required adversarial vectors",
]
for heading in required_headings:
    if heading not in text:
        raise SystemExit(f"missing required section: {heading}")

required_mechanisms = ["virtio-9p / virtio-fs", "Sideload block device", "Guest agent over slirp"]
for mechanism in required_mechanisms:
    if mechanism not in text:
        raise SystemExit(f"missing mechanism comparison: {mechanism}")

constants = {
    "VERSION": "1",
    "HEADER_BYTES": "16",
    "MAX_FRAME_PAYLOAD": "65536",
    "MAX_DATA_BYTES": "65528",
    "MAX_TRANSFER_BYTES": "1073741824",
    "MAX_NAME_BYTES": "255",
    "MAX_CONCURRENT_TRANSFERS": "2",
    "MAX_IN_FLIGHT_DATA_FRAMES": "4",
    "MAX_CONTROL_PAYLOAD": "4096",
    "IDLE_TIMEOUT_SECONDS": "30",
}
for name, value in constants.items():
    pattern = rf"\|\s*`{re.escape(name)}`\s*\|\s*`?{re.escape(value)}`?"
    if not re.search(pattern, text):
        raise SystemExit(f"missing or changed protocol constant: {name}={value}")

frame_types = {
    "HELLO": 1,
    "HELLO_ACK": 2,
    "OFFER": 3,
    "ACCEPT": 4,
    "DATA": 5,
    "ACK": 6,
    "COMMIT": 7,
    "COMPLETE": 8,
    "CANCEL": 9,
    "ERROR": 10,
}
for name, code in frame_types.items():
    if not re.search(rf"\|\s*`{name}`\s*\|\s*{code}\s*\|", text):
        raise SystemExit(f"missing frame assignment: {name}={code}")

required_terms = [
    "network byte order",
    "`payload_len` is the sole frame boundary",
    "invalid length before allocation",
    "strict UTF-8",
    "Unicode NFC",
    "`O_NOFOLLOW`",
    "atomic no-replace rename",
    "durable commit record",
    "parent-directory `fsync`",
    "receiver-controlled flow control",
    "reading a whole transfer into memory is forbidden",
    "retain only `.wvft-<stream_id>.part`",
    "Version 1 does not resume partial transfers",
    "**No arbitrary host fetch:**",
    "**No arbitrary host filesystem access:**",
    "**No eval or command execution:**",
    "**No public ingress:**",
    "A sender cannot manufacture COMPLETE",
]
for term in required_terms:
    if term not in text and term not in flat_text:
        raise SystemExit(f"missing normative requirement: {term}")

states = ["NEGOTIATE", "OFFERED", "RECEIVING", "COMMITTING", "COMPLETE"]
for state in states:
    if text.count(f"**{state}:**") != 2:
        raise SystemExit(f"state {state} must be specified once for upload and once for download")

hostile_vectors = [
    "/etc/passwd",
    "../x",
    "a/b",
    r"a\b",
    "x<NUL>y",
    "NFC collisions",
    "symlink replacement",
    "DATA after COMMIT",
    "between rename and directory fsync",
    "u32::MAX",
    "u64::MAX",
]
for vector in hostile_vectors:
    if vector not in text:
        raise SystemExit(f"missing adversarial vector: {vector}")

for error in [
    "BAD_FRAME",
    "BAD_STATE",
    "BAD_NAME",
    "BAD_OFFSET",
    "TOO_LARGE",
    "BUSY",
    "QUOTA",
    "FLOW_CONTROL",
    "HASH_MISMATCH",
    "SOURCE_CHANGED",
    "CANCELLED",
    "TIMEOUT",
    "COMPLETION_UNKNOWN",
    "IO",
]:
    if error not in text:
        raise SystemExit(f"missing stable error: {error}")

if "/var/lib/wasm-vm/transfer/inbox" not in text or "/var/lib/wasm-vm/transfer/outbox" not in text:
    raise SystemExit("fixed inbox/outbox roots are not both specified")

print(
    "E3-T21a protocol: OK "
    f"({len(constants)} constants, {len(frame_types)} frame types, "
    f"{len(hostile_vectors)} adversarial vectors)"
)
PY
