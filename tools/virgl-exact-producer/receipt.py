#!/usr/bin/env python3
"""Bind frozen source, whole native/Wasm results, original profiles and real GPU proof."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6m3b'
SEEDS=[1779033703,3144134277,1013904242]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    out=Path(sys.argv[1]).resolve()
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    assert not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT),'freeze tracked sources'
    sources={}
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes()
        assert digest is None or sha(raw)==digest,name
        if not name.startswith(('renderer/virgl-shader/build/','target/virgl-exact-producer-fault/')):
            assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),name
        sources[name]=dict(path=name,bytes=len(raw),sha256=sha(raw))
    def report(name,task=TASK,status='passed'):
        value=json.loads((out/name).read_bytes())
        assert value['task']==task and value['status']==status and value['gitHead']==head,name
        return value
    native,node=report('native/report.json'),report('node.json')
    fixture=json.loads((ROOT/'tools/virgl-exact-producer/fixtures.json').read_bytes())
    assert len(native['cases'])==len(node['cases'])==len(fixture)==66
    assert node['nativeSha256']==sha((out/'native/report.json').read_bytes())
    assert native['layout']==[111752,32448,12,2996] and native['probes']==40
    assert len(native['rejections'])==len(node['nativeRequests'])==11 and len(native['failures'])>=106
    assert len(node['schemaAttacks'])==100 and node['getterInvocations']==0 and len(node['ownership'])==2
    assert not (out/'native/native.stderr').read_bytes()
    assert sha((out/'native/cases.bin').read_bytes())==native['fixtureSha256']
    assert sha((out/'native/native.log').read_bytes())==native['stdoutSha256']
    source(native['binary']['path'],native['binary']['sha256'])
    for c,w,f in zip(native['cases'],node['cases'],fixture):
        assert c['name']==w['name']==f['name'] and c['text']==f['text']
        assert c['result']==w['result'] and c['defaultResult']==w['defaultResult'] and c['pairResult']==w['pairResult']
        assert sha(c['text'].encode())==c['textSha256']
        if c.get('source'):
            source(c['source'],c['sourceSha256']);assert c['text'].encode()==(ROOT/c['source']).read_bytes()
        if c['ok'] and not c['defaultOk']:
            assert c['result']['metadata']['constantExactDomains'][0]['components']==f['components']
    legacy=report('legacy.json',task='E6-T12g6m2')
    assert len(legacy['cases'])==10717 and legacy['oldPairs']==2683 and len(legacy['extensions'])==177
    for p in legacy['predecessors']:
        for name in ['manifest.json','records.json']:source(p['path']+'/'+name)
        source(p['path']+'/'+p['manifest']['archive']['path'],p['manifest']['archive']['sha256'])
    coverage=report('coverage-audit.json');assert coverage['lines'] and all(x['status'] in ['executed','waived'] for x in coverage['lines'])
    # Entries cannot coexist: serialized single, pair or exact transaction.
    # Sum every nonrecursive owned helper, plus the largest one entry frame.
    stack=[]
    for name in ['bridge.su','raw_bits.su']:
        raw=(ROOT/'renderer/virgl-shader/build/compiler-bounds-wasm-stack'/name).read_bytes()
        (out/'stack').mkdir(exist_ok=True);(out/'stack'/name).write_bytes(raw)
        for row in raw.decode().splitlines():
            name,size,kind=row.split('\t');assert kind=='static'
            stack.append(dict(function=name.split(':')[-1],bytes=int(size),kind=kind))
    entries=[r['bytes'] for r in stack if r['function'] in ['bridge_translate','bridge_translate_pair','bridge_translate_exact']]
    assert len(entries)==3
    peak=sum(r['bytes'] for r in stack)-sum(entries)+max(entries)
    assert peak<262144
    pixels=attacks=uploads=0;contradictions=[]
    for name,status in [(f'gpu-{s}','passed') for s in SEEDS]+[('fault-derive','failed'),('fault-metadata','failed')]:
        browser=report(name+'/report.json',status=status);check=report('capture-'+name.removeprefix('gpu-')+'.json')
        assert not browser['trackedChanges'] and check['reportSha256']==sha((out/name/'report.json').read_bytes())
        assert check['nodeReportSha256']==sha((out/'node.json').read_bytes())
        assert browser['acceptance']['trustedHostWrapper'] is False
        for entry in browser['sources']+browser['servedFiles']:source(entry['path'],entry['sha256'])
        image=browser['screenshot' if status=='passed' else 'failureScreenshot']
        assert sha((out/name/image['path']).read_bytes())==image['sha256']
        if status=='passed':
            assert not check['contradictions'] and len(browser['acceptance']['rigs'])==37
            assert browser['acceptance']['seed'] in SEEDS
            pixels+=check['checkedPixels'];attacks+=check['checkedAttacks'];uploads+=check['checkedUploadWords']
        else:
            assert len(check['contradictions'])==1
            contradictions+=check['contradictions']
            for entry in browser['faultSources']['artifacts']:
                source('target/virgl-exact-producer-fault/'+browser['acceptance']['fault']+'/'+entry['path'],entry['sha256'])
            source('target/virgl-exact-producer-fault/'+browser['acceptance']['fault']+'/manifest.json')
    paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-exact-producer','tools/virgl-known-branches','tools/lib/virgl-browser-runner.mjs','tools/setup-virgl-emsdk.sh','tools/verify-virgl-exact-producer.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
    for name in paths:source(name)
    for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/'+name)
    records=[dict(path=str(p.relative_to(out)),bytes=p.stat().st_size,sha256=sha(p.read_bytes()))
        for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ['receipt.json','acceptance.log']]
    result=dict(schema='virgl-exact-producer-receipt-v1',task=TASK,status='passed',gitHead=head,sources=list(sources.values()),records=records,
        nativeCases=len(native['cases']),legacyCases=len(legacy['cases']),schemaAttacks=len(node['schemaAttacks']),allocationFaults=len(native['failures']),seeds=SEEDS,
        checkedPixels=pixels,checkedAttacks=attacks,checkedUploadWords=uploads,physicalContradictions=contradictions,
        measuredStack=stack,ownedWasmPeakUpperBoundBytes=peak,stackScope='all nonrecursive owned helpers plus maximum of mutually exclusive serialized entry frames; unchanged upstream/libc excluded',
        guestExecution=False,productionNegotiation=False,trustedHostMetadataWrapper=False)
    (out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(f'{TASK} receipt passed: {pixels} independent pixels, {attacks} rejected banks; {peak} owned Wasm stack bytes')


if __name__=='__main__':
    main()
