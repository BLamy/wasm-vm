#!/usr/bin/env python3
"""Read final ext4 ownership and reviewed capabilities without mounting/writing it."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess
import tempfile


def check(image, overlays, output):
    if not image.is_file() or output.exists():
        raise ValueError("existing image and new metadata receipt required")
    rows = []
    names = ("/usr/lib/chromium/chromium", "/usr/lib/libreoffice/program/soffice.bin", "/usr/bin/node", "/usr/bin/npm",
             "/etc/passwd", "/etc/shadow", "/home/omarchy")
    for name in names:
        result = subprocess.run(["debugfs", "-R", "stat " + name, str(image)], capture_output=True, text=True, check=True)
        expected = 1000 if name == "/home/omarchy" else 0
        match = re.search(r"User:\s*(\d+)\s+Group:\s*(\d+)", result.stdout)
        if not match or tuple(map(int, match.groups())) != (expected, expected):
            raise ValueError("incorrect final filesystem ownership: " + name)
        rows.append({"path": name, "uid": expected, "gid": expected, "stat": result.stdout})
    capabilities = []
    with tempfile.TemporaryDirectory(prefix="omarchy-capability-") as temporary:
        for number, entry in enumerate(json.loads(overlays.read_text())["entries"]):
            if not entry.get("xattrs"):
                continue
            if not re.fullmatch(r"/[A-Za-z0-9/_.+-]+", entry["path"]):
                raise ValueError("unsafe reviewed metadata path")
            for name, expected in entry["xattrs"].items():
                if name != "security.capability":
                    raise ValueError("unexpected reviewed metadata kind")
                destination = Path(temporary) / str(number)
                result = subprocess.run(["debugfs", "-R", f"ea_get -f {destination} {entry['path']} {name}", str(image)],
                                        capture_output=True, text=True, check=True)
                if not destination.is_file() or base64.b64encode(destination.read_bytes()).decode() != expected:
                    raise ValueError("final filesystem capability differs: " + entry["path"])
                capabilities.append({"path": entry["path"], "name": name, "base64": expected, "debugfs": result.stdout + result.stderr})
    receipt = {"status": "passed", "ownership": rows, "capabilities": capabilities, "access": "debugfs read-only; no mount or image mutation"}
    output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"Verified {len(rows)} final ownership records and {len(capabilities)} exact capability xattrs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    check(args.image, args.overlays, args.output)
