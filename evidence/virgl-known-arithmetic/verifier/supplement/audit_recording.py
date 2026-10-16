#!/usr/bin/env python3
"""Interrogate original binaries/profiles and complete supplemental outputs."""
from pathlib import Path
from fractions import Fraction
import hashlib, json, re, struct, subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RAW = ROOT / 'target/evidence/virgl-known-arithmetic-critic-supplement'
UNPACKED = RAW / 'unpacked'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def load(path):
    return json.loads(path.read_bytes())

def binding(path):
    raw = path.read_bytes()
    return dict(path=str(path.relative_to(ROOT)), bytes=len(raw), sha256=sha(raw))

def rational(word):
    sign = -1 if word >> 31 else 1
    exponent, significand = (word >> 23) & 255, word & 0x7fffff
    assert exponent != 255
    if exponent:
        significand |= 0x800000
    scale = (exponent or 1) - 150
    return sign * Fraction(significand) * Fraction(2) ** scale

def main():
    prior = load(ROOT / 'evidence/virgl-known-arithmetic/verifier/verdict.json')
    predictions = load(ROOT / 'tools/virgl-known-arithmetic/supplement-cases.json')
    earlier = load(ROOT / 'evidence/virgl-known-arithmetic/verifier/attack-predictions.json')
    for index, finding in [(16, prior['findings'][0]), (54, prior['findings'][1])]:
        c = next(c for c in predictions['cases'] if c['name'] == finding['fixture']['name'])
        assert c['text'] == finding['fixture']['text'] == earlier['cases'][index]['text']
        assert c['textSha256'] == finding['fixture']['textSha256'] == sha(c['text'].encode())
    assert predictions['words'] == [dict(op='ADD', a=0, b=0x3fc00000, expected=0x3fc00000),
                                   dict(op='ADD', a=0x3fc00000, b=0, expected=0x3fc00000)]
    for w in predictions['words']:
        assert rational(w['a']) + rational(w['b']) == rational(w['expected']) == Fraction(3, 2)
    expected_caches = [[0x3fc00000, 0x3fc00000, 0, 0x3f800000], [0x3f400000] * 4,
                       [0x3f400000] * 4 + [0x3ec00000] * 4, [0x3f400000] * 4]
    # These expectations follow exact rational identities, independently of either compiler.
    assert rational(0x3f400000) == rational(0x3e800000) + rational(0x3f000000) == Fraction(3, 4)
    assert rational(0x3ec00000) == Fraction(3, 4) * Fraction(1, 2)
    points = [('raw_bits.c:known_add', (34, 13, 34, 21)),
              ('raw_bits.c:known_add', (35, 13, 35, 21)),
              ('known_arithmetic.c:known_add', (34, 13, 34, 21)),
              ('known_arithmetic.c:known_add', (35, 13, 35, 21)),
              ('bridge.c:stage_result', (1710, 115, 1710, 142))]
    variants = []
    source = ROOT / 'renderer/virgl-command/constant-domain.mjs'
    source_text = source.read_text()
    assert len(source_text.encode()) == len(source_text), 'V8 offsets are unambiguous ASCII positions'
    snippets = {str(point): source_text[point[0]:point[1]]
                for point in [(11519, 11565), (11978, 11987)]}
    for kind in ['hot', 'cold']:
        directory = UNPACKED / kind
        assert load(directory / 'predictions.json') == predictions
        r, native, wasm, consumer = [load(directory / name) for name in
                                    ['report.json', 'native.json', 'wasm.json', 'consumer.json']]
        assert r['gitHead'] == '5353cf8591a94dbd962f92ee69b488ff18b8ebf0'
        assert r['layout'] == native['layout'] == [111744, 112, 32448]
        assert native['words'] == predictions['words'] and len(native['cases']) == 4
        assert r['arithmeticPredictions'] == 2 and r['hostRoundingModes'] == 4
        assert not (directory / 'native.stderr').read_bytes()
        assert not (directory / 'consumer.stderr').read_bytes()
        fixture = (directory / 'cases.bin').read_bytes()
        cursor = 4
        assert fixture[:4] == b'VKA1'
        def u():
            nonlocal cursor
            value = struct.unpack_from('<I', fixture, cursor)[0]
            cursor += 4
            return value
        assert u() == 2
        for w in predictions['words']:
            assert (u(), u(), u(), u()) == (0, w['a'], w['b'], w['expected'])
        assert u() == 4
        for c in predictions['cases']:
            stage, good, textlen, partnerlen, pairgood = u(), u(), u(), u(), u()
            assert (stage, good, pairgood) == (1, 1, 1)
            text, partner = fixture[cursor:cursor + textlen], fixture[cursor + textlen:cursor + textlen + partnerlen]
            cursor += textlen + partnerlen
            assert text.decode() == c['text'] and partner.decode() == c['partner']
        assert cursor == len(fixture)
        lines = (directory / 'native.log').read_text().splitlines()
        assert lines[:2] == ['WORD 0 1069547520', 'WORD 1 1069547520']
        assert lines[-2:] == ['LAYOUT 111744 112 32448', 'STATUS passed']
        assert len(lines) == 12
        for i, (p, c, other) in enumerate(zip(predictions['cases'], native['cases'], wasm['cases'])):
            assert {key: c[key] for key in p} == p
            assert c['result'] == json.loads(lines[2 + i * 2].removeprefix(f'CASE {i} '))
            assert c['pairResult'] == json.loads(lines[3 + i * 2].removeprefix(f'PAIR {i} '))
            assert c['result']['ok'] and c['pairResult']['ok']
            assert c['result'] == other['result'] and c['pairResult'] == other['pair']
            assert c['result']['metadata'] == c['pairResult']['fragment']['metadata']
            caches = [int(word) for word in re.findall(r'/\* known:word \*/ raw_rhs\.[xyzw] = (\d+)u;', c['result']['glsl'])]
            shadows = [int(word) for word in re.findall(r'/\* known:shadow \*/ uintBitsToFloat\((\d+)u\)', c['result']['glsl'])]
            assert caches == shadows == expected_caches[i], (kind, c['name'], caches)
        coordinate = native['cases'][1]['result']['metadata']
        assert coordinate['profile'] == 'virgl-webgl2-raw-bits-v40'
        assert coordinate['knownArithmeticBaseProfile'] == 'virgl-webgl2-raw-bits-v38'
        assert coordinate['coordinateContract']['origin'] == 'lower-left'
        assert coordinate['coordinateContract']['pixelCenter'] == 'half-integer'
        assert coordinate['coordinateContract']['authority'] == 'existing-input-no-static-range-facts'
        # Re-merge original raw bytes, export only with that recording's own original binary.
        merged = RAW / (kind + '-remerged.profdata')
        exported = RAW / (kind + '-reexported.json')
        merge = ['xcrun', 'llvm-profdata', 'merge', '-sparse', str(directory / 'native.profraw'), '-o', str(merged)]
        export = ['xcrun', 'llvm-cov', 'export', str(directory / 'original/known-test'), '-instr-profile=' + str(merged)]
        subprocess.run(merge, check=True, cwd=ROOT)
        result = subprocess.run(export, check=True, cwd=ROOT, capture_output=True)
        assert not result.stderr
        exported.write_bytes(result.stdout)
        assert merged.read_bytes() == (directory / 'native.profdata').read_bytes()
        assert result.stdout == (directory / 'coverage.json').read_bytes()
        functions = [f for d in json.loads(result.stdout)['data'] for f in d['functions']]
        regions = []
        for name, point in points:
            fs = [f for f in functions if f['name'] == name]
            assert len(fs) == 1
            f = fs[0]
            rs = [r for r in f['regions'] if tuple(r[:4]) == point and r[7] == 0]
            assert len(rs) == 1 and rs[0][4] > 0
            region = rs[0]
            file = f['filenames'][region[5]]
            assert file.endswith('/renderer/virgl-shader/' + ('bridge.c' if name == 'bridge.c:stage_result' else 'raw_known_arithmetic.h'))
            # Keep every containing code region for the same file, honoring LLVM nested range semantics.
            containing = [r for r in f['regions'] if r[7] == 0 and r[5] == region[5]
                          and tuple(r[:2]) <= point[:2] and tuple(r[2:4]) >= point[2:]]
            regions.append(dict(function=name, file=file, region=region, containingRegions=containing))
        assert [p['region'][4] for p in regions] == [8, 4, 4, 4, 4]
        assert [{key: p[key] for key in ['function', 'file', 'region']} for p in regions] == r['nativeRegions']
        profiles = list((directory / 'node-v8').glob('*.json'))
        assert len(profiles) == 1
        v8_scripts = [s for s in load(profiles[0])['result'] if s['url'] == source.as_uri()]
        assert len(v8_scripts) == 1 and r['v8Url'] == source.as_uri()
        v8_points = []
        for start, end in [(11519, 11565), (11978, 11987)]:
            matches = [(f, p) for f in v8_scripts[0]['functions'] for p in f['ranges']
                       if (p['startOffset'], p['endOffset']) == (start, end)]
            assert len(matches) == 1
            f, point = matches[0]
            assert f['isBlockCoverage'] and point['count'] > 0
            v8_points.append(dict(function=f['functionName'], **point, source=source_text[start:end],
                                  containingRanges=[p for p in f['ranges']
                                                    if p['startOffset'] <= start and p['endOffset'] >= end]))
        assert [p['count'] for p in v8_points] == [1, 2]
        assert [{key: p[key] for key in ['startOffset', 'endOffset', 'count']} for p in v8_points] == r['v8Regions']
        assert r['v8Source']['sha256'] == consumer['source']['sha256'] == sha(source.read_bytes())
        assert consumer['nativeSha256'] == sha((directory / 'native.json').read_bytes())
        assert consumer['status'] == wasm['status'] == 'passed' and consumer['getterInvocations'] == 0
        assert len(consumer['results']) == len(consumer['attacks']) == 4
        for c, parsed in zip(native['cases'], consumer['results']):
            assert c['name'] == parsed['name'] and c['result']['metadata'] == parsed['metadata']
            assert parsed['result']['ok']
            assert c['result']['metadata']['knownArithmeticContract'] == parsed['result']['knownArithmetic']
        assert consumer['results'][2]['result']['knownArithmetic']['operations'] == ['ADD', 'MUL']
        assert consumer['results'][1]['result']['coordinates'] == coordinate['coordinateContract']
        rejected = consumer['attacks'][0]
        otherwise_valid = dict(native['cases'][3]['result']['metadata'])
        del otherwise_valid['sineContract']
        assert rejected['metadata'] == otherwise_valid
        assert rejected['result'] == dict(ok=False, error=dict(code='shader-domain-error', message='Sine contract disagrees with its profile.'))
        assert all(a['result']['ok'] is False for a in consumer['attacks'])
        variants.append(dict(kind=kind, binary=binding(directory / 'original/known-test'),
                             fixture=binding(directory / 'cases.bin'), native=binding(directory / 'native.json'),
                             rawProfile=binding(directory / 'native.profraw'), mergedProfile=binding(merged),
                             reexport=binding(exported), llvm=regions, v8Profile=binding(profiles[0]), v8=v8_points,
                             consumer=binding(directory / 'consumer.json'), literalCacheWords=expected_caches,
                             completeSinglePairComparisons=4, getterInvocations=0, sanitizerErrors=0))
    result = dict(schema='virgl-known-arithmetic-incremental-recording-audit-v1', status='passed',
                  exactPriorFixtures=[dict(index=i, name=earlier['cases'][i]['name'],
                                           textSha256=sha(earlier['cases'][i]['text'].encode())) for i in [16, 54]],
                  independentArithmetic='two exact rational zero identities, 3/4 producer and 3/8 chain',
                  variants=variants, v8Source=binding(source), v8Snippets=snippets)
    (OUT / 'recording-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Original hot/cold exports reproduce exactly; LLVM [8,4,4,4,4], V8 [1,2], complete parity and literal caches hold.')

if __name__ == '__main__':
    main()
