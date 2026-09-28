#!/usr/bin/env python3
"""Prove physical/browser control logic changed only task/artifact labels."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path.cwd()
BASE = '04ea9fe4'
OUT = ROOT / 'evidence/omarchy-profile/direct-fp-imports-verifier/harness-parity.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def baseline(path):
    return subprocess.check_output(['git', 'show', BASE + ':' + path])


rows = []
for old, new, replacements in [
    ('tools/verify/omarchy-fmadd-browser.mjs', 'tools/verify/omarchy-direct-fp-browser.mjs', [
        ('compiled FMADD.S loop', 'direct imported FP loop'),
        ('evidence/omarchy-profile/fmadd-browser', 'evidence/omarchy-profile/direct-fp-browser'),
        ('bounded FMADD fixture', 'bounded direct-import FP fixture'),
        ('E5.5-T03an', 'E5.5-T03ao'),
    ]),
    ('tools/verify/omarchy-fmadd-input.mjs', 'tools/verify/omarchy-direct-fp-input.mjs', [
        ('One existing recycling option; preserve the input verdict before optional host profiling.', 'Direct FP imports on the unchanged prepared pair and physical input contract.'),
        ('FMADD_WASM', 'DIRECT_FP_WASM'),
        ('0f9b1213fa160f31d4f35503f6b35b4caf7193668eac3c369ac4a75611b6fced', '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916'),
        ('omarchy-fmadd-input.mjs', 'omarchy-direct-fp-input.mjs'),
        ('frozen FMADD runtime', 'frozen direct-import runtime'),
        ('prepared-pair-fmadd-single-runtime', 'prepared-pair-direct-fp-imports-runtime'),
    ]),
    ('tools/verify/omarchy-desktop-live.mjs', 'tools/verify/omarchy-desktop-live.mjs', [
        ('"tools/verify/omarchy-fmadd-input.mjs",', '"tools/verify/omarchy-fmadd-input.mjs", "tools/verify/omarchy-direct-fp-input.mjs",'),
    ]),
]:
    before = baseline(old)
    after = (ROOT / new).read_bytes()
    normalized = before.decode()
    for original, replacement in replacements:
        assert original in normalized, original
        normalized = normalized.replace(original, replacement)
    assert after == normalized.encode(), new
    rows.append({'baselinePath': old, 'candidatePath': new, 'baselineSha256': digest(before), 'candidateSha256': digest(after), 'changes': replacements})
receipt = {'baselineHead': BASE, 'logicParity': True, 'files': rows,
           'claim': 'all browser arithmetic/ISA assertions and all physical pair/cap/recycling/deadline/input/readback/cleanup controls retained byte-for-byte apart from explicit labels and candidate WASM pin'}
OUT.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'files': len(rows), 'logicParity': True, 'receiptSha256': digest(OUT.read_bytes())}, indent=2))
