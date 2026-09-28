#!/usr/bin/env python3
"""Carry forward unchanged broad-suite failures, preserving their failed status."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fp-division-r1'
previous = repo / 'evidence/omarchy-profile/fp-to-word-r1'
current_log, previous_log = (worker / 'ci.log').read_text(), (previous / 'ci.log').read_text()
status = json.loads((worker / 'ci-commands.json').read_text())
assert len(status['commands']) == 1 and status['commands'][0]['code'] == 2
assert status['allPassed'] is False
errors = lambda text: sorted(set(re.findall(r'^error(?:\[[^]]+\])?:.*$', text, re.M)))
targets = lambda text: re.findall(r'^make: \*\*\* \[([^]]+)\] Error (\d+)', text, re.M)
assert errors(current_log) == errors(previous_log)
assert targets(current_log) == targets(previous_log) == [
    ('clippy','101'), ('test','101'), ('wasm','1'), ('test-riscv','1'), ('determinism','1')]
assert 'reserved_section_is_refused_as_unsupported_on_wasm32 ... FAIL' in current_log
assert 'crates/wasm/tests/resume.rs:93' in current_log
assert '- passing: **128 / 128**' in current_log
assert 'perf-smoke: alu median 24.8 MIPS ≥ floor 15' in current_log
boundaries = json.loads((out / 'unchanged-boundary-inspection.json').read_text())
assert boundaries['allIdentical']
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
path = 'crates/wasm/src/jit_browser.rs'
marker = b'#[cfg(all(test, target_arch = "wasm32"))]'
module_bytes = []
for head in [boundaries['parent'], boundaries['frozen']]:
    data = subprocess.check_output(['git','show',head+':'+path], cwd=repo, env=env)
    module_bytes.append(data[data.index(marker):])
assert module_bytes[0] == module_bytes[1]
sha = lambda b: hashlib.sha256(b).hexdigest()
failure_boundaries = dict(boundaries['files'])
failure_boundaries[path + '::test_modules'] = sha(module_bytes[1])
receipt = dict(broadCiPassed=False, exitCode=2, failingTargets=targets(current_log),
               nativeIsaPassed=128, nativeIsaTotal=128, perfMedianMips=24.8, perfFloorMips=15,
               sameFailingTargetsAsVerifiedPredecessor=True, sameCompilerErrorsAsPredecessor=True,
               failureBoundariesUnchanged=failure_boundaries,
               resumeFailure='reserved_section_is_refused_as_unsupported_on_wasm32 at crates/wasm/tests/resume.rs:93, VIRTIO_RNG expectation',
               determinismFailure='Existing test-only Instant/Duration at gpu/resources.rs:1225,1242',
               ciLogSha256=sha((worker / 'ci.log').read_bytes()),
               predecessorCiLogSha256=sha((previous / 'ci.log').read_bytes()),
               notes='These remain failures. No division runtime or fixture failure is hidden or relabeled.')
(out / 'ci-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
