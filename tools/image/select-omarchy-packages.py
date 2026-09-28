#!/usr/bin/env python3
"""Select a bounded installed-package dependency closure, with explicit providers.

This selects package identities, not semantic version compatibility. Pacman's
database check is required after assembly; no dependency constraint is waived.
"""
import argparse
import json
from pathlib import Path
import re


def fields(path):
    result = {}
    key = None
    for line in path.read_text().splitlines():
        if line.startswith("%") and line.endswith("%"):
            key = line.strip("%")
            result[key] = []
        elif line and key:
            result[key].append(line)
    return result


def select(database, profile):
    packages = {}
    providers = {}
    for entry in sorted(database.glob("*/desc")):
        record = fields(entry)
        name = record["NAME"][0]
        if name in packages:
            raise ValueError(f"duplicate package: {name}")
        packages[name] = record
        for provision in record.get("PROVIDES", []):
            providers.setdefault(re.split("[<>=]", provision)[0], set()).add(name)
    chosen = set()
    todo = list(profile["seeds"])
    while todo:
        requirement = todo.pop()
        name = re.split("[<>=]", requirement)[0]
        if name not in packages:
            candidates = providers.get(name, set())
            selected = profile.get("providers", {}).get(name)
            if selected:
                if selected not in candidates:
                    raise ValueError(f"invalid provider for {name}")
                name = selected
            elif len(candidates) == 1:
                name = next(iter(candidates))
            else:
                raise ValueError(f"missing or ambiguous dependency: {name}")
        if name not in chosen:
            chosen.add(name)
            todo.extend(packages[name].get("DEPENDS", []))
    return {
        "schema": 1,
        "packages": sorted(chosen),
        "installedBytes": sum(int(packages[n].get("SIZE", ["0"])[0]) for n in chosen),
        "versions": {n: packages[n]["VERSION"][0] for n in sorted(chosen)},
        "versionConstraintsChecked": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = select(args.database, json.loads(args.profile.read_text()))
    # Never replace an earlier selection or a source database file.
    with args.output.open("x") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(f"Selected {len(result['packages'])} packages, {result['installedBytes']} installed bytes")


if __name__ == "__main__":
    main()
