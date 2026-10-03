#!/usr/bin/env python3
"""Independently reconstruct the complete native input stream and recorded results."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shader_compat import retained
HELD_HEAD = '26ed74a31e0ee3c1d43b4e174c8096d67898d920'
PROFILES = ['virgl-webgl2-straight-line-v5'] + [f'virgl-webgl2-raw-bits-v{i}' for i in range(1, 10)]
GROUPS = [('raw', 'raw-bit', 279, 22), ('integer', 'integer-mask', 426, 25),
          ('float', 'float-mask', 454, 45), ('numeric', 'numeric-float', 350, 33),
          ('component', 'component-float', 574, 37), ('dot', 'dot-reciprocal', 616, 41), ('constant', 'constant-compiler', 452, 18)]
SEEDS = ['6bd2c931', 'f1037a85', '2e849d67', 'a75c1b09']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result


old = module('constant_native_dot', 'tools/virgl-dot-reciprocals/native_receipt.py')
base = old.base
require, sha, read, binding, git = base.require, base.sha, base.read, base.binding, base.git
verify_source, verify_records = base.verify_source, base.verify_records


def result_stage(result, stage, profile):
    old.result_stage(result, stage, profile)
    metadata = result['metadata']
    keys = {'profile', 'stage', 'inputs', 'outputs', 'attributes', 'uniforms', 'samplers', 'uniformBlocks'}
    if profile in (PROFILES[7], PROFILES[9]):
        require(set(metadata) == keys | {'constantDomains'} and len(metadata['uniforms']) == 1,
                'one exact conditional metadata shape and bank')
        uniform = metadata['uniforms'][0]
        require(metadata['constantDomains'] == [{'kind': 'constant-bank-finite-f32-v1', 'stage': stage, 'slot': 0,
                'name': ('vs' if stage == 'vertex' else 'fs') + 'const0', 'count': uniform['count']}],
                'compiler-derived domain equals actual declared stage bank')
    else:
        require(set(metadata) == keys, 'ordinary profiles have no conditional domain')


def new_workload(cases, pairs, fixtures, hardware, all_cases):
    authored = [dict(f, origin='shared') for f in fixtures]
    authored += [dict(f, origin='hardware', ok=True) for f in hardware['shaders']]
    authored += [dict(f, origin='hardware-negative', ok=False, expected={'errorCode': 'unsupported-feature'}) for f in hardware['negativeCases']]
    require(len(cases) == len(authored) and len({e['name'] for e in cases}) == len(cases), 'all authored inputs exactly once')
    for entry, fixture in zip(cases, authored):
        raw = fixture['text'].encode('ascii'); profile = fixture['expected'].get('profile')
        fields = {k: fixture[k] for k in ('name', 'stage', 'text', 'ok', 'expected', 'origin')}
        fields.update(inputSha256=sha(raw), bytes=len(raw))
        if profile: fields['profile'] = profile
        require({k:v for k,v in entry.items() if k not in ('result', 'resultBytes', 'resultSha256')} == fields, 'full exact authored case input/outcome')
        result = entry['result']; require(result['ok'] is fixture['ok'], 'literal acceptance')
        if fixture['ok']:
            require(set(result) == {'ok', 'glsl', 'metadata'} and profile in PROFILES, 'exact success fields/profile')
            result_stage({k:result[k] for k in ('glsl','metadata')}, entry['stage'], profile)
            expected = fixture['expected']
            require(set(expected) == {'profile', 'constantCount', 'constantDomains'}, 'literal bounded fixture expectations')
            require(result['metadata'].get('constantDomains') == expected['constantDomains'], 'literal stage domain')
            uniforms = result['metadata']['uniforms']; count = expected['constantCount']
            require((len(uniforms) == 1 and uniforms[0]['count'] == count) if count else uniforms == [], 'literal declaration extent')
            tex = re.findall(r'^\s*(?:\d+:\s*)?TEX[^\n]*SAMP\[(\d+)\]', fixture['text'], re.M)
            require(result['metadata']['samplers'] == [{'index':int(i),'name':f'fssamp{i}','type':'sampler2D'} for i in sorted(set(tex),key=int)], 'sampler metadata from actual source uses')
            if profile in (PROFILES[7], PROFILES[9]): require(len(re.findall(r'\btexture\s*\(',result['glsl'])) == len(tex), 'one actual sample per TEX')
        else:
            require(result == {'ok':False,'error':{'code':fixture['expected']['errorCode'],
                    'message':'TGSI is malformed or outside the documented straight-line profile.'}}, 'complete exact rollback error')
    expected_pairs = [{'name':p['name'],'vertex':p['vertex'],'fragment':p['fragment'],'ok':True,'expected':{'interfaceKey':p['interfaceKey']}} for p in hardware['pairs']]
    for stage in ('vertex','fragment'):
        for code in ('parse-error','unsupported-feature'):
            target = next(f['name'] for f in fixtures if f['stage']==stage and not f['ok'] and f['expected']=={'errorCode':code})
            v,f = 'pass-vertex','pass-fragment'
            if stage=='vertex':v=target
            else:f=target
            expected_pairs.append({'name':f'rejected-{stage}-{code}-pair','vertex':v,'fragment':f,'ok':False,'expected':{'errorCode':code}})
    expected_pairs += [
        {'name':'conditional-then-fragment-parse-error','vertex':'coupled-vertex','fragment':'reject-wrong-prefix-fragment','ok':False,'expected':{'errorCode':'unsupported-feature'}},
        {'name':'conditional-incompatible-interface','vertex':'coupled-vertex','fragment':'constant::numeric-ADD-source0-c0-negate-fragment','ok':False,'expected':{'errorCode':'unsupported-feature'}},
        {'name':'conditional-legacy-vertex-pair','vertex':'coupled-vertex','fragment':'pass-fragment','ok':True,'expected':{'interfaceKey':'generic-interpolation-v1:g0/15/flat'}},
        {'name':'legacy-conditional-fragment-pair','vertex':'pass-vertex','fragment':'coupled-fragment','ok':True,'expected':{'interfaceKey':'generic-interpolation-v1:g0/15/flat;g1/15/flat;g2/15/flat'}},
    ]
    require(len(pairs)==len(expected_pairs), 'complete authored pair set')
    for entry, fixture in zip(pairs,expected_pairs):
        v,f = all_cases[fixture['vertex']],all_cases[fixture['fragment']]
        expected = {'name':fixture['name'],'vertexCaseName':v['name'] if '::' not in fixture['vertex'] else fixture['vertex'],
                    'fragmentCaseName':f['name'] if '::' not in fixture['fragment'] else fixture['fragment'],
                    'vertexSha256':v['inputSha256'],'fragmentSha256':f['inputSha256'],'ok':fixture['ok'],'expected':fixture['expected']}
        require({k:x for k,x in entry.items() if k not in ('result','resultBytes','resultSha256')}==expected,'full authored pair identity')
        result=entry['result'];require(result['ok'] is fixture['ok'],'literal pair outcome')
        if result['ok']:
            require(set(result)=={'ok','vertex','fragment','interfaceKey'} and result['interfaceKey']==fixture['expected']['interfaceKey'],'exact linked interface')
            for stage,single in [('vertex',v),('fragment',f)]:
                result_stage(result[stage],stage,single['profile'])
                require(result[stage]['metadata'].get('constantDomains')==single['result']['metadata'].get('constantDomains'),'single/pair domain equality')
            require(result['fragment']=={k:f['result'][k] for k in ('glsl','metadata')},'exact standalone fragment')
        else: require(result=={'ok':False,'error':{'code':fixture['expected']['errorCode'],'message':'TGSI is malformed or outside the documented straight-line profile.'}},'pair transaction original error')
    return {c['name']:c for c in cases},{p['name']:p for p in pairs}


def source_bindings(native):
    return native['sources'] + native['fixtures'] + native['originals'] + [native['constantBaseline']] + [e for label,*_ in GROUPS for e in native[label+'Fixtures']]


def verify_recording(output):
    directory=Path(output);directory=directory if (directory/'native-report.json').is_file() else directory/'native'
    native=read(directory/'native-report.json')
    require(native['schema']=='wasm-vm-structured-conditionals-native-v1' and native['status']=='passed','native schema/outcome')
    require(native['sanitizers']==['address','undefined'] and native['seeds']==SEEDS and native['mutationsPerSeed']==1024,'actual varied sanitizer workload')
    held,_=retained(native)
    require(native['compatibility']=={'heldHead':HELD_HEAD,'retainedCases':3151,'retainedPairs':221,'migrations':0,'predecessorFullGateClaimed':False},'complete unchanged retained boundary')
    require(native['constantBaseline']==binding(ROOT/'evidence/virgl-constant-compiler/cold-clone/acceptance/native/native-report.json'),'verified baseline binding')
    groups=[];all_cases={}
    for label,stem,count,pair_count in GROUPS:
        require(len(native[label+'Cases'])==count and len(native[label+'Pairs'])==pair_count,'complete retained cardinalities')
        groups.append((label+'::',native[label+'Cases'],native[label+'Pairs']))
        all_cases.update({label+'::'+e['name']:e for e in native[label+'Cases']})
    identities=[binding(ROOT/'renderer/virgl-shader/tests/structured-conditional-cases.json'),binding(ROOT/'renderer/virgl-command/tests/structured-conditionals-shaders.json')]
    require(native['fixtures']==identities,'new authored source bindings')
    fixtures,hardware=[read(ROOT/e['path']) for e in identities]
    all_cases.update({e['name']:e for e in native['cases']})
    cases,pairs=new_workload(native['cases'],native['pairs'],fixtures,hardware,all_cases)
    groups.append(('',native['cases'],native['pairs']))
    for entry in source_bindings(native):
        require({k:entry[k] for k in ('path','bytes','sha256')}==binding(ROOT/entry['path']),'current source identity')
    expected_sources={str(p.relative_to(ROOT)) for pattern in ('*.c','*.h') for p in (ROOT/'renderer/virgl-shader').glob(pattern)}|{
        'renderer/virgl-shader/build.sh','renderer/virgl-shader/index.mjs','renderer/virgl-shader/native_tests/structured_conditionals.c',
        'renderer/virgl-shader/README.md','renderer/virgl-shader/UPSTREAM.json','renderer/virgl-shader/verify_sources.py',
        'tools/virgl-structured-conditionals/native.py','tools/virgl-structured-conditionals/native_receipt.py','tools/virgl-structured-conditionals/generate_cases.py'}
    require(len(native['sources'])==len(expected_sources) and {e['path'] for e in native['sources']}==expected_sources,'complete owned source inventory')
    binary=ROOT/'renderer/virgl-shader/build/structured-conditional-sanitize/structured-conditional-test'
    require(native['command']==[str(binary)] and native['binarySha256']==sha(binary.read_bytes()),'actual sanitizer artifact')
    flat_cases=[(prefix+e['name'],e) for prefix,entries,_ in groups for e in entries]
    flat_pairs=[(prefix+e['name'],prefix,e) for prefix,_,entries in groups for e in entries]
    index={name:i for i,(name,_) in enumerate(flat_cases)};pair_index={name:i for i,(name,_,_) in enumerate(flat_pairs)}
    require(len(index)==len(flat_cases)<=4096 and len(pair_index)==len(flat_pairs)<=320,'unique bounded workload')
    singles=[n if '::' in n else 'constant::'+n for n in held['recoverySingles']]+['mov-color-vertex','mov-color-fragment','coupled-vertex','coupled-fragment']
    pair_names=[n if '::' in n else 'constant::'+n for n in held['recoveryPairs']]+['mov-color-vertex-pair','mov-color-fragment-pair','conditional-legacy-vertex-pair','legacy-conditional-fragment-pair']
    require(native['recoverySingles']==singles and len(singles)==20 and native['recoveryPairs']==pair_names and len(pair_names)==18,'complete recovery identities')
    anchors=[all_cases[n] for n in singles]
    require([(e['stage'],e['profile']) for e in anchors]==[(stage,profile) for profile in PROFILES for stage in ('vertex','fragment')],'every profile/stage recovery')
    stream=bytearray(b'VGS9'+struct.pack('<I',19))
    for e in native['originals']:
        raw=(ROOT/e['path']).read_bytes();stream+=struct.pack('<III',int(e['stage']=='fragment'),int(e['ok']),len(raw))+raw
    stream+=struct.pack('<I',len(flat_cases))
    for name,e in flat_cases:
        raw,name=e['text'].encode('ascii'),name.encode('ascii');profile=PROFILES.index(e['profile']) if e.get('profile') else 0
        stream+=struct.pack('<IIIII',int(e['stage']=='fragment'),int(e['ok']),profile,len(name),len(raw))+name+raw
    stream+=struct.pack('<I',len(flat_pairs))
    for name,prefix,e in flat_pairs:
        name=name.encode('ascii');stream+=struct.pack('<IIII',index[e['vertexCaseName'] if '::' in e['vertexCaseName'] else prefix+e['vertexCaseName']],index[e['fragmentCaseName'] if '::' in e['fragmentCaseName'] else prefix+e['fragmentCaseName']],int(e['ok']),len(name))+name
    stream+=struct.pack('<20I',*[index[n] for n in singles])+struct.pack('<18I',*[pair_index[n] for n in pair_names])
    require(bytes(stream)==(directory/'native-input.bin').read_bytes() and native['streamSha256']==sha(stream),'every input stream byte independently reconstructed')
    transcript={'ORIGINAL':native['originals'],'PAIR':[e for _,_,e in flat_pairs],'CASE':[e for _,e in flat_cases]}
    log=(directory/'native.log').read_bytes();require(sha(log)==native['logSha256'],'complete transcript digest')
    order=[];observed={};faults=[];seeds=[]
    for line in log.decode('ascii').splitlines():
        m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)',line)
        if m:
            kind,i,raw=m[1],int(m[2]),m[3].encode('ascii');require(i<len(transcript[kind]),'bounded transcript index');e=transcript[kind][i]
            require((json.loads(raw),len(raw),sha(raw))==(e['result'],e['resultBytes'],e['resultSha256']),'actual serialized result exact')
            order.append((kind,i))
        elif line.startswith('FAULT '):
            _,i,raw=line.split(' ',2);require(int(i)==len(faults),'allocation fault order');faults.append(json.loads(raw))
        elif line.startswith(('LAYOUT ','STATS ','FLOW ')):
            kind,raw=line.split(' ',1);require(kind not in observed,'single layout/stats');observed[kind]=json.loads(raw)
        else:
            m=re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=20480 pair_recoveries=18432 passed',line)
            require(m is not None,'only complete mutation diagnostics');seeds.append(m[1])
    require(order==[(kind,i) for kind in transcript for i in range(len(transcript[kind]))] and seeds==SEEDS,'full ordered actual transcript')
    expected_faults=[]
    ir,arena,glsl=26232,52516,65537
    for profile,stage,site in [(profile,stage,site) for profile in (8,9) for stage in range(2) for site in range(1,4 if profile==8 else 6)]:
        sizes=[ir,arena,glsl] if profile==8 else [ir,arena,ir,arena,glsl]
        message=('Raw IR allocation failed.' if site==1 else 'Structured flow allocation failed.' if site==2 else
                 'Raw GLSL allocation or output bound failed.' if profile==8 else 'TGSI is malformed or outside the documented straight-line profile.')
        expected_faults.append({'kind':'single','profile':profile,'stage':stage,'failAt':site,'attempts':site,'requestedBytes':sizes[site-1],
           'result':{'ok':False,'error':{'code':'unsupported-feature' if profile==9 and site>2 else 'translation-error','message':message}}})
    for site,size in enumerate([ir,arena,ir,arena,ir,arena,ir,arena,glsl,glsl],1):
        expected_faults.append({'kind':'pair','failAt':site,'attempts':site,'requestedBytes':size,'result':{'ok':False,'error':{
          'code':'translation-error' if site<=2 else 'unsupported-feature','message':'Raw IR allocation failed.' if site==1 else
          'Structured flow allocation failed.' if site==2 else 'TGSI is malformed or outside the documented straight-line profile.'}}})
    require(faults==native['allocationFaults']==expected_faults,'all twenty-six actual allocations and public transaction errors')
    require(observed=={'LAYOUT':native['layout'],'STATS':native['stats'],'FLOW':native['flow']} and native['layout']==held['layout'],'actual compact layouts unchanged')
    require(native['flow']=={'arenaBytes':arena,'arenaBoundBytes':53248,'depthLimit':8},'actual bounded snapshot arena allocation')
    expected_truncations=singles+['nested-full-labels-vertex','nested-full-labels-fragment','depth-8-vertex','depth-8-fragment']
    require(native['truncationCases']==expected_truncations,'all profile, labelled and maximal-depth truncation bodies')
    truncations=sum(all_cases[name]['bytes'] for name in expected_truncations);attacks=len(flat_cases)+truncations+324+4096+26
    stats={'originals':19,'acceptedOriginals':12,'cases':len(flat_cases),'pairs':len(flat_pairs),
           'calls':19+len(flat_pairs)+20+attacks*39,'standaloneRecoveries':attacks*20,'pairRecoveries':attacks*18,
           'truncations':truncations,'hostileCases':324,'mutations':4096,'allocationFaults':26}
    require(set(native['stats'])==set(stats)|{'maxSingleResultBytes','maxPairResultBytes'} and all(native['stats'][k]==v for k,v in stats.items()),'derived execution and recovery accounting')
    every=transcript['ORIGINAL']+transcript['CASE'];pair_entries=transcript['PAIR']
    maxima={'singleResultBytes':max(e['resultBytes'] for e in every),'pairResultBytes':max(e['resultBytes'] for e in pair_entries),
      'stageGlslBytes':max(len(s['glsl'].encode()) for e in every+pair_entries if e['result']['ok'] for s in ([e['result']['vertex'],e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
    require(native['recordedMaxima']==maxima and maxima['singleResultBytes']<=native['stats']['maxSingleResultBytes']<147456 and maxima['pairResultBytes']<=native['stats']['maxPairResultBytes']<295936 and maxima['stageGlslBytes']<=65536,'actual serialization bounds')
    verify_records(directory,native['coverage'])
    return native,fixtures,hardware,cases,pairs,{e['sha256']:e for e in native['originals']}


def verify_native(output,head):
    result=verify_recording(output);native=result[0]
    for entry in source_bindings(native):verify_source(entry,head)
    directory=Path(output);directory=directory if (directory/'native-report.json').is_file() else directory/'native'
    verify_coverage(native,directory,head)
    return result


def verify(directory,head): return verify_native(directory,head)[0]


def stages_by_sha(native):
    result={}
    for key in [label+'Cases' for label,*_ in GROUPS]+['cases']:
        for entry in native[key]:
            digest=entry['inputSha256'];require(digest not in result or result[digest]['result']==entry['result'],'same body same full result');result[digest]=entry
    return result


def pairs_by_sha(native):
    result={}
    for key in [label+'Pairs' for label,*_ in GROUPS]+['pairs']:
        for entry in native[key]:
            digest=(entry['vertexSha256'],entry['fragmentSha256']);require(digest not in result or result[digest]['result']==entry['result'],'same pair same full result');result[digest]=entry
    return result


def verify_coverage(native, directory, head):
    coverage = native['coverage']
    require(coverage['schema'] == 'wasm-vm-structured-conditionals-native-coverage-v1', 'native execution counter schema')
    verify_records(directory, coverage)
    for source in coverage['sources']:
        verify_source(source, head)
    expected = {'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c'}
    require({entry['path'] for entry in coverage['sources']} == expected, 'both changed C files recorded')
    exported = read(directory / 'coverage.json')
    require(exported['type'] == 'llvm.coverage.json.export' and len(exported['data']) == 1,
            'complete LLVM coverage export')
    files = exported['data'][0]['files']
    require({str(Path(item['filename']).resolve().relative_to(ROOT)) for item in files} == expected,
            'LLVM counters cover exact bound implementations')
    recorded = {item['path']: item for item in coverage['sources']}
    for item in files:
        path = str(Path(item['filename']).resolve().relative_to(ROOT))
        require(item['summary'] == recorded[path]['summary'] and item['segments'] and
                item['summary']['lines']['covered'] > 0, 'recorded source counters and summary agree')
    for tool in coverage['tools']:
        require(sha(Path(tool['path']).read_bytes()) == tool['sha256'] and tool['version'], 'coverage tool identity')
    stack = coverage['nativeStack']
    require(stack['boundary'] == 'Instrumented native per-function observations only; dynamic sanitizer frames do not establish total or Wasm stack usage.',
            'native stack measurements cannot claim Wasm or total stack')
    require([item['path'] for item in stack['files']] == ['bridge.su', 'raw_bits.su'], 'both compiler stack observations')
    for record in stack['files']:
        decoded = []
        for line in (directory / record['path']).read_text().splitlines():
            function, size, kind = line.split('\t')
            require(size.isdecimal() and kind in ('static', 'dynamic', 'dynamic,bounded'), 'literal stack record')
            decoded.append({'function': function, 'bytes': int(size), 'kind': kind})
        require(decoded == record['functions'] and record['source'] == 'renderer/virgl-shader/' + record['path'][:-3] + '.c',
                'compiler stack transcript exactly represented')

