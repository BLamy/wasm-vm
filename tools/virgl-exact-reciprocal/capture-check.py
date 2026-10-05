#!/usr/bin/env python3
"""Independent recorded WebGL pixel and compiler-source fault assertions."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys

ROOT = Path(__file__).resolve().parents[2]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def expected_word(source):
    exponent = source >> 23 & 255
    require(1 <= exponent <= 253 and (source & 0x7fffff) == 0,
            'source is an independently admitted normal power of two')
    return ((source & 0x80000000) | ((254 - exponent) << 23)) & 0xffffffff


def expected_pixel(mode, word):
    if mode == 'word':
        return [(word >> (8 * lane)) & 255 for lane in range(4)]
    require(mode == 'power', 'known mode')
    exponent = math.ldexp(-1.0 if word >> 31 else 1.0, (word >> 23 & 255) - 127)
    value = max(0.0, min(1.0, math.pow(.25, exponent)))
    return [round(value * 255)] * 4


def check(report, fault=False):
    gpu = report['browser']['gpu']
    devices = gpu['devices']
    require(any('ANGLE Metal Renderer: Apple M4 Max' in d.get('deviceString', '') for d in devices),
            'actual Apple M4 Max Metal WebGL backend')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors zero')
    acceptance = report['acceptance']
    require(acceptance['guestExecution'] is False and acceptance['productionNegotiation'] is False,
            'private isolated claim')
    require(report['status'] == ('failed' if fault else 'passed'), 'expected browser verdict')
    frames = acceptance['frames']
    require(len(frames) == (2 if fault else 6), 'complete scheduled frames')
    require([f['mode'] for f in frames] == ['word', 'power'] * (1 if fault else 3),
            'paired word/power schedule')
    require(sorted(set(f['inputWord'] for f in frames)) == ([0x40000000] if fault else
            [0x3f000000, 0x40000000, 0xc0000000]), 'exact authored inputs')
    channels = 0
    for frame in frames:
        word = expected_word(frame['inputWord'])
        require(frame['expectedWord'] == word, 'integer exponent reciprocal prediction')
        rgba = frame['observed']['rgba']
        require(len(rgba) == 64, 'complete 4x4 RGBA8 readback')
        predicted = expected_pixel(frame['mode'], word)
        require(frame['predicted'] == predicted, 'browser and independent pixel equations agree')
        require(frame['observed']['reflection'].get('pruned') is True,
                'exact specialized constant uniformly pruned on physical GPU')
        require(frame['metadata']['constantExactDomains'][0]['components'] ==
                [{'register': 0, 'component': 0, 'word': frame['inputWord']}],
                'actual enforced exact assumption')
        for pixel in range(16):
            for lane in range(4):
                actual = rgba[pixel * 4 + lane]
                if fault and frame['mode'] == 'power':
                    if pixel == 0 and lane == 0:
                        require(frame['failure'] == {'pixel': 0, 'lane': 0,
                            'actual': actual, 'wanted': predicted[lane]}, 'source fault reached physical pixel')
                    continue
                require(abs(actual - predicted[lane]) <= (0 if frame['mode'] == 'word' else 2),
                        f'physical pixel {frame["mode"]}/{pixel}/{lane}: {actual} != {predicted[lane]}')
                channels += 1
    if fault:
        manifest = json.loads((ROOT / 'target/virgl-exact-reciprocal-fault/manifest.json').read_text())
        original = (ROOT / manifest['source']).read_bytes()
        altered = (ROOT / 'target/virgl-exact-reciprocal-fault/raw_bits.c').read_bytes()
        require(sha(original) == manifest['originalSha256'], 'original source bound')
        require(altered == original.replace(manifest['needle'].encode(),
                                            manifest['replacement'].encode()),
                'exactly one compiler source fault')
        require(sha(altered) == manifest['alteredSha256'], 'altered source bound')
        binary = (ROOT / 'target/virgl-exact-reciprocal-fault/virgl-shader.wasm').read_bytes()
        require(sha(binary) == acceptance['faultWasm']['sha256'], 'delivered fault Wasm bound')
        require(any(x['path'] == 'target/virgl-exact-reciprocal-fault/virgl-shader.wasm' and
                    x['sha256'] == sha(binary) for x in report['servedFiles']), 'browser actually served fault Wasm')
        require(frames[0]['checkedPixels'] == 64 and frames[1]['checkedPixels'] == 0,
                'unchanged raw frame passes; altered shadow first fails')
        require(frames[1]['failure']['actual'] == 64 and frames[1]['failure']['wanted'] == 128,
                'physical 0.25 vs 0.5 contradiction')
    else:
        require(channels == 384, 'all six frames independently checked')
        require(all(frame['checkedPixels'] == 64 and 'failure' not in frame for frame in frames),
                'browser checked complete frames')
    return {'status': 'passed', 'fault': fault, 'frames': len(frames),
            'checkedChannels': channels, 'reportSha256': sha(json.dumps(report, sort_keys=True).encode())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('report')
    parser.add_argument('output')
    parser.add_argument('--fault', action='store_true')
    args = parser.parse_args()
    report = json.loads(Path(args.report).read_text())
    result = check(report, args.fault)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(f"{result['frames']} recorded physical frames independently checked")


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'capture-check: {exc}', file=sys.stderr)
        raise
