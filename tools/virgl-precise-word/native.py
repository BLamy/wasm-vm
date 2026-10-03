#!/usr/bin/env python3
"""Record radial-domain cases and every unchanged F2 input and full result."""
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
import tarfile

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '220c2640d8c75df4decae10a3aa12a7be150897f'
BASELINE = ROOT / 'evidence/virgl-radial-domain/worker.tar.gz'
BASELINE_SHA = '7c6c072899bf3d242ab2e36c12893f009178654d9e5762455f3caecd77e37862'
FIXTURE = ROOT / 'renderer/virgl-shader/tests/precise-word-cases.json'
PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 27)]
GROUPS = [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
          ('component', 'component-float', 574, 37), ('dot', 'dot-reciprocal', 616, 41), ('constant', 'constant-compiler', 452, 18), ('structured', 'structured-conditional', 315, 15), ('indirect', 'indirect-constant', 348, 16), ('loop','bounded-loop',198,12),('equality','raw-equality',140,34),('selected','selected-lanes',148,80),('radial','radial-domain',44,51)]
SEEDS = ['397b10e5', '86cd4391', 'c120ad73', '5e74bf09']
SOURCES = ['renderer/virgl-shader/build.sh', 'renderer/virgl-shader/index.mjs',
           'renderer/virgl-shader/native_tests/precise_words.c', 'renderer/virgl-shader/README.md',
           'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
           'tools/virgl-precise-word/native.py', 'tools/virgl-precise-word/native_receipt.py',
           'tools/virgl-precise-word/generate_cases.py']


def require(value, message):
    if not value: raise ValueError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()

def exact(a,b):
    return json.dumps(a,sort_keys=True,separators=(',', ':'),allow_nan=False)==json.dumps(b,sort_keys=True,separators=(',', ':'),allow_nan=False)


