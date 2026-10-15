"""Independent static source accounting; reads recipes, never executes them."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tarfile

ROOT = Path.cwd()
OUT = ROOT / "evidence/omarchy-app-catalog/verifier"
CAT = json.loads((ROOT / "tools/image/omarchy-apps/catalog.json").read_text())
sha = lambda body: hashlib.sha256(body).hexdigest()
records = json.loads((ROOT / "evidence/omarchy-app-catalog/records.json").read_text())
for row in records["files"]:
    body = (ROOT / row["path"]).read_bytes()
    assert len(body) == row["bytes"] and sha(body) == row["sha256"], row["path"]
for command in records["commands"]:
    assert sha((ROOT / command["log"]).read_bytes()) == command["sha256"] and command["exitCode"] == 0
sources = [CAT["upstream"], CAT["existingSelection"], *CAT["repositories"], *CAT["recipes"], *CAT["archiveEvidence"]]
for row in sources:
    body = (ROOT / row["path"]).read_bytes()
    assert sha(body) == row["sha256"] and len(body) == row["bytes"]
upstream = [line.strip() for line in (ROOT / CAT["upstream"]["path"]).read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")]
assert len(upstream) == len(set(upstream)) == 147
assert [row["upstreamName"] for row in CAT["entries"]] == upstream + ["nodejs", "npm"]
assert len(CAT["entries"]) == 149
assert CAT["claims"] == {"installed": False, "executionProven": False,
                         "signaturesVerified": False, "missingOrLargeMeansIncompatible": False}
existing = json.loads((ROOT / CAT["existingSelection"]["path"]).read_text())["versions"]
assert subprocess.check_output(["git", "show", "41b9e397:" + CAT["existingSelection"]["path"]]) == (ROOT / CAT["existingSelection"]["path"]).read_bytes()
packages, all_records, invalid = {}, {}, []
for source in CAT["repositories"]:
    with tarfile.open(ROOT / source["path"]) as archive:
        for member in archive:
            if not member.name.endswith("/desc"):
                continue
            original = archive.extractfile(member).read()
            fields = {match.group(1): match.group(2).strip().splitlines()
                      for match in re.finditer(r"^%([A-Z0-9_]+)%\n(.*?)(?=\n\n|\Z)", original.decode(), re.M | re.S)}
            if any(not fields.get(name) for name in ("NAME", "VERSION", "ARCH", "FILENAME", "SHA256SUM")):
                invalid.append({"repo": source["name"], "member": member.name, "sha256": sha(original), "allNul": not original.strip(b"\0")})
                continue
            name = fields["NAME"][0]
            value = {"repository": source["name"], "member": member.name, "fields": fields}
            all_records.setdefault(name, []).append(value)
            packages.setdefault(name, value)
assert [(row["repo"], row["member"], row["sha256"]) for row in invalid] == [(row["repo"], row["member"], row["sha256"]) for row in CAT["invalidRepositoryRecords"]]
assert len(invalid) == 1 and invalid[0]["allNul"] and "ntk" not in upstream
assert [row["repository"] for row in all_records["argon2"]] == ["core", "extra"]
assert packages["argon2"]["repository"] == "core" and "argon2" not in upstream
aliases = {"nvim": "neovim", "mise-bin": "mise"}
accounted = []
for row in CAT["entries"]:
    name, package = row["upstreamName"], row["package"]
    assert package == aliases.get(name, name)
    if package in existing:
        expected = "existing-image"
        assert row["version"] == existing[package]
    elif package in packages:
        expected = "native-repository-candidate"
        original = packages[package]
        fields = original["fields"]
        assert row["repository"] == original["repository"]
        for label, field in (("version", "VERSION"), ("architecture", "ARCH"), ("archive", "FILENAME"), ("sha256", "SHA256SUM")):
            assert row[label] == fields[field][0], name
        assert row["architecture"] in ("riscv64", "any")
    else:
        recipe = (ROOT / row["recipe"]).read_text()
        arch = re.search(r"^arch=\(([^\n]*)\)", recipe, re.M).group(1)
        declared = re.findall(r"[A-Za-z0-9_]+", arch)
        expected = "portable-data-or-script" if declared == ["any"] else "source-port-required"
        assert row["executionProven"] is False
    assert row["disposition"] == expected, name
    assert row["origin"] == ("upstream" if name in upstream else "user-request")
    assert row["priority"] is (name in ("chromium", "libreoffice-fresh", "nodejs", "npm"))
    accounted.append({"upstreamName": name, "package": package, "disposition": expected})
totals = dict(Counter(row["disposition"] for row in accounted[:147]))
assert totals == {"existing-image": 32, "native-repository-candidate": 97, "source-port-required": 13, "portable-data-or-script": 5}
inspections = json.loads((ROOT / "evidence/omarchy-app-catalog/inputs/archive-inspection.json").read_text())["packages"]
headers = []
for inspection in inspections:
    if inspection["package"] == "npm":
        assert "arch = any\n" in inspection["pkginfo"]
        continue
    candidate = next(row for row in CAT["entries"] if row["package"] == inspection["package"])
    archive = ROOT / "target/omarchy-full/packages" / candidate["archive"]
    process = subprocess.Popen(["bsdtar", "-xOf", str(archive), inspection["elf"]["entry"]], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        header = process.stdout.read(64)
    finally:
        process.terminate()
        process.communicate()
    assert header == bytes.fromhex(inspection["elf"]["headerHex"])
    assert header[:7] == b"\x7fELF\x02\x01\x01" and struct.unpack_from("<H", header, 18)[0] == 243
    headers.append({"package": inspection["package"], "archive": candidate["archive"], "entry": inspection["elf"]["entry"], "headerHex": header.hex(), "class": "ELF64", "endian": "little", "machine": 243})
report = {"status": "passed", "scope": "static discovery/source accounting only", "workerHead": "d52f9b8beed4a94e3f523a56f3506830a4b178a3", "sourceRecordsRehashed": len(sources), "workerRecordedBodiesRehashed": len(records["files"]), "upstreamEntries": 147, "additionalUserEntries": 2, "upstreamDispositions": totals, "aliases": aliases, "invalidRecords": invalid, "duplicateArgon2Repositories": [row["repository"] for row in all_records["argon2"]], "entries": accounted, "originalElfHeadersReopened": headers, "noInstallationExecutionOrSignatureClaim": True}
(OUT / "direct-accounting.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: value for key, value in report.items() if key not in ("entries", "originalElfHeadersReopened")}))
