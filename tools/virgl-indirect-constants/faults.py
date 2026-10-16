#!/usr/bin/env python3
"""Build isolated compiler faults; never rewrite a positive shader or live source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / 'renderer/virgl-shader'
FIXTURE = ROOT / 'renderer/virgl-command/tests/indirect-constants-shaders.json'
MUTATIONS = {
    'index-offset': {
        'path': 'renderer/virgl-shader/raw_bits.c',
        'before': 'emit(w, "%sconst0[raw_addr].%c", p->stage ? "fs" : "vs", "xyzw"[component]);',
        'after': 'emit(w, "%sconst0[(raw_addr ^ 1u)].%c", p->stage ? "fs" : "vs", "xyzw"[component]);',
    },
    'static-bound': {
        'path': 'renderer/virgl-shader/bridge.c',
        'before': 'if ((address.zero & address.one) || (uint32_t)~address.zero >= CONST_REGISTERS) return false;',
        'after': 'if (address.zero & address.one) return false;',
    },
}
BOUND_WITNESSES = {'mask-includes46-vertex', 'mask-includes46-fragment'}




def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(left, right):
    return json.dumps(left, sort_keys=True, separators=(',', ':'), allow_nan=False) == \
        json.dumps(right, sort_keys=True, separators=(',', ':'), allow_nan=False)


def binding(path, base=ROOT):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def verify(output, head, clean_by_sha):
    """Check copied sources, real artifacts, and complete native fault results."""
    require(isinstance(head, str) and len(head) == 40, 'exact frozen fault source head')
    return _verify(output, head, clean_by_sha)


def verify_recording(output, clean_by_sha):
    """Development-only audit, without a committed-head proof claim."""
    return _verify(output, None, clean_by_sha)


def _verify(output, head, clean_by_sha):
    output = Path(output).resolve()
    report = json.loads((output / 'manifest.json').read_bytes())
    require(same(report['schema'], 1) and report['task'] == 'E6-T12e8'
            and report['status'] == 'passed' and (head is None or report['gitHead'] == head),
            'frozen isolated compiler fault identity')
    require(same(report['fixture'], binding(FIXTURE))
            and same(report['wasmHarness'], binding(ROOT / 'tools/virgl-indirect-constants/fault_wasm.mjs'))
            and same(report['harness'], binding(Path(__file__).resolve())), 'fault recorder and literal inputs')
    for item in report['sources'] + [report['fixture'], report['harness'], report['wasmHarness']]:
        raw = (ROOT / item['path']).read_bytes()
        require(same(binding(ROOT / item['path']), item), 'current fault source binding')
        if head is not None:
            require(subprocess.check_output(['git', 'show', f'{head}:{item["path"]}'], cwd=ROOT) == raw,
                    'fault source equals committed head')
    sources = {item['path']: item for item in report['sources']}
    actual_names = sorted(str(path.relative_to(ROOT)) for path in COMPILER.rglob('*') if path.is_file()
                          and not any(part in {'build', '__pycache__'} or part.startswith('.')
                                      for part in path.relative_to(COMPILER).parts))
    require(list(sources) == actual_names, 'complete copied compiler source inventory')
    require(set(report['modes']) == set(MUTATIONS), 'exact two real compiler fault builds')
    fixture = json.loads(FIXTURE.read_bytes())
    shaders = fixture['shaders'] + fixture['negativeCases']
    summary = {}

    def artifact(item):
        path = output / item['path']
        require(path.resolve().is_relative_to(output), 'fault evidence path stays inside recording')
        require(same(binding(path, output), item), 'fault artifact bytes and digest')
        return path

    for mode, definition in MUTATIONS.items():
        record = report['modes'][mode]
        original = (ROOT / definition['path']).read_bytes()
        before, after = definition['before'].encode(), definition['after'].encode()
        require(original.count(before) == 1, 'one unique production source fault seam')
        altered = original.replace(before, after)
        require(len(record['mutations']) == 1, 'one compiler mutation per fault')
        mutation = record['mutations'][0]
        source_record = mutation['recordedSource']
        require(same(mutation, {**definition, 'matches': 1, 'originalSha256': sha(original),
                             'mutatedSha256': sha(altered), 'recordedSource': source_record}),
                'exact declared compiler source mutation')
        require(artifact(source_record).read_bytes() == altered, 'complete mutated C source recorded')
        expected_sources = [{**item, 'bytes': len(altered), 'sha256': sha(altered)}
                            if item['path'] == definition['path'] else item for item in report['sources']]
        require(same(record['sources'], expected_sources), 'no other compiler source altered')
        require(set(record['artifacts']) == {'module', 'wasm', 'native'}, 'all actual fault artifacts')
        for item in record['artifacts'].values():
            artifact(item)
        require(record['build']['commands'] == [['bash', 'build.sh', 'native'], ['bash', 'build.sh', 'wasm']],
                'ordinary compiler build commands over isolated source')
        artifact(record['build']['log'])
        wasm = artifact(record['artifacts']['wasm']).read_bytes()
        require(wasm.startswith(b'\0asm') and len(wasm) > 1000
                and sha(wasm) != sha((COMPILER / 'build/wasm/virgl-shader.wasm').read_bytes()),
                'actual distinct compiled Wasm fault')
        records = json.loads(artifact(record['nativeTranslations']).read_bytes())
        require(len(records) == len(shaders), 'all fault native integration translations')
        changed = 0
        for shader, observed in zip(shaders, records):
            body = shader['text'].encode('ascii')
            require(observed['name'] == shader['name'] and observed['stage'] == shader['stage']
                    and observed['inputSha256'] == sha(body) and same(observed['inputBytes'], len(body)),
                    'fault native translations use unchanged literal inputs')
            require(observed['command'] == [str(Path(report['outputDirectory']) / record['artifacts']['native']['path']),
                                             shader['stage']], 'exact recorded native artifact command')
            stdout = observed['stdout']
            require(same(observed['returnCode'], 0) and observed['stderr'] == ''
                    and stdout.endswith('\n') and stdout.count('\n') == 1
                    and same(json.loads(stdout), observed['result']), 'complete native fault serialization')
            clean = clean_by_sha[sha(body)]
            expected = json.loads(json.dumps(clean))
            if mode == 'index-offset' and expected['ok']:
                expected['glsl'] = expected['glsl'].replace('[raw_addr]', '[(raw_addr ^ 1u)]')
                if '[raw_addr]' in clean['glsl']:
                    access = clean['metadata']['constantAccesses'][0]
                    require(access['count'] == 46 and all(0 <= (i ^ 1) < 46 for i in access['indices']),
                            'every sabotage address stays in the actual declared hardware bank')
                require(same(observed['result'], expected), 'full index fault result changes only address low bit')
            elif mode == 'static-bound' and shader['name'] in BOUND_WITNESSES:
                require(clean['ok'] is False and clean['error']['code'] == 'unsupported-feature',
                        'unknown AND46 address is rejected by the healthy compiler')
                wrong = observed['result']
                require(wrong['ok'] is True
                        and wrong['metadata']['profile'] == 'virgl-webgl2-raw-bits-v10',
                        'removed upper bound wrongly admits a possible one-past access')
                require(same(wrong['metadata']['constantAccesses'], [{
                    'kind': 'constant-bank-static-indirect-v1', 'stage': shader['stage'],
                    'slot': 0, 'name': 'vsconst0' if shader['stage'] == 'vertex' else 'fsconst0',
                    'count': 46, 'indices': [i for i in range(46) if (i & ~46) == 0]}]),
                    'fault witnesses record the exact incomplete address set')
                expected = wrong
            else:
                require(same(observed['result'], expected), 'all other complete fault results remain exact')
            changed += not same(expected, clean)
        if mode == 'static-bound':
            require(changed == 2 and BOUND_WITNESSES.issubset({entry['name'] for entry in records}),
                    'both stage one-past witnesses detect the removed static bound; never GPU dispatched')
        wasm_record = json.loads(artifact(record['wasmTranslations']).read_bytes())
        require(wasm_record['schema'] == 'wasm-vm-indirect-fault-wasm-v1'
                and wasm_record['mode'] == mode and wasm_record['status'] == 'passed',
                'actual fault Wasm ABI run')
        require(same(wasm_record['fixture'], binding(FIXTURE))
                and same(wasm_record['harness'], binding(ROOT / 'tools/virgl-indirect-constants/fault_wasm.mjs')),
                'fault Wasm literal inputs and recorder')
        require(same(wasm_record['artifacts'], record['artifacts'])
                and same(wasm_record['nativeTranslations'], record['nativeTranslations']),
                'same compiled fault artifacts and native transcript')
        require(same(wasm_record['memory'], {'initialBytes': 16777216, 'finalBytes': 16777216,
                                       'bufferIdentityStable': True}), 'fixed memory during fault ABI calls')
        require(same(wasm_record['calls'], [{'name': row['name'], 'stage': row['stage'],
                'inputSha256': row['inputSha256'], 'inputBytes': row['inputBytes'], 'result': row['result']}
                for row in records]), 'all actual fault Wasm results exactly match native')
        require(changed > 0, 'compiler fault actually changes a positive integration result')
        summary[mode] = {'translatedStages': len(records), 'changedStages': changed,
                         'artifacts': record['artifacts'], 'nativeTranslations': record['nativeTranslations'],
                         'wasmTranslations': record['wasmTranslations']}
    return {'manifest': binding(output / 'manifest.json', output), 'modes': summary, 'preview': head is None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    require(not output.exists(), 'fault artifact destination must be fresh')
    output.mkdir(parents=True)
    env = dict(os.environ)
    if not env.get('EMCC'):
        env['EMCC'] = subprocess.check_output(['bash', 'tools/setup-virgl-emsdk.sh'],
                                            cwd=ROOT, text=True).strip()
    sources = sorted(path for path in COMPILER.rglob('*') if path.is_file()
                     and not any(part in {'build', '__pycache__'} or part.startswith('.')
                                 for part in path.relative_to(COMPILER).parts))
    source_bindings = [binding(path) for path in sources]
    fixture = json.loads(FIXTURE.read_bytes())
    require(fixture['schema'] == 'wasm-vm-indirect-constants-hardware-v1', 'literal integration fixture identity')
    shaders = fixture['shaders'] + fixture['negativeCases']
    require(1 <= len(shaders) <= 64 and len({s['name'] for s in shaders}) == len(shaders), 'bounded unique stage inputs')
    report = {'schema': 1, 'task': 'E6-T12e8', 'status': 'running', 'outputDirectory': str(output),
              'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'boundary': 'Isolated compiler source faults, not positive shader or metadata injection.',
              'sources': source_bindings, 'fixture': binding(FIXTURE),
              'harness': binding(Path(__file__).resolve()),
              'wasmHarness': binding(ROOT / 'tools/virgl-indirect-constants/fault_wasm.mjs'), 'modes': {}}
    for mode, mutation in MUTATIONS.items():
        directory = output / mode
        directory.mkdir()
        scratch = Path(tempfile.mkdtemp(prefix=f'wasm-vm-{mode}-')) / 'renderer'
        scratch.mkdir()
        for source in sources:
            target = scratch / source.relative_to(COMPILER)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        original = (ROOT / mutation['path']).read_bytes()
        before, after = mutation['before'].encode(), mutation['after'].encode()
        require(original.count(before) == 1, f'exactly one source fault site: {mode}')
        altered = original.replace(before, after)
        target = scratch / Path(mutation['path']).relative_to('renderer/virgl-shader')
        target.write_bytes(altered)
        copied_sources = []
        for source, identity in zip(sources, source_bindings):
            target = scratch / source.relative_to(COMPILER)
            expected = altered if identity['path'] == mutation['path'] else source.read_bytes()
            require(target.read_bytes() == expected, 'only the declared compiler fault differs')
            copied_sources.append({'path': identity['path'], 'bytes': len(expected), 'sha256': sha(expected)})

        def check_copy():
            for identity in copied_sources:
                path = scratch / Path(identity['path']).relative_to('renderer/virgl-shader')
                raw = path.read_bytes()
                require(len(raw) == identity['bytes'] and sha(raw) == identity['sha256'],
                        'isolated compiler source changed during build or translation')

        saved_source = directory / 'source' / Path(mutation['path']).name
        saved_source.parent.mkdir()
        saved_source.write_bytes(altered)
        build_log = directory / 'build.log'
        commands = [['bash', 'build.sh', target] for target in ('native', 'wasm')]
        with build_log.open('w') as log:
            for command in commands:
                subprocess.run(command, cwd=scratch, env=env, stdout=log,
                               stderr=subprocess.STDOUT, check=True, timeout=300)
                check_copy()
        artifacts = {}
        for kind, relative in [('module', 'build/wasm/virgl-shader.mjs'),
                               ('wasm', 'build/wasm/virgl-shader.wasm'),
                               ('native', 'build/native/virgl-shader')]:
            target = directory / relative.removeprefix('build/')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(scratch / relative, target)
            artifacts[kind] = binding(target, output)
        binary = output / artifacts['native']['path']
        transcripts = []
        for shader in shaders:
            require(shader['stage'] in ('vertex', 'fragment'), 'bounded authored stage')
            body = shader['text'].encode('ascii')
            require(0 < len(body) <= 16384, 'bounded literal shader body')
            command = [str(binary), shader['stage']]
            run = subprocess.run(command, input=body, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, check=True, timeout=30)
            require(run.stderr == b'' and run.stdout.endswith(b'\n') and run.stdout.count(b'\n') == 1,
                    'one complete fault native translation')
            transcripts.append({'name': shader['name'], 'stage': shader['stage'],
                                'inputSha256': sha(body), 'inputBytes': len(body),
                                'command': command, 'returnCode': run.returncode,
                                'stdout': run.stdout.decode('ascii'), 'stderr': '',
                                'result': json.loads(run.stdout)})
        transcript = directory / 'native.json'
        transcript.write_text(json.dumps(transcripts, separators=(',', ':')) + '\n')
        wasm_transcript = directory / 'wasm.json'
        subprocess.run(['node', 'tools/virgl-indirect-constants/fault_wasm.mjs',
                        '--output', str(wasm_transcript), '--fixture', str(FIXTURE),
                        '--directory', str(output), '--mode', mode], cwd=ROOT, env=env, check=True, timeout=120)
        for source, identity in zip(sources, source_bindings):
            require(binding(source) == identity, 'compiler source changed while building faults')
        check_copy()
        require(binding(FIXTURE) == report['fixture'], 'literal hardware inputs changed while building faults')
        report['modes'][mode] = {
            'mutations': [{**mutation, 'matches': 1, 'originalSha256': sha(original),
                           'mutatedSha256': sha(altered), 'recordedSource': binding(saved_source, output)}],
            'artifacts': artifacts, 'sources': copied_sources,
            'build': {'directory': str(scratch), 'commands': commands, 'log': binding(build_log, output)},
            'nativeTranslations': binding(transcript, output),
            'wasmTranslations': binding(wasm_transcript, output),
        }
    report['status'] = 'passed'
    (output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Built actual index-offset and static-bound native/Wasm faults from individually bound source copies.')


if __name__ == '__main__':
    main()
