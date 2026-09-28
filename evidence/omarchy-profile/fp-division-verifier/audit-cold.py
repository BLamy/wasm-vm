#!/usr/bin/env python3
"""Interrogate the final cold receipt and exact clone, without rerunning tests."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fp-division-r1'
cold = worker / 'cold'
report = json.loads((cold / 'report.json').read_text())
frozen = json.loads((out / 'frozen-source-inspection.json').read_text())
expected_head = '619a569e4f97ad3d7d68dbf68fb8c3693082da79'
assert report['head'] == expected_head
assert report['passed'] and report['pristineBeforeBuild']
assert report['committedWasmSha256'] == report['rebuiltWasmSha256'] == frozen['wasm_sha256']
assert len(report['commands']) == 4 and all(row['code'] == 0 for row in report['commands'])
assert report['commands'][2]['args'] == ['make', 'web-dist']
assert report['commands'][3]['args'] == [
    'make', 'verify-E5_5-T03z', 'FP_DIVISION_OUT=' + str(cold / 'browser')]

# The runner's explicit subprocess environment removes every Cargo override and
# Rust compilation/logging override before cloning, compiling, or accepting.
runner = (worker / 'run-cold.py').read_text()
assert "if key.startswith('CARGO_') or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')" in runner
assert 'del env[key]' in runner and 'env=env' in runner
assert "assert clean==''" in runner
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
clone = Path(report['clone'])
git = lambda *args: subprocess.check_output(['git', *args], cwd=clone, env=env)
assert git('rev-parse', 'HEAD').decode().strip() == expected_head
sha = lambda b: hashlib.sha256(b).hexdigest()
source_hashes = {}
for path, expected in frozen['source_sha256'].items():
    committed = git('show', 'HEAD:' + path)
    actual = (clone / path).read_bytes()
    assert committed == actual and sha(actual) == expected, path
    source_hashes[path] = sha(actual)
paths = ['crates', 'tests', 'Makefile', 'Cargo.toml', 'Cargo.lock', '.cargo',
         'tools/verify/omarchy-fp-division-browser.mjs']
assert git('diff', '--name-only', frozen['head'], 'HEAD', '--', *paths) == b''
assert sha((clone / 'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()) == frozen['wasm_sha256']

# Every promoted final test reran; compare semantic lines, not durations or order.
acceptance = (cold / 'acceptance.log').read_text()
hot_acceptance = (worker / 'acceptance.log').read_text()
summaries = re.findall(r'^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', acceptance, re.M)
assert summaries == [('1','0','0'), ('1','0','0'), ('3','0','0'),
                     ('5','0','0'), ('2','0','0'), ('6','0','0')], summaries
critic = lambda text: sorted(line for line in text.splitlines() if line.startswith('CRITIC_'))
assert critic(acceptance) == critic(hot_acceptance)
assert len([line for line in critic(acceptance) if 'digest:' in line]) == 9
browser = json.loads((cold / 'browser/report.json').read_text())
assert browser['passed'] and browser['head'] == expected_head and browser['errors'] == []
assert browser['wasmSha256'] == frozen['wasm_sha256']
receipt = dict(head=expected_head, frozenRuntimeHead=frozen['head'],
               clone=str(clone), commandsPassed=4, pristineBeforeBuild=True,
               environmentScrubInspected=True, sourceHashes=source_hashes,
               frozenRuntimeAndFixturesUnchanged=True,
               testTargetsPassed=6, testsPassed=18, ignored=0,
               allCriticSemanticLinesMatchFrozenRun=True, matchingDigestLines=9,
               rebuiltWasmSha256=frozen['wasm_sha256'],
               coldReportSha256=sha((cold / 'report.json').read_bytes()),
               coldAcceptanceSha256=sha((cold / 'acceptance.log').read_bytes()),
               coldRunnerSha256=sha((worker / 'run-cold.py').read_bytes()))
(out / 'cold-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
