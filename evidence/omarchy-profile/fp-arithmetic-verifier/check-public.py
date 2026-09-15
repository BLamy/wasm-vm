#!/usr/bin/env python3
"""Independent TLS byte check against the frozen repair source."""
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
source = "d64b037b362b36490d58b82663a448ac0532b025"
rows = []
with tempfile.TemporaryDirectory(prefix="fp-arithmetic-critic-public-", dir="/private/tmp") as scratch:
    for origin in ["https://52209836.wasm-vm.pages.dev", "https://wasm-vm.pages.dev"]:
        for name in ["pkg/wasm_vm_wasm_bg.wasm", "pkg/wasm_vm_wasm.js", "roadmap.js", "app.html"]:
            target = Path(scratch) / "artifact"
            url = origin + "/" + name + "?critic=" + source
            result = subprocess.run(
                ["/usr/bin/curl", "--fail", "--silent", "--show-error", "--location",
                 "--max-time", "30", "--output", str(target), "--write-out", "%{http_code}", url],
                capture_output=True, text=True,
            )
            assert result.returncode == 0, (url, result.returncode, result.stderr)
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            expected = hashlib.sha256(subprocess.check_output(
                ["git", "show", source + ":web/dist/" + name], cwd=root,
            )).hexdigest()
            assert actual == expected, (url, actual, expected)
            rows.append({"url": url, "status": int(result.stdout), "sha256": actual,
                         "expectedSha256": expected, "sourceHead": source,
                         "bytes": target.stat().st_size,
                         "checkedAt": datetime.now(timezone.utc).isoformat(),
                         "client": "system curl; TLS verification enabled"})
(out / "independent-public-bytes.json").write_text(json.dumps(rows, indent=2) + "\n")
print("independent public byte checks passed:", len(rows))
