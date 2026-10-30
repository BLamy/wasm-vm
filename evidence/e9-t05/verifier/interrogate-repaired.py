#!/usr/bin/env python3
"""Read-only independent authentication and raw tuple interrogation; no production codec."""
import gzip
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ORIGINAL = ROOT / 'target/evidence/e9-t05-worker-repaired'
PACKET = ROOT / 'evidence/e9-t05/worker-repaired'
OUT = ROOT / 'evidence/e9-t05/verifier'
FROZEN = '4ce36a932feaf171c09cd8b25e90d3fc9ff376ac'
RECEIPT = 'f503e646a19c05ed7a1c33ecd64cae767eaedc33cf06f8acfd01021a2d1aed37'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            value.update(chunk)
    return value.hexdigest()


raw = (ORIGINAL / 'report.json').read_bytes()
assert digest(raw) == RECEIPT
receipt = json.loads(raw)
assert receipt['head'] == FROZEN and receipt['status'] == 'passed'
assert len(receipt['files']) == 542  # 543 originals including the separately authenticated receipt.
for item in receipt['files']:
    path = ORIGINAL / item['path']
    assert path.stat().st_size == item['bytes'], item['path']
    assert file_digest(path) == item['sha256'], item['path']
test_only_changes = {}
for path, expected in receipt['source_sha256'].items():
    frozen = subprocess.check_output(['git', 'show', FROZEN + ':' + path], cwd=ROOT)
    assert digest(frozen) == expected, path
    current = file_digest(ROOT / path)
    if current != expected:
        assert path == 'tools/verify/e9-software-checkpoints-critic.mjs', path
        test_only_changes[path] = {'recorded': expected, 'current': current,
                                  'reason': 'bounded direct-loader admission/descriptor/profile tests; fresh supplementary evidence'}
provenance = json.loads((PACKET / 'provenance.json').read_bytes())
assert provenance['head'] == FROZEN and provenance['original_report_sha256'] == RECEIPT
assert len(provenance['files']) == 51
for item in provenance['files']:
    packed = (PACKET / item['path']).read_bytes()
    assert len(packed) == item['bytes'] and digest(packed) == item['sha256'], item['path']
    decoded = gzip.decompress(packed) if item['encoding'] == 'gzip' else packed
    assert len(decoded) == item['source_bytes'] and digest(decoded) == item['source_sha256']
    assert decoded == (ORIGINAL / item['source']).read_bytes(), item['source']
for alias in provenance['aliases']:
    decoded = gzip.decompress((PACKET / alias['packet']).read_bytes())
    assert digest(decoded) == alias['source_sha256']
    assert decoded == (ORIGINAL / alias['source']).read_bytes()

report = {'P0': 'HELD', 'receipt_sha256': RECEIPT, 'head': FROZEN,
          'original_files': len(receipt['files']), 'compact_files': len(provenance['files']),
          'sources': len(receipt['source_sha256']), 'tuples': {}}
