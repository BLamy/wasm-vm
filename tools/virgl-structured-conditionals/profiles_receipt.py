"""Independent record checks for the closed v8/v9 consumer profile boundary."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FILES = ('renderer/virgl-command/constant-domain.mjs',
         'tools/virgl-structured-conditionals/profiles.mjs')


def require(value, message):
    if not value:
        raise ValueError(message)


def same(left, right):
    return json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == \
        json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)


def binding(path, base=ROOT):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest()}


def metadata(stage, version, count=46):
    name = 'vsconst0' if stage == 'vertex' else 'fsconst0'
    value = {'profile': f'virgl-webgl2-raw-bits-v{version}', 'stage': stage,
             'inputs': [], 'outputs': [], 'attributes': [],
             'uniforms': [{'name': name, 'type': 'uvec4[]', 'count': count, 'encoding': 'float32-bits'}],
             'samplers': [], 'uniformBlocks': []}
    if version in (7, 9):
        value['constantDomains'] = [{'kind': 'constant-bank-finite-f32-v1', 'stage': stage,
                                     'slot': 0, 'name': name, 'count': count}]
    return value


def expected_cases():
    rows = []

    def add(stage, suffix, value, message=None, recipe=None):
        expected = ({'ok': False, 'error': {'code': 'shader-domain-error', 'message': message}}
                    if message else {'ok': True, 'domain': value.get('constantDomains', [None])[0]})
        row = {'name': f'{stage}-{suffix}', 'stage': stage, 'expected': expected,
               'result': expected, 'frozen': True}
        if recipe:
            row.update(recipe=recipe, getterCalls=0)
        else:
            row['input'] = value
        rows.append(row)

    for stage in ('vertex', 'fragment'):
        add(stage, 'v8-unconditional', metadata(stage, 8))
        for version in (7, 9):
            for count in (1, 8, 46, 47):
                add(stage, f'v{version}-extent{count}', metadata(stage, version, count))
        failures = [
            ('v9-missing-domain', 'Conditional shader profile requires a constant domain.'),
            ('v9-empty-domain', 'Conditional shader requires one domain and one constant bank.'),
            ('v9-duplicate-domain', 'Array extent exceeds the bounded contract.'),
            *[(f'v9-wrong-{key}', 'Unknown or inconsistent constant-bank domain.')
              for key in ('kind', 'stage', 'slot', 'name')],
            *[(name, 'Constant domain does not match the declared bank extent and encoding.')
              for name in ('v9-extent-mismatch', 'v9-extent48', 'v9-numeric-uniform')],
            ('v9-extra-field', 'Unknown or accessor property.'),
            ('v8-with-domain', 'Unconditional shader profile carries a conditional contract.'),
            ('v10-with-domain', 'Unknown shader profile.'),
            ('v10-without-domain', 'Unknown shader profile.'),
            ('v7-missing-domain', 'Conditional shader profile requires a constant domain.'),
        ]
        for name, message in failures:
            value = metadata(stage, 9)
            domain = value['constantDomains'][0]
            if name in ('v9-missing-domain', 'v7-missing-domain'):
                del value['constantDomains']
                if name.startswith('v7'):
                    value['profile'] = 'virgl-webgl2-raw-bits-v7'
            elif name == 'v9-empty-domain':
                value['constantDomains'] = []
            elif name == 'v9-duplicate-domain':
                value['constantDomains'].append(dict(domain))
            elif name.startswith('v9-wrong-'):
                key = name.removeprefix('v9-wrong-')
                domain[key] = {'kind': 'finite-normal-only-v1',
                               'stage': 'fragment' if stage == 'vertex' else 'vertex',
                               'slot': 1, 'name': 'otherconst0'}[key]
            elif name == 'v9-extent-mismatch':
                domain['count'] = 45
            elif name == 'v9-extent48':
                domain['count'] = value['uniforms'][0]['count'] = 48
            elif name == 'v9-numeric-uniform':
                value['uniforms'][0]['encoding'] = 'numeric'
            elif name == 'v9-extra-field':
                domain['optional'] = True
            else:
                value['profile'] = 'virgl-webgl2-raw-bits-v8' if name == 'v8-with-domain' else 'virgl-webgl2-raw-bits-v10'
                if name == 'v10-without-domain':
                    del value['constantDomains']
            add(stage, name, value, message)
        add(stage, 'v9-accessor', None, 'Unknown or accessor property.', 'v9-domain-accessor')
    return rows


def verify(directory, head):
    require(isinstance(head, str) and len(head) == 40, 'exact frozen profile source head')
    return _verify(directory, head)


def verify_recording(directory):
    """Development-only source checks, without a final frozen-head claim."""
    return _verify(directory, None)


def _verify(directory, head):
    directory = Path(directory).resolve()
    report = json.loads((directory / 'report.json').read_bytes())
    require(report['schema'] == 'wasm-vm-structured-profiles-v1' and report['task'] == 'E6-T12e7'
            and report['status'] == 'passed', 'profile proof identity and success')
    require(same(report['cases'], expected_cases()), 'all 50 exact typed public profile inputs and results')
    require(same(report['sources'], [binding(ROOT / name) for name in FILES]), 'profile recorder and consumer sources')
    sources = report['sources'] + [binding(Path(__file__).resolve())]
    if head is not None:
        require(report['gitHead'] == head, 'profile proof frozen head')
        for item in sources:
            require(subprocess.check_output(['git', 'show', f'{head}:{item["path"]}'], cwd=ROOT)
                    == (ROOT / item['path']).read_bytes(), 'profile source equals frozen head')
    require(same(report['coverage'], binding(directory / 'coverage.json', directory)), 'actual consumer coverage digest')
    coverage = json.loads((directory / 'coverage.json').read_bytes())
    require(len(coverage) == 1 and coverage[0]['url'].endswith('/renderer/virgl-command/constant-domain.mjs'),
            'coverage belongs to actual consumer')
    functions = [entry for entry in coverage[0]['functions'] if entry['functionName'] == 'parseConstantDomain']
    require(len(functions) == 1 and same(functions[0]['ranges'][0]['count'], 50), 'all 50 public parser calls recorded')
    return {'status': 'passed', 'cases': 50, 'profiles': [7, 8, 9], 'unknownProfileRejected': 10,
            'mandatoryDomains': [7, 9], 'sources': sources,
            'records': [binding(directory / name, directory) for name in ('report.json', 'coverage.json')]}
