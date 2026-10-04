#!/usr/bin/env python3
"""Authored copy dependencies and explicit prior rejections; no compiler output."""
import copy, hashlib, json, re, tarfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BASELINE_SHA = 'bdf9499f20d74e44a1c3f57ff207f2f7e0e5e568e0e81172130809dd7961edad'
MASKS = ['x','y','z','w','xy','xz','xw','yz','yw','zw','xyz','xyw','xzw','yzw','xyzw']
def sha(raw): return hashlib.sha256(raw).hexdigest()
def contract(stage,count,base,components,text='',indirect=None,loop=False,radial=False):
    common=dict(stage=stage,slot=0,name=('vs' if stage=='vertex' else 'fs')+'const0',count=count)
    e=dict(profile='virgl-webgl2-raw-bits-v27',constantCount=count,
           rasterBaseProfile=f'virgl-webgl2-raw-bits-v{base}',
           constantDomains=[dict(kind='constant-bank-finite-f32-v1',**common)],
           constantRasterDomains=[dict(kind='constant-bank-raster-copy-f32-v1',**common,
             components=[dict(register=i,mask=m) for i,m in sorted(components.items())])])
    if indirect is not None:e['constantAccesses']=[dict(kind='constant-bank-static-indirect-v1',**common,indices=indirect)]
    if loop:e['constantConstraints']=[dict(kind='constant-bank-counted-table-i32-v1',**common,register=9,component=0,maximum=18)]
    if radial:e['constantRadialDomains']=[dict(kind='constant-bank-radial-coefficient-f32-v1',**common,register=4,component=0,minimumMagnitude=0x3727c5ac)]
    operations=[op for op in ('FSEQ','FSNE','MAX','MOV') if re.search(r'\b'+op+'_PRECISE\b',text)]
    if operations:e['preciseWordContract']=dict(kind='tgsi-precise-word-local-v1',stage=stage,operations=operations)
    return e
def copy_shader(stage,mask='xyzw',variant='direct'):
    lines=['VERT' if stage=='vertex' else 'FRAG']
    lines += ['DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]'] if stage=='vertex' else ['DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]','DCL CONST[0..5]',
      'IMM[0] UINT32 {0,1065353216,2147483648,1056964608}',
      'OR TEMP[117], IMM[0].xxxx, IMM[0].xxxx',
      'MOV TEMP[0], CONST[0]', 'MOV TEMP[1], IMM[0].wwww']
    if variant=='direct':
        lines += [f'MOV TEMP[1].{mask}, TEMP[0].wzyx']
        components={0:sum(1<<'xyzw'.index('wzyx'['xyzw'.index(c)]) for c in mask)};base=7
    elif variant=='alias':
        lines += [f'MOV TEMP[0].{mask}, TEMP[0].xzyw','MOV TEMP[1], TEMP[0]']
        mapping=list('xyzw')
        for c in mask:mapping['xyzw'.index(c)]='xzyw'['xyzw'.index(c)]
        components={0:sum(1<<'xyzw'.index(c) for c in set(mapping))};base=7
    elif variant=='branch':
        lines += ['UIF CONST[5].xxxx',f'MOV TEMP[0].{mask}, CONST[1].wzyx','ENDIF','MOV TEMP[1], TEMP[0]']
        components={0:15,1:sum(1<<'xyzw'.index('wzyx'['xyzw'.index(c)]) for c in mask)};base=9
    elif variant=='select':
        lines += [f'UCMP TEMP[1].{mask}, CONST[5].xxxx, TEMP[0].wzyx, CONST[1]']
        components={0:sum(1<<'xyzw'.index('wzyx'['xyzw'.index(c)]) for c in mask),1:sum(1<<'xyzw'.index(c) for c in mask)};base=7
    elif variant=='max':
        lines += [f'MAX_PRECISE TEMP[1].{mask}, TEMP[0].wzyx, CONST[1]']
        components={0:sum(1<<'xyzw'.index('wzyx'['xyzw'.index(c)]) for c in mask),1:sum(1<<'xyzw'.index(c) for c in mask)};base=18
    else:raise ValueError(variant)
    lines += ['MOV '+('OUT[1]' if stage=='vertex' else 'OUT[0]')+', TEMP[1]']
    if stage=='vertex':lines += ['MOV OUT[0], IN[0]','MOV OUT[2], IN[1]']
    text='\n'.join(lines+['END'])+'\n'
    return text,contract(stage,6,base,components,text)
