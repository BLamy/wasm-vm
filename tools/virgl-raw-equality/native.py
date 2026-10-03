#!/usr/bin/env python3
"""Record checked indirect cases and every unchanged E8 input and full result."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '80813f4e45202cec3769d51b4f7d2b421034df01'
BASELINE = ROOT / 'evidence/virgl-bounded-loops/cold-clone/acceptance/native/native-report.json'
BASELINE_SHA = '86702b34e542fa397cd255fd037db200a35d89cf21573fb57664b5c7ca678e57'
FIXTURE = ROOT / 'renderer/virgl-shader/tests/raw-equality-cases.json'
MIGRATIONS = ROOT / 'renderer/virgl-shader/tests/raw-equality-migrations.json'
PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 14)]
GROUPS = [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
          ('component', 'component-float', 574, 37), ('dot', 'dot-reciprocal', 616, 41), ('constant', 'constant-compiler', 452, 18), ('structured', 'structured-conditional', 315, 15), ('indirect', 'indirect-constant', 348, 16), ('loop','bounded-loop',198,12)]
SEEDS = ['0fd3e19b', '79a86e25', 'd16430c7', 'b21f9a43']
SOURCES = ['renderer/virgl-shader/build.sh', 'renderer/virgl-shader/index.mjs',
           'renderer/virgl-shader/native_tests/raw_equality.c', 'renderer/virgl-shader/README.md',
           'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
           'tools/virgl-raw-equality/native.py', 'tools/virgl-raw-equality/native_receipt.py',
           'tools/virgl-raw-equality/generate_cases.py']


def require(value, message):
    if not value: raise ValueError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()

def exact(a,b):
    return json.dumps(a,sort_keys=True,separators=(',', ':'),allow_nan=False)==json.dumps(b,sort_keys=True,separators=(',', ':'),allow_nan=False)


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def workload():
    require(sha(BASELINE.read_bytes())==BASELINE_SHA and BASELINE.read_bytes()==subprocess.check_output(['git','show',f'{HELD_HEAD}:{BASELINE.relative_to(ROOT)}'],cwd=ROOT),'verified exact E9 baseline')
    held=json.loads(BASELINE.read_bytes());report={};groups=[]
    migrations=json.loads(MIGRATIONS.read_bytes())
    require(migrations['heldHead']==HELD_HEAD and migrations['baselineSha256']==BASELINE_SHA and len(migrations['entries'])==8,'closed exact expectation migrations')
    changes={(m['group'],m['name']):m for m in migrations['entries']}
    for label,stem,count,pair_count in GROUPS:
        ck,pk=('cases','pairs') if label=='loop' else (label+'Cases',label+'Pairs')
        cases,pairs=copy.deepcopy(held[ck]),copy.deepcopy(held[pk])
        require((len(cases),len(pairs))==(count,pair_count),'whole retained workload')
        for entry in cases:
            migration=changes.get((ck,entry['name']))
            if migration:
                require(not entry['ok'] and entry['inputSha256']==migration['inputSha256'] and exact(entry['result'],migration['oldResult']),'unchanged explicitly migrated body and old result')
                entry['predecessor']=copy.deepcopy(entry)
                for key in ('result','resultBytes','resultSha256'):del entry[key]
                entry.update(ok=True,profile=migration['newProfile'],expected={'profile':migration['newProfile'],'constantCount':46})
        report[label+'Cases'],report[label+'Pairs']=cases,pairs
        report[label+'Fixtures']=copy.deepcopy(held['fixtures' if label=='loop' else label+'Fixtures'])
        groups.append((label+'::',cases,pairs))
    fixture=json.loads(FIXTURE.read_bytes());cases=[]
    require(fixture['schema']=='raw-equality-cases-v1','authored fixture schema')
    for f in fixture['cases']:
        raw=f['text'].encode('ascii');require(0<len(raw)<=16385,'bounded positive/excessive witness')
        e=dict(f,origin='shared',inputSha256=sha(raw),bytes=len(raw))
        if f['ok']:e['profile']=f['expected']['profile']
        cases.append(e)
    lookup={prefix+e['name']:e for prefix,entries,_ in groups for e in entries};lookup.update({e['name']:e for e in cases})
    pairs=[]
    for f in fixture['pairs']:
        v,p=lookup[f['vertex']],lookup[f['fragment']]
        pairs.append(dict(name=f['name'],vertexCaseName=f['vertex'],fragmentCaseName=f['fragment'],vertexSha256=v['inputSha256'],fragmentSha256=p['inputSha256'],ok=f['ok'],expected={'interfaceKey':'generic-interpolation-v1:g0/15/flat' if f['fragment'].startswith('loop::') else 'generic-interpolation-v1:'}))
    report.update(cases=cases,pairs=pairs,originals=copy.deepcopy(held['originals']),fixtures=[describe(FIXTURE),describe(MIGRATIONS)],indirectBaseline=copy.deepcopy(held['indirectBaseline']),structuredBaseline=copy.deepcopy(held['structuredBaseline']),constantBaseline=copy.deepcopy(held['constantBaseline']),e9Baseline=describe(BASELINE),migrationManifest=describe(MIGRATIONS),boundProof=copy.deepcopy(held['boundProof']))
    groups.append(('',cases,pairs))
    report['recoverySingles']=[n if '::' in n else 'loop::'+n for n in held['recoverySingles']]+['eq-vertex','eq-fragment']
    report['recoveryPairs']=[n if '::' in n else 'loop::'+n for n in held['recoveryPairs']]+['eq-vertex-pair','eq-fragment-pair']
    report['truncationCases']=report['recoverySingles'][:2]+report['recoverySingles'][-2:]+['alias-left-vertex','alias-left-fragment']
    return report,groups


def reference(prefix,name): return name if '::' in name else prefix+name


def serialize(report, groups):
    cases = [(prefix + e['name'], e) for prefix, entries, _ in groups for e in entries]
    pairs = [(prefix + e['name'], prefix, e) for prefix, _, entries in groups for e in entries]
    indexes = {name: i for i, (name, _) in enumerate(cases)}
    pair_indexes = {name: i for i, (name, _, _) in enumerate(pairs)}
    require(len(indexes) == len(cases) <= 8192 and len(pair_indexes) == len(pairs) <= 320, 'unique bounded native inputs')
    stream = bytearray(b'VGSA' + struct.pack('<I', 19))
    for entry in report['originals']:
        raw = (ROOT / entry['path']).read_bytes()
        stream += struct.pack('<III', int(entry['stage'] == 'fragment'), int(entry['ok']), len(raw)) + raw
    stream += struct.pack('<I', len(cases))
    for name, entry in cases:
        raw, name = entry['text'].encode('ascii'), name.encode('ascii')
        profile = PROFILES.index(entry['profile']) if entry.get('profile') else 0
        stream += struct.pack('<IIIII', int(entry['stage'] == 'fragment'), int(entry['ok']), profile, len(name), len(raw)) + name + raw
    stream += struct.pack('<I', len(pairs))
    for name, prefix, entry in pairs:
        v, f = entry['vertexCaseName'], entry['fragmentCaseName']
        name = name.encode('ascii')
        stream += struct.pack('<IIII', indexes[reference(prefix,v)], indexes[reference(prefix,f)], int(entry['ok']), len(name)) + name
    stream += struct.pack('<28I', *[indexes[n] for n in report['recoverySingles']])
    stream += struct.pack('<26I', *[pair_indexes[n] for n in report['recoveryPairs']])
    return stream, cases, pairs


def expectations(result, entry):
    require(result['ok'] is entry['ok'], 'literal acceptance: ' + entry.get('name', entry.get('path', '')))
    if not result['ok']:
        require(set(result) == {'ok', 'error'} and result['error']['code'] == entry.get('expected', {'errorCode': 'unsupported-feature'})['errorCode'], 'literal structured error')
    elif 'profile' in entry:
        e, metadata = entry['expected'], result['metadata']
        require(metadata['profile'] == entry['profile'] and metadata['stage'] == entry['stage'], 'literal stage/profile')
        if 'constantDomains' in e: require(exact(metadata.get('constantDomains'), e['constantDomains']), 'exact derived domain')
        if 'constantAccesses' in e: require(exact(metadata.get('constantAccesses'), e['constantAccesses']), 'exact complete indirect set')
        if 'constantConstraints' in e: require(exact(metadata.get('constantConstraints'), e['constantConstraints']), 'exact counted-loop constraint')
        if 'constantCount' in e:
            require(metadata['uniforms'] == ([{'name': ('vs' if entry['stage'] == 'vertex' else 'fs') + 'const0',
                    'type': 'uvec4[]', 'count': e['constantCount'], 'encoding': 'float32-bits'}] if e['constantCount'] else []), 'literal bank extent')
    elif 'vertexCaseName' in entry:
        require(result['interfaceKey'] == entry['expected']['interfaceKey'], 'literal linked interface: ' + entry['name'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'native-report.json').unlink(missing_ok=True)
    report, groups = workload(); stream, cases, pairs = serialize(report, groups)
    sources = sorted(p for pattern in ('*.c', '*.h') for p in (ROOT / 'renderer/virgl-shader').glob(pattern))
    report['sources'] = [describe(p) for p in sources] + [describe(ROOT / p) for p in SOURCES]
    binary = args.binary.resolve(); binary_sha = sha(binary.read_bytes())
    (args.output / 'native-input.bin').write_bytes(stream)
    env = dict(os.environ, UBSAN_OPTIONS='halt_on_error=1', ASAN_OPTIONS='abort_on_error=1',
               LLVM_PROFILE_FILE=str((args.output / 'native.profraw').resolve()))
    run = subprocess.run([str(binary)], input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=600)
    (args.output / 'native.log').write_bytes(run.stdout)
    require(run.returncode == 0, f'sanitizer failed: {run.returncode}; inspect native.log')
    entries = {'ORIGINAL': report['originals'], 'CASE': [e for _, e in cases], 'PAIR': [e for _, _, e in pairs]}
    seen = {k: set() for k in entries}; faults = []; seeds = []
    for line in run.stdout.decode('ascii').splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)', line)
        if match:
            kind, index, raw = match[1], int(match[2]), match[3].encode('ascii')
            require(index not in seen[kind] and index < len(entries[kind]), 'unique native transcript result')
            seen[kind].add(index); entry = entries[kind][index]; result = json.loads(raw)
            if 'result' in entry:
                require(exact((result, len(raw), sha(raw)), (entry['result'], entry['resultBytes'], entry['resultSha256'])), 'complete retained serialized result: ' + entry.get('name', entry.get('path', '')))
            expectations(result, entry)
            entry.update(result=result, resultBytes=len(raw), resultSha256=sha(raw))
        elif line.startswith('FAULT '):
            _, index, raw = line.split(' ', 2); require(int(index) == len(faults), 'ordered actual allocation fault'); faults.append(json.loads(raw))
        elif line.startswith('LAYOUT '): report['layout'] = json.loads(line[7:])
        elif line.startswith('FLOW '): report['flow'] = json.loads(line[5:])
        elif line.startswith('STATS '): report['stats'] = json.loads(line[6:])
        else:
            m = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=28672 pair_recoveries=26624 passed', line)
            require(m is not None, 'only expected native diagnostics'); seeds.append(m[1])
    require(all(len(seen[k]) == len(v) for k, v in entries.items()) and seeds == SEEDS, 'complete native run')
    report['recordedMaxima'] = {'singleResultBytes': max(e['resultBytes'] for e in entries['ORIGINAL'] + entries['CASE']),
        'pairResultBytes': max(e['resultBytes'] for e in entries['PAIR']),
        'stageGlslBytes': max(len(stage['glsl'].encode()) for group in entries.values() for e in group if e['result']['ok']
           for stage in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    for source in report['sources'] + report['fixtures'] + [report['constantBaseline'],report['structuredBaseline'],report['indirectBaseline'],report['e9Baseline']] + [v for label, *_ in GROUPS for v in report[label+'Fixtures']]:
        require(describe(ROOT / source['path']) == source, 'source unchanged during recording')
    require(sha(binary.read_bytes()) == binary_sha, 'native artifact unchanged')
    report.update(schema='wasm-vm-raw-equality-native-v1', status='passed', command=[str(binary)],
                  binarySha256=binary_sha, streamSha256=sha(stream), logSha256=sha(run.stdout), allocationFaults=faults,
                  seeds=SEEDS, mutationsPerSeed=1024, sanitizers=['address', 'undefined'], coverage=coverage(binary, args.output),
                  compatibility={'heldHead': HELD_HEAD, 'retainedCases': 4012, 'retainedPairs': 264,
                                 'migrations': 8, 'predecessorFullGateClaimed': False})
    (args.output / 'native-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', **report['stats'], 'report': str(args.output / 'native-report.json')}))


def coverage(binary, output):
    """Preserve source-bound LLVM counters; no inferred coverage from test names."""
    output = output.resolve()
    raw = output / 'native.profraw'
    require(raw.is_file() and raw.stat().st_size > 0, 'sanitizer run produced LLVM counters')
    profdata = Path(subprocess.check_output(['xcrun', '--find', 'llvm-profdata'], text=True).strip())
    cov = Path(subprocess.check_output(['xcrun', '--find', 'llvm-cov'], text=True).strip())
    profile = output / 'native.profdata'
    commands = []

    def record(command, destination):
        commands.append(command)
        run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        (output / destination).write_bytes(run.stdout)
        require(run.returncode == 0 and not run.stderr,
                f'coverage command failed: {command}: {run.stderr.decode(errors="replace")}')
        return run.stdout

    record([str(profdata), 'merge', '-sparse', str(raw), '-o', str(profile)], 'coverage-merge.log')
    paths = [ROOT / 'renderer/virgl-shader/bridge.c', ROOT / 'renderer/virgl-shader/raw_bits.c']
    arguments = [str(binary), '-instr-profile=' + str(profile), *map(str, paths)]
    exported = json.loads(record([str(cov), 'export', *arguments], 'coverage.json'))
    record([str(cov), 'report', *arguments], 'coverage-report.txt')
    record([str(cov), 'show', *arguments, '-show-line-counts-or-regions', '-show-branches=count'], 'coverage-show.txt')
    require(exported['type'] == 'llvm.coverage.json.export' and len(exported['data']) == 1,
            'one complete LLVM coverage export')
    files = exported['data'][0]['files']
    require({Path(entry['filename']).resolve() for entry in files} == {path.resolve() for path in paths},
            'coverage binds exactly both changed C implementation files')
    summaries = []
    for entry in files:
        path = Path(entry['filename']).resolve()
        require(entry['segments'] and entry['summary']['lines']['covered'] > 0, 'real native execution counters')
        summaries.append({**describe(path), 'summary': entry['summary']})
    names = ['native.profraw', 'native.profdata', 'coverage-merge.log', 'coverage.json',
             'coverage-report.txt', 'coverage-show.txt']
    stack_records = []
    for filename in ('bridge.su', 'raw_bits.su'):
        path = binary.parent / filename
        raw_stack = path.read_bytes()
        require(raw_stack, 'compiler emitted native stack observations')
        (output / filename).write_bytes(raw_stack)
        functions = []
        for line in raw_stack.decode('ascii').splitlines():
            function, size, kind = line.split('\t')
            require(size.isdecimal() and kind in ('static', 'dynamic', 'dynamic,bounded'),
                    'structured compiler stack observation')
            functions.append({'function': function, 'bytes': int(size), 'kind': kind})
        names.append(filename)
        stack_records.append({'path': filename, 'source': 'renderer/virgl-shader/' + filename[:-3] + '.c',
                              'functions': functions})
    return {'schema': 'wasm-vm-raw-equality-native-coverage-v1', 'sources': summaries, 'commands': commands,
            'nativeStack': {'boundary': 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
                            'files': stack_records},
            'tools': [{'path': str(path), 'sha256': sha(path.read_bytes()),
                       'version': subprocess.check_output([str(path), '--version'], text=True).strip()}
                      for path in (profdata, cov)],
            'records': [{'path': name, 'bytes': (output / name).stat().st_size,
                         'sha256': sha((output / name).read_bytes())} for name in names]}



if __name__ == "__main__": main()
