#!/usr/bin/env python3
"""Read-only independent E6-T12e1 evidence audit; writes only binding-audit.json."""
import hashlib
import json
from collections import Counter
from fractions import Fraction as F
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
BASE = 'ebd18189'
HEAD = 'ae3bdf0f1d707f239b00907269f5c783fcf597e5'
NEW = [
    '003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605',
    '9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83',
    '403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c',
    'e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551',
]
ANCHORS = {
    'worker': '2c9115baa9649dbf7b8f4dfe01227c99e61e66538e19d00ded00eb1ef8a5743a',
    'cold-clone/acceptance': '32d2d19d454a92d977bb52193faaa7e1291a1875559a56991d416273e10be7c5',
}
FROZEN = {}
CHECKS = Counter()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text())


def check(value, label):
    if not value:
        raise AssertionError(label)
    CHECKS[label.split(':')[0]] += 1


def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)


def frozen(path, revision=HEAD):
    key = revision, str(path)
    if key not in FROZEN:
        result = subprocess.run(['git', 'show', f'{revision}:{path}'], cwd=ROOT, capture_output=True)
        FROZEN[key] = result.stdout if result.returncode == 0 else None
    return FROZEN[key]


def bound(root, item, tracked=False):
    path = root / item['path']
    raw = path.read_bytes()
    check(sha(raw) == item['sha256'], f'digest:{path}')
    size = item.get('bytes', item.get('size'))
    check(size is None or len(raw) == size, f'size:{path}')
    original = frozen(item['path']) if tracked else None
    if original is not None:
        check(original == raw, f'frozen-source:{path}')


def pixels(draw, expected):
    actual = {tuple(x['pixel']): x for x in draw['checks']}
    check(len(actual) == len(draw['checks']) == draw['checkedPixels'] == len(expected), 'pixel-uniqueness')
    check(set(actual) == set(expected), 'pixel-coordinates')
    for point, rgba in expected.items():
        check(actual[point]['observed'] == actual[point]['expected'] == rgba, 'independent-pixel')


