#!/usr/bin/env python3
"""Authenticate frozen packed inputs, original hardware custody and retained gates."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = '23bf410f9e152d53e83e674717c647a4164dcde7'
TASK = 'E6-T11d15'

def need(value, why):
    if not value:
        raise ValueError(why)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

def main(directory):
    directory = Path(directory).resolve()
    head = git('rev-parse', 'HEAD')
    need(not git('diff', '--name-only', 'HEAD'), 'freeze tracked source before recording')
    files, sources, generated = {}, {}, {}
    def record(name, digest=None):
        raw = (directory/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'record drift ' + name)
        files[name] = sha(raw)
        return raw
    def source(name, digest=None):
        raw = (ROOT/name).read_bytes()
        need(digest is None or sha(raw) == digest, 'source drift ' + name)
        if '/build/' in name or name.startswith('target/'):
            generated[name] = sha(raw)
        else:
            need(raw == subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT), 'unfrozen source '+name)
            sources[name] = sha(raw)
    for _ in range(500):
        if b'\nSTANDARD_PACKED_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('recording log incomplete')
    def physical(name, task, frames, fault=False, typed=False, formats=False):
        report = json.loads(record(name+'/report.json'))
        need(report['gitHead'] == head and report['task'] == task, 'physical head/task '+name)
        need(report['status'] == ('failed' if fault else 'passed'), 'physical status '+name)
        memory = dict(bytes=16777216, stageExport='function', pairExport='function')
        if typed:
            memory['typedPairExport'] = 'function'
        if formats:
            memory['vertexFormatsExport'] = 'function'
        need(report['fixedMemory'] == memory, 'fixed actual compiler '+name)
        need(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors '+name)
        browser = report['browser']
        need(not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'hardware headed WebGL2 '+name)
        need(not any(any(w in a.lower() for w in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or a.startswith('--disable-gpu') for a in browser['commandLine']), 'software flags')
        served = {r['path']: r['sha256'] for r in report['servedFiles']}
        mutation = report.get('mutation')
        for row in report['sources']:
            source(row['path'], row['sha256'])
            if '/'+row['path'] in served:
                digest = mutation['servedSha256'] if mutation and row['path'] == mutation['path'] else row['sha256']
                need(served['/'+row['path']] == digest, 'served custody '+row['path'])
        for key in ['screenshot', 'browserCoverage']:
            record(name+'/'+report[key]['path'], report[key]['sha256'])
        coverage = json.loads(record(name+'/'+report['browserCoverage']['path']))
        need({'renderer/virgl-command/'+n+'.mjs' for n in ['state','decoder','resources','cache','constant-domain']} <= {r['source'] for r in coverage['scripts']}, 'runtime coverage closure')
        for row in coverage['scripts']:
            need(row['sha256'] == served['/'+row['source']], 'coverage source custody')
        result = report['partial'] if fault else report['browserResult']['result']
        need(len(result['frames']) == frames, 'complete native frames '+name)
        need(not result['guestExecution'] and not result['productionNegotiation'], 'isolated authority '+name)
        for blob in result['blobs']:
            packed = record(name+'/'+blob['path'], blob['gzipSha256'])
            raw = gzip.decompress(packed)
            need(len(raw) == blob['bytes'] and sha(raw) == blob['sha256'], 'native blob custody')
        for frame in result['frames']:
            need(frame['history'][-1]['result']['gpuComplete'] and frame['native']['calls'], 'native draw/fence')
            need(frame['audit']['held'] != fault, 'original full pixel verdict')
        if fault:
            need(mutation and mutation['path'] in ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/decoder.mjs'], 'actual source sabotage')
            raw = record(name+'/mutation-source.mjs', mutation['servedSha256'])
            original = (ROOT/mutation['path']).read_bytes()
            needle, replacement = mutation['needle'].encode(), mutation['replacement'].encode()
            need(original.count(needle) == 1 and raw == original.replace(needle, replacement), 'exact source fault')
            need('independent original compact pixels' in report['browserResult']['error']['message'], 'fault failed pixels after native completion')
        return result
    wire = json.loads(record('wire/report.json'))
    need(wire['status'] == 'passed' and wire['gitHead'] == head and wire['task'] == TASK, 'wire exact source head')
    need(wire['wire']['status'] == 'passed' and len(wire['wire']['records']) == 59 and wire['wire']['legacy']['status'] == 'passed', 'literal packed wire/extents matrix')
    for row in wire['sources']:
        source(row['path'], row['sha256'])
    own = physical('hardware', TASK, 214, typed=True, formats=True)
    for fault in ['native-normalize', 'constant-field', 'shader-sign']:
        physical('fault-'+fault, TASK, 1, True, typed=True, formats=True)
    need(len(own['suspensions']) == 6 and len(own['ownership']) == 3 and len(own['rejections']) == 15, 'packed bounded ownership/lifetime matrix')
    for run in own['runs']:
        need(all(run['inspection']['jobs'][key] == 0 for key in ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes']), 'packed tickets retired')
    for family, task, frames, faults in [
        ('compact', 'E6-T11d12', 225, ['native-normalize','constant-unpack']),
        ('scalar', 'E6-T11d13', 391, ['native-signedness','constant-scaled']),
        ('integer', 'E6-T11d14', 348, ['native-signedness','constant-word','shader-conversion'])
    ]:
        physical('retained-'+family+'/hardware', task, frames, typed=family=='integer')
        for fault in faults:
            physical('retained-'+family+'/fault-'+fault, task, 1, True, typed=family=='integer')
        audit = json.loads(record('retained-'+family+'/physical-audit.json'))
        need(audit['status'] == 'passed' and len(audit['frames']) == frames and len(audit['faults']) == len(faults), 'retained original '+family+' independent pixels')
    audit = json.loads(record('physical-audit.json'))
    need(audit['status'] == 'passed' and len(audit['frames']) == audit['nativeDraws'] == 214 and len(audit['faults']) == 3 and audit['nanPixels'] == 0, 'full packed original pixels')
    abi = record('abi/packed-native.json')
    need(abi == record('abi/packed-sanitize.json') and json.loads(abi) == {'status':'pinned-header','formats':[8,123,172,173],'components':4,'elementBytes':4}, 'original packed wire/header ABI')
    need(not git('diff','--name-only',PREDECESSOR,head,'--','crates','web','tools/guest'), 'unqualified guest/production boundary unchanged')
    carried = {}
    for family in ['draw','constant','topology','restart','assembly','points','compact','scalar','integer']:
        for name in git('ls-files','evidence/virgl-standard-'+family+'/worker/*','evidence/virgl-standard-'+family+'/verifier/*').splitlines():
            source(name)
            need((ROOT/name).read_bytes() == subprocess.check_output(['git','show',PREDECESSOR+':'+name],cwd=ROOT), 'historical HELD evidence changed')
            carried[name] = sources[name]
    need(record('native/native.jsonl') == record('native/sanitize.jsonl'), 'packed sanitized native equality')
    for directory_name, count in [('native',59), ('typed-retained',48)]:
        node = json.loads(record(directory_name+'/node.json'))
        need(node['status'] == 'passed' and node['cases'] == count and node['exactNativeWasm'] and node['peerIsolation'] and node['getters'] == 0 and node['pressure']['bytes'] == 16777216 and node['pressure']['recovered'], 'actual C/Wasm/API/OOM '+directory_name)
        rows = [json.loads(row) for row in record(directory_name+'/allocations.jsonl').splitlines()]
        summary = rows[-1]
        need(summary['faults'] == summary['recoveries'] == 40 and summary['callerMutation'] and not summary['partialResults'], 'all actual allocation faults '+directory_name)
    need(record('typed-retained/native.jsonl') == record('typed-retained/sanitize.jsonl'), 'retained typed sanitized equality')
    retained = json.loads(record('compiler-retained/receipt.json'))
    need(retained['status'] == 'passed' and retained['gitHead'] == head and retained['cases'] == 669 and retained['frames'] == 129 and retained['legacyBoundary']['unchanged'], 'full prescribed changed compiler gate')
    for name, digest in retained['sources'].items():
        source(name,digest)
    for name, digest in retained['generated'].items():
        source(name,digest)
    # Its tee can append success after hashing. The outer seal owns the finished log.
    for name, digest in retained['files'].items():
        if name != 'acceptance.log':
            record('compiler-retained/'+name,digest)
    stack_frames = {}
    for file in (directory/'compiler-retained/stack').glob('*.su'):
        for line in file.read_text().splitlines():
            fields=line.split('\t');stack_frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
    stack_names=['bridge_translate_standard_pair_vertex_formats','standard_pair','standard_convert','vrend_convert_shader','standard_emit']
    need(all(name in stack_frames for name in stack_names), 'actual packed Wasm call stack frames')
    packed_stack={name:stack_frames[name] for name in stack_names}
    packed_stack['conservativeBytes']=sum(packed_stack.values())
    need(packed_stack['conservativeBytes']<262144, 'packed compiler fits fixed Wasm stack')
    source('tasks/epic-6-transcendence/E6-T11d15-standard-packed-vertex-fetch.md')
    for family in ['packed','integer']:
        for mode in [family+'-native/standard-'+family+'-test', family+'-sanitize/standard-'+family+'-test', family+'-allocation-sanitize/standard-'+family+'-allocation-test']:
            source('renderer/virgl-shader/build/standard-'+mode)
    for name in git('ls-files','renderer/virgl-shader','renderer/virgl-command','tools/verify-virgl-standard-*','tools/virgl-command/standard-*','Makefile').splitlines():
        source(name)
    coverage = json.loads(record('coverage-audit.json'))
    need(coverage['gitHead'] == head and coverage['predecessor'] == PREDECESSOR and coverage['fullRegionsRemainAuthority'] and coverage['llvm'], 'affected C/JS diff coverage')
    for path in directory.rglob('*'):
        if path.is_file() and path.name != 'receipt.json':
            record(path.relative_to(directory).as_posix())
    receipt = dict(schema='standard-packed-fetch-receipt-v1',task=TASK,status='passed',gitHead=head,frames=214,
                   checkedPhysicalPixels=audit['pixels'],nativeDraws=audit['nativeDraws'],normalizedBuffers=audit['normalizedBuffers'],
                   nanCategoryPixels=0,portableNaNPayload=False,guestExecution=False,productionNegotiation=False,
                   authority='isolated-standard-packed-floating-fetch',productionDrawAuthority=False,
                   packedCompilerStack=packed_stack,historicalEvidenceHead=PREDECESSOR,carriedVerifiedEvidence=carried,files=files,sources=sources,generated=generated)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')


if __name__ == '__main__':
    main(sys.argv[1])
