#!/usr/bin/env python3
"""Record unchanged native shader translations for the constant renderer fixtures."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'renderer/virgl-command/tests/constant-shaders.json'
PROFILE = 'virgl-webgl2-straight-line-v5'
SOURCES = [
    'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/bridge.h',
    'renderer/virgl-shader/cli.c', 'renderer/virgl-shader/index.mjs',
    'renderer/virgl-shader/build.sh', 'renderer/virgl-shader/UPSTREAM.json',
    'renderer/virgl-shader/verify_sources.py', 'tools/virgl-constants/native.py',
]


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / 'native-report.json'
    report_path.unlink(missing_ok=True)
    sources = [describe(ROOT / p) for p in SOURCES]
    fixture_identity = describe(FIXTURE)
    binary = args.binary.resolve()
    binary_sha = sha(binary.read_bytes())
    transcript = []

    def translate(stage, raw, label, accepted):
        command = [str(binary), stage]
        run = subprocess.run(command, input=raw, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, timeout=30)
        record = {'label': label, 'command': command, 'inputSha256': sha(raw),
                  'returnCode': run.returncode, 'stdout': run.stdout.decode('ascii'),
                  'stderr': run.stderr.decode('ascii')}
        transcript.append(record)
        # Preserve failing invocations too; the report is published only on success.
        (args.output / 'native.log').write_text(''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in transcript))
        require(run.returncode == 0 and not run.stderr, f'{label}: native CLI failure')
        require(run.stdout.endswith(b'\n') and run.stdout.count(b'\n') == 1, f'{label}: one serialized result')
        result = json.loads(run.stdout)
        require(result.get('ok') is accepted, f'{label}: literal acceptance')
        if accepted:
            require(set(result) == {'ok', 'glsl', 'metadata'}, f'{label}: exact success fields')
            require(result['metadata']['profile'] == PROFILE and result['metadata']['stage'] == stage,
                    f'{label}: exact stage/profile')
            require(result['glsl'].startswith('#version 300 es') and len(result['glsl'].encode('ascii')) <= 65536,
                    f'{label}: bounded ESSL300')
        else:
            require(set(result) == {'ok', 'error'} and set(result['error']) == {'code', 'message'} and
                    result['error']['code'] == 'unsupported-feature', f'{label}: unchanged structured rejection')
        return {'result': result, 'resultBytes': len(run.stdout) - 1,
                'stdoutSha256': sha(run.stdout)}

    unique = {}
    for workload in ('textured-scene', 'kmscube', 'glmark2-es2', 'compositor'):
        for path in sorted((ROOT / 'evidence/virgl-corpus/captures' / workload / 'shaders').glob('*.tgsi')):
            raw = path.read_bytes()
            require(sha(raw) == path.stem, 'original SHA identity')
            unique.setdefault(path.stem, (path, raw))
    require(len(unique) == 19, 'nineteen unchanged original bodies')
    originals = []
    for digest, (path, raw) in sorted(unique.items()):
        stage = 'vertex' if raw.startswith(b'VERT\n') else 'fragment'
        require(raw.startswith(b'VERT\n' if stage == 'vertex' else b'FRAG\n'), 'original stage')
        accepted = b'PRECISE' not in raw
        originals.append({**describe(path), 'stage': stage, 'ok': accepted,
                          **translate(stage, raw, digest, accepted)})
    require(sum(o['ok'] for o in originals) == 12, 'unchanged twelve-of-nineteen acceptance')

    fixtures = json.loads(FIXTURE.read_bytes())
    require(type(fixtures) is list and 1 <= len(fixtures) <= 32, 'bounded authored fixture count')
    names, cases = set(), []
    for fixture in fixtures:
        require(set(fixture) == {'name', 'stage', 'text', 'expected'}, 'exact fixture fields')
        name, stage, expected = fixture['name'], fixture['stage'], fixture['expected']
        require(type(name) is str and 0 < len(name) <= 160 and name not in names, 'unique bounded shader name')
        names.add(name)
        require(stage in ('vertex', 'fragment') and type(fixture['text']) is str, 'fixture stage/text')
        raw = fixture['text'].encode('ascii')
        require(0 < len(raw) <= 16384, 'bounded original authored shader bytes')
        require(set(expected) == {'constantCount'} and type(expected['constantCount']) is int and
                1 <= expected['constantCount'] <= 47, 'literal declaration expectation')
        entry = {'name': name, 'stage': stage, 'inputSha256': sha(raw), 'bytes': len(raw),
                 'ok': True, 'expected': expected, **translate(stage, raw, name, True)}
        uniforms = entry['result']['metadata']['uniforms']
        require(len(uniforms) == 1 and uniforms[0]['count'] == expected['constantCount'],
                f'{name}: exact declared constant extent')
        cases.append(entry)

    for source in sources + [fixture_identity] + [{k: o[k] for k in ('path', 'bytes', 'sha256')} for o in originals]:
        require(describe(ROOT / source['path']) == source, f'source changed during run: {source["path"]}')
    require(sha(binary.read_bytes()) == binary_sha, 'native binary changed during run')
    report = {'schema': 'wasm-vm-constants-native-v1', 'status': 'passed', 'profile': PROFILE,
              'boundary': 'unchanged compiler; authored renderer shader inputs, not original high-constant execution',
              'binarySha256': binary_sha, 'binary': str(binary), 'sources': sources,
              'fixture': fixture_identity, 'originals': originals, 'cases': cases,
              'stats': {'originals': 19, 'acceptedOriginals': 12, 'cases': len(cases),
                        'calls': len(transcript)},
              'logSha256': sha((args.output / 'native.log').read_bytes())}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **report['stats'], 'report': str(report_path)}))


if __name__ == '__main__':
    main()
