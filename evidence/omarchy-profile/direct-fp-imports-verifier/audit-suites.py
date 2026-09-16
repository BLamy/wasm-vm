#!/usr/bin/env python3
"""Check independent private/shared FP suites and identity/sabotage receipts."""
from pathlib import Path
import hashlib
import json
import re
import sys

path = Path(sys.argv[1])
data = path.read_bytes()
text = data.decode()
assert 'test result: FAILED' not in text
expected = {
    'jit_fp_arithmetic_verifier': 6,
    'jit_fp_from_integer_verifier': 6,
    'jit_fp_to_word_verifier': 6,
    'jit_fp_division_verifier': 6,
    'jit_fp_fmadd_verifier': 6,
    'jit_fp_direct_imports_verifier': 2,
}
sections = re.split(r'Running tests/([^\s/]+)\.rs', text)
observed = {}
for i in range(1, len(sections), 2):
    name, body = sections[i:i + 2]
    if name not in expected:
        continue
    marker = f'test result: ok. {expected[name]} passed; 0 failed; 0 ignored; 0 filtered out;'
    assert marker in body, name
    observed[name] = expected[name]
assert observed == expected, observed
receipts = []
for number, line in enumerate(text.splitlines(), 1):
    if line.startswith('CRITIC_DIRECT_FP_IMPORTS '):
        metadata, payload = line.split(' {', 1)
        result = json.loads('{' + payload)
        shared = ' shared=true ' in metadata
        assert 'compiled_executions=9 memory_growth=65536' in metadata
        assert result == {
            'rows': 6, 'shared': shared, 'helpers': 5, 'literals': 132,
            'digests': ['f5c775ff0b743b09'] * 6,
            'correctTypes': 5, 'rejectedTypes': 22,
            'identitySabotageRejected': True, 'wrongTypedTrampolineLinks': True,
            'restoredIdentity': True, 'afterAllExecutorsDropped': True,
        }
        receipts.append({'line': number, 'compiledExecutions': 9, 'memoryGrowth': 65536, **result})
assert len(receipts) == 2 and {r['shared'] for r in receipts} == {False, True}
source_path = Path('crates/wasm/tests/jit_fp_direct_imports_verifier.rs')
receipt = {
    'logPath': str(path), 'logSha256': hashlib.sha256(data).hexdigest(),
    'testSourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
    'testCounts': observed, 'totalPassed': sum(observed.values()),
    'actualImportReceipts': receipts,
    'sabotageScope': 'local copy of actual captured import replaced with equivalent JS trampoline; production unchanged; named identity assertion rejects then restoration passes',
}
out = Path(sys.argv[2])
out.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'passed': receipt['totalPassed'], 'actualInstances': 12, 'scalarCases': 264, 'rejectedTypes': 44, 'sabotage': 'rejected both modes, restored'}, indent=2))
