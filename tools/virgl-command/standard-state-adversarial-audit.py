#!/usr/bin/env python3
"""Authenticate promoted standard binding rejection/pixel/fence sensitivity."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HEAD = 'adcbe81bcd091c3d411a8f96ac8746e1a17290fb'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def need(value, label):
    if not value:
        raise AssertionError(label)


def fence_audit(events):
    syncs, ready, completed = {}, {}, []
    for at, event in enumerate(events):
        name, turn, label = event['name'], event['turn'], event['label']
        if name == 'fenceSync':
            need(event['sync'] not in syncs, 'distinct actual native sync identity')
            syncs[event['sync']] = {'issued': turn, 'last': -1}
        elif name == 'clientWaitSync':
            sync = syncs[event['sync']]
            need(turn > sync['issued'] and turn > sync['last'], 'later-task single zero-timeout poll')
            sync['last'] = turn
            need(event['actual'] in [37146, 37147, 37148], 'actual native readiness code')
            if event['delivered'] in [37146, 37148]:
                need(event['actual'] in [37146, 37148], 'no readiness invented by trace wrapper')
                ready[label] = turn
                completed.append({'event': at, 'label': label, 'turn': turn, 'sync': event['sync']})
            else:
                need(event['delivered'] == 37147, 'bounded delay only reports timeout')
        elif name == 'getBufferSubData':
            need(label in ready and ready[label] <= turn, 'actual PBO read follows owned completion')
    return completed


def report(directory, name, fault=None):
    folder = directory / name
    raw = (folder / 'report.json').read_bytes()
    value = json.loads(raw)
    need(value['runtimeHead'] == HEAD and value['status'] == ('failed' if fault else 'passed'), name + ' runtime/status')
    need(value['browserErrors'] == [], name + ' unexpected browser errors')
    sources = {row['path']: row['sha256'] for row in value['sources']}
    for row in value['sources']:
        original = (ROOT / row['path']).read_bytes()
        need(len(original) == row['bytes'] and sha(original) == row['sha256'], name + ' recorded source custody')
    served = {row['path']: row['sha256'] for row in value['served']}
    if fault:
        mutation = value['mutation']
        original = subprocess.check_output(['git', 'show', HEAD + ':' + mutation['path']], cwd=ROOT)
        changed = (folder / 'mutation-source.mjs').read_bytes()
        need(mutation['mode'] == fault and sha(original) == mutation['originalSha256'], name + ' mutation anchor')
        need(original.count(mutation['needle'].encode()) == 1 and
             original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == changed and
             sha(changed) == mutation['servedSha256'], name + ' only designated real mutation')
        need(served[mutation['path']] == sha(changed), name + ' actually served mutation')
    for name_, digest in served.items():
        expected = value['mutation']['servedSha256'] if fault and name_ == value['mutation']['path'] else sources[name_]
        need(digest == expected, name + ' served closure')
    coverage_raw = (folder / 'browser-coverage.json').read_bytes()
    need(sha(coverage_raw) == value['coverageSha256'], name + ' coverage custody')
    for row in json.loads(coverage_raw)['scripts']:
        need(row['sha256'] == served[row['source']], name + ' coverage served-source custody')
    need(sha((folder / 'browser.png').read_bytes()) == value['screenshotSha256'], name + ' browser capture custody')
    need(value['browser']['gpu']['featureStatus'].get('webgl2', value['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled', name + ' enabled hardware WebGL')
    need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe'])
                 or arg.startswith('--disable-gpu') for arg in value['browser']['commandLine']), name + ' hardware launch')
    return value, {'report': name + '/report.json', 'sha256': sha(raw)}


def main(directory):
    normal, normal_cite = report(directory, 'normal')
    result = normal['browserResult']['result']
    plans = json.loads((directory / 'normal/predictions.json').read_bytes())
    need(len(plans) == len(result['runs']) == 2, 'original two independent seed/schedule plans')
    frames, fences, cases = [], [], []
    for plan, run in zip(plans, result['runs']):
        need(plan['seed'] == run['seed'] and len(run['frames']) == 11, 'complete original independent frame matrix')
        fences.extend(fence_audit(run['events']))
        for index, frame in enumerate(run['frames']):
            wanted = plan['frames'][index][1]
            raw = bytes.fromhex(frame['pixelsHex'])
            need(frame['expected'] == wanted and len(raw) == 256, 'unchanged independently predicted full image')
            need(all(abs(value - wanted[at % 4]) <= 1 for at, value in enumerate(raw)), 'independent full-pixel equation')
            need(any(event['name'] in ['drawArrays', 'drawElements'] and event['label'] == frame['label'] for event in run['events']), 'recorded real native draw')
            for stage_source in frame['native']['sources']:
                need(any(event['name'] == 'shaderSource' and event['source'] == stage_source['source'] and event['type'] == stage_source['type'] for event in run['events']), 'native attached shader actual source')
            frames.append({'point': f'browserResult.result.runs[{len(frames)//11}].frames[{index}]',
                           'label': frame['label'], 'expected': wanted, 'firstPixel': list(raw[:4]),
                           'pixelsSha256': sha(raw), 'pixels': len(raw) // 4, 'held': True})
    binding = result['nativeBindings']
    need(binding['status'] == 'passed' and len(binding['cases']) == 6, 'native binding matrix')
    expected_labels = ['fragment-uniforms', 'fragment-samplers', 'vertex-uniforms', 'vertex-samplers',
                       'unknown-active-default-block', 'unknown-eliminated-default-block']
    for at, row in enumerate(binding['cases']):
        need(row['label'] == expected_labels[at] and row['held'], 'native binding case ordering/result')
        completed = fence_audit(row['events'])
        if at < 5:
            need(not row['result']['ok'] and row['result']['gpuComplete'] and row['result']['draws'] == [] and row['nativeDraws'] == [], 'active incomplete metadata fails before native draw')
            need(row['result']['error']['code'] == 'shader-reflection-error' and
                 any(name in row['result']['error']['message'] for name in row['names']), 'native completeness code/name')
            need(row['activeNative'], 'genuinely active unknown/omitted native entry')
            for event in row['activeNative']:
                actual = event['result']
                expected_type = 5126 if at == 4 else 36296 if row['label'].endswith('uniforms') else 35678
                need(actual['type'] == expected_type and actual['size'] == (3 if expected_type == 36296 else 1), 'actual missing type/extent')
                need(any(query['name'] == 'getActiveUniforms' and query['parameter'] == 35386 and
                         query['indices'] == [event['index']] and query['result'] == [-1] and query['turn'] == event['turn']
                         for query in row['events']), 'actual missing native entry is default-block')
        else:
            need(row['result']['ok'] and row['result']['gpuComplete'] and len(row['nativeDraws']) == 1, 'native elimination allowed real completed draw')
            need(all(actual['name'] != 'wv_critic_unaccounted' for actual in row['native']['activeUniforms']), 'native unknown declaration actually pruned')
            wanted = plans[0]['frames'][0][1]
            need(len(row['output']) == 256 and all(abs(value - wanted[i % 4]) <= 1 for i, value in enumerate(row['output'])), 'eliminated declaration independent full pixels')
            need(any('uniform highp float wv_critic_unaccounted;' in source['source'] for source in row['native']['sources']), 'real native eliminated source declaration')
        cases.append({'point': f'browserResult.result.nativeBindings.cases[{at}]', 'label': row['label'],
                      'result': row['result'], 'activeNative': row['activeNative'], 'nativeDraws': row['nativeDraws'],
                      'completedFences': completed, 'held': True})
    native_fault, native_cite = report(directory, 'fault-native-binding', 'native-binding')
    value = native_fault['browserResult']
    need('critic-binding-fragment-uniforms coherent active metadata rejects before draw expected false observed true' in value['error']['message'], 'named promoted native rejection oracle sensitivity')
    row = value['bindingPartial']['cases'][0]
    need(row['label'] == 'fragment-uniforms' and row['result']['ok'] and row['result']['gpuComplete'] and len(row['nativeDraws']) == 1, 'real omitted raw bank draw under accounting sabotage')
    need(next(uniform['words'] for uniform in row['native']['uniforms'] if uniform['name'] == 'fsconst0') == [0] * 12, 'actual native omitted FS bank zero words')
    need(row['output'] == [0] * 256, 'saved actual F1 wrong pixels under accounting sabotage')
    native_fences = fence_audit(row['events'])
    need(native_fences, 'actual sabotaged native draw/readback fence completed')
    pixel_fault, pixel_cite = report(directory, 'fault-pixel', 'vs-blue')
    value = pixel_fault['browserResult']
    need('critic-full-955415761 independent pixel oracle' in value['error']['message'], 'named promoted independent pixel sensitivity')
    frame = value['partial']['lastFrame']
    need(frame['expected'] == [91, 117, 153, 140] and frame['observedFirst'] == [82, 117, 144, 140], 'actual named view corruption')
    need(frame['mismatches'] and len(frame['dump']['draws']) == 1, 'pixel sabotage reached real native draw')
    pixel_run = value['partial']['runs'][0]
    need(any(event['name'] == 'drawArrays' for event in pixel_run['events']), 'saved real pixel sabotage native call')
    pixel_fences = fence_audit(pixel_run['events'])
    need(pixel_fences, 'saved actual pixel sabotage completion fence')
    audit = {'schema': 1, 'task': 'E6-T11d5', 'sourceHead': HEAD, 'status': 'passed',
             'normal': normal_cite, 'frames': frames, 'pixels': sum(row['pixels'] for row in frames) + 64,
             'bindingCases': cases, 'completedFences': fences,
             'nativeSabotage': {**native_cite, 'point': 'browserResult.bindingPartial.cases[0]',
                              'nativeDraws': row['nativeDraws'], 'completedFences': native_fences,
                              'expectedPixel': [91, 117, 153, 140], 'observedPixel': [0, 0, 0, 0]},
             'pixelSabotage': {**pixel_cite, 'point': 'browserResult.partial.lastFrame',
                             'expectedPixel': frame['expected'], 'observedPixel': frame['observedFirst'],
                             'completedFences': pixel_fences}}
    (directory / 'adversarial-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print('Promoted native-binding audit passed: 22 frames / 1472 pixels, six binding cases; both real source sabotages detected.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    main(parser.parse_args().directory.resolve())
