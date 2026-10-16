#!/usr/bin/env python3
"""Independent D35 critic inverse, fences, original backings and smallest V8 ranges.

This script imports no product or worker inverse. Its original fields are derived
by critic-auth directly from the pinned Mesa archive; native offsets come from GLES.
"""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = 'b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06'
SUBMISSION = '1398a86992e0575a29c56a9a93bd5e9d11d80e11'
RECORDED = 'b6434e33c9e5399f48fc191656e02f318cd78075'
RUNTIME_FILES = ['renderer/virgl-command/resources.mjs', 'renderer/virgl-command/packed-normalized-images.mjs']
SHA = lambda raw: hashlib.sha256(raw).hexdigest()


def need(condition, point):
    if not condition:
        raise ValueError(point)


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def native_fields(fmt, raw):
    size = fmt['guestPixelBytes']
    for offset in range(0, len(raw), size):
        word = int.from_bytes(raw[offset:offset + size], 'little')
        yield [((1 << f['bits']) - 1 or 1) if f.get('implicit') else
               (word >> f['offset']) & ((1 << f['bits']) - 1) for f in fmt['rgbaFields']]


def canonical(fmt, raw):
    alpha = fmt['rgbaFields'][3]
    mask = ((1 << alpha['bits']) - 1) << alpha['offset'] if alpha.get('implicit') else 0
    size = fmt['guestPixelBytes']
    return b''.join((int.from_bytes(raw[i:i + size], 'little') | mask).to_bytes(size, 'little')
                    for i in range(0, len(raw), size))


def upload_words(fmt, raw):
    return b''.join(sum((value if fmt['rgbaFields'][lane]['bits'] else 0) << fmt['nativeOffsets'][lane]
                        for lane, value in enumerate(pixel)).to_bytes(fmt['guestPixelBytes'], 'little')
                    for pixel in native_fields(fmt, raw))


