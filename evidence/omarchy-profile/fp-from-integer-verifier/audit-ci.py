"""Audit inherited gauntlet failures by exact source identity; do not rerun gates."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = ROOT / 'evidence/omarchy-profile/fp-from-integer-r1'
BASE = '51dd9864'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def prior(path):
    return subprocess.check_output(['git', 'show', BASE + ':' + path], cwd=ROOT)

files = ['crates/wasm/tests/resume.rs', 'crates/core/src/resume.rs', 'crates/core/src/dispatch.rs',
         'crates/core/src/hart/mod.rs', 'crates/wvseccomp/src/main.rs', 'tools/ci/determinism-hazards.sh',
         'crates/core/src/dev/virtio/gpu/resources.rs', 'crates/core/src/lib.rs', 'Cargo.lock',
         'Cargo.toml', 'crates/core/Cargo.toml', 'crates/wasm/Cargo.toml', 'crates/wvseccomp/Cargo.toml']
rows = []
for name in files:
    current = (ROOT / name).read_bytes()
    assert current == prior(name), name
    rows.append({'path': name, 'sourceBase': BASE, 'sha256': digest(current), 'unchanged': True})
# The browser source has a new adapter, so compare its complete affected test
# suffix rather than mistakenly marking the whole changed file unchanged.
name = 'crates/wasm/src/jit_browser.rs'
marker = b'#[cfg(all(test, target_arch = "wasm32"))]'
current = (ROOT / name).read_bytes().split(marker, 1)[1]
assert current == prior(name).split(marker, 1)[1]
rows.append({'path': name, 'sourceBase': BASE, 'boundary': 'complete existing wasm32 test modules after first cfg(test, target_arch=wasm32)', 'sha256': digest(current), 'unchanged': True})
assert (ROOT / 'Makefile').read_bytes().startswith(prior('Makefile'))
receipt = json.loads((WORKER / 'ci-commands.json').read_text())
assert not receipt['allPassed'] and [row['code'] for row in receipt['commands']] == [2]
log = (WORKER / 'ci.log').read_text()
old_log = (ROOT / 'evidence/omarchy-profile/fp-arithmetic-r1/ci.log').read_text()
pattern = r'^make: \*\*\* \[([^] ]+)\] Error \d+$'
failed = re.findall(pattern, log, re.M)
assert failed == re.findall(pattern, old_log, re.M) == ['clippy', 'test', 'wasm', 'test-riscv', 'determinism']
messages = ['cannot find function `prctl`', 'cannot find value `PR_SET_NO_NEW_PRIVS`',
            'cannot find value `SYS_seccomp`', 'expected `i32`, found `i64`',
            'method `live_blocks` is never used', 'method `fetch_phys` is never used',
            'assertion failed: !is_supported_section(section::VIRTIO_RNG)',
            'no method named `boot_supervisor`', 'no method named `enable_builtin_sbi`',
            'crates/core/src/dev/virtio/gpu/resources.rs:1225:        let started = std::time::Instant::now();']
for message in messages:
    assert message in log and message in old_log, message
assert '- passing: **128 / 128**' in log
assert 'perf-smoke: alu median 25.3 MIPS ≥ floor 15' in log
for name, count in [('jit_fp_from_integer.rs', 2), ('jit_fp_from_integer_verifier.rs', 6)]:
    section = log.split('Running tests/' + name + ' ', 1)[1].split('\n     Running tests/', 1)[0]
    assert f'test result: ok. {count} passed; 0 failed' in section
report = {'method': 'Independent git-show byte identity and recorded diagnostic comparison; no gates rerun',
          'ciHead': receipt['head'], 'ciLogSha256': digest(log.encode()), 'broadCiPassed': False,
          'broadCiExitCodes': [2], 'failedTargets': failed, 'sameFailureTargetsAsVerifiedParent': True,
          'inheritedDiagnosticSignatures': messages, 'files': rows, 'allIdentical': True,
          'oldMakeRecipesUnchanged': True, 'nativeIsaCompliance': '128/128', 'perfSmokeMips': 25.3,
          'perfSmokeFloorMips': 15, 'conversionWasmTestsPassed': {'worker': 2, 'verifier': 6},
          'sourceFindingsIntroducedByT03x': []}
(OUT / 'inherited-gates-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
