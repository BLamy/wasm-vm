"""Evidence identities for the conditional constant consumer, never runtime rules."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '5561bf3d8a16d2e847b7772909bf772f2c8c57d5'
PROFILE = 'virgl-webgl2-raw-bits-v7'
KIND = 'constant-bank-finite-f32-v1'
FIXTURE = 'renderer/virgl-command/tests/constant-domain-shaders.json'


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def binding(path, base=ROOT):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def source(item, head):
    raw = (ROOT / item['path']).read_bytes()
    require(sha(raw) == item['sha256'] and len(raw) == item.get('bytes', item.get('size')),
            f'current source binding: {item["path"]}')
    if '/build/' not in item['path']:
        require(git('show', f'{head}:{item["path"]}') == raw, f'committed source binding: {item["path"]}')


def artifact(directory, item):
    path = directory / item['path']
    require(path.resolve().is_relative_to(directory.resolve()), 'evidence path stays inside recording')
    raw = path.read_bytes()
    require(sha(raw) == item['sha256'], f'recorded artifact digest: {item["path"]}')
    if 'bytes' in item or 'size' in item:
        require(len(raw) == item.get('bytes', item.get('size')), f'recorded artifact length: {item["path"]}')
    return raw


def verify_native(directory, head):
    report = read(directory / 'native-report.json')
    require(report['schema'] == 'wasm-vm-constant-domain-native-v1' and report['status'] == 'passed'
            and report['heldCompilerHead'] == HELD_HEAD, 'native proof identity')
    require(report['fixture'] == binding(ROOT / FIXTURE), 'native fixture binding')
    require(sha(Path(report['binary']).read_bytes()) == report['binarySha256'], 'native executable digest')
    raw = (directory / 'native.log').read_bytes()
    require(sha(raw) == report['logSha256'], 'complete native transcript digest')
    transcript = [json.loads(line) for line in raw.splitlines()]
    fixtures = read(ROOT / FIXTURE)
    require(len(fixtures) == len(report['cases']) == len(transcript) == report['calls'] == 14,
            'all fourteen authored stage translations')
    names = git('ls-tree', '-r', '--name-only', HELD_HEAD, 'renderer/virgl-shader').decode().splitlines()
    names = [name for name in names if '/build/' not in name]
    require([item['path'] for item in report['sources']] == names + ['tools/virgl-constant-domains/native.py'],
            'complete unchanged compiler source inventory')
    for item in report['sources']:
        source(item, head)
        if item['path'].startswith('renderer/virgl-shader/'):
            require(git('show', f'{HELD_HEAD}:{item["path"]}') == (ROOT / item['path']).read_bytes(),
                    'no new compiler capability hidden in consumer proof')
    for fixture, case, record in zip(fixtures, report['cases'], transcript):
        body = fixture['text'].encode('ascii')
        require(case['name'] == record['name'] == fixture['name'] and case['stage'] == fixture['stage']
                and case['inputSha256'] == record['inputSha256'] == sha(body)
                and case['inputBytes'] == len(body), 'literal stage input and order')
        stdout = record['stdout'].encode('ascii')
        require(record['command'] == [report['binary'], fixture['stage']] and record['returnCode'] == 0
                and record['stderr'] == '' and stdout.count(b'\n') == 1 and stdout.endswith(b'\n')
                and case['stdoutSha256'] == sha(stdout) and case['resultBytes'] == len(stdout) - 1
                and json.loads(stdout) == case['result'], 'complete native result serialization')
        result = case['result']
        require(set(result) == {'ok', 'glsl', 'metadata'} and result['ok'] is True
                and result['metadata']['stage'] == fixture['stage']
                and result['metadata']['profile'] != PROFILE and 'constantDomains' not in result['metadata'],
                'native compiler remains unconditional')
    return report, {entry['name']: entry for entry in report['cases']}
