"""Light independent audit of final browser and physical-input capture provenance."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = ROOT / 'evidence/omarchy-profile/fp-from-integer-r1'
FROZEN = 'b587faf6f1bee5db45c5c9368d0a748f9badaff4'
WASM = '0ce4a5a304d82574b5f4118725bcffc2547121605e49304d280153eae4a5d312'

def read(path):
    return json.loads(path.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

sources = ['crates/core/src/jit.rs', 'crates/core/src/softfloat.rs', 'crates/jit-translate/src/lib.rs',
           'crates/jit-runtime/src/lib.rs', 'crates/wasm/src/jit_browser.rs',
           'tests/support/jit_fp_from_integer_verifier.rs', 'crates/jit-runtime/tests/fp_from_integer_verifier.rs',
           'crates/wasm/tests/jit_fp_from_integer_verifier.rs', 'tools/verify/omarchy-fp-from-integer-browser.mjs']
source_hashes = {}
for name in sources:
    body = (ROOT / name).read_bytes()
    assert body == subprocess.check_output(['git', 'show', FROZEN + ':' + name], cwd=ROOT), name
    source_hashes[name] = hashlib.sha256(body).hexdigest()
assert sha(ROOT / 'web/dist/pkg/wasm_vm_wasm_bg.wasm') == WASM

browser = WORKER / 'browser'
r = read(browser / 'report.json')
assert r['head'] == FROZEN and r['wasmSha256'] == WASM and r['passed'] and r['errors'] == []
assert r['suite'] == {'metric-pass': '127', 'metric-fail': '0', 'metric-done': '127'}
assert r['capability'] == 'Integer-to-float conversions1/1 passing · live in browser'
elf = (browser / 'fp-from-integer.elf').read_bytes()
assert hashlib.sha256(elf).hexdigest() == r['elfSha256']
assert elf[:7] == b'\x7fELF\x02\x01\x01'
assert list(struct.unpack_from('<32I', elf, 0x1000)) == r['words']
assert struct.unpack_from('<4Q', elf, 0x3000) == (16777217, 0xdeadbeefffffffff, 0xfffffffffeffffff, 0xffffffffffffffff)
# Inspect actual guest parcels rather than relying on emitter helper names.
for index, kind, rm, rd, rs in [(11, 0, 0, 0, 10), (12, 1, 7, 1, 11), (13, 2, 2, 2, 12), (14, 3, 0, 3, 31)]:
    parcel = r['words'][index]
    assert parcel & 0x7f == 0x53 and parcel >> 25 == 0x68
    assert ((parcel >> 20) & 31, (parcel >> 12) & 7, (parcel >> 7) & 31, (parcel >> 15) & 31) == (kind, rm, rd, rs)
reference, compiled = r['runs']
assert reference['jit'] is False and compiled['jit'] is True
assert reference['registers'] == compiled['registers']
assert reference['stats'] == compiled['stats'] and reference['digest'] == compiled['digest']
assert compiled['stats']['retired'] == 4000 and compiled['jitStats']['retiredViaJit'] == 3611
assert compiled['digest'] == '5df84ec4c17598ab2c56293bb5b78338947ce9991af18e0ef795aa4a07d2df44'
for run in r['runs']:
    assert all(s['kind'] == 'max' for s in run['statuses']) and sum(s['retired'] for s in run['statuses']) == 4000
    for register, expected in [(13, '9'), (14, '3'), (16, 'ffffffff4b800000'), (17, 'ffffffff4f800000'), (18, 'ffffffffcb800001'), (19, 'ffffffff5f800000'), (20, 'ffffffff4c000000')]:
        assert run['registers'][register + 1] == expected, register
    assert int(run['registers'][16], 16) & 0x8000000000006000 == 0x8000000000006000
for filename, digest in [('suite.png', r['suiteScreenshotSha256']), ('built-page.png', r['screenshotSha256']), ('capability-inspection.png', r['capabilityInspection']['sha256'])]:
    assert sha(browser / filename) == digest
browser_audit = {'reportSha256': sha(browser / 'report.json'), 'head': r['head'], 'wasmSha256': WASM,
                 'elfSha256': r['elfSha256'], 'guestRamDigest': compiled['digest'], 'retiredViaJit': 3611,
                 'guestRetired': 4000, 'suite': '127/127', 'errors': [], 'imagesInspected': True,
                 'imageFinding': 'Suite shows 127 passed, 0 failed, 127 done; conversion capability green/live 1/1; built page contains real E5.5-T03x task detail.',
                 'sourceFileSha256': source_hashes, 'passed': True}
(OUT / 'browser-audit.json').write_text(json.dumps(browser_audit, indent=2) + '\n')

path = WORKER / 'physical-input/desktop/report.json'
p = read(path)
k = p['keyboard']
assert p['trial']['head'] == FROZEN and p['trial']['readbackMs'] == 120000 and k['deadlineMs'] == 120000
assert not p['trial']['profilingRequested'] and not p['trial']['admissionProbeRequested']
assert p['trial']['recycling'] is False and p['mode'] == 'input-trial'
assert all(word not in p['url'] for word in ['testHooks', 'e2eShowall'])
assert p['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'] == WASM
for name, entry in p['trial']['helpers'].items():
    assert sha(ROOT / name) == entry['sha256'], name
for name, entry in p['identities']['files'].items():
    if name != 'artifacts-omarchy.json':
        assert sha(ROOT / 'web/dist' / name) == entry['sha256'], name
assert p['result'] == 'failed' and not k['verified'] and p['cleanup']['closed']
assert p['errors'] == []
parse = lambda text: datetime.fromisoformat(text.replace('Z', '+00:00'))
assert (parse(k['deadlineAt']) - parse(k['typedAt'])).total_seconds() == 120
assert parse(k['failedAt']) >= parse(k['deadlineAt'])
assert len(p['inputEvents']) == 128 and all(event['trusted'] for event in p['inputEvents'])
accepted = [event for event in p['workerTraffic'] if event['type'] == 'input-result' and event.get('method') == 'sendKeyboardEvent']
assert len(accepted) == 128 and all(event['result'] is True and event['error'] is None for event in accepted)
readbacks = [event['exec'] for event in p['observations'] if 'exec' in event]
assert len(readbacks) == 13 and all(x['exit'] == 75 and k['nonce'] not in x['stdout'] for x in readbacks)
assert len(p['serialCommands']) == 14 and k['nonce'] not in json.dumps(p['serialCommands'])
assert k['nonce'] not in json.dumps([event for event in p['workerTraffic'] if event['type'] == 'serial-input'])
for command in p['serialCommands']:
    assert command['stage'] == 'physical keyboard:nonce-readback'
    assert command['command'] == "if [ -f '" + k['guestFile'] + "' ]; then cat '" + k['guestFile'] + "'; else (exit 75); fi"
frames = [event['runtime']['presentation']['framesReceived'] for event in p['observations'] if 'runtime' in event]
assert frames == [2, 2]
before = path.parent / 'desktop.png'
after = path.parent / 'failure.png'
assert sha(before) == sha(after) == '97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f'
q = list((ROOT / 'tasks').rglob('E5.5-T03q-*.md'))
assert len(q) == 1 and '\nstatus: pending\n' in q[0].read_text()
prior = read(ROOT / 'evidence/omarchy-profile/fp-arithmetic-r1/physical-input/desktop/report.json')
for key in ['kernel', 'bootSnapshot', 'overlayDelta', 'chunkManifest']:
    assert p['candidate']['source'][key]['sha256'] == prior['candidate']['source'][key]['sha256'], key
physical = {'reportSha256': sha(path), 'head': p['trial']['head'], 'wasmSha256': WASM,
            'enteredAt': k['typedAt'], 'deadlineAt': k['deadlineAt'], 'failedAt': k['failedAt'],
            'deadlineMs': 120000, 'trustedEvents': 128, 'acceptedEvents': 128,
            'completedReadbacks': 13, 'pendingReadbacks': 1, 'nonceVerified': False,
            'serialNonceInjection': False, 'imagesInspected': True,
            'imageFinding': 'Both actual Foot captures show the same empty shell prompt and cursor with no typed command or output.',
            'beforeSha256': sha(before), 'afterSha256': sha(after), 'frames': frames,
            'pinnedGuestArtifactsUnchangedFromT03w': True, 'cleanupClosed': True, 't03qStatus': 'pending'}
assert physical['reportSha256'] == '29b15c67cd97e1d8daac22b4bf449ba7bd35f3ec5fd6703e8a1e8054fdd7f1fa'
(OUT / 'physical-input-audit.json').write_text(json.dumps(physical, indent=2) + '\n')
print(json.dumps({'browser': browser_audit, 'physical': physical}, indent=2))
