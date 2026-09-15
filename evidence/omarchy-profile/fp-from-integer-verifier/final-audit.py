"""Verify sealed T03x evidence, immutable source boundaries and pristine rebuild."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = ROOT / 'evidence/omarchy-profile/fp-from-integer-r1'
RUNTIME = 'b587faf6f1bee5db45c5c9368d0a748f9badaff4'
COLD = '5f759ef96773b93e2b1faff27183bf6e66213fea'
WASM = '0ce4a5a304d82574b5f4118725bcffc2547121605e49304d280153eae4a5d312'
SEAL = '4cc96e781b67301c1bf3713705818e28f0a168c47956147522834f310ba5731f'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)

assert sha(WORKER / 'sha256.txt') == SEAL
sealed = []
for line in (WORKER / 'sha256.txt').read_text().splitlines():
    wanted, name = line.split(None, 1)
    name = name.lstrip(' *')
    path = (WORKER / name).resolve()
    assert path.is_relative_to(WORKER.resolve()) and sha(path) == wanted, name
    sealed.append(name)
assert len(sealed) == len(set(sealed)) == 46
submission = read(WORKER / 'submission.json')
assert submission['runtimeSourceHead'] == submission['artifactHead'] == RUNTIME
assert submission['submissionSourceHead'] == submission['coldHead'] == COLD
assert submission['runtimeWasmSha256'] == WASM
source_paths = [
    'Cargo.lock', 'Makefile', 'crates/core/src/jit.rs', 'crates/core/src/softfloat.rs',
    'crates/jit-translate/src/lib.rs', 'crates/jit-runtime/src/lib.rs', 'crates/wasm/src/jit_browser.rs',
    'crates/jit-translate/tests/differential.rs', 'tests/support/jit_fp_from_integer.rs',
    'crates/jit-runtime/tests/fp_from_integer.rs', 'crates/wasm/tests/jit_fp_from_integer.rs',
    'tests/support/jit_fp_from_integer_verifier.rs', 'crates/jit-runtime/tests/fp_from_integer_verifier.rs',
    'crates/wasm/tests/jit_fp_from_integer_verifier.rs', 'docs/jit-fp-policy.md',
    'tools/verify/omarchy-fp-from-integer-browser.mjs', 'web/roadmap.js']
source_hashes = {}
for path in source_paths:
    body = (ROOT / path).read_bytes()
    assert body == git('show', RUNTIME + ':' + path) == git('show', COLD + ':' + path), path
    source_hashes[path] = hashlib.sha256(body).hexdigest()
for path, wanted in submission['runtimeFiles'].items():
    assert source_hashes[path] == wanted
assert sha(ROOT / 'web/dist/pkg/wasm_vm_wasm_bg.wasm') == WASM

cold = read(WORKER / 'cold/report.json')
assert cold['passed'] and cold['pristineBeforeBuild'] and cold['head'] == COLD
assert all(row['code'] == 0 for row in cold['commands'])
assert [row['args'][:2] for row in cold['commands']] == [['git', 'clone'], ['git', 'checkout'], ['make', 'web-dist'], ['make', 'verify-E5_5-T03x']]
assert cold['committedWasmSha256'] == cold['rebuiltWasmSha256'] == WASM
clone = Path(cold['clone'])
assert git('rev-parse', 'HEAD', cwd=clone).decode().strip() == COLD
for path in source_paths:
    assert (clone / path).read_bytes() == (ROOT / path).read_bytes(), path
for path in ['pkg/wasm_vm_wasm_bg.wasm', 'pkg/wasm_vm_wasm.js', 'app.html', 'roadmap.js', 'sw.js']:
    assert (clone / 'web/dist' / path).read_bytes() == (ROOT / 'web/dist' / path).read_bytes(), path
# Local rebuilding intentionally restores local artifact URLs that deployment
# rewrites to R2. Check this exact bounded post-build difference, not a claim
# that the entire deployment directory remained byte-identical after rebuilding.
manifest_names = ['artifacts-alpine.json', 'artifacts-node-alpine.json', 'artifacts-omarchy.json', 'artifacts.json']
post_build_diff = git('diff', '--name-only', cwd=clone).decode().splitlines()
assert post_build_diff == ['web/dist/' + name for name in manifest_names]
for name in manifest_names:
    local = read(clone / 'web/dist' / name)
    deployed = read(ROOT / 'web/dist' / name)
    for key, entry in local['artifacts'].items():
        other = deployed['artifacts'][key]
        assert entry['sha256'] == other['sha256'] and entry['size'] == other['size']
        entry.pop('url')
        other.pop('url')
    assert local == deployed, name
scrubber = (WORKER / 'run-cold.py').read_text()
assert "key.startswith('CARGO_') or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')" in scrubber
assert "clean==''" in scrubber and "subprocess.run(args,cwd=cwd,env=env" in scrubber

expected_receipts = [
    'FP_FROM_INT corpus cases=21504 register_flags_fnv=55175ee7c3836290',
    'FP_FROM_INT CSR/source-update/later-fault/invalid-prefix cases=384',
    'FP_FROM_INT runloop FS-off/invalid-rm prefix=1 bytes=2 later-fault-flags=3',
    'CRITIC_NATIVE_FROM_INT_LITERALS Receipt { cases: 12672, illegal: 0, digest: 11332523716468034169 }',
    'CRITIC_PRIVATE_FROM_INT_LITERALS Receipt { cases: 12672, illegal: 0, digest: 11332523716468034169 }',
    'CRITIC_SHARED_FROM_INT_LITERALS Receipt { cases: 12672, illegal: 0, digest: 11332523716468034169 }',
    'CRITIC_NATIVE_FROM_INT_SEEDED Receipt { cases: 3584, illegal: 1736, digest: 8412752937936467894 }',
    'CRITIC_PRIVATE_FROM_INT_SEEDED Receipt { cases: 3584, illegal: 1736, digest: 8412752937936467894 }',
    'CRITIC_SHARED_FROM_INT_SEEDED Receipt { cases: 3584, illegal: 1736, digest: 8412752937936467894 }',
    'CRITIC_FROM_INT_PURITY cases=3072 legal_helper_calls=1620 illegal_helper_calls=0 import_index=5 integer_wasm_only=true',
    'actual_integer_conversion_arithmetic_conversion_chain=true integer_imports=5 unsupported_families=6',
]
for name in ['acceptance.log', 'cold/acceptance.log']:
    content = (WORKER / name).read_text()
    for receipt in expected_receipts:
        assert receipt in content, (name, receipt)
    counts = re.findall(r'test result: ok\. (\d+) passed; 0 failed; 0 ignored;', content)
    assert counts == ['1', '3', '5', '2', '6'], (name, counts)
    assert content.count('CRITIC_FROM_INT_CHAIN ') == 16
    assert content.count('CRITIC_FROM_INT_GROWTH ') == 6
    assert content.count('bytes_grown=65536') == 6
    assert 'test result: FAILED' not in content

browsers = []
for location, head in [('browser', RUNTIME), ('cold/browser', COLD)]:
    directory = WORKER / location
    report = read(directory / 'report.json')
    assert report['head'] == head and report['passed'] and report['errors'] == []
    assert report['wasmSha256'] == WASM
    assert sha(directory / 'fp-from-integer.elf') == report['elfSha256'] == '170850ed3232b08073a037a511a4c4e1c3e8e6ec15da282aca38a2fd62285b2b'
    assert report['suite'] == {'metric-pass': '127', 'metric-fail': '0', 'metric-done': '127'}
    assert report['capability'] == 'Integer-to-float conversions1/1 passing · live in browser'
    reference, compiled = report['runs']
    assert not reference['jit'] and compiled['jit']
    assert reference['registers'] == compiled['registers']
    assert reference['stats'] == compiled['stats'] and reference['digest'] == compiled['digest']
    assert compiled['stats']['retired'] == 4000 and compiled['jitStats']['retiredViaJit'] == 3611
    assert compiled['digest'] == '5df84ec4c17598ab2c56293bb5b78338947ce9991af18e0ef795aa4a07d2df44'
    for register, expected in [(13, '9'), (14, '3'), (16, 'ffffffff4b800000'), (17, 'ffffffff4f800000'), (18, 'ffffffffcb800001'), (19, 'ffffffff5f800000'), (20, 'ffffffff4c000000')]:
        assert compiled['registers'][register + 1] == expected
    assert sha(directory / 'suite.png') == report['suiteScreenshotSha256']
    assert sha(directory / 'built-page.png') == report['screenshotSha256']
    assert sha(directory / 'capability-inspection.png') == report['capabilityInspection']['sha256']
    browsers.append({'report': location + '/report.json', 'reportSha256': sha(directory / 'report.json'),
                     'head': head, 'retiredViaJit': 3611, 'guestRetired': 4000,
                     'guestRamDigest': compiled['digest'], 'suite': '127/127', 'errors': [], 'threeImagesIndependentlyInspected': True})

public_counts = []
for path in [WORKER / 'cloudflare-public.json', OUT / 'independent-public-bytes.json']:
    rows = read(path)
    assert len(rows) == 8
    assert {urlsplit(row['url']).hostname for row in rows} == {'d3e13537.wasm-vm.pages.dev', 'wasm-vm.pages.dev'}
    for row in rows:
        assert row['status'] == 200 and row['sha256'] == row['expectedSha256']
        assert row['sha256'] == sha(ROOT / 'web/dist' / urlsplit(row['url']).path.lstrip('/'))
    public_counts.append(len(rows))
physical = read(OUT / 'physical-input-audit.json')
assert physical['reportSha256'] == sha(WORKER / 'physical-input/desktop/report.json')
assert physical['head'] == RUNTIME and physical['wasmSha256'] == WASM
assert physical['deadlineMs'] == 120000 and physical['trustedEvents'] == physical['acceptedEvents'] == 128
assert physical['completedReadbacks'] == 13 and physical['pendingReadbacks'] == 1
assert not physical['nonceVerified'] and not physical['serialNonceInjection']
assert physical['frames'] == [2, 2] and physical['beforeSha256'] == physical['afterSha256']
assert physical['imagesInspected'] and physical['cleanupClosed']
q = list((ROOT / 'tasks').rglob('E5.5-T03q-*.md'))
assert len(q) == 1 and '\nstatus: pending\n' in q[0].read_text()

sabotage = read(OUT / 'sabotage.json')
assert sabotage['returncode'] == 101 and sabotage['restored_returncode'] == 0 and sabotage['production_files_untouched']
assert sabotage['original_sha256'] == sha(ROOT / 'tests/support/jit_fp_from_integer_verifier.rs')
affected = read(WORKER / 'affected-commands.json')
assert affected['head'] == RUNTIME and affected['allPassed'] and all(row['code'] == 0 for row in affected['commands'])
ci = read(OUT / 'inherited-gates-audit.json')
assert ci['ciLogSha256'] == sha(WORKER / 'ci.log') and not ci['broadCiPassed'] and ci['allIdentical']
assert ci['broadCiExitCodes'] == [2] and ci['nativeIsaCompliance'] == '128/128'
assert ci['perfSmokeMips'] == 25.3 and ci['perfSmokeFloorMips'] == 15
for row in ci['files']:
    content = (ROOT / row['path']).read_bytes()
    if 'boundary' in row:
        content = content.split(b'#[cfg(all(test, target_arch = "wasm32"))]', 1)[1]
    assert hashlib.sha256(content).hexdigest() == row['sha256'], row['path']
carried = read(OUT / 'carried-boundaries.json')
assert carried['arithmetic_packed_result_extraction_token_identical']
for row in carried['boundaries']:
    content = (ROOT / row['path']).read_bytes()
    if 'boundary' in row:
        content = content.split(b'pub mod abi {', 1)[1]
    assert hashlib.sha256(content).hexdigest() == row['sha256'], row['path']
report = {
    'auditedAt': datetime.now(timezone.utc).isoformat(), 'submissionCommit': git('rev-parse', 'HEAD').decode().strip(),
    'runtimeHead': RUNTIME, 'coldHead': COLD, 'workerSealSha256': SEAL, 'sealedFilesVerified': len(sealed),
    'runtimeSourceSha256': source_hashes, 'runtimeWasmSha256': WASM,
    'coldPristineBeforeBuild': True, 'coldSourceDiffEmpty': True,
    'coldExactWasmGlueAppRoadmapSw': True, 'coldPostBuildManifestOnlyDiff': post_build_diff,
    'coldAcceptanceExitCodes': [row['code'] for row in cold['commands']], 'browsers': browsers,
    'workerPublicExactByteReceipts': public_counts[0], 'independentPublicExactByteReceipts': public_counts[1],
    'physicalInput': physical, 'desktopResponsive': False, 'broadCiPassed': False,
    'broadCiFailedTargets': ci['failedTargets'], 'inheritedGateBoundariesRechecked': len(ci['files']),
    'carriedHeldBoundariesRechecked': len(carried['boundaries']), 'wrongGoldenFailedThenRestored': True,
    'T03qStatus': 'pending', 'auditPassed': True,
}
(OUT / 'final-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
