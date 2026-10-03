#!/usr/bin/env python3
"""Independent cold bindings, compatibility, physical words and changed-line coverage."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

HEAD = 'a7be954c1f3bea9dd1e96522e890fa012197c6fe'
PARENT = '80813f4e45202cec3769d51b4f7d2b421034df01'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--clone', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    evidence = args.root / 'evidence/virgl-raw-equality/cold-clone'
    report = json.loads((evidence / 'report.json').read_bytes())
    assert report['gitHead'] == report['cloneHead'] == report['cloneHeadAfter'] == HEAD
    assert report['statusBefore'] == report['statusAfter'] == ''
    assert report['status'] == 'passed' and report['exitCode'] == 0
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.clone).decode().strip() == HEAD
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=args.clone)
    actual_paths = {str(p.relative_to(evidence)) for p in (evidence / 'acceptance').rglob('*') if p.is_file()}
    assert actual_paths == {e['path'] for e in report['acceptanceFiles']}
    for item in report['acceptanceFiles']:
        path = evidence / item['path']
        raw = path.read_bytes()
        assert type(item['bytes']) is int and item['bytes'] == len(raw)
        assert sha(raw) == item['sha256']
        assert raw == (args.clone / 'target/evidence/virgl-raw-equality-cold' /
                       Path(item['path']).relative_to('acceptance')).read_bytes()
    assert sha((evidence / 'cold.log').read_bytes()) == report['logSha256']
    assert sha((args.clone / 'tools/virgl-raw-equality/cold.py').read_bytes()) == report['harnessSha256']
    receipt = json.loads((evidence / 'acceptance/receipt.json').read_bytes())
    for item in receipt['sources']:
        raw = (args.clone / item['path']).read_bytes()
        assert type(item['bytes']) is int and len(raw) == item['bytes'] and sha(raw) == item['sha256']
        assert raw == subprocess.check_output(['git', 'show', f'{HEAD}:{item["path"]}'], cwd=args.clone)
    for item in receipt['records']:
        raw = (evidence / 'acceptance' / item['path']).read_bytes()
        assert type(item['bytes']) is int and len(raw) == item['bytes'] and sha(raw) == item['sha256']
    base = json.loads((args.clone / 'evidence/virgl-bounded-loops/cold-clone/acceptance/native/native-report.json').read_bytes())
    native = json.loads((evidence / 'acceptance/native/native-report.json').read_bytes())
    stages = pairs = unchanged = 0
    migrated = []
    for group in ['raw', 'integer', 'float', 'numeric', 'component', 'dot', 'constant',
                  'structured', 'indirect', 'loop']:
        old = base['cases' if group == 'loop' else group + 'Cases']
        current = native[group + 'Cases']
        assert len(old) == len(current)
        for prior, now in zip(old, current):
            assert prior['text'] == now['text'] and prior['inputSha256'] == now['inputSha256']
            if prior['result'] != now['result']:
                assert group in ('integer', 'float') and prior['name'].startswith('still-unsupported-')
                assert prior['result']['ok'] is False and now['result']['ok'] is True
                assert now['result']['metadata']['profile'] == 'virgl-webgl2-raw-bits-v13'
                assert now['predecessor'] == prior
                migrated.append({'group': group, 'name': prior['name'], 'inputSha256': prior['inputSha256'],
                                 'oldResultSha256': prior['resultSha256'], 'newResultSha256': now['resultSha256']})
            else:
                assert prior == now
                unchanged += 1
            stages += 1
        a, b = base['pairs' if group == 'loop' else group + 'Pairs'], native[group + 'Pairs']
        assert a == b
        pairs += len(a)
    assert (stages, pairs, unchanged, len(migrated)) == (4012, 264, 4004, 8)
    assert native['originals'] == base['originals'] and len(native['originals']) == 19
    assert sum(e['result']['ok'] for e in native['originals']) == 12
    for slug in ('integer-masks', 'float-masks'):
        original = (args.clone / f'renderer/virgl-shader/tests/{slug}.mjs').read_text()
        successor = (args.clone / f'renderer/virgl-shader/tests/{slug}-equality-successor.mjs').read_text()
        assert original[:original.index('function pressureProof(')] == successor[:successor.index('async function sabotageOperation')]
    exported_path = evidence / 'acceptance/native/coverage.json'
    exported = json.loads(exported_path.read_bytes())
    binary = args.clone / 'renderer/virgl-shader/build/raw-equality-sanitize/raw-equality-test'
    assert sha(binary.read_bytes()) == native['binarySha256']
    command = [subprocess.check_output(['xcrun', '--find', 'llvm-cov']).decode().strip(), 'export',
               str(binary), '-instr-profile=' + str(args.clone / 'target/evidence/virgl-raw-equality-cold/native/native.profdata'),
               str(args.clone / 'renderer/virgl-shader/bridge.c'), str(args.clone / 'renderer/virgl-shader/raw_bits.c')]
    reexport = subprocess.check_output(command)
    assert reexport == exported_path.read_bytes()
    coverage = []
    for file in ('renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c'):
        item = next(e for e in exported['data'][0]['files'] if e['filename'].endswith('/' + file))
        summary = next(e for e in native['coverage']['sources'] if e['path'] == file)
        assert summary['summary'] == item['summary']
        assert sha((args.clone / file).read_bytes()) == summary['sha256']
        patch = subprocess.check_output(['git', 'diff', '--unified=0', PARENT, HEAD, '--', file], cwd=args.clone).decode()
        line = None
        for value in patch.splitlines():
            match = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', value)
            if match:
                line = int(match[1]); continue
            if line is None or value.startswith(('+++', '---')):
                continue
            if value.startswith('+'):
                counts = []
                for start, end in zip(item['segments'], item['segments'][1:]):
                    if start[3] and not start[5] and start[0] <= line <= end[0]:
                        if end[0] != line or end[1] > 1:
                            counts.append(start[2])
                maximum = max(counts, default=0)
                text = value[1:]
                waiver = None
                if not maximum:
                    assert not text.strip() or text.lstrip().startswith(('/*', '*', 'static ')), (file, line, text)
                    waiver = 'Non-executable comment/blank/function declaration; body independently exercised.'
                coverage.append({'file': file, 'line': line, 'source': text,
                                 'count': maximum, 'classification': 'waived' if waiver else 'executed',
                                 'waiver': waiver})
                line += 1
            elif not value.startswith('-'):
                line += 1
    helper = next(e for e in exported['data'][0]['functions'] if e['name'] == 'raw_bits.c:equal_float_mask')
    assert type(helper['count']) is int and helper['count'] == 124
    # Independently reconstruct the direct FSEQ/FSNE hardware words from physical bytes.
    gpu = json.loads((evidence / 'acceptance/gpu/report.json').read_bytes())
    proof = gpu['acceptance']
    direct_words = 0
    for stage, key in [('vertex', 'vertexProbes'), ('fragment', 'fragmentProbes')]:
        for probe in proof[key]:
            if probe['name'] not in ('eq', 'ne', 'self-eq', 'self-ne'):
                continue
            for vector in probe['vectors']:
                a, b = vector['a'], vector['a'] if probe['name'].startswith('self-') else vector['b']
                wanted = []
                for x, y in zip(a, b):
                    is_nan = any((v >> 23) & 255 == 255 and v & 0x7FFFFF != 0 for v in (x, y))
                    equal = not is_nan and (x == y or (x << 1) & 0xFFFFFFFF == 0 and (y << 1) & 0xFFFFFFFF == 0)
                    wanted.append(0xFFFFFFFF if (not equal if probe['name'].endswith('ne') else equal) else 0)
                reconstructed = [0]*4
                if stage == 'vertex':
                    for capture in vector['captures']:
                        words = struct.unpack('<8I', bytes(capture['rawBytes']))
                        assert list(words) == capture['observedBits']
                        assert sha(bytes(capture['rawBytes'])) == capture['bytesSha256']
                        for lane, word in enumerate(words[4:]):
                            assert word >= 0x3F000000 and (word - 0x3F000000) % 32768 == 0
                            reconstructed[lane] |= ((word - 0x3F000000)//32768) << capture['selector']
                else:
                    for draw in vector['draws']:
                        for lane, byte in enumerate(draw['observedBytes']):
                            assert byte in (0, 255)
                            reconstructed[lane] |= (byte//255) << draw['selector']
                assert reconstructed == wanted == vector['observedWords']
                direct_words += 4
    assert direct_words == 192
    assert all(gpu['browserErrors'][name] == [] for name in ('console', 'page', 'requests'))
    assert proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted']
    faults = []
    for mode in ('nan-guard', 'zero-sign', 'ne-complement', 'mask-one'):
        fault = json.loads((evidence / f'acceptance/fault-{mode}/report.json').read_bytes())
        assert fault['status'] == 'failed' and 'independent' in fault['acceptance']['failure']['message']
        assert all(fault['browserErrors'][name] == [] for name in ('console', 'page', 'requests'))
        faults.append({'mode': mode, 'reportSha256': sha((evidence / f'acceptance/fault-{mode}/report.json').read_bytes()),
                       'failure': fault['acceptance']['failure']['message']})
    result = {'schema': 'fresh-raw-equality-recording-audit-v1', 'status': 'passed', 'head': HEAD,
              'coldReportSha256': sha((evidence / 'report.json').read_bytes()),
              'receiptSha256': sha((evidence / 'acceptance/receipt.json').read_bytes()),
              'coldFiles': len(actual_paths), 'sourceBindings': len(receipt['sources']),
              'recordBindings': len(receipt['records']), 'compatibility': {
                  'retainedStages': stages, 'unchangedStages': unchanged, 'retainedPairs': pairs,
                  'originals': 19, 'acceptedOriginals': 12, 'migrations': migrated},
              'coverage': {'exportSha256': sha(reexport), 'reexportMatches': True, 'command': command,
                           'knownEqualityCalls': helper['count'], 'changedLines': coverage},
              'physicalDirectPredicateWords': direct_words, 'gpuReportSha256': sha((evidence / 'acceptance/gpu/report.json').read_bytes()),
              'compilerFaults': faults}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('coverage', 'compatibility')}, indent=2))


if __name__ == '__main__':
    main()
