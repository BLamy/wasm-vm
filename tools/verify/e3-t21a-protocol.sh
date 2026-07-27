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
    "`RESOLVE_NO_XDEV`",
    "`st_nlink != 1`",
    "`st_nlink == 1` both before and after streaming",
    "atomic no-replace rename",
    "durable commit record",
    "final-name visibility point",
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
    "out-of-root hard-link fixture",
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

required_interruption_rows = [
    "| sender or receiver CANCEL before final-name visibility |",
    "| CANCEL after final-name visibility |",
    "| EOF, timeout, tab kill, or VM stop before final-name visibility |",
    "| EOF after final-name visibility but before durable promotion |",
    "| EOF after durable promotion but before COMPLETE is observed |",
]
for row in required_interruption_rows:
    if row not in text:
        raise SystemExit(f"missing interruption outcome row: {row}")

capability_rows = {
    "URL, DNS name, destination IP, or port": "DENY",
    "host path or host directory enumeration": "DENY",
    "guest path containing a directory component": "DENY",
    "command, shell, eval, dynamic import, or URL handler": "DENY",
    "host listener or public ingress": "DENY",
}
for capability, policy in capability_rows.items():
    pattern = rf"\|\s*{re.escape(capability)}\s*\|\s*`{policy}`\s*\|"
    if not re.search(pattern, text):
        raise SystemExit(f"missing normative capability policy: {capability}={policy}")

if "`st_nlink != 1` is `ERROR(BAD_NAME)`" not in flat_text:
    raise SystemExit("hard-link rejection must map st_nlink != 1 exactly to ERROR(BAD_NAME)")

permissive = re.compile(
    r"\b(?:[Aa]llows?|[Aa]llowed|[Aa]llowing|[Pp]ermits?|[Pp]ermitted|[Pp]ermitting|"
    r"[Aa]ccepts?|[Aa]ccepted|[Aa]ccepting|[Ee]nables?|[Ee]nabled|[Ee]nabling)\b",
)
capability_section_match = re.search(
    r"### Capabilities not granted\n(.*?)\n### Abuse controls",
    text,
    re.DOTALL,
)
if not capability_section_match:
    raise SystemExit("missing complete normative denied-capabilities section")
if permissive.search(capability_section_match.group(1)):
    raise SystemExit("permissive language is forbidden in the denied-capabilities section")

denied_subject = re.compile(
    r"\b(URL|DNS name|destination IP|host path|command|shell|eval|public ingress|hard[- ]link|st_nlink)\b",
    re.IGNORECASE,
)
for paragraph_number, paragraph in enumerate(re.split(r"\n\s*\n", text), 1):
    if permissive.search(paragraph) and denied_subject.search(paragraph):
        raise SystemExit(
            f"permissive language about a denied capability in paragraph {paragraph_number}"
        )

print(
    "E3-T21a protocol: OK "
    f"({len(constants)} constants, {len(frame_types)} frame types, "
    f"{len(hostile_vectors)} adversarial vectors, "
    f"{len(required_interruption_rows)} interruption outcomes, "
    f"{len(capability_rows)} denied capabilities)"
)
PY
