#!/usr/bin/env python3
"""Independently recompute complete frames, pair identity and actual wire/upload proof."""
from pathlib import Path
import hashlib
import json
import math
import struct
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6m3c'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def expected(kind, alternate):
    rgba=[]
    for y in range(8):
        for x in range(8):
            if kind=='flat':
                color=[0,0,0,255] if alternate else [255,255,0,255] if 10*(y+.5)<8*(x+.5) else [0,255,0,255]
            elif kind=='smooth':
                color=[math.floor((x+.5)/10*255+.5),math.floor((y+.5)/8*255+.5),0,255]
            elif kind=='coordinate-bytes':
                color=list(struct.pack('<f',x+.5))
            elif kind=='spatial-discard':
                color=[0,0,255,255] if x+.5<4 else [64,128,191,255]
            elif kind=='always-discard':
                color=[0,0,255,255]
            else:
                raise ValueError('unknown literal oracle')
            rgba+=color
    return rgba


def key(texts, components):
    return tuple(texts)+tuple(json.dumps(x,sort_keys=True,separators=(',',':')) for x in components)


def packets(raw):
    data=bytes(raw);at=0
    while at<len(data):
        header,=struct.unpack_from('<I',data,at);count=header>>16;end=at+4+4*count
        assert end<=len(data)
        yield header&255,(header>>8)&255,list(struct.unpack_from('<'+'I'*count,data,at+4))
        at=end
    assert at==len(data)


