#!/usr/bin/env python3
"""Fresh-critic custody, primary-field, native-event and smallest-range audit.

This does not execute or import renderer conversion code. The worker's complete
Python inverse is also rerun unchanged, after authenticating its frozen source.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ec96d7544bb86c9defda0b7abc60e447a0a634b9'
FROZEN = 'c7c66c54482566f76b2f49af5a5e5721bd69d3f7'
SEAL = ROOT/'evidence/virgl-standard-packed-unsigned-images/worker'
PINS = {'recording.tar.gz': '3013c3d161c192b598370147e70940a28a14bfd741ce3a4180ed027da79167fc',
        'records.json': 'f191f60d45f82bab43fdec9227123b8f79c53fb9df90f60546b468741167af6e',
        'manifest.json': 'f6fb9368e136cc8e4ed9fa5bd0d8ddfce453a9dcf3bba577bbadbbfdfee0f6c6'}
sha = lambda b: hashlib.sha256(b).hexdigest()


def need(value, message):
    if not value:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def json_at(path):
    return json.loads(path.read_bytes())


def reopen(folder, destination=None, pins=None):
    digests = {name: sha((folder/name).read_bytes()) for name in PINS}
    if pins:
        need(digests == pins, 'sealed digest mismatch '+str(folder))
    manifest, index = json_at(folder/'manifest.json'), json_at(folder/'records.json')
    need(manifest['archiveSha256'] == digests['recording.tar.gz'] and
         manifest['recordIndexSha256'] == digests['records.json'], 'sealed manifest custody')
    expected = {r['path']: r for r in index['records']}
    need(len(expected) == len(index['records']), 'duplicate index member')
    seen, total = set(), 0
    with tarfile.open(folder/'recording.tar.gz', 'r:gz') as archive:
        for entry in archive:
            need(entry.isfile() and entry.name in expected and entry.name not in seen and
                 not entry.name.startswith('/') and '..' not in Path(entry.name).parts,
                 'unsafe/duplicate/unindexed archive member '+entry.name)
            raw, record = archive.extractfile(entry).read(), expected[entry.name]
            need(len(raw) == record['bytes'] and sha(raw) == record['sha256'], 'member drift '+entry.name)
            seen.add(entry.name)
            total += len(raw)
            if destination:
                target = destination/entry.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
    need(seen == set(expected) and len(seen) == manifest['records'], 'incomplete sealed recording')
    return dict(path=folder.relative_to(ROOT).as_posix(), members=len(seen), rawBytes=total,
                digests=digests, sourceHead=index.get('sourceHead'))


def original_fields():
    header = (ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes()
    yaml = (ROOT/'tools/virgl-command/standard-packed-unsigned-mesa-formats.yaml').read_bytes()
    descriptor = json_at(ROOT/'tools/virgl-command/standard-packed-unsigned-formats.json')
    need(sha(header) == descriptor['originalHeaderSha256'] and sha(yaml) == descriptor['mesaExcerptSha256'],
         'primary header/Mesa pins')
    fields = {}
    for row in descriptor['records']:
        name, ident = row['originalName'], row['originalFormat']
        need(re.search(r'VIRGL_FORMAT_'+name+r'\s*=\s*'+str(ident)+r'\b', header.decode()), 'original enum')
        block = yaml.decode().split('- name: '+name+'\n')[1].split('- name:')[0]
        widths = [int(s[2:]) for s in re.search(r'channels: \[([^]]+)\]', block)[1].split(', ')]
        swizzles = re.search(r'swizzles: \[([^]]+)\]', block)[1].split(', ')
        need(widths == [10, 10, 10, 2], 'unsigned physical fields')
        fields[ident] = [(sum(widths[:'XYZW'.index(s)]), widths['XYZW'.index(s)]) for s in swizzles]
        need(fields[ident] == [(f['offset'], f['bits']) for f in row['rgbaFields']], 'primary derived offsets')
    need(fields == {225: [(20, 10), (10, 10), (0, 10), (30, 2)],
                    253: [(0, 10), (10, 10), (20, 10), (30, 2)]}, 'both original aliases')
    return fields


def unpack_native(fields, fmt, public):
    need(len(public) % 4 == 0, 'complete original words')
    return b''.join(struct.pack('<4I', *[(word[0] >> offset) & ((1 << bits)-1)
                                      for offset, bits in fields[fmt]])
                    for word in struct.iter_unpack('<I', public))


def audit_events(report, path, fields):
    result = report['partial'] if report['status'] == 'failed' else report['browserResult']['result']
    blobs = {b['key']: b for b in result['blobs']}
    def raw(record):
        b = blobs[record['key']]
        packed = (path.parent/b['path']).read_bytes()
        need(sha(packed) == b['gzipSha256'], 'compressed raw custody')
        value = gzip.decompress(packed)
        need(len(value) == b['bytes'] and sha(value) == b['sha256'], 'raw native custody')
        return value
    rows, components, reads, fences = [], 0, 0, 0
    for ordinal, row in enumerate(result['runs']):
        points = row['events']
        creates = [(i, e) for i, e in enumerate(points) if e['name'] == 'fenceSync']
        for i, create in creates:
            deletes = [(j, e) for j, e in enumerate(points) if e['name'] == 'deleteSync' and e['sync'] == create['sync']]
            need(len(deletes) == 1 and deletes[0][0] > i, 'native fence retirement once/after creation')
            polls = [(j, e) for j, e in enumerate(points) if e['name'] == 'clientWaitSync' and e['sync'] == create['sync']]
            need(all(i < j < deletes[0][0] and e['turn'] > create['turn'] and
                     e['actual'] in (37146, 37147, 37148) and e['delivered'] in (37146, 37147, 37148)
                     for j, e in polls), 'bounded later-task owned physical fence polls')
            need(len({e['turn'] for _, e in polls}) == len(polls), 'one fence poll per later task')
            fences += 1
        for i, event in enumerate(points):
            if event['name'] == 'getBufferSubData':
                preceding = [(j, e) for j, e in enumerate(points[:i]) if e['name'] == 'clientWaitSync' and e['delivered'] in (37146, 37148)]
                need(preceding, 'physical completion before collection')
                point = preceding[-1][1]
                need(point['actual'] in (37146, 37148) and point['turn'] <= event['turn'], 'actual hardware completion before collection')
                reads += 1
        need(all(o['deleted'] == 1 for o in row['nativeObjects']) and
             all(v == 0 for v in row['final']['budgets'].values()), 'once-only objects and terminal charges')
        for event in row['nativeEvents']:
            if event['name'] == 'blitFramebuffer':
                need(event['args'][8:] == [16384, 9728], 'integer private copy must use COLOR and NEAREST')
            if event['name'] == 'texStorage2D' and event['args'][2] != 0:
                need(event['args'][2] == 36975, 'actual packed integer native internal format')
        # Full sync native and PBO raw lane outputs are authenticated before compaction.
        if 'transfers' in row and report['status'] == 'passed':
            fmt = row['metadata']['format']
            for transfer in row['transfers']:
                expected = unpack_native(fields, fmt, raw(transfer['sync']))
                level = transfer['level']
                candidates = [b for b in row['readbacks'] if b['label'] == 'original-packed-unsigned-sync-read-'+str(level)]
                need(len(candidates) == 1 and candidates[0]['type'] == 'Uint32Array' and
                     candidates[0]['args'][4:] == [36249, 5125] and raw(candidates[0]['bytes']) == expected,
                     'whole original native integer direct-read plane')
                components += len(expected)//4
                for read in transfer['reads']:
                    label = 'original-packed-unsigned-staged-'+str(read['opcode'])+'-'+str(level)
                    candidates = [b for b in row['readbacks'] if b['label'] == label]
                    issue = [b for b in candidates if b['name'] == 'readPixels']
                    collect = [b for b in candidates if b['name'] == 'getBufferSubData']
                    need(len(issue) == len(collect) == 1 and issue[0]['type'] == 'PBO' and
                         issue[0]['buffer'] == collect[0]['buffer'] and issue[0]['args'][4:] == [36249, 5125] and
                         raw(collect[0]['bytes']) == expected, 'complete PBO integer lanes and physical buffer identity')
                    components += len(expected)//4
            for operation in row['operations']:
                wire, layout = bytes.fromhex(operation['wire']), operation['layout']
                words = list(struct.unpack('<'+'I'*(len(wire)//4), wire))
                opcode, length = words[0] & 255, words[0] >> 16
                need(opcode in (9, 43) and length == len(words)-1, 'full original upload packet header')
                w, h = words[9], words[10]
                need(layout['rowBytes'] == w*4 and layout['tightBytes'] == layout['scratchBytes'] == w*h*4 and
                     layout['stagingBytes'] == 0, 'four-byte packed upload layout')
        rows.append(dict(run=ordinal, kind=row.get('kind', 'matrix'), format=row['metadata']['format'],
                         nativeObjects=len(row['nativeObjects']), syncs=len(creates), terminalBudgets=row['final']['budgets']))
    return dict(path=str(path), runs=rows, rawReadComponents=components, physicalCollections=reads, onceOnlyFences=fences)


def coverage(directory, source_root):
    added, name = {}, None
    diff = git('diff', '--unified=0', BASE, FROZEN, '--', 'renderer/virgl-command/resources.mjs',
               'renderer/virgl-command/packed-unsigned-images.mjs').decode()
    for row in diff.splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)', row)[1])
        elif row.startswith('+') and name:
            added.setdefault(name, []).append(line)
            line += 1
    recorded = json_at(directory/'coverage-audit.json')
    observations = []
    for path in sorted(directory.rglob('browser-coverage.json')):
        if '/fault-' in str(path):
            continue
        record = json_at(path)
        for script in record.get('scripts', [record]):
            if script['source'] in added:
                need(script['sha256'] == sha((source_root/script['source']).read_bytes()), 'exact coverage script source')
                observations.append((path.relative_to(directory).as_posix(), script['source'], script['coverage']))
    for path in sorted((directory/'node-coverage').glob('coverage-*.json')):
        for script in json_at(path)['result']:
            for name in added:
                if script['url'].endswith('/'+name):
                    observations.append((path.relative_to(directory).as_posix(), name, script))
    partitions = []
    for name, lines in added.items():
        source = (source_root/name).read_text().splitlines(keepends=True)
        boundaries = [0]
        for text in source:
            boundaries.append(boundaries[-1]+len(text.encode('utf-16-le'))//2)
        relevant = [(path, c) for path, n, c in observations if n == name]
        for line in lines:
            start, end = boundaries[line-1:line+1]
            cuts = {start, end}
            for _, script in relevant:
                for function in script['functions']:
                    for region in function['ranges']:
                        cuts.update(e for e in (region['startOffset'], region['endOffset']) if start < e < end)
            cuts = sorted(cuts)
            for start, end in zip(cuts, cuts[1:]):
                counters = []
                for path, script in relevant:
                    candidates = [r for f in script['functions'] for r in f['ranges']
                                  if r['startOffset'] <= start and end <= r['endOffset']]
                    if candidates:
                        smallest = min(candidates, key=lambda r: r['endOffset']-r['startOffset'])
                        counters.append(dict(record=path, **smallest))
                partitions.append(dict(source=name, line=line, startOffset=start, endOffset=end,
                                       maxCount=max((c['count'] for c in counters), default=0), counters=counters))
    need(added == recorded['addedLines'], 'full exact changed line set')
    by_key = lambda rows: {(r['source'], r['line'], r['startOffset'], r['endOffset']): r for r in rows}
    actual, expected = by_key(partitions), by_key(recorded['partitions'])
    need(actual.keys() == expected.keys() and len(actual) == len(partitions) == 327, 'all smallest nested partitions')
    for key, row in actual.items():
        other = expected[key]
        need(row['maxCount'] > 0 and row['maxCount'] == other['maxCount'] and
             sorted(row['counters'], key=lambda c:c['record']) == sorted(other['counters'], key=lambda c:c['record']),
             'partition counter/sufficiency mismatch '+str(key))
    return dict(status='passed', positive=len(partitions), missing=[], waivers=[], partitions=partitions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    predictions = json_at(out/'predictions.json')
    need(predictions['writtenBeforeWorkerEvidence'], 'critic predictions predate evidence')
    reopened = out/'worker-reopened'
    custody = reopen(SEAL, reopened, PINS)
    need(custody['members'] == 11416 and custody['rawBytes'] == 105019927 and custody['sourceHead'] == FROZEN,
         'complete worker custody and frozen head')
    source = reopened/'source'
    for path in source.rglob('*'):
        if path.is_file():
            need(path.read_bytes() == git('show', FROZEN+':'+path.relative_to(source).as_posix()), 'sealed frozen source')
    fields = original_fields()
    result = dict(schema='packed-unsigned-fresh-critic-worker-audit-v1', status='running', custody=custody,
                  primaryFields={str(k):v for k,v in fields.items()}, predecessorSeals=[], acceptances=[])
    for family in ('virgl-standard-packed-normalized-images', 'virgl-packed-normalized-consumer'):
        for role in ('worker', 'verifier'):
            folder = ROOT/'evidence'/family/role
            for name in PINS:
                need((folder/name).read_bytes() == git('show', BASE+':'+(folder/name).relative_to(ROOT).as_posix()), 'unchanged held seal')
            result['predecessorSeals'].append(reopen(folder))
    need(sum(r['members'] for r in result['predecessorSeals']) == 141936, 'all held predecessor members')
    inverse_file = ROOT/'tools/virgl-command/standard-packed-unsigned-values.py'
    need(inverse_file.read_bytes() == git('show', FROZEN+':'+inverse_file.relative_to(ROOT).as_posix()), 'unchanged complete inverse')
    spec = importlib.util.spec_from_file_location('complete_inverse', inverse_file)
    inverse = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inverse)
    for prefix in ('hot', 'cold'):
        directory = reopened/prefix
        receipt = json_at(directory/'receipt.json')
        need(receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN, 'exact hot/cold receipt head')
        for name, digest in receipt['files'].items():
            need(sha((directory/name).read_bytes()) == digest, 'receipt-record drift '+prefix+'/'+name)
        for name, digest in receipt['sources'].items():
            need(sha(git('show', FROZEN+':'+name)) == digest, 'exact frozen source pin '+name)
        for name, digest in receipt['generated'].items():
            raw = (reopened/(prefix+'-generated')/name).read_bytes()
            need(sha(raw) == digest and sha((ROOT/name).read_bytes()) == digest, 'actual C/Wasm generated pin')
        before = (directory/'independent-values.json').read_bytes()
        inverse.main(directory)
        need((directory/'independent-values.json').read_bytes() == before, 'complete independent worker inverse changed result')
        cov = coverage(directory, source)
        (out/(prefix+'-independent-coverage.json')).write_text(json.dumps(cov, indent=2)+'\n')
        wire = json_at(directory/'wire/report.json')['wire']
        counts = {kind:sum(r['kind'] == kind for r in wire['records']) for kind in ('old-owner','old-layout','old-consumer')}
        need(counts == {'old-owner':132,'old-layout':120,'old-consumer':6}, 'complete original old boundary records')
        need(all(not r['result']['ok'] for r in wire['records'] if r['kind'] in counts), 'old consumer/owner/layout remains closed')
        for record in wire['records']:
            kind = record['kind']
            if kind in ('invalid-metadata','invalid-transfer','hostile-metadata','backend-profile','invalid-config'):
                need(not record['result']['ok'], 'all selected malformed/profile refusals')
            if kind == 'hostile-metadata':
                need(record['calls'] == 0, 'hostile metadata never invokes accessor')
            if kind == 'layout':
                layout, box = record['result']['layout'], record['fields']['box']
                read = record['fields']['direction'] == 2
                need(layout['tightBytes'] == box['width']*box['height']*4 and
                     layout['scratchBytes'] == box['width']*box['height']*(16 if read else 4) and
                     layout['stagingBytes'] == (box['width']*box['height']*16 if read else 0), 'all original 4/16-byte pure layouts')
            if kind == 'allocation-bound':
                meta = record['metadata']
                charge = sum(max(1,meta['width']//2**level)*max(1,meta['height']//2**level)*4 for level in range(meta['lastLevel']+1))
                exact = next(iter(record['limits'].values())) == charge
                need(record['result']['ok'] == exact and record['allocations'] == int(exact), 'exact/short complete packed allocation precedes native mutation')
        audits = [audit_events(json_at(path), path, fields) for path in sorted(directory.glob('hardware-*/report.json'))]
        need(len(audits) == 4, 'full matrix and all three worker schedules')
        for path in sorted(directory.glob('hardware-boundaries-*/report.json')):
            runs = json_at(path)['browserResult']['result']['runs']
            need(len(runs) == 22, 'complete varied native schedule')
            for run in runs:
                if run['kind'].startswith('native-error-'):
                    need(run['result']['ok'] is False and run['result']['error']['code'] == 'backend-error' and run['faultEvents'], 'all actual native allocation/transfer/completion failure refusals')
                if run['kind'] == 'actual-context-loss':
                    need(run['actualLost'] and not run['result']['ok'] and run['result']['error']['code'] == 'backend-error', 'actual hardware context loss refuses')
        predecessor = json_at(directory/'predecessor-audit.json')
        for name, digest in predecessor['unchangedBoundaries'].items():
            need(sha((ROOT/name).read_bytes()) == digest and (ROOT/name).read_bytes() == git('show',BASE+':'+name), 'held source boundary')
        result['acceptances'].append(dict(prefix=prefix, receiptSha256=sha((directory/'receipt.json').read_bytes()),
                                          valueAudit=json_at(directory/'independent-values.json'), oldBoundaryCounts=counts,
                                          coveragePartitions=len(cov['partitions']), nativeAudits=audits))
    cold = json_at(reopened/'cold/report.json')
    need(cold['gitHead'] == cold['cloneHead'] == FROZEN and cold['statusBefore'] == cold['statusAfter'] == '' and
         cold['status'] == 'passed' and cold['exitCode'] == 0 and
         cold['receiptSha256'] == result['acceptances'][1]['receiptSha256'], 'completed pristine exact-head cold proof')
    need(sha((reopened/'cold/cold.log').read_bytes()) == cold['logSha256'], 'full cold log digest')
    gap = json_at(ROOT/'evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.json')
    need(gap['sourceSnapshotHead'] == BASE and gap['originalMetadataRecords'] == len(gap['records']) == 12 and gap['allocations'] == 0,
         'twelve original predecessor refusals and zero allocations')
    for record in gap['records']:
        meta = record['metadata']
        need(meta['format'] in fields and meta['lastLevel'] in (0,3) and meta['bind'] in (2,8,10) and
             record['originalCreateWords'] == [meta[k] for k in ('id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags')],
             'complete original predecessor creation metadata')
        words = struct.unpack('<14I',bytes.fromhex(record['originalTransferHex']))
        need(words == (43 | (13 << 16),6,0,0,59,0,0,0,0,13,7,1,5,1) and
             all(not record[k]['ok'] and record[k]['error']['code'] == 'unsupported-resource' for k in ('create','layout')),
             'complete original predecessor transfer packet and explicit refusal')
    for record in gap['sources']:
        raw = git('show',BASE+':'+record['path'])
        need(sha(raw) == record['sha256'] and len(raw) == record['bytes'], 'predecessor negative source boundary')
    result['predecessorRefusal'] = dict(path='evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.json',
                                      sha256=sha((ROOT/'evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.json').read_bytes()),
                                      completeRecords=12,allocations=0,sourceHead=BASE)
    cold_source = (source/'tools/virgl-command/standard-packed-unsigned-cold.py').read_text()
    need("del env[key]" in cold_source and "'EMSDK_PYTHON'" in cold_source and "'NODE_V8_COVERAGE'" in cold_source,
         'cold override scrub recorded code')
    result['coldProof'] = cold
    serving = json_at(ROOT/'tools/virgl-command/standard-packed-unsigned-serving-boundary.json')
    result['declarativeWaivers'] = []
    for record in serving['records']:
        text = (ROOT/record['path']).read_text()
        for change in reversed(record['changes']):
            need(text.count(change['after']) == 1, 'unique declared historical addition')
            text = text.replace(change['after'], change['before'], 1)
        need(text.encode() == git('show',BASE+':'+record['path']) and sha(text.encode()) == record['predecessorSha256'],
             'exact old static server algorithm boundary')
        result['declarativeWaivers'].append(dict(path=record['path'], reason='Only a static served-module/source pin entry is added; exact prior algorithm bytes hold.'))
    need(len(result['declarativeWaivers']) == 27, 'all historical declarations')
    diff = git('diff',BASE,FROZEN,'--','renderer/virgl-shader','crates','web','tools/guest')
    need(not diff, 'no compiler/default/production/capset/browser surface admission')
    result['status'] = 'passed'
    (out/'worker-independent-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed', workerMembers=custody['members'], predecessorMembers=141936,
                          coveragePartitionsPerAcceptance=327, nativeAudits=sum(len(r['nativeAudits']) for r in result['acceptances']))))


if __name__ == '__main__':
    main()
