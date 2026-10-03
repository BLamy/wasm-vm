#!/usr/bin/env python3
"""Build real isolated certificate/emitter faults with full native/Wasm parity."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / 'renderer/virgl-shader'
MUTATIONS = {
    'guard-open': ('raw_bits.c', '" & 2147483647u) != 0u) {\\n"',
                   '" & 2147483647u) != 0u || true) {\\n"'),
    'width-proof': ('bridge.c', '(zero.zero | zero.one) != UINT32_MAX || (zero.one & UINT32_C(0x7fffffff))) return false;',
                    '(zero.zero | zero.one) != UINT32_MAX) return false;'),
}


def sha(raw): return hashlib.sha256(raw).hexdigest()


def binding(path, base):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def require(ok, message):
    if not ok: raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixture = COMPILER / 'tests/selected-lanes-cases.json'
    cases = json.loads(fixture.read_bytes())['cases']
    partners = json.loads((ROOT / 'renderer/virgl-command/tests/bounded-loops-shaders.json').read_bytes())['shaders']
    pair_inputs = []
    for stage in ('vertex','fragment'):
        for prefix in ('a-plain-', 'reject-a-nonzero-missing-width-'):
            current = next(e for e in cases if e['name']==prefix+stage)
            vertex = current['text'] if stage=='vertex' else next(e['text'] for e in partners if e['name']=='pass-vertex')
            fragment = current['text'] if stage=='fragment' else next(e['text'] for e in partners if e['name']=='pass-fragment')
            pair_inputs.append({'name':current['name']+'-pair','vertexText':vertex,'fragmentText':fragment})
    sources = [binding(p, ROOT) for p in sorted(COMPILER.rglob('*')) if p.is_file()
               and not any(s.startswith('.') or s in ('build', '__pycache__') for s in p.relative_to(COMPILER).parts)]
    report = {'schema': 'selected-lanes-actual-source-faults-v1', 'status': 'running',
              'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'fixture': binding(fixture, ROOT), 'sources': sources, 'modes': {}}
    try:
        for name, (filename, before, after) in MUTATIONS.items():
            original = (COMPILER / filename).read_bytes()
            require(original.count(before.encode()) == 1, 'unique source seam ' + name)
            folder = output / name
            folder.mkdir(exist_ok=True)
            mutated = original.replace(before.encode(), after.encode())
            (folder / filename).write_bytes(mutated)
            with tempfile.TemporaryDirectory(prefix='selected-lanes-fault-') as tmp:
                clone = Path(tmp) / 'shader'
                shutil.copytree(COMPILER, clone, ignore=shutil.ignore_patterns('build', '__pycache__', '.DS_Store'))
                (clone / filename).write_bytes(mutated)
                commands = []
                with (folder / 'build.log').open('wb') as stream:
                    for mode in ('native', 'selected-lanes-pair-native', 'wasm'):
                        command = ['bash', 'build.sh', mode]
                        commands.append(command)
                        subprocess.run(command, cwd=clone, stdout=stream, stderr=subprocess.STDOUT,
                                       check=True, timeout=240)
                shutil.copy2(clone / 'build/native/virgl-shader', folder / 'native')
                shutil.copy2(clone / 'build/selected-lanes-pair-native/pair-test', folder / 'pair-native')
                shutil.copy2(clone / 'build/wasm/virgl-shader.wasm', folder / 'fault.wasm')
            records = []
            for entry in cases:
                run = subprocess.run([str(folder / 'native'), entry['stage']], input=entry['text'].encode(),
                                     capture_output=True, check=True, timeout=10)
                require(not run.stderr, 'fault native stderr')
                records.append({'name': entry['name'], 'stage': entry['stage'],
                                'inputSha256': sha(entry['text'].encode()), 'stdout': run.stdout.decode(),
                                'result': json.loads(run.stdout)})
            (folder / 'native.json').write_text(json.dumps(records, indent=2) + '\n')
            pairs = []
            for entry in pair_inputs:
                vertex, fragment = entry['vertexText'].encode(), entry['fragmentText'].encode()
                run = subprocess.run([str(folder / 'pair-native')], input=struct.pack('<II',len(vertex),len(fragment))+vertex+fragment,
                                     capture_output=True, check=True, timeout=10)
                require(not run.stderr, 'actual fault native pair stderr')
                pairs.append({**entry,'stdout':run.stdout.decode(),'result':json.loads(run.stdout)})
            (folder / 'pairs.json').write_text(json.dumps(pairs,indent=2)+'\n')
            command = ['node', str(ROOT / 'tools/virgl-selected-lanes/fault-wasm.mjs'),
                       '--wasm', str(folder / 'fault.wasm'), '--native', str(folder / 'native.json'),
                       '--output', str(folder / 'wasm.json')]
            run = subprocess.run(command, cwd=ROOT, capture_output=True, check=True, timeout=90)
            (folder / 'wasm.log').write_bytes(run.stdout + run.stderr)
            if name == 'width-proof':
                witnesses = [e for e in records if e['name'].startswith('reject-a-nonzero-missing-width-')]
                require(len(witnesses) == 2 and all(e['result']['ok'] is True for e in witnesses),
                        'certificate removal really admits both missing-predecessor stages')
            report['modes'][name] = {'before': before, 'after': after, 'filename': filename,
                                    'originalSha256': sha(original), 'mutatedSha256': sha(mutated),
                                    **{key: binding(folder / path, output) for key, path in {
                                        'source': filename, 'native': 'native', 'pairNative':'pair-native', 'pairTranslations':'pairs.json', 'wasm': 'fault.wasm',
                                        'translations': 'native.json', 'wasmParity': 'wasm.json',
                                        'buildLog': 'build.log'}.items()},
                                    'buildCommands': commands, 'wasmCommand': command}
        for item in sources:
            require(binding(ROOT / item['path'], ROOT) == item, 'compiler source changed during fault recording')
        report['status'] = 'passed'
    finally:
        (output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print('built two real source faults and complete native/Wasm parity')


if __name__ == '__main__': main()
