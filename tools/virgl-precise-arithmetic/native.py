#!/usr/bin/env python3
"""Record exact arithmetic and the complete verified raster-bank workload."""
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
HELD_HEAD = 'b5cfbb33c290f352437b00a2112500d68ee8ae87'
BASELINE = ROOT / 'evidence/virgl-raster-bank/worker.tar.gz'
BASELINE_SHA = '399b2eb6c745bc256a123debd9b5af236b355231accc7653ebf179c276040f42'
FIXTURE = ROOT / 'renderer/virgl-shader/tests/precise-arithmetic-cases.json'
PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 29)]
GROUPS = [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
          ('component', 'component-float', 574, 37), ('dot', 'dot-reciprocal', 616, 41), ('constant', 'constant-compiler', 452, 18), ('structured', 'structured-conditional', 315, 15), ('indirect', 'indirect-constant', 348, 16), ('loop','bounded-loop',198,12),('equality','raw-equality',140,34),('selected','selected-lanes',148,80),('radial','radial-domain',44,51),('precise','precise-word',84,82),('mask','ordered-mask',215,182),('raster','raster-bank',173,158)]
SEEDS = ['397b10e5', '86cd4391', 'c120ad73', '5e74bf09']
SOURCES = ['Makefile','renderer/virgl-shader/build.sh', 'renderer/virgl-shader/index.mjs',
           'renderer/virgl-shader/native_tests/raster_bank.c', 'renderer/virgl-shader/README.md',
           'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/verify_sources.py',
           'tools/virgl-raster-bank/native.py', 'tools/virgl-raster-bank/native_receipt.py',
           'tools/virgl-raster-bank/generate_cases.py', 'tools/verify-virgl-raster-bank.sh',
           'tools/virgl-precise-word/generate_cases.py','tools/virgl-precise-word/oracle.mjs',
           'tools/virgl-raster-bank/shared.py','tools/virgl-raster-bank/receipt.py','tools/virgl-raster-bank/wasm.mjs','tools/virgl-raster-bank/wasm_receipt.py','tools/virgl-raster-bank/browser.mjs','tools/virgl-raster-bank/oracle.mjs','tools/virgl-raster-bank/reference.mjs','tools/virgl-raster-bank/consumer.mjs','tools/virgl-raster-bank/faults.py','tools/virgl-raster-bank/cold.py',
           'renderer/virgl-command/tests/raster-bank.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','tools/lib/virgl-browser-runner.mjs','tools/virgl-radial-domain/oracle.mjs',
           'renderer/virgl-command/tests/ordered-mask-regressions.mjs','renderer/virgl-command/tests/precise-word-regressions.mjs','renderer/virgl-command/tests/radial-domain-regressions.mjs','renderer/virgl-shader/native_tests/precise_upstream_allocations.sh']