def main():
    evidence = ROOT / 'evidence/virgl-components'
    cold = read(evidence / 'cold-clone/report.json')
    clone = Path(cold['clone'])
    check(cold['status'] == 'passed' and cold['exitCode'] == 0, 'cold-success')
    check(cold['gitHead'] == cold['cloneHead'] == cold['cloneHeadAfter'] == HEAD, 'cold-exact-head')
    check(cold['statusBefore'] == cold['statusAfter'] == '', 'cold-recorded-clean')
    check(git('rev-parse', 'HEAD', cwd=clone).decode().strip() == HEAD, 'cold-retained-head')
    check(git('status', '--porcelain', '--untracked-files=all', cwd=clone) == b'', 'cold-retained-clean')
    check(cold['harnessSha256'] == sha(frozen('tools/virgl-components/cold.py')), 'cold-frozen-harness')
    check(cold['logSha256'] == sha((evidence / 'cold-clone/cold.log').read_bytes()), 'cold-log')
    for item in cold['acceptanceFiles']:
        bound(evidence / 'cold-clone', item)
    baseline = json.loads(frozen('docs/gpu-3d-contract.json', BASE))
    old_accepted = {h for h, x in baseline['capturedShaders'].items() if x['currentBridge'] == 'translated'}
    check(len(old_accepted) == 7 and not old_accepted.intersection(NEW), 'seven-prior-plus-four')
    fixture = read(ROOT / 'renderer/virgl-shader/tests/component-cases.json')
    quad = [(-1,-1),(1,-1),(-1,1),(-1,1),(1,-1),(1,1)]
    texels = [[240,40,80,255],[20,200,60,128],[80,40,240,64],[160,220,40,0]]
    summaries = {}
    for label, anchor in ANCHORS.items():
        directory = evidence / label
        source_root = clone if label.startswith('cold') else ROOT
        receipt = read(directory / 'receipt.json')
        check(sha((directory / 'receipt.json').read_bytes()) == anchor, 'receipt-anchor')
        check(receipt['status'] == 'passed' and receipt['gitHead'] == HEAD, 'receipt-head')
        for item in receipt['sources']:
            check(frozen(item['path']) is not None, 'receipt-source-tracked')
            bound(source_root, item, True)
        for item in receipt['records']:
            bound(directory, item)
        for path, digest in receipt['compilerSha256'].items():
            check(sha(Path(path).read_bytes()) == digest, 'compiler-binding')
        native = read(directory / 'native/native-report.json')
        check(native['sanitizers'] == ['address','undefined'] and native['status'] == 'passed', 'native-sanitizers')
        check(sha((directory / 'native/native.log').read_bytes()) == native['logSha256'], 'native-log')
        check(sha((source_root / 'renderer/virgl-shader/build/component-sanitize/component-test').read_bytes()) == native['binarySha256'], 'native-binary')
        contract = read(directory / 'regression/contract/receipt.json')
        results = contract['capturedShaderResults']
        check(contract['head'] == HEAD and set(results) == set(baseline['capturedShaders']), 'original-identities')
        accepted = {h for h, r in results.items() if r['ok']}
        check(accepted == old_accepted | set(NEW), 'exact-accepted-identities')
        outcomes = Counter('translated' if r['ok'] else r['error']['code'] for r in results.values())
        check(outcomes == {'translated':11,'unsupported-feature':7,'parse-error':1}, 'exact-rejections')
        for report_name in ('hardware','sabotage','regression/literal','regression/captured'):
            report = read(directory / report_name / 'report.json')
            check(report['gitHead'] == HEAD and report['trackedChanges'] == [], 'browser-frozen-head')
            check(report['browserErrors'] == {'console':[],'page':[],'requests':[]}, 'browser-zero-errors')
            for item in report['sources'] + report['servedFiles']:
                bound(source_root, item, True)
        hardware = read(directory / 'hardware/report.json')
        acceptance = hardware['acceptance']
        check(acceptance['status'] == 'passed' and acceptance['omissions'] == [], 'hardware-status')
        check({x['sha256']:x['result'] for x in acceptance['corpus']} == results, 'all19-native-wasm-parity')
        check({x['sha256'] for x in acceptance['translations']} == set(NEW), 'four-new-draw-identities')
        for item in acceptance['corpus']:
            bound(source_root, item, True)
            check(frozen(item['path'], BASE) == frozen(item['path']), 'unchanged-original-bytes')
            check(sha(frozen(item['path'])) == item['sha256'], 'original-content-address')
            if not item['result']['ok']:
                text = frozen(item['path']).decode()
                check('PRECISE' in text if item['result']['error']['code'] == 'unsupported-feature' else ', CONSTANT' in text, 'remaining-rejection-provenance')
        for item in native['inputs']:
            check(item['result'] == results[item['sha256']] and item['result']['ok'], 'four-native-original-parity')
        check(native['cases'] == acceptance['boundary']['cases'], 'all249-native-wasm-parity')
        check(len(native['cases']) == len(fixture) == 249, 'fixture-size')
        for case, expected in zip(native['cases'], fixture):
            check(case['name'] == expected['name'] and case['inputSha256'] == sha(expected['text'].encode()) and case['ok'] == expected['ok'], 'fixture-identity-outcome')
        check(acceptance['boundary']['recovery'] == {'rounds':2,'conversions':1992,'outputsAndMetadataIdentical':True}, 'recovery-parity')
        check(len(acceptance['draws']) == 10, 'draw-count')
        for index, draw in enumerate(acceptance['draws']):
            expected = {}
            if index < 6:
                digest = NEW[index // 3]
                brightness = [F(0),F(1,2),F(1)][index % 3]
                for q, color in enumerate(texels):
                    rgba = [int(c*brightness) for c in color[:3]] + [color[3]]
                    for y in range(4+16*(q//2),12+16*(q//2)):
                        for x in range(4+16*(q%2),12+16*(q%2)):
                            expected[x,y] = rgba
                attributes = {x['index']:x['values'] for x in draw['attributes']}
                check(attributes[1] == [v for x,y in quad for v in [float(brightness),(x+1)/2,(y+1)/2,0]], 'fragment-bound-attributes')
                stage = 'fragment'
            else:
                digest = NEW[2+(index-6)//2]
                sign = 1 if index%2 == 0 else -1
                # Solve the desired 2x2 geometry via its determinant; no GLSL,
                # metadata or recorded expected/readback values define it.
                a,b,c,d = F(1,2),F(-1,8),F(1,8),F(1,2)
                det = a*d-b*c
                for y in range(32):
                    for x in range(32):
                        px = sign*F(2*x+1-32,32)-F(1,4)
                        py = sign*F(2*y+1-32,32)+F(1,4)
                        u,v = (d*px-b*py)/det,(-c*px+a*py)/det
                        extent = max(abs(u),abs(v))
                        if extent < F(4,5):expected[x,y] = [255,64,128,255]
                        elif extent > F(6,5):expected[x,y] = [0,0,255,255]
                affine = index < 8
                constants = ([[sign*.5,sign*.125,.125,0],[sign*-.125,sign*.5,.25,0],[sign*.25,sign*-.25,-.5,0]] if affine else
                             [[sign,sign*.25,.25,0],[sign*-.25,sign,.5,0],[sign*.5,sign*-.5,1,0],[sign*.25,sign*-.25,-1.5,2]])
                check(draw['uniforms'][0]['values'] == constants, 'vertex-bound-constants')
                attrs = {x['index']:x['values'] for x in draw['attributes']}
                check(attrs[0] == [v for x,y in quad for v in [x,y,.75 if affine else .5,.5 if affine else 1]], 'vertex-bound-attributes')
                stage = 'vertex'
            check(draw['shaderSha256'] == digest and draw[stage+'GlslSha256'] == sha(results[digest]['glsl'].encode()), 'compiled-original-glsl')
            check(draw['depth'] == (index>=6), 'draw-depth-mode')
            pixels(draw, expected)
        check(acceptance['checkedPixels'] == 4736, 'pixel-total')
        sabotage = read(directory / 'sabotage/report.json')['acceptance']
        omission = sabotage['omissions'][0]
        original = results[NEW[2]]['glsl']
        changed = original.replace(omission['original'],omission['replacement'],1)
        check(sha(changed.encode()) == omission['servedGlslSha256'], 'sabotage-exact-source')
        check(sabotage['draws'][-1]['failure'] == {'pixel':[15,4],'expected':[255,64,128,255],'observed':[0,0,255,255]}, 'sabotage-observed-pixel')
        regressions = {}
        for name, count, pixel_count in [('literal',9,4336),('captured',3,768)]:
            old = read(directory / 'regression' / name / 'report.json')['acceptance']
            check(old['status'] == 'passed' and len(old['draws']) == count and old['checkedPixels'] == pixel_count, 'prior-draws')
            for draw in old['draws']:
                for pixel in draw['checks']:
                    check(pixel['observed'] == pixel['expected'], 'prior-observed-pixels')
            regressions[name] = {'draws':count,'pixels':pixel_count}
        summaries[label] = {'receiptSha256':anchor,'sources':len(receipt['sources']),'records':len(receipt['records']),
                            'servedBodies':len(hardware['servedFiles']),'unchangedOriginals':len(results),
                            'acceptedHashes':sorted(accepted),'outcomes':dict(outcomes),'pixels':4736,'prior':regressions}
    # Analytic sensitivity limitation, not an emulator execution or task verdict.
    corners = [(x,y) for x in (-1,1) for y in (-1,1)]
    original_z = [F(1,8)*x+F(1,4)*y-F(1,2) for x,y in corners]
    wrong_z = [F(3,8)*x-F(1,2) for x,y in corners]
    check(all(-1 < z < 0 for z in original_z + wrong_z), 'z-swizzle-counterexample')
    output = {'task':'E6-T12e1','frozenHead':HEAD,'status':'bindings-held','checks':dict(CHECKS),'evidence':summaries,
              'coldClone':str(clone),'coldRemovedEnvironmentNames':cold['removedEnvironmentNames'],
              'limitation':'Vertex depth oracle only observes z<0; replacing affine TEMP1 z source y with x preserves all depth decisions over the quad. Main verifier informed; requires GPU attack or independent exact-z native assertion to resolve.'}
    (Path(__file__).with_name('binding-audit.json')).write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'status':output['status'],'checkCount':sum(CHECKS.values()),'evidence':summaries},indent=2))


if __name__ == '__main__':
    main()
