#!/usr/bin/env python3
"""Regenerate pinned upstream tables; ordinary builds use checked-in outputs."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

import yaml


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare without writing")
    args = parser.parse_args()
    if yaml.__version__ != "6.0.2":
        raise SystemExit("Regeneration requires PyYAML==6.0.2")
    root = Path(__file__).resolve().parent
    util = root / "vendor/src/gallium/auxiliary/util"
    generator = util / "u_format_table.py"
    source = util / "u_format.yaml"
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    outputs = {}
    for name, options in [("u_format_gen.h", ["--enums"]), ("u_format_table.c", [])]:
        outputs[name] = subprocess.check_output(
            [sys.executable, str(generator), *options, str(source)], env=env
        )
    version = (root / "vendor/src/virgl-version.h.meson").read_text()
    for key, value in [("MAJOR", "1"), ("MINOR", "3"), ("MICRO", "0")]:
        version = version.replace("@VIRGL_" + key + "_VERSION@", value)
    outputs["virgl-version.h"] = version.encode()
    for name, data in outputs.items():
        path = root / "generated" / name
        if args.check:
            if path.read_bytes() != data:
                raise SystemExit("Generated file differs: " + name)
        else:
            path.write_bytes(data)
    print("Generated data matches pinned upstream and PyYAML 6.0.2" if args.check else "Generated data regenerated; review and update UPSTREAM.json hashes deliberately")


if __name__ == "__main__":
    main()
