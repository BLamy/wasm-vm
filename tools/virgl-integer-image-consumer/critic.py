#!/usr/bin/env python3
"""Audit the promoted original native target/cache attack and its physical fault."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('original_consumer_inverse', ROOT/'tools/virgl-integer-image-consumer/pixels.py')
inverse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inverse)
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def novel(directory, fault=False):
    raw = (directory/'report.json').read_bytes()
    report = json.loads(raw)
    require(report['status'] == ('failed' if fault else 'passed'), 'critic native/control status')
    require(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'critic zero browser errors')
    browser = report['browser']
    require(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'critic headed physical GPU')
    require(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', flag, re.I) for flag in browser['commandLine']), 'critic native hardware flags')
    require(sha((directory/report['screenshot']['path']).read_bytes()) == report['screenshot']['sha256'], 'critic actual screenshot')
    a = report['partial'] if fault else report['browserResult']['result']
    require(not a['guestExecution'] and not a['productionNegotiation'], 'isolated consumer scope')
    require('Apple M4 Max' in a['gpu'] and 'Metal' in a['gpu'], 'actual native Metal renderer')
    blobs = inverse.owned_blobs(directory, a)
    require(len(a['runs']) == 1 and len(a['frames']) == (2 if fault else 8), 'bounded complete native attack')
    run = a['runs'][0]
    stats = inverse.native_audit(run)
    require(run['source']['format'] == 196 and run['range'] == [0, 4] and run['source']['width'] == 17 and run['source']['height'] == 9, 'actual original UINT NPOT range')
    require('DCL OUT[5], COLOR' in run['fragment'] and 'DCL SVIEW[3], 2D, UINT' in run['fragment'], 'original OUT5 COLOR0 and UINT declaration')
    lod = int(re.search(r'^IMM\[0\] INT32 \{([^,}]+)', run['fragment'], re.M)[1])
    initial = [int(value) for value in re.search(r'^IMM\[1\] UINT32 \{([^}]+)\}', run['fragment'], re.M)[1].split(',')]
    query = [max(1, run['source']['width'] >> lod), max(1, run['source']['height'] >> lod), initial[2], run['range'][1]-run['range'][0]+1]
    require(query == [8, 4, 33, 5], 'independent original literal query words')
    programs, links, observations = {}, [], []
    for index, frame in enumerate(a['frames']):
        number = frame['outputFormat']
        desc = inverse.fmt(number)
        lanes = [query[lane] if lane < desc['components'] else 1 if lane == 3 else 0 for lane in range(4)]
        expected = struct.pack('<4I', *lanes)*(run['width']*run['height'])
        actual = blobs[frame['native']]
        require(blobs[frame['expected']] == expected, 'native critic expectation agrees independent literal original words')
        mismatch = actual != expected
        require(mismatch == (fault and index == 1), 'unchanged native assertion catches only physical sabotage')
        draw = next(d for d in run['draws'] if d['label'] == frame['label'])
        observation = next(o for o in run['observations'] if o['label'] == frame['label'])
        require('integer-image-color0-v1:'+str(number) in observation['materialKey'], 'every exact retained target format is in material identity')
        require(draw['native']['program'] == observation['nativeProgram'] and draw['native']['attachment'] == observation['nativeAttachment'], 'material observations are actual native draw handles')
        require(draw['native']['mask'] == [True, True, True, desc['components'] == 4], 'implicit integer alpha is protected')
        require(draw['samplers'][0]['type'] == 0x8dd2 and draw['samplers'][0]['metadata']['format'] == 196, 'same original unsigned source native sampler throughout target changes')
        require(len(draw['queries']) == 1 and draw['queries'][0]['value'] == 5, 'actual original local mip count uniform')
        create = next(e for e in run['events'] if e['name'] == 'fenceSync' and e['sync'] == frame['completion']['sync'])
        require(draw['sequence'] < create['sequence'] < frame['completion']['sequence'], 'full native output follows its own physical draw fence')
        if number in programs:
            require(programs[number] == draw['native']['program'], 'returning to exact retained format reuses exact native program')
        else:
            require(draw['native']['program'] not in programs.values(), 'new same-sign/native-format material has a distinct native program')
            programs[number] = draw['native']['program']
        links.append(observation['links'])
        if frame.get('outputBacking'):
            backing = bytearray([0x2e]*20000)
            pixel_bytes = desc['components']*desc['bits']//8
            stride = run['width']*pixel_bytes+3
            row = b''.join((word & ((1 << desc['bits'])-1)).to_bytes(desc['bits']//8, 'little') for word in lanes[:desc['components']])*run['width']
            for y in range(run['height']):
                backing[5+y*stride:5+y*stride+len(row)] = row
            require(blobs[frame['outputBacking']] == backing, 'full original public backing including padding')
            wire = bytes.fromhex(run['history'][frame['publicHistory']]['hex'])
            words = struct.unpack('<14I', wire)
            require(words[0] == 43 | (13 << 16) and words[1:5] == (frame['outputResource'], 0, 0, stride) and words[-2:] == (5, 2), 'actual original typed public read wire')
        if frame.get('beforeSabotage'):
            require(blobs[frame['beforeSabotage']] == expected, 'original actual post-completion output was correct')
            first, second = frame['originalCompletion'], frame['sabotageCompletion']
            require(first['sync'] != second['sync'] and first['sequence'] < second['sequence'], 'actual corruption uses second distinct completed native sync')
            upload = next(e for e in run['events'] if e['name'] == 'texSubImage2D' and e['label'] == 'critic-postcompletion-corruption')
            require(first['sequence'] < upload['sequence'] < create['sequence'] < second['sequence'], 'physical native corruption follows first completion and precedes second fence')
            expected_words, observed_words = struct.unpack('<256I', expected), struct.unpack('<256I', actual)
            require(expected_words[0] == 8 and observed_words[0] == 9 and expected_words[1:] == observed_words[1:], 'sabotage changes exactly the first native R word 8 to9')
            require(report['browserResult']['error']['message'].startswith('critic full original TXQ integer output after native completion'), 'physical fault trips the new unchanged assertion')
        observations.append(dict(frame=index, format=number, completion=frame['completion'], nativeSha256=sha(actual), independentSha256=sha(expected), held=not mismatch))
    if not fault:
        require(list(programs) == [196, 179, 193, 200] and links == [2, 3, 4, 5, 5, 5, 5, 5], 'same-sign formats own material keys and returns add no links')
        require(all(p['held'] for p in a['predictions']), 'all new native critic predictions held')
    else:
        require(a['sabotage']['fenceCompleted'] and not a['sabotage']['held'], 'fault assertion follows completed original native job')
    return dict(path=directory.name, status='EXPECTED REFUTATION' if fault else 'HELD', reportSha256=sha(raw), frames=len(a['frames']), query=query, **stats, observations=observations)


def main(directory):
    directory = Path(directory).resolve()
    node = json.loads((directory/'node/report.json').read_text())
    browser = json.loads((directory/'contracts/report.json').read_text())
    require(node['status'] == browser['status'] == 'passed', 'native compiler contract replay passes')
    a, b = node['contract'], browser['browserResult']['result']
    require(a == b and a['cases'] == 2586 and a['accepted'] == 1238 and a['getters'] == 0 and len(a['attacks']) == 144, 'complete original Node/browser contracts and hostile ownership attacks agree')
    require(len(a['historical']) == 957 and all(r['current'] == r['original'] for r in a['historical']), 'every historical original normalized result remains identical')
    boundary = [inverse.inspect(directory/('boundary-'+str(seed))) for seed in [1000000007, 2147483647, 4294967291]]
    require(all(r['frames'] == 24 and r['status'] == 'passed' for r in boundary), 'three complete fresh deterministic schedules')
    native, fault = novel(directory/'novel-native'), novel(directory/'novel-sabotage', True)
    result = dict(schema='original-integer-image-consumer-critic-v1', status='HELD', gitHead=node['gitHead'],
                  contracts=dict(cases=2586, accepted=1238, historical=957, attacks=144, getters=0),
                  boundaries=boundary, native=native, sabotage=fault, guestExecution=False, productionNegotiation=False)
    (directory/'critic-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='HELD', contracts=2586, boundaryFrames=72, novelFrames=native['frames'], sabotage='8 -> 9 after second native completion')))


if __name__ == '__main__':
    main(sys.argv[1])