def main():
    report_path,node_path,output=map(Path,sys.argv[1:4])
    report=json.loads(report_path.read_bytes());node=json.loads(node_path.read_bytes())
    native_path=node_path.parent/'native/report.json';native=json.loads(native_path.read_bytes())
    assert sha(native_path.read_bytes())==node['nativeSha256']
    fixtures=json.loads((ROOT/'tools/virgl-exact-pair/fixtures.json').read_bytes())
    nc={c['name']:c for c in native['cases']};wc={c['name']:c for c in node['cases']}
    assert all(nc[c['name']]['result']==wc[c['name']]['result'] for c in fixtures)
    pairs={key([c['vertexText'],c['fragmentText']],[c['vertexComponents'],c['fragmentComponents']]):c['result'] for c in native['cases']}
    stages={}
    for c in native['cases']:
        for s,name in enumerate(['vertex','fragment']):
            stages[name,c[name+'Text'],json.dumps(c[name+'Components'],sort_keys=True)]=c['singles'][s]
    assert report['task']==node['task']==TASK
    assert report['acceptance']['trustedHostWrapper'] is False
    assert 'Apple M4 Max' in report['acceptance']['renderer']
    assert all(not x for x in report['browserErrors'].values())
    a=report['acceptance'];fault=a.get('fault');contradictions=[];checked_pixels=attacks=upload_words=draws=0
    assert report['status']==('failed' if fault else 'passed')
    assert a['fixture']['sha256']==sha((ROOT/'tools/virgl-exact-pair/fixtures.json').read_bytes())
    for entry in a['shaderFixtures']:
        request=entry['request'];wanted=nc[entry['fixture']]['result']
        if entry['result']!=wanted:
            assert fault in ['interface','metadata'];contradictions.append(dict(point='shaderFixtures/'+entry['fixture'],kind='actual compiler full paired result',expected=wanted,observed=entry['result']))
        else:
            assert not fault
        assert pairs[key([request['vertexText'],request['fragmentText']],[request['vertexComponents'],request['fragmentComponents']])]==wanted
    for rig in a['rigs']:
        assert rig['geometry']['positions']==[-1,-1,0,0,1,-1,1,0,1,1,1,1,-1,1,0,1]
        assert rig['geometry']['indices']==[0,1,2,0,2,3,1,2,0,2,3,0] and rig['geometry']['viewport']==[0,0,10,8]
        assert rig['glObjects']['live']==0 and all(x==0 for x in rig['finalBudgets'].values())
        assert all(x==0 for x in rig['finalResourceBudgets'].values())
        shaders=set()
        for tr in rig['translations']:
            request=tr['request'];result=tr['result']
            if tr['kind']=='pair-exact':
                wanted=pairs[key([request['vertexText'],request['fragmentText']],[request['vertexComponents'],request['fragmentComponents']])]
                if result!=wanted:
                    assert fault;contradictions.append(dict(point=rig['name']+'/pair',kind='actual paired compiler mismatch',expected=wanted,observed=result))
                if result['ok']:
                    shaders.update([result['vertex']['glsl'],result['fragment']['glsl']])
            else:
                stage=request['stage'];words=request.get('components',[])
                wanted=stages[stage,request['text'],json.dumps(words,sort_keys=True)]
                assert result==wanted,rig['name']+' whole actual stage result'
                if result['ok']:shaders.add(result['glsl'])
        assert all(e['source'] in shaders for e in rig['glEvents'] if e['call']=='shaderSource')
        shader_sources={e['id']:e['source'] for e in rig['glEvents'] if e['call']=='shaderSource'}
        program_shaders={}
        for e in rig['glEvents']:
            if e['call']=='attachShader':program_shaders.setdefault(e['programId'],[]).append(e['shaderId'])
        for submission in rig['submissions']:
            decoded=list(packets(submission['bytes']))
            for opcode,typ,words in decoded:
                if opcode==1 and typ==4:
                    text=bytes(struct.pack('<'+'I'*len(words[5:]),*words[5:]))[:words[2]-1].decode('ascii')
                    assert any(c['vertexText']==text or c['fragmentText']==text for c in fixtures)
                if opcode==12:
                    assert words[0] in [0,1] and words[1]==0
            if submission['result']['ok'] is False and fault:
                contradictions.append(dict(point=rig['name']+'/submission/'+submission['label'],kind='physical paired interface rejected',result=submission['result']))
            if 'inputAfter' in submission:assert all(x==255 for x in submission['inputAfter'])
        for frame in rig['draws']:
            prediction=frame['prediction'];literal=expected(prediction['physical'],prediction['alternate'])
            fixture=nc[prediction['fixture']];assert fixture['physical']==prediction['physical']
            actual_sources=[shader_sources[s] for s in program_shaders[frame['nativeProgramId']]]
            assert sorted(actual_sources)==sorted([fixture['result']['vertex']['glsl'],fixture['result']['fragment']['glsl']])
            assert prediction['rgba']==literal and frame['rgbaBytes']==literal,frame['name']+' independent whole-frame equations'
            assert frame['rgbaSha256']==sha(bytes(literal))
            submission=rig['submissions'][frame['submissionIndex']]
            effects=[e for e in rig['glEvents'][submission['eventsStart']:submission['eventsEnd']] if e['call']=='drawElements']
            assert len(effects)==1 and effects[0]['sequence']>prediction['madeBeforeEvent'] and effects[0]['programId']==frame['nativeProgramId']
            ctx=next(x for x in frame['snapshot']['contexts'] if x['id']==frame['contextId']);sub=next(x for x in ctx['subContexts'] if x['id']==ctx['currentSubContext'])
            banks=sub['bindings']['constants']
            assert frame['program']['key']==str(frame['program']['vertexGeneration'])+':'+str(frame['program']['fragmentGeneration'])+':'+fixture['interfaceKey']
            assert frame['program']['interfaceKey']==fixture['interfaceKey']
            for stage,name in enumerate(['vertex','fragment']):
                metadata=fixture['result'][name]['metadata']
                if metadata['profile']=='virgl-webgl2-raw-bits-v42':
                    domain=metadata['constantExactDomains'][0];assert len(banks[stage])>=min(domain['count'],46)*4
                    for word in domain['components']:assert banks[stage][word['register']*4+word['component']]==word['word']
            for uniform in frame['uniforms']:
                stage=0 if uniform['stage']=='vertex' else 1;n=min(uniform['activeCount'],46)*4
                assert uniform['words'][:n]==banks[stage][:n]
            checked_pixels+=64;draws+=1
        for rejected in rig['attacks']:
            assert rejected['result']['ok'] is False and rejected['result']['appliedCommands']==(1 if rejected['prefix'] else 0)
            assert rejected['result']['error']['code'] in ['constant-exact-domain-error','incomplete-draw']
            assert rejected['pixelsBefore']==rejected['pixelsAfter']
            assert rejected['before']['budgets']==rejected['after']['budgets']
            assert not any(e['call'] in ['drawElements','getBufferSubData','copyBufferSubData','createShader','createProgram','linkProgram'] for e in rejected['events'])
            assert not any(e['call']=='uniform4uiv' and e['name'].startswith('vs' if rejected['stage']==0 else 'fs') for e in rejected['events'])
            if rejected['prefix']:
                opcode,typ,words=next(packets(rejected['prefix']));assert opcode==12 and typ==0 and words[:2]==[rejected['stage'],0]
                ctx=next(x for x in rejected['after']['contexts'] if x['id']==1);sub=next(x for x in ctx['subContexts'] if x['id']==ctx['currentSubContext']);assert sub['bindings']['constants'][rejected['stage']]==words[2:]
            attacks+=1
        for e in rig['glEvents']:
            if e['call']=='uniform4uiv':assert e['words']==e['observed'] and e['programId']==e['currentProgramId'];upload_words+=len(e['words'])
            if e['call']=='clientWaitSync':assert e['turn']>0
        if not fault and rig.get('schedule'):assert rig['yieldAttacks'] or rig.get('lifecycle')
    if fault:
        assert contradictions and len(a['rigs'])==1
        fs=report['faultSources'];assert fs['task']==TASK and fs['fault']==fault
        directory=ROOT/'target/virgl-exact-pair-fault'/fault
        for entry in fs['artifacts']:
            raw=(directory/entry['path']).read_bytes();assert sha(raw)==entry['sha256'] and len(raw)==entry['bytes']
        assert a['faultWasm']['sha256']==sha((directory/'virgl-shader.wasm').read_bytes())
        assert a['failure'] and any(x['kind']=='physical paired interface rejected' for x in contradictions)
    else:
        assert len(a['rigs'])==17 and not contradictions and checked_pixels>10000 and attacks>200
    result=dict(task=TASK,status='passed',gitHead=report['gitHead'],reportSha256=sha(report_path.read_bytes()),nodeReportSha256=sha(node_path.read_bytes()),nativeReportSha256=sha(native_path.read_bytes()),checkedPixels=checked_pixels,checkedFrames=draws,checkedAttacks=attacks,checkedUploadWords=upload_words,contradictions=contradictions,oracle='literal provoking indices, barycentric fractions, packed FragCoord float32 and ordered negative discard; complete actual compiler and packet/upload binding',guestExecution=False,productionNegotiation=False,trustedHostWrapper=False)
    output.write_text(json.dumps(result,indent=2)+'\n');print(f'{TASK} capture checked: {checked_pixels} independent pixels, {attacks} rejected banks, {len(contradictions)} expected source-fault contradictions')


if __name__=='__main__':
    main()