def compare_plane(fmt, original, captured, point):
    size = fmt['guestPixelBytes']
    need(len(captured) == len(original) // size * 4, point + ' complete native component count')
    for pixel, expected in enumerate(native_fields(fmt, original)):
        wide = int.from_bytes(captured[pixel * 4:pixel * 4 + 4], 'little') if size == 4 else None
        for lane, value in enumerate(expected):
            bits = fmt['rgbaFields'][lane]['bits']
            mask = (1 << bits) - 1
            actual = (wide >> fmt['nativeOffsets'][lane]) & mask if size == 4 else \
                     (captured[pixel * 4 + lane] * mask + 127) // 255 if bits else captured[pixel * 4 + lane] // 255
            need(actual == value, point + f' pixel={pixel} lane={lane} expected={value} observed={actual}')
    return len(original) // size * 4


def original_input(fmt, width, height, last, seed, dense=False):
    size, planes, offset = fmt['guestPixelBytes'], [], 5
    def random():
        nonlocal seed
        seed ^= seed << 13 & 0xffffffff
        seed ^= seed >> 17
        seed ^= seed << 5 & 0xffffffff
        seed &= 0xffffffff
        return seed
    for level in range(last + 1):
        raw = bytearray()
        for pixel in range(width * height):
            word = pixel if dense and size == 2 else random()
            if dense and size == 4:
                word = pixel % 1024 | (pixel // 4 % 1024) << 10 | (1023 - pixel % 1024) << 20 | (pixel % 4) << 30
            raw.extend((word & ((1 << (size * 8)) - 1)).to_bytes(size, 'little'))
        stride = width * size + 7
        planes.append(dict(level=level, width=width, height=height, stride=stride, offset=offset, input=bytes(raw)))
        offset += (height - 1) * stride + width * size + 11
        width, height = max(1, width // 2), max(1, height // 2)
    backing = bytearray([0xa7] * (offset + 9))
    for plane in planes:
        count = plane['width'] * size
        for y in range(plane['height']):
            at = plane['offset'] + y * plane['stride']
            backing[at:at + count] = plane['input'][y * count:(y + 1) * count]
    return planes, bytes(backing)


def audit_fences(row, point):
    issued, completed, deleted, captures = {}, {}, Counter(), 0
    for index, event in enumerate(row['events']):
        if event['name'] == 'fenceSync':
            need(event['sync'] not in issued, point + ' unique sync identity')
            issued[event['sync']] = dict(index=index, turn=event['turn'], label=event['label'])
        elif event['name'] == 'clientWaitSync':
            sync = event['sync']
            need(sync in issued and not deleted[sync] and event['turn'] > issued[sync]['turn'], point + ' poll owns an earlier live fence')
            if event['delivered'] in (37146, 37148):
                need(event['actual'] in (37146, 37148), point + ' actual physical completion')
                completed[sync] = dict(index=index, turn=event['turn'], label=event['label'])
        elif event['name'] == 'getBufferSubData':
            live = [sync for sync in completed if not deleted[sync] and completed[sync]['index'] < index]
            need(live, point + f'/events/{index} CPU capture follows its own live completed sync')
            sync = max(live, key=lambda key: issued[key]['index'])
            need(completed[sync]['label'] == event['label'] and completed[sync]['turn'] <= event['turn'], point + ' capture/completion identity')
            captures += 1
        elif event['name'] == 'deleteSync':
            need(event['sync'] in issued, point + ' retirement owns sync')
            deleted[event['sync']] += 1
    need(all(deleted[sync] == 1 for sync in issued), point + ' every physical sync retires once')
    need(all(obj['deleted'] == 1 for obj in row['nativeObjects']), point + ' every native object retires once')
    need(all(value == 0 for value in row['final']['budgets'].values()), point + ' zero final budgets')
    return dict(syncs=len(issued), completed=len(completed), captures=captures)


def audit_values(directory, formats, output):
    count = dict(runs=0, nativeComponents=0, publicBytes=0, untouchedPaddingBytes=0, physicalReadComponents=0,
                 syncs=0, completed=0, captures=0)
    records, faults, dense = [], [], []
    paths = sorted(directory.glob('hardware-*/report.json')) + sorted(directory.glob('fault-*/report.json'))
    need(paths, str(directory) + ' has native records')
    for path in paths:
        envelope = json.loads(path.read_text())
        fault = path.parent.name.startswith('fault-')
        report = envelope['partial'] if fault else envelope['browserResult']['result']
        point = path.relative_to(directory).as_posix()
        need(envelope['gitHead'] in (SUBMISSION, RECORDED) and envelope['status'] == ('failed' if fault else 'passed'), point + ' exact source/head status')
        need(envelope['browserErrors'] == dict(console=[], page=[], requests=[]), point + ' browser errors')
        need(not envelope['browser']['headless'] and 'M4' in report['gpu'] and 'Metal' in report['gpu'], point + ' real headed Apple Metal')
        need(not any(re.search(r'headless|swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', arg, re.I)
                     for arg in envelope['browser']['commandLine']), point + ' hardware command line')
        need(all(report[key] is False for key in ('guestExecution', 'productionNegotiation', 'productionDrawAuthority')), point + ' isolated authority')
        for name in RUNTIME_FILES:
            source = next(item for item in envelope['sources'] if item['path'] == name)
            need(source['sha256'] == SHA((ROOT / name).read_bytes()), point + ' runtime source identity ' + name)
        blobs = {row['key']: row for row in report['blobs']}
        def raw(reference):
            saved = blobs[reference['key']]
            zipped = (path.parent / saved['path']).read_bytes()
            need(SHA(zipped) == saved['gzipSha256'], point + ' compressed bytes ' + saved['key'])
            value = gzip.decompress(zipped)
            need(SHA(value) == saved['sha256'] and len(value) == saved['bytes'], point + ' complete raw bytes ' + saved['key'])
            return value
        def plane(fmt, expected, reference, label):
            count['nativeComponents'] += compare_plane(fmt, expected, raw(reference), point + '/' + label)
        def fence(event):
            need(event['name'] == 'clientWaitSync' and event['actual'] in (37146, 37148) and event['delivered'] in (37146, 37148), point + ' physical fence')
        refutation = None
        for index, row in enumerate(report['runs']):
            count['runs'] += 1
            cursor = point + f'/runs/{index}'
            m = row['metadata']
            fmt = formats[m['format']]
            size = fmt['guestPixelBytes']
            fence_counts = audit_fences(row, cursor)
            for key, value in fence_counts.items():
                count[key] += value
            kind = row.get('kind', 'matrix')
            if kind == 'matrix':
                planes, backing = original_input(fmt, m['width'], m['height'], m['lastLevel'], row['seed'], row.get('dense', False))
                expected = [canonical(fmt, p['input']) for p in planes]
                need(raw(row['backing']) == backing and len(row['planes']) == len(planes), cursor + ' complete independently predicted inputs')
                for p, saved in zip(planes, row['planes']):
                    need(all(p[key] == saved[key] for key in ('level', 'width', 'height', 'stride', 'offset')) and p['input'] == raw(saved['input']), cursor + ' original pixel input')
                if row.get('dense'):
                    words = [int.from_bytes(planes[0]['input'][i:i + size], 'little') for i in range(0, len(planes[0]['input']), size)]
                    if size == 2:
                        need(words == list(range(65536)), cursor + ' exhaustive original sixteen-bit words')
                    else:
                        for field in fmt['rgbaFields']:
                            need({word >> field['offset'] & ((1 << field['bits']) - 1) for word in words} == set(range(1 << field['bits'])), cursor + ' complete original ten/two-bit field domain')
                    dense.append(dict(format=m['format'], bits=size * 8, pixels=len(words), point=cursor))
                fence(row['uploadFence'])
                if 'sabotageFence' in row:
                    fence(row['sabotageFence'])
                    need(row['sabotageFence']['sync'] != row['uploadFence']['sync'], cursor + ' distinct actual post-completion fence')
                    corrupt = next(event for event in row['faultEvents'] if event['name'] == 'actual-native-packed-word-corruption')
                    need(corrupt['completedBefore'] == row['uploadFence'] and corrupt['original'] != corrupt['delivered'], cursor + ' actual native target bit changed after completion')
                if 'initialNative' in row:
                    fence(row['initialFence'])
                    plane(fmt, bytes(len(expected[0])), row['initialNative'], f'runs/{index}/initialNative')
                for p, saved in zip(planes, row['planes']):
                    try:
                        plane(fmt, p['input'], saved['observed']['native'], f'runs/{index}/planes/{p["level"]}/observed/native')
                    except ValueError as error:
                        if not fault:
                            raise
                        refutation = dict(point=f'runs/{index}/planes/{p["level"]}/observed/native', prediction=str(error), blob=saved['observed']['native'])
                        break
                if refutation:
                    continue
                for patch in row['patches']:
                    patch_input = raw(patch['input'])
                    original, _ = original_input(fmt, patch['width'], patch['height'], 0, row['seed'] ^ 0x987612)
                    need(patch_input == original[0]['input'], cursor + ' independent patch source')
                    p = planes[patch['level']]
                    output_plane = bytearray(expected[p['level']])
                    count_bytes = patch['width'] * size
                    for y in range(patch['height']):
                        at = ((patch['y'] + y) * p['width'] + patch['x']) * size
                        output_plane[at:at + count_bytes] = canonical(fmt, patch_input[y * count_bytes:(y + 1) * count_bytes])
                    expected[p['level']] = bytes(output_plane)
                    fence(patch['fence'])
                    plane(fmt, expected[0], row['afterPatchNative'], f'runs/{index}/afterPatchNative')
                clear_index = 0
                for view in row['views']:
                    fence(view['fence'])
                    need(view['callerState']['before'] == view['callerState']['after'], cursor + ' native copy caller restoration')
                    for p in view['planes']:
                        need(p['local'] + view['firstLevel'] == p['original'], cursor + ' original/local range correspondence')
                        try:
                            plane(fmt, expected[p['original']], p['native'], f'runs/{index}/views/planes/native')
                        except ValueError as error:
                            if not fault:
                                raise
                            refutation = dict(point=f'runs/{index}/views/planes/native', prediction=str(error), blob=p['native'])
                            break
                    if refutation:
                        break
                    if 'refresh' in view:
                        clear = row['clears'][clear_index]
                        clear_index += 1
                        need(clear['values'] == [1, 0, 1, 1] and raw(clear['backingBefore']) == backing, cursor + ' native-only clear and original backing')
                        fence(clear['fence'])
                        word = sum(((1 << f['bits']) - 1 if f.get('implicit') else int(clear['values'][lane] * ((1 << f['bits']) - 1))) << f['offset'] for lane, f in enumerate(fmt['rgbaFields']))
                        expected[clear['level']] = word.to_bytes(size, 'little') * (planes[clear['level']]['width'] * planes[clear['level']]['height'])
                        fence(view['refresh']['fence'])
                        for p in view['refresh']['planes']:
                            plane(fmt, expected[p['original']], p['native'], f'runs/{index}/views/refresh/planes/native')
                if fault:
                    continue
                need(row['initializationState']['before'] == row['initializationState']['after'], cursor + ' original global/indexed caller masks')
                need(not any(item['label'] == 'original-packed-normalized-range-copy' for item in row['readbacks']), cursor + ' native-only copies')
                physical = sum(len(p['input']) for p in planes)
                for allocation in row['allocations']:
                    meta = allocation['metadata']
                    if meta['target'] != 2:
                        continue
                    total = sum(max(1, meta['width'] // 2 ** level) * max(1, meta['height'] // 2 ** level) * size for level in range(meta['lastLevel'] + 1))
                    need(meta['byteLength'] == meta['gpuByteLength'] == total and allocation['copyScratch'] is None, cursor + ' original/native allocation without shadow')
                    event = next(item for item in row['nativeEvents'] if item['name'] == 'texStorage2D' and item['texture'] == allocation['texture'])
                    need(event['args'][1:] == [meta['lastLevel'] + 1, report['nativeEnums'][fmt['plannedNativeInternal']], meta['width'], meta['height']], cursor + ' native packed internal storage')
                uploaded = [item for item in row['uploads'] if item['label'].startswith('original-packed-normalized-upload-')]
                need(len(uploaded) == len(planes), cursor + ' all original native mip uploads')
                for upload in uploaded:
                    level = int(upload['label'].rsplit('-', 1)[1])
                    need(raw(upload['bytes']) == upload_words(fmt, planes[level]['input']), cursor + ' independent actual upload packed words')
                    need(upload['args'][6:] == [report['nativeEnums'][fmt['plannedUploadFormat']], report['nativeEnums'][fmt['plannedUploadType']]], cursor + ' actual upload type/format')
                final, staged = bytearray(backing), bytearray([0x2e] * len(backing))
                need(raw(row['stagingBacking']) == staged, cursor + ' original staging input')
                for p, transfer in zip(planes, row['transfers']):
                    image, charge = expected[p['level']], p['width'] * p['height'] * 4
                    need(raw(transfer['sync']) == image, cursor + ' complete sync public original words')
                    count['publicBytes'] += len(image)
                    for read in transfer['reads']:
                        fence(read['fence'])
                        need(raw(read['nativeBytes']) == image, cursor + ' complete async public original words')
                        count['publicBytes'] += len(image)
                        for step in ('beforeRead', 'afterPrepare', 'afterIssue', 'afterReady', 'afterRelease'):
                            b = read[step]
                            scratch = charge if step in ('afterPrepare', 'afterIssue', 'afterReady') else 0
                            pbo = charge if step in ('afterIssue', 'afterReady') else 0
                            need(b['cpuBytes'] == 2 * len(backing) + scratch and b['backingBytes'] == 2 * len(backing) and b['scratchBytes'] == scratch and b['gpuBytes'] == physical + pbo, cursor + ' exact CPU/GPU/scratch/PBO at ' + step)
                    for capture in row['readbacks']:
                        if capture['label'] in [f'original-packed-normalized-sync-read-{p["level"]}', f'original-packed-normalized-staged-43-{p["level"]}', f'original-packed-normalized-staged-45-{p["level"]}'] and capture['bytes'] is not None:
                            count['physicalReadComponents'] += compare_plane(fmt, image, raw(capture['bytes']), cursor + ' complete raw native transfer capture')
                    row_bytes = p['width'] * size
                    for y in range(p['height']):
                        at = p['offset'] + y * p['stride']
                        final[at:at + row_bytes] = staged[at:at + row_bytes] = image[y * row_bytes:(y + 1) * row_bytes]
                need(raw(row['finalBacking']) == final and raw(row['finalStagingBacking']) == staged, cursor + ' full original backing/padding/SG')
                count['untouchedPaddingBytes'] += 2 * (len(backing) - physical)
            elif kind == 'generation-context-held-range':
                planes, backing = original_input(fmt, m['width'], m['height'], m['lastLevel'], report['seed'] ^ m['format'])
                need(raw(row['backing']) == backing, cursor + ' independently predicted retained source')
                for name in ('uploadFence', 'copyFence'):
                    fence(row[name])
                fence(row['discarded']['fence'])
                need(row['sourceGeneration'] == row['privateGeneration'] != row['replacementGeneration'], cursor + ' source/private retained and replacement generation')
                need(len({row['sourceTexture'], row['privateTexture'], row['replacementTexture']}) == 3, cursor + ' source/private/replacement physical identities')
                for p in row['heldPlanes']:
                    plane(fmt, planes[p['original']]['input'], p['native'], f'runs/{index}/heldPlanes/{p["local"]}/native')
            elif kind == 'queued-complete':
                fence(row['fence'])
                need(raw(row['output']) == canonical(fmt, raw(row['input'])), cursor + ' exact detached old-source read')
                count['publicBytes'] += len(raw(row['output']))
            elif kind.startswith('native-budget-'):
                budget, short = kind[len('native-budget-'):].rsplit('-', 1)
                need(row['before']['budgets'] == row['after']['budgets'], cursor + ' exact final bounded accounting')
                if short == '0':
                    fence(row['fence'])
                    need(raw(row['output']) == raw(row['input']), cursor + ' exact bounded native words')
                    b = row['afterIssue']['budgets']
                    need(b['scratchBytes'] == row['charge'] and b['gpuBytes'] == row['base'] + row['charge'] and b['cpuBytes'] == len(raw(row['backing'])) + row['charge'], cursor + ' exact bounded PBO/CPU charge')
                else:
                    need(not row['issued' if budget == 'gpuBytes' else 'prepared']['ok'], cursor + ' one-byte-short refuses')
            elif kind == 'deliberately-masked-indexed-extension':
                fence(row['uploadFence'])
                need(row['before'] == row['after'] and any(event.get('deliberatelyMasked') and event['actualAvailable'] for event in row['nativeEvents']), cursor + ' actual optional indexed extension fallback')
                plane(fmt, raw(row['input']), row['native'], f'runs/{index}/native')
            elif kind.startswith('native-error-'):
                need(row['result']['ok'] is False and row['result']['error']['code'] == 'backend-error' and row['faultEvents'], cursor + ' native error reached/refused/retired')
            elif kind == 'actual-context-loss':
                need(row['actualLost'] and not row['result']['ok'] and row['result']['error']['code'] == 'backend-error', cursor + ' actual native loss refuses')
            elif kind.startswith('queued-'):
                need(kind in ('queued-cancel-before-begin', 'queued-cancel-after-begin', 'queued-dispose-owner', 'queued-dispose-backend'), cursor + ' reviewed cancellation case')
            else:
                need(False, cursor + ' unreviewed case kind ' + kind)
        if fault:
            need(refutation is not None and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'], point + ' independent physical fault refutation')
            faults.append(dict(file=point, reportSha256=SHA(path.read_bytes()), fault=report['fault'], **refutation))
        else:
            need(all(prediction['held'] for prediction in report['predictions']), point + ' no failed recorded prediction')
        records.append(dict(file=point, sha256=SHA(path.read_bytes()), runs=len(report['runs']), status='refuted-control' if fault else 'held'))
    result = dict(schema='d35-independent-critic-values-v1', status='passed', importsProductConversion=False,
                  independentlyDerivedPrimary=True, **count, dense=dense, faults=faults, records=records)
    write(output, result)
    print(json.dumps({key: result[key] for key in ('status', 'runs', 'nativeComponents', 'physicalReadComponents', 'publicBytes', 'untouchedPaddingBytes', 'syncs', 'captures')}), flush=True)
    return result


def coverage(directory, output):
    diff = subprocess.check_output(['git', 'diff', '--unified=0', BASE, SUBMISSION, '--', *RUNTIME_FILES], cwd=ROOT, text=True)
    added, name, line = {}, None, None
    for row in diff.splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)', row)[1])
        elif row.startswith('+') and name:
            added.setdefault(name, []).append(line)
            line += 1
    records = []
    for path in sorted(directory.rglob('browser-coverage.json')):
        if path.relative_to(directory).parts[0].startswith('fault-'):
            continue
        saved = json.loads(path.read_text())
        for script in saved.get('scripts', [saved]):
            if script['source'] in added:
                need(script['sha256'] == SHA((ROOT / script['source']).read_bytes()), str(path) + ' matching runtime source')
                records.append(dict(file=path.relative_to(directory).as_posix(), digest=SHA(path.read_bytes()), **script))
    for path in sorted((directory / 'node-coverage').glob('coverage-*.json')):
        for script in json.loads(path.read_text())['result']:
            for name in RUNTIME_FILES:
                if script['url'].endswith('/' + name):
                    records.append(dict(file=path.relative_to(directory).as_posix(), digest=SHA(path.read_bytes()), source=name,
                                        sha256=SHA((ROOT / name).read_bytes()), coverage=script))
    partitions = []
    for name, lines in added.items():
        text = (ROOT / name).read_text().splitlines(keepends=True)
        offsets = [0]
        for row in text:
            offsets.append(offsets[-1] + len(row.encode('utf-16-le')) // 2)
        observed = [record for record in records if record['source'] == name]
        for line in lines:
            start, end = offsets[line - 1], offsets[line]
            endpoints = {start, end}
            for record in observed:
                for function in record['coverage']['functions']:
                    for region in function['ranges']:
                        endpoints.update(point for point in (region['startOffset'], region['endOffset']) if start < point < end)
            points = sorted(endpoints)
            for a, b in zip(points, points[1:]):
                governing = []
                for record in observed:
                    candidates = [(region['endOffset'] - region['startOffset'], fn, index, region)
                                  for fn, function in enumerate(record['coverage']['functions']) for index, region in enumerate(function['ranges'])
                                  if region['startOffset'] <= a and b <= region['endOffset']]
                    if candidates:
                        _, fn, index, region = min(candidates, key=lambda item: (item[0], -item[1], -item[2]))
                        governing.append(dict(file=record['file'], digest=record['digest'], function=fn, range=index, **region))
                partitions.append(dict(source=name, line=line, startOffset=a, endOffset=b,
                                       count=max((item['count'] for item in governing), default=0), governing=governing))
    zero = [row for row in partitions if row['count'] == 0]
    claimed = json.loads((directory / 'coverage-audit.json').read_text())
    observed = {(p['source'], p['line'], p['startOffset'], p['endOffset']): p['count'] for p in partitions}
    expected = {(p['source'], p['line'], p['startOffset'], p['endOffset']): p['maxCount'] for p in claimed['partitions']}
    need(observed == expected and not zero and len(partitions) == 449, 'independently rebuilt smallest governing nested V8 partitions')
    result = dict(schema='d35-fresh-critic-smallest-v8-v1', status='passed', positive=len(partitions), zero=zero, waivers=[],
                  coveredAddedLines=added, governingSourceSHA256={name: SHA((ROOT / name).read_bytes()) for name in added},
                  claimedAuditSHA256=SHA((directory / 'coverage-audit.json').read_bytes()), records=records, partitions=partitions)
    write(output, result)
    print(json.dumps(dict(coverage='held', positive=len(partitions), zero=len(zero), waivers=0)), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--coverage', action='store_true')
    args = parser.parse_args()
    primary = json.loads((args.root / 'primary-derived.json').read_text())
    formats = {row['originalFormat']: row for row in primary['records']}
    audit_values(args.directory, formats, args.root / (args.name + '-values.json'))
    if args.coverage:
        coverage(args.directory, args.root / (args.name + '-coverage.json'))


if __name__ == '__main__':
    main()
