#!/usr/bin/env python3
"""Literal page/archive/native witness audit; no production codecs are imported."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory', type=Path, required=True)
p.add_argument('--development', action='store_true')
a = p.parse_args()
root = a.directory.resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
u32 = lambda b, n: struct.unpack_from('<I', b, n)[0]
u64 = lambda b, n: struct.unpack_from('<Q', b, n)[0]
canonical = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False).encode()
report = json.loads((root / 'report.json').read_text())
assert report['status'] == 'passed' and not report['errors'] and not report['missing'] and not report['external']
assert a.development or report['development'] is False
run = report['result']
assert run['status'] == 'passed' and run['pages']['count'] == 130 and run['checkpoints'] > 63
assert run['maxResidentRows'] == 16 and run['pages']['maxPageRows'] <= 16 and run['pages']['maxPageBytes'] <= 8192
for ref in report['raw']:
    b = (root / ref['file']).read_bytes()
    assert len(b) == ref['bytes'] and sha(b) == ref['sha256']

class Store:
    def __init__(self, directory):
        self.path = directory
        self.meta = json.loads((directory / 'storage.json').read_text())['stores']
        self.objects = {r['key']: r['value'] for r in self.meta['objects']}
        for h, obj in self.objects.items():
            assert obj['sha256'] == h
            self.read({'sha256': h, 'length': obj['length']})
    def read(self, ref):
        obj = self.objects[ref['sha256']]
        assert obj['length'] == ref['length'] and obj['sha256'] == ref['sha256'] and obj['version'] == 1
        parts = []
        for part in obj['parts']:
            b = (self.path / 'chunks' / (part['sha256'] + '.bin')).read_bytes()
            assert len(b) == int(part['length']) <= 1048576 and sha(b) == part['sha256']
            parts.append(b)
        b = b''.join(parts)
        assert len(b) == int(ref['length']) and sha(b) == ref['sha256']
        return b
    def manifest(self, id):
        row = next(r['value'] for r in self.meta['sessions'] if r['key'] == id)
        return bytes(row['manifest'])

source = Store(root / 'saved')
imported = Store(root / 'imported')
manifest_bytes = source.manifest(run['id'])
assert sha(manifest_bytes) == run['saved']['manifestSha256'] and imported.manifest(run['id']) == manifest_bytes
manifest = json.loads(manifest_bytes)
assert manifest['machine']['ram_bytes'] == '1073741824' and manifest['policy']['clock']['divider'] == 64
assert manifest['policy']['mode'] == 'exact-replay' and len(manifest['checkpoints']) == run['checkpoints']
extensions = manifest['extensions']
assert [e['kind'] for e in extensions] == ['e9-exact-initial-witness-v1', 'e9-exact-witness-pages-v2']
assert [e['required'] for e in extensions] == [False, True] and all(len(e['bytes']) <= 8192 for e in extensions)
commitment = json.loads(bytes(extensions[1]['bytes']))
assert tuple(commitment) == ('version', 'count', 'pages', 'tail', 'first', 'last', 'finished')
assert bytes(extensions[1]['bytes']) == canonical(commitment) and commitment['version'] == 2 and commitment['finished'] is True
assert commitment['count'] == 130 and 1 <= commitment['pages'] <= 4096

def position(row):
    return (int(row['transition']), 0 if row['phase'] == 'before' else 1, row['ordinal'], int(row['sequence']))

def check_row(row):
    assert tuple(row) == ('transition', 'phase', 'ordinal', 'sequence', 'retired', 'digest')
    for key in ('transition', 'sequence', 'retired'):
        assert type(row[key]) is str and re.fullmatch('0|[1-9][0-9]{0,19}', row[key]) and int(row[key]) <= 2**64 - 1
    assert row['phase'] in ('before', 'observe') and type(row['ordinal']) is int and 0 <= row['ordinal'] < 2**32
    assert row['phase'] != 'observe' or row['ordinal'] > 0
    assert int(row['retired']) <= int(row['transition']) and len(row['digest']) == 32
    assert all(type(b) is int and 0 <= b <= 255 for b in row['digest'])

def pages(store):
    ref, remaining, count = commitment['tail'], commitment['count'], commitment['pages']
    seen, reverse, refs = set(), [], []
    while ref:
        assert tuple(ref) == ('sha256', 'length') and 0 < int(ref['length']) <= 8192 and ref['sha256'] not in seen
        seen.add(ref['sha256']); refs.append(ref)
        b = store.read(ref); page = json.loads(b)
        assert b == canonical(page) and tuple(page) == ('version', 'previous', 'before', 'rows') and page['version'] == 2
        assert type(page['before']) is int and 1 <= len(page['rows']) <= 16 and page['before'] + len(page['rows']) == remaining
        assert (page['previous'] is None) == (page['before'] == 0)
        for row in page['rows']: check_row(row)
        reverse.extend(reversed(page['rows']))
        remaining, count, ref = page['before'], count - 1, page['previous']
    assert remaining == count == 0 and len(reverse) == 130
    rows = list(reversed(reverse))
    assert rows[0] == commitment['first'] and rows[-1] == commitment['last']
    assert json.loads(bytes(extensions[0]['bytes'])) == [rows[0]]
    assert all(rows[0][k] == manifest['begin'][k] and rows[-1][k] == manifest['end'][k]
               for k in ('transition', 'phase', 'ordinal', 'sequence', 'retired'))
    for first, last in zip(rows, rows[1:]):
        assert position(first) < position(last) and int(first['sequence']) <= int(last['sequence']) and int(first['retired']) <= int(last['retired'])
    return rows, refs

rows, page_refs = pages(source)
tail_rows = len(json.loads(source.read(commitment['tail']))['rows'])
assert 1 <= tail_rows < 16 and run['tailRows'] == tail_rows, 'final tail must be independently partial'
assert pages(imported) == (rows, page_refs)
assert len(canonical(rows)) > 8192, 'must cross the actual old extension byte capacity'
raw_rows = []
for index, ref in enumerate(run['rawWitnesses']):
    raw = json.loads((root / ref['file']).read_bytes())
    for key, value in rows[index].items(): assert raw[key] == value
    native = (root / raw['state']['file']).read_bytes()
    assert len(native) == raw['logicalBytes'] == raw['state']['bytes']
    assert sha(native) == raw['logicalSha256'] == raw['state']['sha256']
    assert native[:8] == b'WVMRESU1' and u32(native, 8) == 1
    assert native[44:76].hex() == manifest['machine']['base_image']
    at, sections = 84, {}
    while at < len(native):
        tag, size = u32(native, at), u32(native, at + 4); at += 8
        assert tag not in sections and at + size <= len(native)
        sections[tag] = native[at:at + size]; at += size
    assert at == len(native) and 2 not in sections and 18 in sections
    clock = sections[18]
    assert clock[:8] == b'WVCLK001' and (u64(clock, 12), u64(clock, 20), u64(clock, 28), u64(clock, 36)) == tuple(int(raw[k]) for k in ('transition', 'retired', 'ordinal', 'sequence'))
    digest = sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(native)) + native + bytes.fromhex(raw['ramDigest']))
    assert digest == bytes(raw['digest']).hex()
    raw_rows.append(raw)
assert len(raw_rows) == 130

inventory = {r['sha256']: r for r in run['inventory']}
expected = {}
def add(ref):
    assert ref['sha256'] not in expected or expected[ref['sha256']] == ref
    expected[ref['sha256']] = ref
    source.read(ref)
for asset in manifest['assets']: add(asset['content'])
for ref in page_refs: add(ref)
for event in manifest['events']:
    add(event['content'])
    for row in json.loads(source.read(event['content'])):
        if row['payload']['storage'] == 'blob': add(row['payload']['content'])
for h in {point['disk_root'] for point in manifest['checkpoints']}:
    obj = source.objects[h]; ref = {'sha256': h, 'length': obj['length']}; add(ref)
    disk = json.loads(source.read(ref)); assert disk['base'] == manifest['machine']['base_image'] and disk['blocks'] == []

# Independently expand the recorded native full/delta RAM graph, not product codecs.
ram = bytearray(1 << 30); view = memoryview(ram); last_machine = None; states = []
for point in manifest['checkpoints']:
    add(point['machine']); add(point['gpu']); data = source.read(point['machine']); delta = None
    if data[:8] == b'WVKEYF01':
        delta = json.loads(data[8:]); assert delta['parent'] == last_machine and delta['ramBytes'] == str(len(ram))
        add(delta['frame']); count = 0; last = -1
        for ref in delta['chunks']:
            add(ref); b = source.read(ref); assert b[:8] == b'WVRAMD01' and u32(b, 8) == 1 and u64(b, 12) == len(ram)
            at = 24
            for _ in range(u32(b, 20)):
                page, size = u32(b, at), struct.unpack_from('<H', b, at + 4)[0]; at += 6
                assert last < page < len(ram)//4096 and size == 4096
                view[page*4096:page*4096 + size] = b[at:at + size]; at += size; last = page; count += 1
            assert at == len(b)
        assert count == delta['dirtyPages']
        data = source.read(delta['frame'])
    assert data[:8] == (b'WVGPUD01' if delta else b'WVGPUB01') and u32(data, 8) == 1
    header, size, pending, output = u32(data, 12), u64(data, 16), u32(data, 24), u32(data, 28)
    assert 32 + header + size + pending + output == len(data)
    meta = json.loads(data[32:32 + header]); native = data[32 + header:32 + header + size]
    assert meta['position'] == point['position'] and meta['runtime'] == manifest['machine']['vm_build'] and meta['rendererSha256'] == point['gpu']['sha256']
    assert native[-84:-76] == b'WVGRESU1' and sha(native[:-32]) == native[-32:].hex()
    at, sections = 84, {}
    while at < len(native) - 84:
        tag, n = u32(native, at), u32(native, at + 4); at += 8
        assert tag not in sections and at + n <= len(native) - 84
        sections[tag] = native[at:at + n]; at += n
    assert at == len(native) - 84 and (2 in sections) == (delta is None)
    if not delta:
        b, at, offset = sections[2], 0, 0
        while at < len(b):
            kind, n = b[at], u32(b, at + 1); at += 5
            assert kind in (0, 1) and 0 < n <= len(ram) - offset
            if kind: view[offset:offset + n] = b[at:at + n]; at += n
            else:
                for start in range(offset, offset + n, 1048576): view[start:min(start + 1048576, offset + n)] = bytes(min(1048576, offset + n - start))
            offset += n
        assert at == len(b) and offset == len(ram)
    ram_digest = sha(view)
    assert ram_digest == meta['ramSha256'] and (not delta or ram_digest == delta['ramSha256'])
    raw = next(row for row in raw_rows if all(row[k] == point['position'][k] for k in ('transition', 'phase', 'ordinal', 'sequence', 'retired')))
    assert raw['ramDigest'] == ram_digest and bytes(raw['digest']).hex() == meta['stateSha256']
    states.append({'id': point['id'], 'stateSha256': meta['stateSha256'], 'ramSha256': ram_digest})
    last_machine = point['machine']
assert expected == inventory

archive = (root / run['archiveFile']['file']).read_bytes()
assert archive[:8] == b'WVBUND01' and u32(archive, 8) == 1
length = u32(archive, 12); header = json.loads(archive[16:16 + length])
assert tuple(header) == ('version', 'encoding', 'portability', 'scope', 'manifest', 'objects', 'uncompressedBytes')
assert header['portability'] == 'wasm-vm-witness-storage-v2' and header['scope'] == 'storage-only'
assert archive[16:16 + length] == canonical(header) and 16 + length + int(header['uncompressedBytes']) == len(archive)
archive_refs = {}; at = 16 + length; last = ''
for ref in header['objects']:
    assert ref['sha256'] > last; last = ref['sha256']; size = int(ref['length']); b = archive[at:at + size]; at += size
    assert len(b) == size and sha(b) == ref['sha256']; archive_refs[ref['sha256']] = ref
assert at == len(archive) and header['manifest'] == {'sha256': sha(manifest_bytes), 'length': str(len(manifest_bytes))}
assert archive_refs == {**expected, header['manifest']['sha256']: header['manifest']}
assert run['gc']['collected'] and run['archive']['witnesses'] == 130 and run['unfinishedArchive']['finished'] is False
assert sha(source.manifest(run['prefix']['id'])) == run['prefix']['manifestSha256']
if not a.development:
    attacks = report['attacks']; names = {r['name'] for r in attacks['checks']}
    assert {'missing-checkpoint', 'checkpoint-digest', 'rewritten-old-prefix', 'stale-final-cas', 'partial-real-retention-quota-import',
            'missing-final-page-open', 'corrupt-physical-page', 'archive-missing-before-publication', 'archive-surplus-before-publication',
            'old-client-refuses-required-pages', 'storage-archive-playback-refused'} <= names
    assert attacks['quota']['sessions'] == 0 and attacks['quota']['objects'] > 0 and attacks['finalGc']['collected']
    assert all(r['status'] in ('rejected', 'held') for r in attacks['checks'])
    assert {'missing-event-blob-before-publication','corrupt-event-blob-open','corrupt-event-blob-blocks-gc',
            'event-blob-publication-gc-export-import-inventory'} <= names
    fixture = attacks['blobFixture']
    body = (root / fixture['bodyBytes']['file']).read_bytes()
    assert fixture['body'] == {'sha256':sha(body),'length':str(len(body))} and body
    original_records = json.loads(source.read(fixture['originalEvent']))
    modified_bytes = (root / fixture['eventBytes']['file']).read_bytes()
    assert fixture['event'] == {'sha256':sha(modified_bytes),'length':str(len(modified_bytes))}
    modified_records = json.loads(modified_bytes)
    assert original_records[0]['payload']['storage'] == 'inline' and bytes(original_records[0]['payload']['bytes']) == body
    restored = json.loads(modified_bytes)
    assert restored[0]['payload'] == {'storage':'blob','content':fixture['body']}
    restored[0]['payload'] = original_records[0]['payload']
    assert restored == original_records, 'storage fixture must preserve every original event value'
    blob_manifest = (root / fixture['manifest']['file']).read_bytes()
    blob_archive = (root / fixture['archive']['file']).read_bytes()
    assert blob_archive[:8] == b'WVBUND01' and u32(blob_archive,8)==1
    hlen=u32(blob_archive,12); bh=json.loads(blob_archive[16:16+hlen]); offset=16+hlen; found={}; prior=''
    assert bh['portability']=='wasm-vm-witness-storage-v2' and bh['scope']=='storage-only'
    assert canonical(bh)==blob_archive[16:offset] and len(blob_archive)==offset+int(bh['uncompressedBytes'])
    for ref in bh['objects']:
        assert prior<ref['sha256'];prior=ref['sha256'];n=int(ref['length']);payload=blob_archive[offset:offset+n];offset+=n
        assert len(payload)==n and sha(payload)==ref['sha256'];found[ref['sha256']]=ref
    assert offset==len(blob_archive)
    blob_manifest_ref={'sha256':sha(blob_manifest),'length':str(len(blob_manifest))}
    blob_expected=dict(expected);del blob_expected[fixture['originalEvent']['sha256']]
    for ref in [fixture['body'],fixture['event'],blob_manifest_ref]:blob_expected[ref['sha256']]=ref
    assert found==blob_expected and bh['manifest']==blob_manifest_ref


out = root / 'independent-witness-oracle'; out.mkdir(exist_ok=False)
result = {'status': 'passed', 'witnesses': len(rows), 'pages': len(page_refs), 'fullV1WitnessBytes': len(canonical(rows)),
          'tailRows': tail_rows, 'commitmentBytes': len(extensions[1]['bytes']), 'checkpoints': len(states), 'states': states,
          'physicalObjects': len(source.objects), 'inventoryObjects': len(expected), 'archiveObjects': len(archive_refs),
          'manifestSha256': sha(manifest_bytes), 'tail': commitment['tail'], 'rawNativeStates': len(raw_rows),
          'scope': 'All 130 logical-native state/digest bindings; independent full/delta RAM reconstruction at every required native checkpoint. Not whole-history replay or desktop qualification.'}
(out / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'states'}))
