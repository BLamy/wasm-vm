#!/usr/bin/env python3
"""Author literal arithmetic cases and migrations from the verified F4b record.
Never query the current compiler to create expected values or metadata.
"""
import copy
import hashlib
import json
import re
import tarfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BASELINE_SHA = '399b2eb6c745bc256a123debd9b5af236b355231accc7653ebf179c276040f42'
MASKS = ['x','y','z','w','xy','xz','xw','yz','yw','zw','xyz','xyw','xzw','yzw','xyzw']
def sha(value): return hashlib.sha256(value).hexdigest()
def policy(stage, text):
    return dict(kind='tgsi-precise-binary32-rne-v1',stage=stage,
      operations=[op for op in ('ADD','MUL') if re.search(r'\b'+op+r'_PRECISE\b',text)],
      rounding='nearest-even',nan='canonical-quiet-0x7fc00000',subnormals='gradual')
def expected(stage,text,base=2,count=6,metadata=None):
    result = dict(profile='virgl-webgl2-raw-bits-v28',constantCount=count,
      arithmeticBaseProfile=f'virgl-webgl2-raw-bits-v{base}',preciseArithmeticContract=policy(stage,text))
    if metadata:
        result.update({k:copy.deepcopy(v) for k,v in metadata.items() if k.startswith('constant') or k in ('rasterBaseProfile','preciseWordContract')})
    elif base == 7:
        result['constantDomains']=[dict(kind='constant-bank-finite-f32-v1',stage=stage,slot=0,
          name=('vs' if stage=='vertex' else 'fs')+'const0',count=count)]
    return result
def codec(stage):
    selector = 'IN[1]' if stage=='vertex' else 'IN[0]'
    return [f'USHR TEMP[100].x, {selector}.xxxx, IMM[1].xxxx',
      'AND TEMP[100].x, TEMP[100].xxxx, IMM[1].yyyy',
      'UADD TEMP[100].x, TEMP[100].xxxx, IMM[1].zzzz',
      'USHR TEMP[115], TEMP[117], TEMP[100].xxxx',
      'AND TEMP[115], TEMP[115], IMM[1].wwww',
      'UCMP TEMP[115], TEMP[115], IMM[0].yyyy, IMM[0].xxxx',
      'MOV OUT[1], TEMP[115]' if stage=='vertex' else 'MOV OUT[0], TEMP[115]',
      *(['MOV OUT[0], IN[0]'] if stage=='vertex' else []), 'END']
def kernel_text(stage,op,mask='xyzw',variant='direct'):
    lines=['VERT' if stage=='vertex' else 'FRAG',
      'DCL IN[0]' if stage=='vertex' else 'DCL IN[0], GENERIC[0], CONSTANT',
      'DCL IN[1]' if stage=='vertex' else 'DCL IN[1], GENERIC[1], CONSTANT',
      'DCL OUT[0], POSITION' if stage=='vertex' else 'DCL OUT[0], COLOR']
    if stage=='vertex':lines+=['DCL OUT[1], GENERIC[0]']
    lines+=['DCL TEMP[0..117]','DCL CONST[0..5]',
      'IMM[0] UINT32 {0,1065353216,2147483648,0}',
      'IMM[1] UINT32 {23,127,4294967200,1}',
      'IMM[2] UINT32 {65535,16,0,0}',
      'IMM[3] UINT32 {1065353217,1065353214,3212836864,1}']
    for index in range(3):
        lines += [f'AND TEMP[{index}], CONST[{index*2}], IMM[2].xxxx',
          f'SHL TEMP[{index}], TEMP[{index}], IMM[2].yyyy',
          f'AND TEMP[{index+3}], CONST[{index*2+1}], IMM[2].xxxx',
          f'OR TEMP[{index}], TEMP[{index}], TEMP[{index+3}]']
    lines += ['MOV TEMP[117], IMM[0].xxxx']
    a,b='TEMP[0]','TEMP[1]'
    if variant=='swizzle':a,b='TEMP[0].wzyx','TEMP[1].yxwz'
    if variant=='negative':a,b='-TEMP[0]','-TEMP[1]'
    if variant=='absolute':a,b='|TEMP[0]|','|TEMP[1]|'
    if variant=='absolute-negative':a,b='-|TEMP[0]|','-|TEMP[1]|'
    destination='TEMP[0]' if variant=='alias-left' else 'TEMP[1]' if variant=='alias-right' else 'TEMP[117]'
    if op=='CHAIN':
        lines += [f'MUL_PRECISE TEMP[3], {a}, {b}',f'ADD_PRECISE {destination}.{mask}, TEMP[3], TEMP[2]']
    elif variant=='branch':
        lines += ['UIF TEMP[2].xxxx',f'{op}_PRECISE TEMP[117].{mask}, {a}, {b}',
          'ELSE',f'{op}_PRECISE TEMP[117].{mask}, {b}, {a}','ENDIF']
    else:lines += [f'{op}_PRECISE {destination}.{mask}, {a}, {b}']
    if destination!='TEMP[117]':lines+=['MOV TEMP[117], '+destination]
    return '\n'.join(lines+codec(stage))+'\n'