report['test_only_changes'] = test_only_changes
components = {}
for name in ['before', 'after', 'restored']:
    frame = (ORIGINAL / 'browser' / (name + '.checkpoint')).read_bytes()
    assert frame[:12] == b'WVSOFT01' + struct.pack('<I', 1)
    parts = {}
    cursor = 212
    for index, label in enumerate(['context', 'native', 'disk', 'input', 'output']):
        size = struct.unpack_from('<Q', frame, 12 + index * 40)[0]
        parts[label] = frame[cursor:cursor + size]
        assert len(parts[label]) == size
        assert digest(parts[label]) == frame[20 + index * 40:52 + index * 40].hex()
        cursor += size
    assert cursor == len(frame)
    context = json.loads(parts['context'])
    assert context['held'] == {'keyboard': [30], 'tablet': [], 'mouse': []}
    assert context['position'] == {'transition': '0', 'phase': 'before', 'ordinal': 0,
                                   'sequence': '0', 'retired': '0'}
    native = parts['native']
    assert native[:12] == b'WVMRESU1' + struct.pack('<I', 1)
    sections = {}
    cursor = 84
    while cursor < len(native):
        tag, size = struct.unpack_from('<II', native, cursor)
        assert tag not in sections
        cursor += 8
        section = native[cursor:cursor + size]
        assert len(section) == size
        sections[tag] = section
        cursor += size
    assert cursor == len(native) and set(sections) == set(range(1, 17))
    # Independent sparse expansion: no call to the implementation's RAM digest.
    ram = sections[2]
    ram_hash = hashlib.sha256()
    cursor = 0
    expanded = 0
    while cursor < len(ram):
        kind, size = struct.unpack_from('<BI', ram, cursor)
        assert kind in (0, 1) and size and expanded + size <= int(context['ram_bytes'])
        cursor += 5
        if kind:
            payload = ram[cursor:cursor + size]
            assert len(payload) == size
            ram_hash.update(payload)
            cursor += size
        else:
            for offset in range(0, size, 1 << 20):
                ram_hash.update(bytes(min(size - offset, 1 << 20)))
        expanded += size
    assert cursor == len(ram) and expanded == int(context['ram_bytes'])
    phase, divider, stimecmp = struct.unpack('<QQQ', sections[9])
    assert divider == context['clock']['divider'] and phase < divider
    disk = parts['disk']
    assert disk[:9] == b'WVOD1' + struct.pack('<I', 4096)
    generation = struct.unpack_from('<Q', disk, 49)[0]
    assert native[44:76] == disk[17:49]
    assert struct.unpack_from('<Q', native, 76)[0] == generation
    count = struct.unpack_from('<I', disk, 57)[0]
    assert len(disk) == 61 + count * 4104
    previous = -1
    for index in range(count):
        block = struct.unpack_from('<Q', disk, 61 + index * 4104)[0]
        assert previous < block < (struct.unpack_from('<Q', disk, 9)[0] + 4095) // 4096
        previous = block
    item = {'frame_sha256': digest(frame), 'frame_bytes': len(frame),
            'component_sha256': {key: digest(value) for key, value in parts.items()},
            'section_sha256': {str(key): digest(value) for key, value in sections.items()},
            'ram_sha256': ram_hash.hexdigest(), 'ram_bytes': expanded, 'phase': phase,
            'divider': divider, 'stimecmp': str(stimecmp), 'generation': str(generation),
            'disk_blocks': count, 'input_hex': parts['input'].hex()}
    report['tuples'][name] = item
    components[name] = parts
assert components['before'] == components['restored']
assert components['before']['native'] != components['after']['native']
assert components['before']['disk'] != components['after']['disk']
assert components['before']['input'] == b'e9_queue=queued-before\n'
report['P1_tuple'] = 'HELD'
browser = json.loads((ORIGINAL / 'browser/report.json').read_bytes())
assert browser['status'] == 'passed' and browser['head'] == FROZEN and browser['errors'] == []
assert browser['checks']['suite'] == {'passed': 127, 'failed': 0}
assert browser['checks']['restoredMemory']['stdout'] == 'memory-before/queued-before\n'
assert browser['checks']['liveSurvives']['stdout'] == 'memory-after/queue-after\n'
assert browser['checks']['failures']['committedSame'] is True
assert browser['checks']['failures']['revision'] == '1'
assert browser['checks']['restored']['scheduler']['retiredInstructions'] == 0
io = browser['checks']['io']
for kind in ['read', 'write', 'bounded']:
    assert io[kind]['beforeClock'] == io[kind]['afterClock']
assert io['read']['remaining'] == [] and io['read']['exactRestored'] is True
assert all(item['unchanged'] and item['error'] != 'accepted' for item in io['read']['corruption'])
assert io['read']['sibling'] == 'session_checkpoint_disk_mismatch'
assert io['write']['after']['pendingBytes'] == 0 and io['write']['generation'] == '1'
assert io['bounded']['error'] == 'session_checkpoint_busy_or_budget'
assert len(io['expectedConsoleErrors']) == 16 and io['pageErrors'] == []
assert io['bounded']['recovered']['run']['retired'] > 0
report.update({'P2_browser': 'HELD', 'P3_recorded_failures': 'HELD', 'P4': 'HELD',
               'browser_report_sha256': file_digest(ORIGINAL / 'browser/report.json')})
(OUT / 'worker-repaired-interrogation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'tuples'}, indent=2))
