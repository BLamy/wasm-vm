#!/usr/bin/env python3
"""Reconstruct the critic's native alias/mip/partial-box run from original fields."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('critic_inverse', Path(__file__).with_name('standard-packed-normalized-critic-audit.py'))
inverse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inverse)
need, sha = inverse.need, inverse.SHA
ENUMS = dict(RGB565=36194, RGBA4=32854, RGB5_A1=32855, RGB10_A2=32857,
             RGB=6407, RGBA=6408, UNSIGNED_SHORT_5_6_5=33635,
             UNSIGNED_SHORT_4_4_4_4=32819, UNSIGNED_SHORT_5_5_5_1=32820,
             UNSIGNED_INT_2_10_10_10_REV=33640)


def main(directory, primary, output):
    path = directory / 'report.json'
    envelope = json.loads(path.read_text())
    need(envelope['status'] == 'passed' and envelope['browserResult']['status'] == 'passed', 'novel completed')
    report = envelope['browserResult']['result']
    need('M4' in report['gpu'] and 'Metal' in report['gpu'] and not envelope['browser']['headless'], 'novel actual headed Metal')
    need(envelope['browserErrors'] == dict(console=[], page=[], requests=[]), 'novel no browser error')
    need(all(not report[key] for key in ('guestExecution', 'productionNegotiation', 'productionDrawAuthority', 'oracleImportsProductConversion')), 'novel private authority/oracle')
    need(all(row['held'] for row in report['predictions']), 'novel all captured assertions held')
    fields = {row['originalFormat']: row for row in json.loads(primary.read_text())['records']}
    blobs = {row['key']: row for row in report['blobs']}
    def raw(reference):
        saved = blobs[reference['key']]
        zipped = (directory / saved['path']).read_bytes()
        value = gzip.decompress(zipped)
        need(sha(zipped) == saved['gzipSha256'] and sha(value) == saved['sha256'] and len(value) == saved['bytes'], 'novel complete blob ' + reference['key'])
        return value
    counts = dict(runs=0, originalFormats=[], nativeComponents=0, rawTransferComponents=0, publicBytes=0,
                  untouchedPaddingBytes=0, syncs=0, completed=0, captures=0, budgetCases=0)
    anchors = []
    for i, row in enumerate(report['runs']):
        point = f'report.json/browserResult/result/runs/{i}'
        fmt = fields[row['metadata']['format']]
        size = fmt['guestPixelBytes']
        counts['runs'] += 1
        for key, value in inverse.audit_fences(row, point).items():
            counts[key] += value
        # All physically allocated texture levels have packed-sized storage and no shadow.
        for allocation in row['allocations']:
            m = allocation['metadata']
            if m['target'] != 2:
                need(allocation['texture'] is None and allocation['buffer'] is None, point + ' CPU-only guest bind524288')
                continue
            af = fields[m['format']]
            packed = sum(max(1, m['width'] >> level) * max(1, m['height'] >> level) * af['guestPixelBytes'] for level in range(m['lastLevel'] + 1))
            need(m['byteLength'] == m['gpuByteLength'] == packed and allocation['copyScratch'] is None, point + ' exact packed mip storage/no shadow')
            event = next(e for e in row['nativeEvents'] if e['name'] == 'texStorage2D' and e['texture'] == allocation['texture'])
            need(event['args'][1:] == [m['lastLevel'] + 1, ENUMS[af['plannedNativeInternal']], m['width'], m['height']], point + ' actual native packed texStorage2D')
        if row['kind'] == 'novel-original-alias-mip-partial':
            counts['originalFormats'].append(fmt['originalFormat'])
            plan = row['inputPlan']
            need(row['callerBefore'] == row['callerAfter'] and row['copyCallerBefore'] == row['copyCallerAfter'], point + ' caller FBO/mask/indexed/scissor')
            need(row['generation'] != row['replacementGeneration'] and row['replacementMetadata']['format'] == row['alias'], point + ' opposite alias distinct generation')
            expected, originals, offset = [], [], 3
            backing = bytearray([0xcd] * len(bytes.fromhex(plan['backingHex'])))
            for p in plan['planes']:
                level, width, height = p['level'], p['width'], p['height']
                need((width, height, p['stride'], p['offset']) == (max(1, 11 >> level), max(1, 7 >> level), width * size + 5, offset), point + ' prescribed original odd-stride mip plan')
                words = [((report['seed'] + fmt['originalFormat'] * 97 + pixel * 0x9e3779b9) ^ ((pixel + 7) * 0x45d9f3b) ^ (level * 0xabcdef01)) & ((1 << (size * 8)) - 1) for pixel in range(width * height)]
                original = b''.join(word.to_bytes(size, 'little') for word in words)
                need(original.hex() == p['inputHex'] and raw(row['planes'][level]['input']) == original, point + ' independent original input formula')
                originals.append(original)
                expected.append(bytearray(inverse.canonical(fmt, original)))
                for y in range(height):
                    backing[offset + y * p['stride']:offset + y * p['stride'] + width * size] = original[y * width * size:(y + 1) * width * size]
                offset += (height - 1) * p['stride'] + width * size + 13
            need(raw(row['originalBacking']) == backing and backing.hex() == plan['backingHex'], point + ' full original SG/padding input')
            patch = plan['patch']
            patch_input = b''.join(((report['seed'] ^ pixel * 0x1749a3bd ^ fmt['originalFormat']) & ((1 << (size * 8)) - 1)).to_bytes(size, 'little') for pixel in range(4))
            need(patch_input.hex() == patch['inputHex'] and patch == dict(level=1, x=2, y=1, width=2, height=2, stride=2 * size + 3, offset=1, inputHex=patch_input.hex()), point + ' independent nonzero mip patch')
            p = plan['planes'][1]
            for y in range(2):
                at = ((y + 1) * p['width'] + 2) * size
                expected[1][at:at + 2 * size] = inverse.canonical(fmt, patch_input[y * 2 * size:(y + 1) * 2 * size])
            need(len(row['observations']) == 10, point + ' full source/private/retained native plane capture')
            for j, observed in enumerate(row['observations']):
                level = observed['original']
                need(raw(observed['expected']) == expected[level], point + ' expected fixture independent reconstruction')
                counts['nativeComponents'] += inverse.compare_plane(fmt, expected[level], raw(observed['native']), point + f'/observations/{j}/native')
                if observed['kind'] != 'source-after-patch':
                    need(observed['local'] + 1 == level, point + ' original/local nonzero mip map')
            uploads = [u for u in row['uploads'] if u['label'].startswith('critic-original-upload-')]
            need(len(uploads) == 4, point + ' four actual native mip uploads')
            for u in uploads:
                level = int(u['label'].rsplit('-', 1)[1])
                need(raw(u['bytes']) == inverse.upload_words(fmt, originals[level]), point + ' actual native upload permutation')
                need(u['args'][6:] == [ENUMS[fmt['plannedUploadFormat']], ENUMS[fmt['plannedUploadType']]], point + ' original native upload type/format')
            patch_upload = next(u for u in row['uploads'] if u['label'] == 'critic-nonzero-mip-partial-upload')
            need(raw(patch_upload['bytes']) == inverse.upload_words(fmt, patch_input) and patch_upload['args'][1:6] == [1, 2, 1, 2, 2], point + ' actual nonzero mip/box patch')
            blits = [e for e in row['nativeEvents'] if e['name'] == 'blitFramebuffer']
            need(len(blits) == 3 and all(e['args'][-2:] == [16384, 9728] for e in blits), point + ' native-only three NEAREST color mip blits')
            need(not any(r['label'] == 'critic-GPU-range-copy' for r in row['readbacks']), point + ' no CPU copy fallback')
            box = plan['box']
            need(box == dict(level=1, x=1, y=1, width=3, height=2, stride=3 * size + 3, offset=7), point + ' prescribed odd partial output box')
            dense = b''.join(expected[1][((y + 1) * 5 + 1) * size:((y + 1) * 5 + 4) * size] for y in range(2))
            need(raw(row['expectedPartial']) == dense, point + ' exact cropped original words')
            staged = bytearray([0x89] * len(backing))
            need(raw(row['stagingBefore']) == staged, point + ' complete staged SG input')
            for read in row['reads']:
                need(raw(read['output']) == dense and read['fence']['actual'] in (37146, 37148), point + ' physical-fence partial output')
                counts['publicBytes'] += len(dense)
                before, prepared, issued = read['before'], read['afterPrepare'], read['afterIssue']
                need(before['cpuBytes'] == before['backingBytes'] == 2 * len(backing) and before['scratchBytes'] == 0, point + ' public original/staging CPU-only charge')
                need(prepared['cpuBytes'] - before['cpuBytes'] == prepared['scratchBytes'] == 24 and prepared['gpuBytes'] == before['gpuBytes'], point + ' scratch at preparation')
                need(issued['gpuBytes'] - before['gpuBytes'] == 24 and issued['scratchBytes'] == 24, point + ' physical PBO only at issue')
            for capture in row['readbacks']:
                if capture['label'] in ('critic-sync-partial-mip-read', 'critic-async-partial-mip-read-43', 'critic-async-partial-mip-read-45') and capture['bytes'] is not None:
                    counts['rawTransferComponents'] += inverse.compare_plane(fmt, dense, raw(capture['bytes']), point + ' complete raw native partial transfer')
            for y in range(2):
                at = 7 + y * box['stride']
                backing[at:at + 3 * size] = staged[at:at + 3 * size] = dense[y * 3 * size:(y + 1) * 3 * size]
            need(raw(row['finalBacking']) == backing and raw(row['finalStaging']) == staged, point + ' complete final source/staged SG bytes')
            counts['untouchedPaddingBytes'] += 2 * (len(backing) - len(dense))
            need(len(row['negatives']) == 5 and all(not negative['ok'] for negative in row['negatives']), point + ' getter/unsigned-overflow refusals')
        elif row['kind'] == 'critic-partial-native-budget':
            counts['budgetCases'] += 1
            source = raw(row['input'])
            need(row['before'] == row['after'], point + ' exact reservation owner state restored')
            observed = row['observations'][0]
            need(raw(observed['expected']) == source, point + ' native unchanged target independent input')
            counts['nativeComponents'] += inverse.compare_plane(fmt, source, raw(observed['native']), point + '/observations/0/native')
            if row['short']:
                need(not row['issued' if row['budget'] == 'gpuBytes' else 'prepared']['ok'], point + ' exact one-byte-short refusal')
            else:
                cropped = b''.join(source[(y * 3 + 1) * 2:(y * 3 + 3) * 2] for y in range(3))
                need(raw(row['output']) == cropped and row['fence']['actual'] in (37146, 37148), point + ' exact bounded partial result physically completed')
                counts['publicBytes'] += len(cropped)
        else:
            need(False, point + ' unreviewed novel run')
        anchors.append(dict(point=point, native=next(iter(row['observations']))['native'], kind=row['kind']))
    need(counts['originalFormats'] == list(fields) and counts['runs'] == 19 and counts['budgetCases'] == 6, 'all thirteen original aliases and six exact/one-short bounds')
    result = dict(schema='d35-critic-novel-independent-inverse-v1', status='passed', importsProductConversion=False,
                  reportSha256=sha(path.read_bytes()), primarySha256=sha(primary.read_bytes()), **counts, anchors=anchors)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('anchors', 'originalFormats')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--primary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    main(args.directory, args.primary, args.output)