SOURCES += ['renderer/virgl-shader/native_tests/precise_arithmetic.c','renderer/virgl-command/tests/raster-bank-verifier-regressions.mjs','renderer/virgl-command/tests/precise-arithmetic.mjs','tools/verify-virgl-precise-arithmetic.sh'] + ['tools/virgl-precise-arithmetic/'+name for name in ('native.py','native_receipt.py','generate_cases.py','shared.py','receipt.py','wasm.mjs','wasm_receipt.py','browser.mjs','oracle.mjs','reference.mjs','consumer.mjs','faults.py','cold.py')]


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
    require(sha(BASELINE.read_bytes())==BASELINE_SHA and BASELINE.read_bytes()==subprocess.check_output(['git','show',f'{HELD_HEAD}:{BASELINE.relative_to(ROOT)}'],cwd=ROOT),'verified complete ordered-mask baseline')
    with tarfile.open(BASELINE) as archive: held=json.loads(archive.extractfile('native/native-report.json').read())
    fixture=json.loads(FIXTURE.read_bytes())
    require(fixture['schema']=='precise-arithmetic-cases-v1' and fixture['baselineSha256']==BASELINE_SHA,'literal raster copy fixture')
    migrations={e['name']:e for e in fixture['migrationCandidates']};pair_migrations={e['name']:e for e in fixture['pairMigrations']};report={};groups=[];inventory=[]
    for label,stem,count,pair_count in GROUPS:
        ck,pk=('cases','pairs') if label=='raster' else (label+'Cases',label+'Pairs')
        cases,pairs=copy.deepcopy(held[ck]),copy.deepcopy(held[pk])
        require((len(cases),len(pairs))==(count,pair_count),'complete retained predecessor group')
        report[label+'Cases'],report[label+'Pairs']=cases,pairs
        report[label+'Fixtures']=copy.deepcopy(held['fixtures' if label=='raster' else label+'Fixtures'])
        groups.append((label+'::',cases,pairs))
        for entry in cases:
            name=label+'::'+entry['name']
            if name not in migrations:continue
            spec=migrations[name]
            require(entry['inputSha256']==spec['inputSha256'] and exact({k:entry[k] for k in ('result','resultBytes','resultSha256')},spec['before']),'literal prior rejected copy bytes/result')
            before={k:entry.pop(k) for k in ('result','resultBytes','resultSha256')}
            entry.update(ok=True,expected=copy.deepcopy(spec['expected']),migrationBefore=before,profile=spec['expected']['profile'])
            inventory.append(dict(kind='single',name=name,inputSha256=entry['inputSha256'],before=before))
        for entry in pairs:
            name=label+'::'+entry['name']
            if name not in pair_migrations:continue
            spec=pair_migrations[name]
            require(exact({k:entry[k] for k in ('result','resultBytes','resultSha256')},spec['before']) and all(entry[k]==spec[k] for k in ('vertexSha256','fragmentSha256')),'literal prior rejected pair')
            before={k:entry.pop(k) for k in ('result','resultBytes','resultSha256')}
            entry.update(ok=True,migrationBefore=before)
            inventory.append(dict(kind='pair',name=name,before=before,vertexSha256=entry['vertexSha256'],fragmentSha256=entry['fragmentSha256']))
    cases=[]
    for f in fixture['cases']:
        raw=f['text'].encode('ascii');require(0<len(raw)<=16385,'bounded literal copy shader')
        e=dict(f,origin='shared',inputSha256=sha(raw),bytes=len(raw))
        if f['ok']:e['profile']=f['expected']['profile']
        cases.append(e)
    lookup={prefix+e['name']:e for prefix,entries,_ in groups for e in entries};lookup.update({e['name']:e for e in cases})
    for prefix,_,entries in groups:
        for e in entries:
            if prefix+e['name'] in pair_migrations:e['expected']={'interfaceKey':literal_interface(lookup[reference(prefix,e['fragmentCaseName'])]['text'])}
    pairs=[]
    for f in fixture['pairs']:
        v,p=lookup[f['vertex']],lookup[f['fragment']]
        pairs.append(dict(name=f['name'],vertexCaseName=f['vertex'],fragmentCaseName=f['fragment'],vertexSha256=v['inputSha256'],fragmentSha256=p['inputSha256'],ok=f['ok'],expected={'interfaceKey':literal_interface(p['text'])}))
    originals=copy.deepcopy(held['originals'])
    for spec in fixture['originalMigrations']:
        e=next(e for e in originals if e['path']==spec['path']);raw=(ROOT/e['path']).read_bytes()
        require(sha(raw)==spec['sha256']==e['sha256'] and exact({k:e[k] for k in ('result','resultBytes','resultSha256')},spec['before']),'unchanged captured gradient body/rejection')
        before={k:e.pop(k) for k in ('result','resultBytes','resultSha256')}
        e.update(ok=True,profile=spec['expected']['profile'],expected=spec['expected'],text=raw.decode('ascii'),migrationBefore=before)
        inventory.append(dict(kind='original',name=e['sha256'],path=e['path'],inputSha256=e['sha256'],before=before))
    report.update(cases=cases,pairs=pairs,originals=originals,fixtures=[describe(FIXTURE)],migrationInventory=inventory,rasterBaseline=describe(BASELINE),boundProof=copy.deepcopy(held['boundProof']))
    for key in ('indirectBaseline','structuredBaseline','constantBaseline','e9Baseline','f1Baseline','f2Baseline','f3Baseline','f4Baseline','maskBaseline'):report[key]=copy.deepcopy(held[key])
    groups.append(('',cases,pairs))
    report['recoverySingles']=[name if '::' in name else 'raster::'+name for name in held['recoverySingles']]+['arithmetic-add-xyzw-direct-vertex','arithmetic-add-xyzw-direct-fragment']
    report['recoveryPairs']=[name if '::' in name else 'raster::'+name for name in held['recoveryPairs']]+['arithmetic-add-xyzw-direct-vertex-pair','arithmetic-add-xyzw-direct-fragment-pair']
    report['truncationCases']=copy.deepcopy(held['truncationCases'])
    return report,groups


def reference(prefix,name): return name if '::' in name else prefix+name