OBSERVER='''FRAG
DCL IN[1], GENERIC[0], CONSTANT
DCL IN[2], GENERIC[1], CONSTANT
DCL OUT[0], COLOR
DCL TEMP[0..117]
IMM[0] UINT32 {23,127,4294967200,1}
IMM[1] UINT32 {0,1065353216,0,0}
USHR TEMP[0].x, IN[2].xxxx, IMM[0].xxxx
AND TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy
UADD TEMP[0].x, TEMP[0].xxxx, IMM[0].zzzz
USHR TEMP[1], IN[1], TEMP[0].xxxx
AND TEMP[1], TEMP[1], IMM[0].wwww
UCMP TEMP[1], TEMP[1], IMM[1].yyyy, IMM[1].xxxx
MOV OUT[0], TEMP[1]
END
'''
def main():
    archive=ROOT/'evidence/virgl-ordered-masks/worker.tar.gz';assert sha(archive.read_bytes())==BASELINE_SHA
    with tarfile.open(archive) as a:held=json.load(a.extractfile('./native/native-report.json'))
    cases=[];pairs=[];kernels=[];ledger=[];originals=[]
    def add(name,stage,text,e,ok=True,**extra):
        c=dict(name=name,stage=stage,text=text,ok=ok,expected=e,**extra);cases.append(c);return c
    # Names and component expectations were classified from literal inputs.
    specs={'raw':{'unknown-constant-output':(0,7)},'integer':{'selector-raw-same-unknown':(45,7)},
      'constant':{'mixed-output':(45,7)},'structured':{'reject-output-permission-0':(0,9),'reject-output-permission-1':(0,9),'one-sided-authority':(0,9)},
      'indirect':{'reject-numeric-output':(0,11)}}
    for label,entries in specs.items():
        for stem,(index,base) in entries.items():
            for stage in ('vertex','fragment'):
                old=next(e for e in held[label+'Cases'] if e['name']==stem+'-'+stage)
                ledger.append(dict(name=label+'::'+old['name'],inputSha256=old['inputSha256'],before={k:old[k] for k in ('result','resultBytes','resultSha256')},
                  expected=contract(stage,46,base,{index:15},old['text'],[0] if label=='indirect' else None)))
    for stage,begin in [('vertex',218),('fragment',382)]:
        for offset,index in enumerate([0,45,45,45]):
            old=next(e for e in held['constantCases'] if e['name']==f'reject-conditional-output-{begin+offset}-{stage}')
            ledger.append(dict(name='constant::'+old['name'],inputSha256=old['inputSha256'],before={k:old[k] for k in ('result','resultBytes','resultSha256')},expected=contract(stage,46,7,{index:15},old['text'])))
    for kind,count,start,end,base in [('nested',26,18,25,14),('loop',46,28,45,16)]:
        old=next(e for e in held['radialCases'] if e['name']==f'reject-no-alpha-view-unmarked-structural-port-{kind}-fragment')
        ledger.append(dict(name='radial::'+old['name'],inputSha256=old['inputSha256'],before={k:old[k] for k in ('result','resultBytes','resultSha256')},
          expected=contract('fragment',count,base,{i:8 for i in range(start,end)},old['text'],list(range(10,46)) if kind=='loop' else None,kind=='loop',True)))
    assert len(ledger)==24
    pair_names=['constant::rejected-vertex-unsupported-feature-pair','radial::reject-no-alpha-view-unmarked-structural-port-nested-fragment-pair','radial::reject-no-alpha-view-unmarked-structural-port-loop-fragment-pair']
    pair_ledger=[]
    for name in pair_names:
        label,stem=name.split('::');old=next(e for e in held[label+'Pairs'] if e['name']==stem)
        pair_ledger.append(dict(name=name,before={k:old[k] for k in ('result','resultBytes','resultSha256')},vertexSha256=old['vertexSha256'],fragmentSha256=old['fragmentSha256']))
    for stage in ('vertex','fragment'):
        for mask in MASKS:
            for variant in ('direct','alias','branch','select','max'):
                name=f'copy-{mask}-{variant}-{stage}';text,e=copy_shader(stage,mask,variant);add(name,stage,text,e)
                if mask in ('x','yz','xyzw'):
                    kernels.append(dict(name=name,case=name,stage=stage,kind='copy',mask=mask,variant=variant,count=6))
                pairs.append(dict(name='gpu-'+name+'-pair',vertex=name if stage=='vertex' else 'precise::pass-vertex',fragment='observer-fragment' if stage=='vertex' else name,ok=True))
        valid,_=copy_shader(stage)
        for name,before,after,code in [
          ('computed','MOV TEMP[1].xyzw, TEMP[0].wzyx','AND TEMP[1], TEMP[0], CONST[1]','unsupported-feature'),
          ('exceptional-imm','MOV TEMP[1].xyzw, TEMP[0].wzyx','UCMP TEMP[1], CONST[5], TEMP[0], IMM[0].zzzz','unsupported-feature'),
          ('missing-predecessor','MOV TEMP[0], CONST[0]','UIF CONST[5].xxxx\nMOV TEMP[0], CONST[0]\nENDIF','parse-error')]:
            text=valid.replace(before,after)
            if name=='exceptional-imm':text=text.replace('2147483648','1')
            add('reject-'+name+'-'+stage,stage,text,dict(errorCode=code),False)
        killed=valid.replace('MOV TEMP[1].xyzw, TEMP[0].wzyx','MOV TEMP[1], IMM[0].wwww')
        add('killed-bank-'+stage,stage,killed,dict(profile='virgl-webgl2-raw-bits-v1',constantCount=6))
        for depth in (8,9):
            text,e=copy_shader(stage)
            text=text.replace('MOV TEMP[1].xyzw, TEMP[0].wzyx', 'UIF CONST[5].xxxx\n'*depth+'MOV TEMP[1].xyzw, TEMP[0].wzyx\n'+'ENDIF\n'*depth)
            e=contract(stage,6,9,{0:15})
            add(f'raster-depth-{depth}-'+stage,stage,text,e if depth==8 else dict(errorCode='unsupported-feature'),depth==8)
            if depth==8:pairs.append(dict(name='gpu-raster-depth-8-'+stage+'-pair',vertex='raster-depth-8-'+stage if stage=='vertex' else 'precise::pass-vertex',fragment='observer-fragment' if stage=='vertex' else 'raster-depth-8-'+stage,ok=True))
        for limit in (179,180):
            text,e=copy_shader(stage);count=sum(not x.startswith(('VERT','FRAG','DCL','IMM')) and x!='END' for x in text.splitlines())
            text=text.replace('MOV TEMP[1].xyzw, TEMP[0].wzyx','MOV TEMP[0], TEMP[0]\n'*(limit-count)+'MOV TEMP[1].xyzw, TEMP[0].wzyx')
            name=('raster-limit-' if limit==179 else 'reject-raster-instruction180-')+stage
            add(name,stage,text,e if limit==179 else dict(errorCode='parse-error'),limit==179)
            if limit==179:pairs.append(dict(name='gpu-'+name+'-pair',vertex=name if stage=='vertex' else 'precise::pass-vertex',fragment='observer-fragment' if stage=='vertex' else name,ok=True))
    add('observer-fragment','fragment',OBSERVER,dict(profile='virgl-webgl2-raw-bits-v2',constantCount=0))
    for prefix,kind,count,start,end,base,radial in [('5a243fc7','nested',26,18,25,20,False),('616a643d','loop',46,28,45,23,False),('a6143f11','nested',26,18,25,24,True),('e911b393','loop',46,28,45,26,True)]:
        old=next(e for e in held['originals'] if e['sha256'].startswith(prefix));raw=(ROOT/old['path']).read_bytes();assert sha(raw)==old['sha256'];text=raw.decode('ascii')
        e=contract('fragment',count,base,{i:8 for i in range(start,end)},text,list(range(10,46)) if kind=='loop' else None,kind=='loop',radial)
        originals.append(dict(path=old['path'],sha256=old['sha256'],before={k:old[k] for k in ('result','resultBytes','resultSha256')},expected=e))
        name='original-'+prefix;add(name,'fragment',text,e,originalPath=old['path'],originalSha256=old['sha256'])
        kernels.append(dict(name=name,case=name,stage='fragment',kind='original',form=kind,count=count,radial=radial,originalPath=old['path'],originalSha256=old['sha256']))
        pairs.append(dict(name='gpu-'+name+'-pair',vertex='precise::pass-vertex',fragment=name,ok=True))
        if kind=='loop':
            tail=re.search(r'((?:\d+:\s*)?MOV OUT\[0\], [^\n]+)\n',text);assert tail
            bad=text.replace(tail[1],re.sub(r'MOV OUT\[0\], .*','MOV OUT[0], CONST[9].xxxx',tail[1]))
            add('reject-count-output-'+prefix,'fragment',bad,dict(errorCode='unsupported-feature'),False)
    result=dict(schema='raster-bank-cases-v1',baselineSha256=BASELINE_SHA,cases=cases,pairs=pairs,kernels=kernels,migrationCandidates=ledger,pairMigrations=pair_ledger,originalMigrations=originals)
    path=ROOT/'renderer/virgl-shader/tests/raster-bank-cases.json';path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(cases=len(cases),pairs=len(pairs),kernels=len(kernels),migrations=len(ledger),originals=len(originals))))
if __name__=='__main__':main()
