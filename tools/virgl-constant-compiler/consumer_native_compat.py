#!/usr/bin/env python3
"""Reexecute E6a inputs with current compiler, preserving every full result."""
import argparse
import json
import subprocess
from pathlib import Path

from compat_common import ROOT, BASE, HELD_HEAD, require, sha, read, binding, held, git

FIXTURE = 'renderer/virgl-command/tests/constant-domain-shaders.json'
SCHEMA = 'wasm-vm-e6a-native-successor-compat-v1'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    old = held(BASE + '/native/native-report.json')
    require(binding(ROOT / FIXTURE) == old['fixture'], 'exact unchanged E6a authored inputs')
    fixtures = read(ROOT / FIXTURE)
    require(len(fixtures) == len(old['cases']) == 14, 'all E6a inputs')
    binary = args.binary.resolve()
    require(binary == ROOT / 'renderer/virgl-shader/build/native/virgl-shader', 'actual current native compiler')
    binary_sha = sha(binary.read_bytes())
    names = git('ls-files', 'renderer/virgl-shader').decode().splitlines()
    names = [name for name in names if '/build/' not in name]
    names += ['tools/virgl-constant-compiler/consumer_native_compat.py',
              'tools/virgl-constant-compiler/compat_common.py', FIXTURE]
    sources = [binding(ROOT / name) for name in names]
    records, cases = [], []
    for fixture, expected in zip(fixtures, old['cases']):
        body = fixture['text'].encode('ascii')
        command = [str(binary), fixture['stage']]
        run = subprocess.run(command, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        records.append({'name': fixture['name'], 'command': command, 'inputSha256': sha(body),
                        'returnCode': run.returncode, 'stdout': run.stdout.decode('ascii'),
                        'stderr': run.stderr.decode('ascii')})
        (args.output / 'native.log').write_text(''.join(json.dumps(record, separators=(',', ':')) + '\n' for record in records))
        require(run.returncode == 0 and run.stderr == b'' and run.stdout.count(b'\n') == 1
                and run.stdout.endswith(b'\n'), 'one successful complete native serialization')
        case = {'name': fixture['name'], 'stage': fixture['stage'], 'inputSha256': sha(body),
                'inputBytes': len(body), 'stdoutSha256': sha(run.stdout), 'resultBytes': len(run.stdout) - 1,
                'result': json.loads(run.stdout)}
        require(case == expected, f'full E6a result preserved: {fixture["name"]}')
        cases.append(case)
    require(sha(binary.read_bytes()) == binary_sha and all(binding(ROOT / item['path']) == item for item in sources),
            'compiler and sources unchanged during replay')
    report = {'schema': SCHEMA, 'status': 'passed', 'gitHead': git('rev-parse', 'HEAD').decode().strip(),
              'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
              'boundary': 'Current compiler produces byte-identical full results for all 14 unchanged E6a consumer inputs.',
              'baseline': binding(ROOT / BASE / 'native/native-report.json'), 'fixture': binding(ROOT / FIXTURE),
              'binary': str(binary), 'binarySha256': binary_sha, 'sources': sources,
              'cases': cases, 'calls': 14, 'logSha256': sha((args.output / 'native.log').read_bytes())}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('E6b consumer compatibility: 14 full native results equal verified E6a.')


if __name__ == '__main__':
    main()
