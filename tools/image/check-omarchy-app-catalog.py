#!/usr/bin/env python3
"""Check the complete, static Omarchy app inventory; never install or execute recipes."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "tools/image/omarchy-apps/catalog.json"
ALIASES = {"nvim": "neovim", "mise-bin": "mise"}
PRIORITY = ("chromium", "libreoffice-fresh", "nodejs", "npm")
PORTABLE = {"omarchy-nvim", "tobi-try", "ttf-ia-writer", "ufw-docker", "yaru-icon-theme"}


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read(path):
    return json.loads((ROOT / path).read_text())


def repositories(catalog):
    packages, invalid = {}, []
    if [repo["name"] for repo in catalog["repositories"]] != ["core", "extra", "unsupported"]:
        raise ValueError("repository precedence must match core, extra, unsupported")
    for repo in catalog["repositories"]:
        with tarfile.open(ROOT / repo["path"]) as archive:
            for member in archive:
                if not member.name.endswith("/desc"):
                    continue
                body = archive.extractfile(member).read()
                fields = {}
                for section in body.decode().strip().split("\n\n"):
                    lines = section.splitlines()
                    if lines and re.fullmatch(r"%[A-Z0-9_]+%", lines[0]):
                        fields[lines[0][1:-1]] = lines[1:]
                if not all(fields.get(k) for k in ("NAME", "VERSION", "ARCH", "FILENAME", "SHA256SUM")):
                    invalid.append({"repo": repo["name"], "member": member.name, "sha256": hashlib.sha256(body).hexdigest()})
                    continue
                name = fields["NAME"][0]
                if name in packages:
                    # Like pacman, the first configured repository wins. The
                    # captured repositories both contain argon2; neither is used
                    # as an application seed. Do not infer version ordering.
                    continue
                packages[name] = {"package": name, "repository": repo["name"],
                                  "version": fields["VERSION"][0], "architecture": fields["ARCH"][0],
                                  "archive": fields["FILENAME"][0], "sha256": fields["SHA256SUM"][0]}
    if invalid != catalog["invalidRepositoryRecords"]:
        raise ValueError("repository damage differs from recorded discovery")
    return packages


def expected_entries(catalog):
    upstream = [line for line in (ROOT / catalog["upstream"]["path"]).read_text().splitlines()
                if line and not line.startswith("#")]
    if len(upstream) != 147 or len(set(upstream)) != 147:
        raise ValueError("expected all 147 unique upstream Omarchy4.0.2 entries")
    installed = read(catalog["existingSelection"]["path"])["versions"]
    packages = repositories(catalog)
    result = []
    for name in upstream + ["nodejs", "npm"]:
        package = ALIASES.get(name, name)
        entry = {"upstreamName": name, "package": package, "origin": "upstream" if name in upstream else "user-request",
                 "priority": name in PRIORITY}
        if package in installed:
            entry.update(disposition="existing-image", version=installed[package])
        elif package in packages:
            entry.update(disposition="native-repository-candidate", **packages[package])
            if entry["architecture"] not in ("riscv64", "any"):
                raise ValueError(f"non-RISC-V repository candidate: {name}")
        else:
            recipe = next((r for r in catalog["recipes"] if r["name"] == name), None)
            if not recipe:
                raise ValueError(f"missing explicit source-port record: {name}")
            entry.update(disposition="portable-data-or-script" if name in PORTABLE else "source-port-required",
                         recipe=recipe["path"], executionProven=False)
        result.append(entry)
    return result


def check(archives=None):
    catalog = read(str(CATALOG.relative_to(ROOT)))
    for source in [catalog["upstream"], catalog["existingSelection"], *catalog["repositories"],
                   *catalog["recipes"], *catalog["archiveEvidence"]]:
        path = ROOT / source["path"]
        if not path.is_file() or path.stat().st_size != source["bytes"] or sha(path) != source["sha256"]:
            raise ValueError(f"source digest mismatch: {source['path']}")
    expected = expected_entries(catalog)
    if catalog["entries"] != expected:
        raise ValueError("catalogue must account for every upstream entry exactly, with its source-backed disposition")
    if catalog["claims"] != {"installed": False, "executionProven": False, "signaturesVerified": False,
                             "missingOrLargeMeansIncompatible": False}:
        raise ValueError("discovery must not claim an installed or incompatible application")
    inspections = read("evidence/omarchy-app-catalog/inputs/archive-inspection.json")["packages"]
    fetched = {p["name"]: p for p in read("evidence/omarchy-app-catalog/inputs/archive-fetch.json")["packages"]}
    candidates = {p["package"]: p for p in expected}
    for item in inspections:
        name = item["package"]
        record = candidates[name]
        fetch = fetched[name]
        if name not in PRIORITY or record["sha256"] != fetch["sha256"] or record["archive"] != item["archive"]:
            raise ValueError("priority archive does not match repository discovery")
        info = dict(line.split(" = ", 1) for line in item["pkginfo"].splitlines()
                    if line.startswith(("pkgname = ", "pkgver = ", "arch = ")))
        if info != {"pkgname": name, "pkgver": record["version"], "arch": record["architecture"]}:
            raise ValueError("actual archive metadata differs from repository")
        if item["executionProven"] or item["signatureVerification"] != "pending":
            raise ValueError("archive inspection is not execution or signature evidence")
        if name != "npm":
            header = bytes.fromhex(item["elf"]["headerHex"])
            if len(header) != 64 or header[:6] != b"\x7fELF\x02\x01" or int.from_bytes(header[18:20], "little") != 243:
                raise ValueError("priority executable is not ELF64 little-endian RISC-V")
        if archives is not None:
            path = archives / record["archive"]
            if sha(path) != record["sha256"] or sha(Path(str(path) + ".sig")) != fetch["signatureSha256"]:
                raise ValueError("downloaded archive/signature digest mismatch")
            pkginfo = subprocess.check_output(["bsdtar", "-xOf", str(path), ".PKGINFO"]).decode()
            if pkginfo != item["pkginfo"]:
                raise ValueError("archive metadata inspection cannot be reproduced")
            if name != "npm":
                process = subprocess.Popen(["bsdtar", "-xOf", str(path), item["elf"]["entry"]], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                try:
                    actual = process.stdout.read(64)
                finally:
                    process.terminate()
                    process.communicate()
                if actual != header:
                    raise ValueError("actual priority executable header differs")
    if {p["package"] for p in inspections} != set(PRIORITY):
        raise ValueError("all four priority package inspections are required")
    result = {"status": "passed", "scope": "static discovery only", "upstreamEntries": 147,
              "additionalUserEntries": 2, "dispositions": dict(Counter(p["disposition"] for p in expected)),
              "actualArchivesReopened": archives is not None,
              "unresolvedPorts": [p["upstreamName"] for p in expected if p["disposition"] == "source-port-required"]}
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archives", type=Path, help="also reopen actual downloaded archives and inspect native ELF headers")
    check(parser.parse_args().archives)
