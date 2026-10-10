#!/usr/bin/env python3
"""Authenticate frozen compiler records and their independently audited pixels."""
from pathlib import Path
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T11d4'
GENERATED=['renderer/virgl-shader/build/'+name for name in [
 'standard-native/standard-test','standard-sanitize/standard-test',
 'standard-allocation-sanitize/standard-allocation-test',
 'wasm/virgl-shader.mjs','wasm/virgl-shader.wasm','sanitize/hostile-test']]

def need(ok,reason):
    if not ok:raise ValueError(reason)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def main(directory):
    head=git('rev-parse','HEAD');need(not git('diff','--name-only','HEAD'),'freeze source before recording')
    metadata=json.loads((directory/'native/metadata.json').read_text());node=json.loads((directory/'native/node.json').read_text())
    need(metadata['status']==node['status']=='passed' and metadata['cases']==node['cases']==634,'complete native/independent metadata/Wasm cases')
    need(node['exactNativeWasm'] and node['fixedMemory']['bytes']==16777216 and node['fixedMemory']['recovered'],'fixed actual Wasm recovery')
    need((directory/'native/native.jsonl').read_bytes()==(directory/'native/sanitize.jsonl').read_bytes(),'native and sanitized bytes differ')
    allocations=[json.loads(l) for l in (directory/'native/allocations.jsonl').read_text().splitlines()]
    summary=allocations[-1];need(summary['kind']=='summary' and summary['faults']==summary['recoveries'] and summary['faults']>30 and summary['callerMutation'],'actual allocation and caller ownership attacks')
    need(sum(r['kind'] in ['upstream-fault','calloc-fault'] for r in allocations)==summary['faults'],'every recorded actual fault')
    for row in allocations:
        if row['kind'] in ['upstream-fault','calloc-fault']:need(set(row['result'])=={'ok','error'} and not row['result']['ok'],'partial allocation success')
    for name in ['hardware','fault-sine','retained-ordinary','retained-raw','retained-private-92cb','retained-private-c580']:
        report=json.loads((directory/name/'report.json').read_text())
        need(report['gitHead']==head and not report['trackedChanges'],'stale or dirty '+name)
        need(report['status']==('failed' if name=='fault-sine' else 'passed'),'failed required path '+name)
        need(report['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors '+name)
        shot=report.get('screenshot',report.get('failureScreenshot'));need(shot is not None,'missing browser recording '+name)
        need(sha((directory/name/shot['path']).read_bytes())==shot['sha256'],'screenshot drift '+name)
        for item in report['servedFiles']:need(sha((ROOT/item['path']).read_bytes())==item['sha256'],'served runtime/input drift '+item['path'])
        coverage=report['browserCoverage'];need(sha((directory/name/coverage['path']).read_bytes())==coverage['sha256'],'V8 coverage drift '+name)
        if name=='hardware':need(report['acceptance']['frames'] and not report['productionNegotiation'],'isolated physical compiler scope')
    audit=json.loads((directory/'physical-audit.json').read_text());need(audit['status']=='passed' and audit['frames']==125 and audit['pixels']==2390624 and audit['mutation']['caught'],'offline physical evidence')
    # Preserve the entire pre-existing C boundary byte for byte (apart from the
    # two new includes and trailing whitespace). Its HELD evidence is carried;
    # the new frozen module also executed direct ordinary/raw/private anchors.
    predecessor='97ed2ca31f08465e442c88aed3a677237f78e236'
    legacy=subprocess.check_output(['git','show',predecessor+':renderer/virgl-shader/bridge.c'],cwd=ROOT)
    prefix=(ROOT/'renderer/virgl-shader/bridge.c').read_bytes().split(b'/* The standard facet deliberately')[0]
    for include in [b'#include "standard_guard.h"\n',b'#include "standard_emit.h"\n']:prefix=prefix.replace(include,b'')
    need(prefix.rstrip()==legacy.rstrip(),'old C runtime was changed')
    coverage={}
    for name in ['matrix','allocations']:
        data=json.loads((directory/'coverage'/f'{name}.json').read_text())
        wanted=[r for r in data['data'][0]['files'] if r['filename'].endswith(('/standard_guard.c','/standard_emit.c','/bridge.c'))]
        need(len(wanted)==3,'missing instrumented standard source '+name)
        coverage[name]=[{key:r['summary'][key] for key in ['lines','regions','branches','functions']}|{'file':r['filename'].split('/renderer/')[-1]} for r in wanted]
    frames={}
    for p in (directory/'stack').glob('*.su'):
        for line in p.read_text().splitlines():
            fields=line.split('\t');frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
    need(frames.get('bridge_translate_standard_pair',262144)<120000 and frames.get('standard_convert',262144)<40000 and frames.get('standard_emit',262144)<4096,'owned optimized Wasm stack bounds')
    stack=dict(pair=frames['bridge_translate_standard_pair'],conversion=frames['standard_convert'],emitter=frames['standard_emit'],largestUpstream=frames.get('vrend_convert_shader'),stackBytes=262144)
    paths=git('ls-files','--','renderer/virgl-shader','tools/virgl-standard-shader','tools/verify-virgl-standard-shader.sh','tools/lib/virgl-browser-runner.mjs','tools/setup-virgl-emsdk.sh','tools/virgl-original-programs','tools/virgl-original-corpus','tools/virgl-original-c580','tools/virgl-92cb-geometry','tools/virgl-92cb-raster','tools/virgl-capture/validate.py','tools/verify-virgl-shader.mjs','tools/verify-virgl-raw-bits.mjs','evidence/virgl-production-readiness','evidence/virgl-workload-inventory/captures/es2gears/shaders','evidence/virgl-workload-inventory/captures/es2gears/manifest.json','evidence/virgl-workload-inventory/captures/es2gears/summary.json','evidence/virgl-workload-inventory/captures/es2gears/events.jsonl','evidence/virgl-workload-inventory/es2gears-inventory.json','Makefile',f'tasks/epic-6-transcendence/{TASK}-standard-shader-compiler.md').splitlines()
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in directory.rglob('*') if p.is_file() and p.name!='receipt.json'}
    result=dict(schema='standard-shader-compiler-receipt-v1',task=TASK,status='passed',gitHead=head,cases=634,frames=125,pixels=2390624,coverage=coverage,stack=stack,legacyBoundary=dict(head=predecessor,sha256=sha(legacy),unchanged=True),guestExecution=False,productionDrawAuthority=False,files=files,sources={p:sha((ROOT/p).read_bytes()) for p in paths},generated={p:sha((ROOT/p).read_bytes()) for p in GENERATED})
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('Frozen standard compiler, 634 cases, 125 physical frames, coverage and legacy boundaries authenticated.')

if __name__=='__main__':main(Path(sys.argv[1]))