def serialize(report, groups):
    cases = [(prefix + e['name'], e) for prefix, entries, _ in groups for e in entries]
    pairs = [(prefix + e['name'], prefix, e) for prefix, _, entries in groups for e in entries]
    indexes = {name: i for i, (name, _) in enumerate(cases)}
    pair_indexes = {name: i for i, (name, _, _) in enumerate(pairs)}
    require(len(indexes) == len(cases) <= 8192 and len(pair_indexes) == len(pairs) <= 2048, 'unique bounded native inputs')
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
    stream += struct.pack('<62I', *[indexes[n] for n in report['recoverySingles']])
    stream += struct.pack('<60I', *[pair_indexes[n] for n in report['recoveryPairs']])
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
        if 'preciseWordContract' in e or 'preciseArithmeticContract' in e:
            require(result['glsl'].count('/* TGSI PRECISE word-local */')==len(re.findall(r'\b(?:MOV|FSEQ|FSNE|MAX|ADD|MUL)_PRECISE\b',entry['text'])),'every instruction-local flag emitted')
        for key in ('rasterBaseProfile','constantRasterDomains','arithmeticBaseProfile','preciseArithmeticContract'):
            if key in e: require(exact(metadata.get(key),e[key]), 'literal copied-component obligation')
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
    seen = {k: set() for k in entries}; faults = []; seeds = []; upstream = []
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
        elif line.startswith('UPSTREAM '):
            _, index, raw = line.split(' ', 2); require(int(index) == len(upstream), 'ordered upstream allocation calibration'); upstream.append(json.loads(raw))
        elif line.startswith('LAYOUT '): report['layout'] = json.loads(line[7:])
        elif line.startswith('FLOW '): report['flow'] = json.loads(line[5:])
        elif line.startswith('STATS '): report['stats'] = json.loads(line[6:])
        else:
            m = re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=63488 pair_recoveries=61440 passed', line)
            require(m is not None, 'only expected native diagnostics'); seeds.append(m[1])
    require(all(len(seen[k]) == len(v) for k, v in entries.items()) and seeds == SEEDS, 'complete native run')
    report['recordedMaxima'] = {'singleResultBytes': max(e['resultBytes'] for e in entries['ORIGINAL'] + entries['CASE']),
        'pairResultBytes': max(e['resultBytes'] for e in entries['PAIR']),
        'stageGlslBytes': max(len(stage['glsl'].encode()) for group in entries.values() for e in group if e['result']['ok']
           for stage in ([e['result']['vertex'], e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    for source in report['sources'] + report['fixtures'] + [report['constantBaseline'],report['structuredBaseline'],report['indirectBaseline'],report['e9Baseline'],report['f1Baseline'],report['f2Baseline'],report['f3Baseline'],report['f4Baseline'],report['maskBaseline'],report['rasterBaseline']] + [v for label, *_ in GROUPS for v in report[label+'Fixtures']]:
        require(describe(ROOT / source['path']) == source, 'source unchanged during recording')
    require(sha(binary.read_bytes()) == binary_sha, 'native artifact unchanged')
    report.update(schema='wasm-vm-precise-arithmetic-native-v1', status='passed', command=[str(binary)],
                  binarySha256=binary_sha, streamSha256=sha(stream), logSha256=sha(run.stdout), allocationFaults=faults,
                  upstreamCalibrations=upstream, seeds=SEEDS, mutationsPerSeed=1024, sanitizers=['address', 'undefined'], coverage=coverage(binary, args.output),
                  compatibility={'heldHead': HELD_HEAD, 'retainedCases':4816, 'retainedPairs':851, 'singleMigrations':10, 'pairMigrations':4, 'originalMigrations':1, 'predecessorFullGateClaimed':False})
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
    paths = [ROOT / 'renderer/virgl-shader/bridge.c', ROOT / 'renderer/virgl-shader/raw_bits.c', ROOT / 'renderer/virgl-shader/checked_upstream.c']
    arguments = [str(binary), '-instr-profile=' + str(profile), *map(str, paths)]
    exported = json.loads(record([str(cov), 'export', *arguments], 'coverage.json'))
    record([str(cov), 'report', *arguments], 'coverage-report.txt')
    record([str(cov), 'show', *arguments, '-show-line-counts-or-regions', '-show-branches=count'], 'coverage-show.txt')
    require(exported['type'] == 'llvm.coverage.json.export' and len(exported['data']) == 1,
            'one complete LLVM coverage export')
    files = exported['data'][0]['files']
    require({Path(entry['filename']).resolve() for entry in files} == {path.resolve() for path in paths},
            'coverage binds exactly the three changed C implementation files')
    summaries = []
    for entry in files:
        path = Path(entry['filename']).resolve()
        require(entry['segments'] and entry['summary']['lines']['covered'] > 0, 'real native execution counters')
        summaries.append({**describe(path), 'summary': entry['summary']})
    names = ['native.profraw', 'native.profdata', 'coverage-merge.log', 'coverage.json',
             'coverage-report.txt', 'coverage-show.txt']
    stack_records = []
    for filename in ('bridge.su', 'raw_bits.su', 'checked_upstream.su'):
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
    return {'schema': 'wasm-vm-precise-arithmetic-native-coverage-v1', 'sources': summaries, 'commands': commands,
            'nativeStack': {'boundary': 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
                            'files': stack_records},
            'tools': [{'path': str(path), 'sha256': sha(path.read_bytes()),
                       'version': subprocess.check_output([str(path), '--version'], text=True).strip()}
                      for path in (profdata, cov)],
            'records': [{'path': name, 'bytes': (output / name).stat().st_size,
                         'sha256': sha((output / name).read_bytes())} for name in names]}



if __name__ == "__main__": main()
