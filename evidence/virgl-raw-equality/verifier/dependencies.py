#!/usr/bin/env python3
"""Inventory the local validator modules actually loaded by the frozen auditor."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

p = argparse.ArgumentParser()
p.add_argument('--clone', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
root = a.clone.resolve()
files = set()
original = importlib.util.spec_from_file_location


def tracked(name, path, *args, **kwargs):
    path = Path(path).resolve()
    if path.is_relative_to(root):
        files.add(str(path.relative_to(root)))
    return original(name, path, *args, **kwargs)


importlib.util.spec_from_file_location = tracked
sys.path.insert(0, str(root / 'tools/virgl-raw-equality'))
import receipt
r = receipt.verify(root / 'target/evidence/virgl-raw-equality-cold',
                   'a7be954c1f3bea9dd1e96522e890fa012197c6fe')
for module in sys.modules.values():
    if hasattr(module, '__file__') and module.__file__:
        path = Path(module.__file__).resolve()
        if path.is_file() and path.is_relative_to(root):
            files.add(str(path.relative_to(root)))
missing = files - {e['path'] for e in r['sources']}
assert not missing
a.output.write_text(json.dumps({'loaded': sorted(files), 'notBound': sorted(missing)}, indent=2) + '\n')
print('All actual imported proof dependencies bound:', len(files))
