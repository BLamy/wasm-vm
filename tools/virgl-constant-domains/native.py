#!/usr/bin/env python3
"""Record real native translations of the consumer's authored hardware inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = 'renderer/virgl-command/tests/constant-domain-shaders.json'
HELD_HEAD = '5561bf3d8a16d2e847b7772909bf772f2c8c57d5'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def binding(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    names = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader'], cwd=ROOT,
                                    text=True).splitlines()
    compiler = [binding(ROOT / name) for name in names if '/build/' not in name]
    for item in compiler:
        old = subprocess.check_output(['git', 'show', f'{HELD_HEAD}:{item["path"]}'], cwd=ROOT)
        require(sha(old) == item['sha256'], 'consumer must preserve the verified compiler source')
    sources = compiler + [binding(ROOT / 'tools/virgl-constant-domains/native.py')]
    fixture = binding(ROOT / FIXTURE)
    inputs = json.loads((ROOT / FIXTURE).read_bytes())
    require(type(inputs) is list and 1 <= len(inputs) <= 32, 'bounded stage fixture table')
    binary = args.binary.resolve()
    binary_sha = sha(binary.read_bytes())
    records, cases, seen = [], [], set()
    for entry in inputs:
        require(set(entry) == {'name', 'stage', 'text', 'expected'}, 'exact stage fixture shape')
        require(entry['name'] not in seen and entry['stage'] in ('vertex', 'fragment'), 'unique named stage')
        seen.add(entry['name'])
        raw = entry['text'].encode('ascii')
        require(0 < len(raw) <= 16384, 'bounded exact authored text')
        command = [str(binary), entry['stage']]
        run = subprocess.run(command, input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             timeout=30)
        record = {'name': entry['name'], 'command': command, 'inputSha256': sha(raw),
                  'returnCode': run.returncode, 'stdout': run.stdout.decode('ascii'),
                  'stderr': run.stderr.decode('ascii')}
        records.append(record)
        (args.output / 'native.log').write_text(''.join(json.dumps(item, separators=(',', ':')) + '\n'
                                                       for item in records))
        require(run.returncode == 0 and run.stderr == b'' and run.stdout.count(b'\n') == 1
                and run.stdout.endswith(b'\n'), 'one complete successful native invocation')
        result = json.loads(run.stdout)
        require(result.get('ok') is True and set(result) == {'ok', 'glsl', 'metadata'}, 'real compiler success')
        metadata = result['metadata']
        require(metadata['stage'] == entry['stage'] and 'constantDomains' not in metadata
                and metadata['profile'] != 'virgl-webgl2-raw-bits-v7', 'no compiler contract admission')
        require(len(metadata['uniforms']) == 1 and metadata['uniforms'][0]['count'] ==
                entry['expected']['constantCount'], 'truthful declared bank extent')
        cases.append({'name': entry['name'], 'stage': entry['stage'], 'inputSha256': sha(raw),
                      'inputBytes': len(raw), 'stdoutSha256': sha(run.stdout),
                      'resultBytes': len(run.stdout) - 1, 'result': result})
    for source in sources + [fixture]:
        require(binding(ROOT / source['path']) == source, 'recorded input changed during native proof')
    require(sha(binary.read_bytes()) == binary_sha, 'native executable changed during proof')
    report = {'schema': 'wasm-vm-constant-domain-native-v1', 'status': 'passed',
              'boundary': 'Unmodified verified compiler over authored consumer inputs; no conditional compiler admission.',
              'heldCompilerHead': HELD_HEAD, 'sources': sources, 'fixture': fixture,
              'binary': str(binary), 'binarySha256': binary_sha, 'cases': cases,
              'calls': len(records), 'logSha256': sha((args.output / 'native.log').read_bytes())}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Constant-domain consumer native inputs: {len(cases)} complete translations recorded')


if __name__ == '__main__':
    main()
