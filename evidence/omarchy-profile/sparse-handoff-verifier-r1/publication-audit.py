#!/usr/bin/env python3
"""Refetch the published immutable and production artifacts with a normal HTTP client."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
rows = json.loads((root / "evidence/omarchy-profile/sparse-handoff-final/publication.json").read_text())
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()

def check(row):
    command = ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "45", "--write-out", "%{http_code}", row["url"]]
    response = subprocess.check_output(command)
    status, body = int(response[-3:]), response[:-3]
    digest = hashlib.sha256(body).hexdigest()
    path = "web/dist" + urlsplit(row["url"]).path
    committed = subprocess.check_output(["git", "show", head + ":" + path], cwd=root)
    assert status == 200 and body == committed
    assert digest == row["sha256"] and len(body) == row["bytes"]
    return {"url": row["url"], "status": status, "bytes": len(body), "sha256": digest, "head": head, "matchesCommittedDist": True}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    result = list(pool.map(check, rows))
(out / "publication-audit.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