def append_private(text):
    lines=text.strip().splitlines();lines=[re.sub(r'^\d+:\s*','',line) for line in lines]
    first=next(i for i,line in enumerate(lines[1:],1) if not re.match(r'^(DCL|IMM|PROPERTY)\b',line))
    defined=set()
    for line in lines:
        m=re.match(r'DCL TEMP\[(\d+)(?:\.\.(\d+))?\]',line)
        if m:defined.update(range(int(m[1]),int(m[2] or m[1])+1))
    if 117 not in defined:lines.insert(first,'DCL TEMP[117]');first+=1
    used={int(x) for x in re.findall(r'IMM\[(\d+)\] (?:UINT32|FLT32)',text)}
    available=next((i for i in range(8) if i not in used),None)
    if available is not None:
        lines.insert(first,f'IMM[{available}] UINT32 {{1065353217,1065353214,3212836864,0}}')
    else:available=0
    assert lines[-1]=='END' and len(lines)<254
    lines[-1:-1]=[f'MUL_PRECISE TEMP[117], IMM[{available}].xxxx, IMM[{available}].yyyy',
      f'ADD_PRECISE TEMP[117], TEMP[117], IMM[{available}].zzzz']
    return '\n'.join(lines)+'\n'
def main():
    archive=ROOT/'evidence/virgl-raster-bank/worker.tar.gz';assert sha(archive.read_bytes())==BASELINE_SHA
    with tarfile.open(archive) as a:held=json.load(a.extractfile('native/native-report.json'))
    groups={key:rows for key,rows in held.items() if (key=='cases' or key.endswith('Cases')) and isinstance(rows,list) and rows and isinstance(rows[0],dict) and 'text' in rows[0]}
    lookup={('' if key=='cases' else key[:-5]+'::')+e['name']:e for key,rows in groups.items() for e in rows}
    migrations=[];pair_migrations=[];originals=[];cases=[];pairs=[];kernels=[]
    # The complete independently classified new tokens are the only prior
    # negatives that migrate. New expected profiles follow their literal uses.
    specs={'numeric::unsupported-MUL_PRECISE-vertex':1,'numeric::unsupported-MUL_PRECISE-fragment':1,
      'constant::reject-retry-suffix-252-vertex':7,'constant::reject-retry-suffix-416-fragment':7,
      'constant::precise-suffix-vertex':7,'constant::precise-suffix-fragment':7,
      'precise::reject-add-vertex':2,'precise::reject-mul-vertex':2,
      'precise::reject-add-fragment':2,'precise::reject-mul-fragment':2}
    for name,base in specs.items():
        e=lookup[name];assert not e['ok'];count=6 if name.startswith('precise::') else 46
        migrations.append(dict(name=name,inputSha256=e['inputSha256'],before={k:e[k] for k in ('result','resultBytes','resultSha256')},expected=expected(e['stage'],e['text'],base,count)))
    for e in held['precisePairs']:
        if e['name'] not in ('reject-add-vertex-pair','reject-mul-vertex-pair','reject-add-fragment-pair','reject-mul-fragment-pair'):continue
        pair_migrations.append(dict(name='precise::'+e['name'],vertexSha256=e['vertexSha256'],fragmentSha256=e['fragmentSha256'],before={k:e[k] for k in ('result','resultBytes','resultSha256')}))
    rejected=[e for e in held['originals'] if not e['ok']];assert len(rejected)==1
    for e in rejected:
        text=(ROOT/e['path']).read_text();assert sha(text.encode())==e['sha256']
        originals.append(dict(path=e['path'],sha256=e['sha256'],before={k:e[k] for k in ('result','resultBytes','resultSha256')},expected=expected('vertex',text,7,4)))
    def add(name,stage,text,e,ok=True):
        cases.append(dict(name=name,stage=stage,text=text,ok=ok,expected=e));return cases[-1]
    for stage in ('vertex','fragment'):
        for op in ('ADD','MUL'):
            for mask in MASKS:
                for variant in ('direct','alias-left','alias-right'):
                    name=f'arithmetic-{op.lower()}-{mask}-{variant}-{stage}';text=kernel_text(stage,op,mask,variant)
                    add(name,stage,text,expected(stage,text))
                    if mask=='xyzw' and variant=='direct':kernels.append(dict(case=name,stage=stage,op=op,mask=mask,variant=variant,count=6,vectorSet='all'))
            for variant in ('negative','absolute','absolute-negative','swizzle','branch'):
                name=f'arithmetic-{op.lower()}-xyzw-{variant}-{stage}';text=kernel_text(stage,op,variant=variant)
                add(name,stage,text,expected(stage,text,8 if variant=='branch' else 2))
                if op=='ADD' and variant in ('absolute-negative','branch'):kernels.append(dict(case=name,stage=stage,op=op,mask='xyzw',variant=variant,count=6,vectorSet='targeted'))
        for variant in ('direct','alias-left','alias-right'):
            name=f'arithmetic-chain-xyzw-{variant}-{stage}';text=kernel_text(stage,'CHAIN',variant=variant)
            add(name,stage,text,expected(stage,text));kernels.append(dict(case=name,stage=stage,op='CHAIN',mask='xyzw',variant=variant,count=6,vectorSet='all' if variant=='direct' else 'targeted'))
        for op,mask,variant in [('ADD','yz','alias-left'),('MUL','x','alias-right'),('MUL','xyzw','swizzle'),('MUL','xyzw','absolute')]:
            name=f'arithmetic-{op.lower()}-{mask}-{variant}-{stage}'
            kernels.append(dict(case=name,stage=stage,op=op,mask=mask,variant=variant,count=6,vectorSet='targeted'))
        for base in range(1,28):
            sources=[e for e in lookup.values() if e['ok'] and e['stage']==stage and e['result']['metadata']['profile']==f'virgl-webgl2-raw-bits-v{base}']
            source=min(sources,key=lambda e:len(e['text']));text=append_private(source['text']);md=source['result']['metadata']
            count=md['uniforms'][0]['count'] if md['uniforms'] else 0
            add(f'combined-{base}-{stage}',stage,text,expected(stage,text,base,count,md))
        # The backward raster walk must stop at a numerically authorized exact
        # producer while retaining copied-bank obligations for other lanes.
        lines=['VERT' if stage=='vertex' else 'FRAG']
        if stage=='vertex':lines+=['DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']
        else:lines+=['DCL OUT[0], COLOR']
        output='OUT[1]' if stage=='vertex' else 'OUT[0]'
        lines+=['DCL TEMP[0]','DCL CONST[0..1]',
          'IMM[0] UINT32 {1048576000,1056964608,1061158912,1065353216}',
          'IMM[1] UINT32 {0,1065353216,0,0}',
          'ADD_PRECISE TEMP[0], IMM[0], IMM[1].xxxx',
          'MUL_PRECISE TEMP[0], TEMP[0], IMM[1].yyyy',
          f'MOV {output}.xy, TEMP[0].xyxy',f'MOV {output}.zw, CONST[0].zwzw']
        if stage=='vertex':lines+=['MOV OUT[0], IN[0]']
        text='\n'.join(lines+['END','']);e=expected(stage,text,27,2)
        e['rasterBaseProfile']='virgl-webgl2-raw-bits-v7'
        e['constantDomains']=[dict(kind='constant-bank-finite-f32-v1',stage=stage,slot=0,
          name=('vs' if stage=='vertex' else 'fs')+'const0',count=2)]
        e['constantRasterDomains']=[dict(kind='constant-bank-raster-copy-f32-v1',stage=stage,slot=0,
          name=('vs' if stage=='vertex' else 'fs')+'const0',count=2,components=[dict(register=0,mask=12)])]
        name='numeric-raster-mixed-'+stage;add(name,stage,text,e)
        kernels.append(dict(case=name,stage=stage,op='RASTER',mask='xyzw',variant='direct',count=2,vectorSet='original'))
        # No private arithmetic result receives general output authority.
        text=kernel_text(stage,'ADD').replace('MOV '+('OUT[1]' if stage=='vertex' else 'OUT[0]')+', TEMP[115]',
          'MOV '+('OUT[1]' if stage=='vertex' else 'OUT[0]')+', TEMP[117]')
        add('reject-manufactured-output-'+stage,stage,text,{'errorCode':'unsupported-feature'},False)
        valid=kernel_text(stage,'MUL',variant='absolute-negative')
        for name,bad in [('reverse-modifier',valid.replace('-|TEMP[0]|','|-TEMP[0]|')),
          ('unclosed-absolute',valid.replace('-|TEMP[0]|','-|TEMP[0]')),
          ('repeated-minus',valid.replace('-|TEMP[0]|','--|TEMP[0]|')),
          ('saturate',valid.replace('MUL_PRECISE','MUL_PRECISE_SAT')),
          ('legacy-rules',valid.replace('DCL TEMP[0..117]','PROPERTY LEGACY_MATH_RULES 1\nDCL TEMP[0..117]'))]:
            add('reject-'+name+'-'+stage,stage,bad,{'errorCode':'unsupported-feature'},False)
        # Boundary witnesses use the same public path as the bit-plane kernels.
        bounded=kernel_text(stage,'ADD')
        instructions=sum(line!='END' and not re.match(r'^(VERT|FRAG|DCL|IMM|PROPERTY)\b',line)
                         for line in bounded.strip().splitlines())
        filler='MOV TEMP[116].x, IMM[0].xxxx\n'*(179-instructions)
        limit=bounded.replace('END\n',filler+'END\n')
        add('arithmetic-limit-'+stage,stage,limit,expected(stage,limit))
        add('reject-instruction-180-'+stage,stage,limit.replace('END\n','MOV TEMP[116].x, IMM[0].xxxx\nEND\n'),{'errorCode':'parse-error'},False)
        huge=bounded.replace('END\n','MUL_PRECISE TEMP[116], -|TEMP[0].wzyx|, -|TEMP[1].yxwz|\n'*(179-instructions)+'END\n')
        add('reject-helper-output-bound-'+stage,stage,huge,{'errorCode':'translation-error'},False)
    for name in ('pass-vertex','pass-fragment'):
        e=next(e for e in held['preciseCases'] if e['name']==name)
        add(name,e['stage'],e['text'],{'profile':e['profile'],'constantCount':0})
    semantics=sorted({int(n) for e in cases if e['name'].startswith('combined-') and e['stage']=='fragment'
                      for n in re.findall(r'DCL IN\[[^\]]+\][^\n]*, GENERIC\[(\d+)\]',e['text'])})
    assert len(semantics)<=7
    lines=['VERT','DCL IN[0]',*[f'DCL IN[{i+1}]' for i in range(len(semantics))],
           'DCL OUT[0], POSITION',*[f'DCL OUT[{i+1}], GENERIC[{semantic}]' for i,semantic in enumerate(semantics)],
           'MOV OUT[0], IN[0]',*[f'MOV OUT[{i+1}], IN[{i+1}]' for i in range(len(semantics))],'END']
    add('pass-combined-vertex','vertex','\n'.join(lines)+'\n',{'profile':'virgl-webgl2-straight-line-v5','constantCount':0})
    add('pass-combined-fragment','fragment','FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\nIMM[0] UINT32 {0,0,0,1065353216}\nOR TEMP[0], IMM[0], IMM[0]\nMOV OUT[0], TEMP[0]\nEND\n',{'profile':'virgl-webgl2-raw-bits-v1','constantCount':0})
    for entry in cases[:]:
        if not entry['ok'] or entry['name'].startswith('pass-'):continue
        combined=entry['name'].startswith('combined-')
        pairs.append(dict(name=entry['name']+'-pair',vertex=entry['name'] if entry['stage']=='vertex' else 'pass-combined-vertex' if combined else 'pass-vertex',fragment=entry['name'] if entry['stage']=='fragment' else 'pass-combined-fragment' if combined else 'pass-fragment',ok=True))
    original=rejected[0];add('unchanged-final-original','vertex',(ROOT/original['path']).read_text(),originals[0]['expected'])
    pairs.append(dict(name='unchanged-final-original-pair',vertex='unchanged-final-original',fragment='pass-fragment',ok=True))
    kernels.append(dict(case='unchanged-final-original',stage='vertex',op='ORIGINAL',mask='xyzw',variant='direct',count=4,vectorSet='original',originalPath=original['path'],originalSha256=original['sha256']))
    result=dict(schema='precise-arithmetic-cases-v1',baselineSha256=BASELINE_SHA,cases=cases,pairs=pairs,kernels=kernels,migrationCandidates=migrations,pairMigrations=pair_migrations,originalMigrations=originals)
    path=ROOT/'renderer/virgl-shader/tests/precise-arithmetic-cases.json';path.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:len(result[k]) for k in ('cases','pairs','kernels','migrationCandidates','pairMigrations','originalMigrations')}))
if __name__=='__main__':main()
