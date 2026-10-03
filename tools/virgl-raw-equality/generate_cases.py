#!/usr/bin/env python3
"""Literal equality witnesses and bounded admission attacks; no compiler output."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = 'virgl-webgl2-raw-bits-v13'


def shader(stage, body, fragment=False):
    lines = ['VERT' if stage == 'vertex' else 'FRAG']
    lines += ['DCL IN[0]', 'DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]'] if stage == 'vertex' else ['DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]', 'DCL CONST[0..45]',
              'IMM[0] UINT32 {255,15,1,31}',
              'IMM[1] UINT32 {1056964608,1065353216,8388607,2143289345}',
              'IMM[2] FLT32 {1,2,0,0.5}',
              'IMM[3] UINT32 {0,1,2147483648,4294967295}']
    lines += body.splitlines()
    lines += ['USHR TEMP[115], TEMP[117], CONST[44]']
    if stage == 'vertex':
        lines += ['AND TEMP[115], TEMP[115], IMM[0].xxxx', 'SHL TEMP[115], TEMP[115], IMM[0].yyyy',
                  'OR TEMP[115], TEMP[115], IMM[1].xxxx', 'MOV OUT[1], TEMP[115]', 'MOV OUT[0], IN[0]']
    else:
        lines += ['AND TEMP[115], TEMP[115], IMM[0].zzzz', 'NOT TEMP[115], TEMP[115]',
                  'UADD TEMP[115], TEMP[115], IMM[3].yyyy', 'AND TEMP[115], TEMP[115], IMM[1].yyyy', 'MOV OUT[0], TEMP[115]']
    return '\n'.join(lines + ['END']) + '\n'


def main():
    cases, kernels, pairs = [], [], []
    bodies = {
        'eq': 'FSEQ TEMP[117], CONST[0], CONST[45]',
        'ne': 'FSNE TEMP[117], CONST[0], CONST[45]',
        'self-eq': 'FSEQ TEMP[117], CONST[0], CONST[0]',
        'self-ne': 'FSNE TEMP[117], CONST[0], CONST[0]',
        'alias-left': 'MOV TEMP[117], CONST[0]\nMOV TEMP[116], CONST[45]\nFSEQ TEMP[117].xy, TEMP[117].yxwz, TEMP[116].wzyx\nFSNE TEMP[117].z, TEMP[117].yyyy, TEMP[116].xxxx',
        'alias-right': 'MOV TEMP[117], CONST[0]\nMOV TEMP[116], CONST[45]\nFSNE TEMP[116].xy, TEMP[117].wzyx, TEMP[116].yxwz\nFSEQ TEMP[116].w, TEMP[117].zzzz, TEMP[116].zzzz\nMOV TEMP[117], TEMP[116]',
        'computed-add': 'ADD TEMP[117], IMM[2], IMM[2]\nFSEQ TEMP[117], TEMP[117], IMM[2].yyxy',
        'computed-mul': 'MUL TEMP[117], IMM[2], IMM[2].wwww\nFSNE TEMP[117], TEMP[117], IMM[2].wxzz',
        'computed-overwrite': 'ADD TEMP[117], IMM[2], IMM[2]\nMOV TEMP[117], CONST[0]\nFSEQ TEMP[117], TEMP[117], CONST[45]',
        'selected': 'FSEQ TEMP[116], CONST[0], CONST[45]\nUCMP TEMP[117], TEMP[116], CONST[43], IMM[1]',
        'structured': 'UIF CONST[43].xxxx\nADD TEMP[114], IMM[2], IMM[2]\nELSE\nMUL TEMP[114], IMM[2], IMM[2].wwww\nENDIF\nFSEQ TEMP[117], TEMP[114], CONST[45]',
        'finite': 'ADD TEMP[114], CONST[0], IMM[2]\nFSEQ TEMP[117], TEMP[114], CONST[45]',
        'structured-finite': 'UIF CONST[43].xxxx\nADD TEMP[114], CONST[0], IMM[2]\nELSE\nMUL TEMP[114], CONST[0], IMM[2].wwww\nENDIF\nFSNE TEMP[117], TEMP[114], CONST[45]',
        'indirect': 'UARL ADDR[0].x, IMM[3].xxxx\nMOV TEMP[114], CONST[ADDR[0].x]\nFSEQ TEMP[117], TEMP[114], CONST[45]',
        'indirect-finite': 'UARL ADDR[0].x, IMM[3].xxxx\nADD TEMP[114], CONST[ADDR[0].x], IMM[2]\nFSNE TEMP[117], TEMP[114], CONST[45]',
    }
    versions = {'structured': 8, 'finite': 7, 'structured-finite': 9, 'indirect': 10, 'indirect-finite': 11}
    for stage in ('vertex', 'fragment'):
        for name, body in bodies.items():
            text = shader(stage, body)
            if name.startswith('indirect'): text = text.replace('DCL TEMP[0..117]', 'DCL TEMP[0..117]\nDCL ADDR[0]')
            version = versions.get(name, 13)
            entry = dict(name=name+'-'+stage, stage=stage, text=text, ok=True,
                         expected=dict(profile=f'virgl-webgl2-raw-bits-v{version}', constantCount=46))
            cases.append(entry)
            kernels.append(dict(name=name, stage=stage, case=entry['name'], probeText=text.split('USHR TEMP[115]')[0]+'END\n',
                                vectorSet='finite' if name in ('finite','structured-finite','indirect-finite') else 'raw'))
        base = shader(stage, bodies['eq'])
        for op in ('FSEQ','FSNE'):
            for dst in ('.x','.xy','.xyz','.y','.z','.w'):
                # Initialize all untouched lanes; consume only the written post-swizzle lanes.
                body = f'MOV TEMP[117], IMM[3]\n{op} TEMP[117]{dst}, CONST[0].wzyx, CONST[45].yxwz'
                cases.append(dict(name=op.lower()+'-mask-'+dst[1:]+'-'+stage,stage=stage,text=shader(stage,body),ok=True,expected=dict(profile=PROFILE,constantCount=46)))
            for tail in ('_PRECISE','_SAT','X'):
                cases.append(dict(name='reject-'+op+tail+'-'+stage,stage=stage,text=base.replace('FSEQ ',op+tail+' '),ok=False,expected=dict(errorCode='unsupported-feature')))
            for operand in ('-CONST[0]','|CONST[0]|','TEMP[116]'):
                cases.append(dict(name='reject-'+op+'-'+operand.replace('[','').replace(']','')+'-'+stage,stage=stage,text=base.replace('FSEQ TEMP[117], CONST[0]',op+' TEMP[117], '+operand),ok=False,expected=dict(errorCode='parse-error')))
        # Every constant bit pattern is legal for comparisons, but an all-ones result
        # is not authorized as ordinary floating output.
        out = 'OUT[1]' if stage=='vertex' else 'OUT[0]'
        for body in ('FSEQ TEMP[117], CONST[0], CONST[0]', 'FSNE TEMP[117], CONST[0], CONST[45]'):
            text=shader(stage,body).replace('MOV '+out+', TEMP[115]','MOV '+out+', TEMP[117]')
            cases.append(dict(name='reject-direct-'+body.split()[0]+'-'+stage,stage=stage,text=text,ok=False,expected=dict(errorCode='unsupported-feature')))
        # A known NaN must choose the safe UCMP arm. This is the CPU-only
        # admission-fault witness; an unsafe admitted body is never sent to GL.
        for op in ('FSEQ','FSNE'):
            body=f'{op} TEMP[116], IMM[1].wwww, IMM[1].wwww\nUCMP TEMP[117], TEMP[116], '+('IMM[1].wwww, IMM[2]' if op=='FSEQ' else 'IMM[2], IMM[1].wwww')
            text=shader(stage,body).replace('MOV '+out+', TEMP[115]','MOV '+out+', TEMP[117]')
            cases.append(dict(name='known-nan-'+op+'-'+stage,stage=stage,text=text,ok=True,expected=dict(profile=PROFILE,constantCount=46)))
        for depth in (8,9):
            body='UIF CONST[43].xxxx\n'*depth+bodies['eq']+'\nENDIF\n'*depth
            # Initialize the comparison destination on the predecessor that skips UIF.
            text=shader(stage,'MOV TEMP[117], IMM[3]\n'+body)
            cases.append(dict(name='depth-'+str(depth)+'-'+stage,stage=stage,text=text,ok=depth==8,expected=dict(profile='virgl-webgl2-raw-bits-v8',constantCount=46) if depth==8 else dict(errorCode='unsupported-feature')))
        count=sum(not line.startswith(('VERT','FRAG','DCL','IMM')) and line!='END' for line in base.splitlines())
        for limit in (179,180):
            text=base.replace('END\n','MOV TEMP[114], IMM[3]\n'*(limit-count)+'END\n')
            cases.append(dict(name=('instruction-limit' if limit==179 else 'reject-instruction180')+'-'+stage,stage=stage,text=text,ok=limit==179,expected=dict(profile=PROFILE,constantCount=46) if limit==179 else dict(errorCode='parse-error')))
        for count in (16384,16385):
            text=base+'\n'*(count-len(base))
            cases.append(dict(name='text-'+str(count)+'-'+stage,stage=stage,text=text,ok=count==16384,expected=dict(profile=PROFILE,constantCount=46) if count==16384 else dict(errorCode='input-too-large')))
    # Certified-loop precedences use the actual retained graph, not relabelled metadata.
    old=json.loads((ROOT/'renderer/virgl-shader/tests/bounded-loop-cases.json').read_text())
    for stage in ('vertex','fragment'):
        entry=copy.deepcopy(next(e for e in old if e['name']=='loop-small-'+stage))
        entry['name']='loop-equality-'+stage
        text=entry['text'].replace('IMM[3] FLT32 {0.5,0.25,0,1}', 'IMM[3] FLT32 {0.5,0.25,0,1}\nIMM[4] UINT32 {255,15,1,31}\nIMM[5] UINT32 {1056964608,1065353216,0,0}')
        if stage=='fragment':text=text.replace('DCL IN[1], GENERIC[0], CONSTANT\n','').replace('MOV OUT[0], IN[1]\n','')
        codec=['FSEQ TEMP[117], CONST[0], CONST[45]','USHR TEMP[115], TEMP[117], CONST[44]']
        codec += ['AND TEMP[115], TEMP[115], IMM[4].xxxx','SHL TEMP[115], TEMP[115], IMM[4].yyyy','OR TEMP[115], TEMP[115], IMM[5].xxxx','MOV OUT[1], TEMP[115]'] if stage=='vertex' else ['AND TEMP[115], TEMP[115], IMM[4].zzzz','NOT TEMP[115], TEMP[115]','UADD TEMP[115], TEMP[115], IMM[4].zzzz','AND TEMP[115], TEMP[115], IMM[5].yyyy','MOV OUT[0], TEMP[115]']
        entry['text']=text.replace('END\n','\n'.join(codec)+'\nEND\n');cases.append(entry)
        kernels.append(dict(name='loop-equality',stage=stage,case=entry['name'],probeText=entry['text'].split('USHR TEMP[115]')[0]+'END\n',vectorSet='finite'))
        for op in ('FSEQ','FSNE'):
            for mask in ('.xz','.zw'):
                text=shader(stage,'MOV TEMP[117], IMM[3]\n'+op+' TEMP[117]'+mask+', CONST[0], CONST[45]')
                cases.append(dict(name='reject-noncontiguous-'+op+mask+'-'+stage,stage=stage,text=text,ok=False,expected=dict(errorCode='unsupported-feature')))
            for mask,ok in (('.x',True),('.xy',False)):
                body='MOV TEMP[117], IMM[3]\nMOV TEMP[116].x, IMM[3].xxxx\n'+op+' TEMP[117]'+mask+', IMM[1].wwww, TEMP[116].xyyy'
                cases.append(dict(name='consumed-'+op+mask+'-'+stage,stage=stage,text=shader(stage,body),ok=ok,expected=dict(profile=PROFILE,constantCount=46) if ok else dict(errorCode='parse-error')))

    vectors=[]
    # Every tuple is a literal encoding; fields are classified independently in JS.
    samples=[(0,0x80000000),(0x80000000,0),(1,0),(0x80000001,0x80000000),(1,1),
             (0x7fffff,0x800000),(0x807fffff,0x80800000),(0x3f800000,0x3f800000),
             (0x3f800001,0x3f800000),(0xbf800000,0xbf800000),(0xbf800001,0xbf800000),
             (0x7f800000,0x7f800000),(0xff800000,0xff800000),(0x7f800000,0xff800000),
             (0x7fc00001,0x7fc00001),(0xffc00001,0xffc00001),(0x7f800001,0x7f800001),
             (0xff800001,0xff800001),(0x7fffffff,0x3f800000),(0x3f800000,0xffffffff),
             (0x7fc12345,0x7fc54321),(0x00800000,0x00800000),(0x7f7fffff,0x7f7fffff),
             (0xff7fffff,0xff7fffff)]
    for index in range(0,len(samples),4):
        block=samples[index:index+4]
        vectors.append(dict(name='raw-'+str(index//4),a=[a for a,b in block],b=[b for a,b in block],c=[0,1,0x3f000000,0xbf800000]))
    finite=[dict(name='finite-'+str(i),a=a,b=b,c=[i,1,0x3f000000,0x3f800000]) for i,(a,b) in enumerate([
        ([0x3f000000,0x3f800000,0,0xbf800000],[0x3fc00000,0x40400000,0,0]),
        ([0x3f800000,0x40000000,0,0x3f000000],[0x3f000000,0x3f800000,0,0x3e800000])])]
    for stage in ('vertex','fragment'):
        pairs.append(dict(name='eq-'+stage+'-pair',vertex='eq-vertex' if stage=='vertex' else 'loop::pass-vertex',fragment='loop::pass-fragment' if stage=='vertex' else 'eq-fragment',ok=True))
    for stage in ('vertex','fragment'):
        for op in ('FSEQ','FSNE'):
            for vector in vectors:
                body=op+' TEMP[117], IMM[4], IMM[5]'
                text=shader(stage,body).replace('IMM[3] UINT32 {0,1,2147483648,4294967295}', 'IMM[3] UINT32 {0,1,2147483648,4294967295}\nIMM[4] UINT32 {'+','.join(map(str,vector['a']))+'}\nIMM[5] UINT32 {'+','.join(map(str,vector['b']))+'}')
                cases.append(dict(name='known-'+op+'-'+vector['name']+'-'+stage,stage=stage,text=text,ok=True,expected=dict(profile=PROFILE,constantCount=46)))
    for kernel in kernels:
        pairs.append(dict(name='gpu-'+kernel['case']+'-pair',vertex=kernel['case'] if kernel['stage']=='vertex' else 'float::legacy-vertex',fragment='float::legacy-fragment' if kernel['stage']=='vertex' else kernel['case'],ok=True))
    fixture=dict(schema='raw-equality-cases-v1',cases=cases,pairs=pairs,kernels=kernels,vectors=vectors,finiteVectors=finite)
    (ROOT/'renderer/virgl-shader/tests/raw-equality-cases.json').write_text(json.dumps(fixture,indent=2)+'\n')
    print('authored',len(cases),'stages',len(kernels),'hardware kernels')


if __name__=='__main__':main()