def describe(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': sha(raw)}


def literal_interface(text):
    records=[]
    for match in re.finditer(r'^DCL IN\[\d+\](?:\.([xyzw]+))?, GENERIC\[(\d+)\]([^\n]*)',text,re.M):
        mask=sum(1<<'xyzw'.index(c) for c in (match[1] or 'xyzw'))
        interpolation='flat' if 'CONSTANT' in match[3] else 'noperspective' if 'LINEAR' in match[3] else 'smooth'
        records.append((int(match[2]),mask,interpolation))
    return 'generic-interpolation-v1:'+';'.join(f'g{i}/{m}/{p}' for i,m,p in sorted(records))

def workload():
    require(sha(BASELINE.read_bytes())==BASELINE_SHA and BASELINE.read_bytes()==subprocess.check_output(['git','show',f'{HELD_HEAD}:{BASELINE.relative_to(ROOT)}'],cwd=ROOT),'verified exact F3 baseline')
    with tarfile.open(BASELINE) as archive: held=json.loads(archive.extractfile('./native/native-report.json').read())
    report={};groups=[];fixture=json.loads(FIXTURE.read_bytes())
    require(fixture['schema']=='precise-word-cases-v1' and fixture['baselineSha256']==BASELINE_SHA,'authored exact word fixture schema')
    migration_specs={e['name']:e for e in fixture['migrationCandidates']}
    migration_inventory=[]
    for label,stem,count,pair_count in GROUPS:
        ck,pk=('cases','pairs') if label=='radial' else (label+'Cases',label+'Pairs')
        cases,pairs=copy.deepcopy(held[ck]),copy.deepcopy(held[pk])
        require((len(cases),len(pairs))==(count,pair_count),'complete retained F3 workload')
        report[label+'Cases'],report[label+'Pairs']=cases,pairs
        report[label+'Fixtures']=copy.deepcopy(held['fixtures' if label=='radial' else label+'Fixtures'])
        groups.append((label+'::',cases,pairs))
        for entry in cases:
            original_name=entry['name'] if label=='radial' else label+'::'+entry['name']
            if original_name in migration_specs:
                spec=migration_specs[original_name];require(entry['inputSha256']==spec['inputSha256'] and exact(entry['result'],spec['before']),'literal original rejected input/result')
                # Four still-unsupported cases also contain other unsupported
                # operations/authority. Their full previous rejection is held.
                if label=='raw':continue
                if label=='structured' and entry['name'].startswith('reject-'):
                    before={k:entry.pop(k) for k in ('result','resultBytes','resultSha256')}
                    entry['expected']={'errorCode':'parse-error'};entry['migrationBefore']=before
                    migration_inventory.append(dict(kind='rejection',name=label+'::'+entry['name'],inputSha256=entry['inputSha256'],before=before))
                    continue
                before={k:entry.pop(k) for k in ('result','resultBytes','resultSha256')}
                entry['ok']=True
                version=24 if label=='radial' else 19 if label in ('selected','structured') else 21 if label=='indirect' else 23 if label=='loop' else 17
                if label=='structured' and '-True-' in entry['name']:version=20
                count_match=re.search(r'DCL CONST\[0\.\.(\d+)\]',entry['text']);count=int(count_match[1])+1 if count_match else 0
                e={'profile':PROFILES[version],'constantCount':count,'preciseWordContract':{'kind':'tgsi-precise-word-local-v1','stage':entry['stage'],'operations':sorted(set(re.findall(r'\b(FSEQ|FSNE|MAX|MOV)_PRECISE\b',entry['text'])))}}
                stage=entry['stage'];bank=dict(stage=stage,slot=0,name=('vs' if stage=='vertex' else 'fs')+'const0',count=count)
                if version in (20,23,24):e['constantDomains']=[dict(bank,kind='constant-bank-finite-f32-v1')]
                if version==21:e['constantAccesses']=[dict(bank,kind='constant-bank-static-indirect-v1',indices=[0])]
                if version==23:
                    e['constantAccesses']=[dict(bank,kind='constant-bank-static-indirect-v1',indices=list(range(10,46)))]
                    e['constantConstraints']=[dict(bank,kind='constant-bank-counted-table-i32-v1',register=9,component=0,maximum=18)]
                if version==24:e['constantRadialDomains']=[dict(bank,kind='constant-bank-radial-coefficient-f32-v1',register=4,component=0,minimumMagnitude=0x3727c5ac)]
                entry.update(profile=e['profile'],expected=e,migrationBefore=before)
                migration_inventory.append(dict(kind='single',name=label+'::'+entry['name'],inputSha256=entry['inputSha256'],before=before))
        if label=='radial':
            for entry in pairs:
                if entry['name'].startswith('reject-precise-gated-'):
                    before={k:entry.pop(k) for k in ('result','resultBytes','resultSha256')}
                    entry.update(ok=True,expected={'interfaceKey':'generic-interpolation-v1:g0/15/flat'},migrationBefore=before)
                    migration_inventory.append(dict(kind='pair',name='radial::'+entry['name'],vertexSha256=entry['vertexSha256'],fragmentSha256=entry['fragmentSha256'],before=before))
    cases=[]
    for f in fixture['cases']:
        raw=f['text'].encode('ascii');require(0<len(raw)<=16385,'bounded authored input')
        e=dict(f,origin='shared',inputSha256=sha(raw),bytes=len(raw))
        if f['ok']:e['profile']=f['expected']['profile']
        cases.append(e)
    lookup={prefix+e['name']:e for prefix,entries,_ in groups for e in entries};lookup.update({e['name']:e for e in cases})
    rename=lambda name:name if '::' in name else 'radial::'+name
    pairs=[]
    for f in fixture['pairs']:
        vname=f['vertex'] if f['vertex'] in lookup else rename(f['vertex']);fname=f['fragment'] if f['fragment'] in lookup else rename(f['fragment'])
        v,p=lookup[vname],lookup[fname]
        pairs.append(dict(name=f['name'],vertexCaseName=vname,fragmentCaseName=fname,vertexSha256=v['inputSha256'],fragmentSha256=p['inputSha256'],ok=f['ok'],expected=({'interfaceKey':literal_interface(p['text'])} if f['ok'] else {'errorCode':p['expected']['errorCode'] if not p['ok'] else v['expected']['errorCode']})))
    report.update(cases=cases,pairs=pairs,originals=copy.deepcopy(held['originals']),fixtures=[describe(FIXTURE)],migrationInventory=migration_inventory,f3Baseline=describe(BASELINE),boundProof=copy.deepcopy(held['boundProof']))
    for key in ('indirectBaseline','structuredBaseline','constantBaseline','e9Baseline','f1Baseline','f2Baseline'):report[key]=copy.deepcopy(held[key])
    groups.append(('',cases,pairs))
    new=[f'profile-{profile}-{stage}' for profile in range(17,27) for stage in ('vertex','fragment')]
    report['recoverySingles']=[rename(n) for n in held['recoverySingles'][:34]]+new+[rename(n) for n in held['recoverySingles'][34:]]
    report['recoveryPairs']=[rename(n) for n in held['recoveryPairs']]+[n+'-mixed-pair' for n in new]
    report['truncationCases']=report['recoverySingles'][:2]+report['recoverySingles'][34:38]+['equality::alias-left-vertex','equality::alias-left-fragment']
    return report,groups


def reference(prefix,name): return name if '::' in name else prefix+name


def serialize(report, groups):
    cases = [(prefix + e['name'], e) for prefix, entries, _ in groups for e in entries]
    pairs = [(prefix + e['name'], prefix, e) for prefix, _, entries in groups for e in entries]
    indexes = {name: i for i, (name, _) in enumerate(cases)}
    pair_indexes = {name: i for i, (name, _, _) in enumerate(pairs)}
    require(len(indexes) == len(cases) <= 8192 and len(pair_indexes) == len(pairs) <= 512, 'unique bounded native inputs')
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
    stream += struct.pack('<58I', *[indexes[n] for n in report['recoverySingles']])
    stream += struct.pack('<56I', *[pair_indexes[n] for n in report['recoveryPairs']])
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
        if 'constantRadialDomains' in e: require(exact(metadata.get('constantRadialDomains'), e['constantRadialDomains']), 'exact radial coefficient domain')
        if 'preciseWordContract' in e:
            require(exact(metadata.get('preciseWordContract'),e['preciseWordContract']),'literal exact word contract')
            require(result['glsl'].count('/* TGSI PRECISE word-local */')==len(re.findall(r'\b(?:MOV|FSEQ|FSNE|MAX)_PRECISE\b',entry['text'])),'every retained instruction-local flag emitted')
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
    run = subprocess.run([str(binary)], input=stream, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=1200)
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
            m = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=59392 pair_recoveries=57344 passed', line)
            require(m is not None, 'only expected native diagnostics'); seeds.append(m[1])
    require(all(len(seen[k]) == len(v) for k, v in entries.items()) and seeds == SEEDS, 'complete native run')
    report['recordedMaxima'] = {'singleResultBytes': max(e['resultBytes'] for e in entries['ORIGINAL'] + entries['CASE']),
        'pairResultBytes': max(e['resultBytes'] for e in entries['PAIR']),
        'stageGlslBytes': max(len(stage['glsl'].encode()) for group in entries.values() for e in group if e['result']['ok']
           for stage in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    for source in report['sources'] + report['fixtures'] + [report['constantBaseline'],report['structuredBaseline'],report['indirectBaseline'],report['e9Baseline'],report['f1Baseline'],report['f2Baseline'],report['f3Baseline']] + [v for label, *_ in GROUPS for v in report[label+'Fixtures']]:
        require(describe(ROOT / source['path']) == source, 'source unchanged during recording')
    require(sha(binary.read_bytes()) == binary_sha, 'native artifact unchanged')
    report.update(schema='wasm-vm-precise-word-native-v1', status='passed', command=[str(binary)],
                  binarySha256=binary_sha, streamSha256=sha(stream), logSha256=sha(run.stdout), allocationFaults=faults,
                  seeds=SEEDS, mutationsPerSeed=1024, sanitizers=['address', 'undefined'], coverage=coverage(binary, args.output),
                  compatibility={'heldHead': HELD_HEAD, 'retainedCases': 4344, 'retainedPairs': 429,
                                 'singleMigrations': 20, 'rejectionMigrations': 2, 'pairMigrations': 2, 'predecessorFullGateClaimed': False})
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
    return {'schema': 'wasm-vm-precise-word-native-coverage-v1', 'sources': summaries, 'commands': commands,
            'nativeStack': {'boundary': 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
                            'files': stack_records},
            'tools': [{'path': str(path), 'sha256': sha(path.read_bytes()),
                       'version': subprocess.check_output([str(path), '--version'], text=True).strip()}
                      for path in (profdata, cov)],
            'records': [{'path': name, 'bytes': (output / name).stat().st_size,
                         'sha256': sha((output / name).read_bytes())} for name in names]}



if __name__ == "__main__": main()
