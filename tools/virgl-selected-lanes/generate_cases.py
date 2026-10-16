#!/usr/bin/env python3
"""Authored observational-definedness witnesses; never reads compiler output."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def shader(stage, form='a', mask='xyzw', variant='plain', depth=1):
    base, scalar = (0, 'x') if form == 'a' else (20, 'w')
    w,p,b,lt,gt,c,m,a,d,t,r,s = [base+i for i in range(12)]
    if variant == 'payload-alias': r=p
    if variant == 'selector-weight': s=t
    if variant == 'fallback-disjoint': r=b
    ss=scalar*4
    suffix='' if mask=='xyzw' else '.'+mask
    out=117
    if variant == 'final-lrp': out=r
    if variant == 'final-selector': out=s
    fallback=f'TEMP[{b}]'+('.yyyy' if variant=='fallback-disjoint' else '')
    payload=f'TEMP[{p}]'+('.wzyx' if variant=='swizzle' else '')
    lines=['VERT' if stage=='vertex' else 'FRAG']
    lines+=['DCL IN[0]','DCL IN[1]','DCL IN[2]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]'] if stage=='vertex' else ['DCL IN[1], GENERIC[0], CONSTANT','DCL IN[2], GENERIC[1], CONSTANT','DCL OUT[0], COLOR']
    lines+=['DCL TEMP[0..117]','DCL CONST[0..45]',
            'IMM[0] FLT32 {2,0,1,0.5}',
            'IMM[1] FLT32 {0.125,4,0.25,0.75}',
            'IMM[2] UINT32 {23,127,4294967200,1}',
            'IMM[3] UINT32 {2147483648,0,2143289345,0}']
    lines+=['MOV TEMP[117], IMM[1].zzzz']
    if out != 117: lines += [f'MOV TEMP[{out}], IMM[1].zzzz']
    if variant=='old-destination': lines += [f'MOV TEMP[{r}], IMM[1].wwww']
    wraps=depth-1 if form=='a' else depth
    lines+=['UIF CONST[43].xxxx']*wraps
    lines += ['UIF CONST[45].xxxx',f'MOV TEMP[{w}].{scalar}, IMM[0].xxxx']
    if variant=='finite-width': lines[-1]=f'MOV TEMP[{w}].{scalar}, CONST[1].xxxx'
    if variant=='nested-payload': lines += ['UIF CONST[42].xxxx']
    lines += [f'MOV TEMP[{p}], '+('CONST[0]' if variant=='finite-payload' else 'IN[2].xyxy')]
    if variant=='nested-payload': lines += ['ELSE',f'MOV TEMP[{p}], IN[2].yxxy','ENDIF']
    lines += [f'MOV TEMP[{b}], IMM[1].zzzz','ELSE',f'MOV TEMP[{w}].{scalar}, '+('IMM[3].xxxx' if variant=='negative-zero' else 'IMM[0].yyyy'),f'MOV TEMP[{b}], IMM[1].zzzz','ENDIF',
              f'FSLT TEMP[{lt}].{scalar}, TEMP[{w}].{ss}, IMM[1].xxxx',
              f'FSLT TEMP[{gt}].{scalar}, IMM[1].yyyy, TEMP[{w}].{ss}',
              f'OR TEMP[{c}].{scalar}, TEMP[{lt}].{ss}, TEMP[{gt}].{ss}',
              f'MUL TEMP[{m}].{scalar}, IMM[0].'+('yyyy, IMM[0].yyyy' if variant=='discarded-nan' else 'zzzz, IMM[0].wwww'),
              f'ADD TEMP[{a}].{scalar}, IMM[0].'+('yyyy' if variant=='discarded-nan' else 'wwww')+f', TEMP[{m}].{ss}',
              f'DIV TEMP[{d}].{scalar}, TEMP[{a}].{ss}, TEMP[{w}].{ss}',
              f'UCMP TEMP[{t}].{scalar}, TEMP[{c}].{ss}, IMM[0].yyyy, TEMP[{d}].{ss}',
              f'LRP TEMP[{r}]{suffix}, TEMP[{t}].{ss}, {payload}, {fallback}',
              f'FSNE TEMP[{s}].{scalar}, TEMP[{t}].{ss}, IMM[0].yyyy',
              f'UCMP TEMP[{out}]{suffix}, TEMP[{s}].{ss}, TEMP[{r}], {fallback}']
    if out != 117: lines += [f'MOV TEMP[117], TEMP[{out}]']
    if form=='b': lines += ['ELSE','MOV TEMP[117], IMM[1].wwww','ENDIF']
    lines += ['ENDIF']*(wraps-(1 if form=='b' else 0))
    # Finite normal exponent carriers encode the bit index through the existing
    # float vertex ABI. Outputs are exact 0/1 bit planes, so RGBA8 is lossless.
    lines += ['USHR TEMP[100].x, IN[1].xxxx, IMM[2].xxxx',
              'AND TEMP[100].x, TEMP[100].xxxx, IMM[2].yyyy',
              'UADD TEMP[100].x, TEMP[100].xxxx, IMM[2].zzzz',
              'USHR TEMP[115], TEMP[117], TEMP[100].xxxx',
              'AND TEMP[115], TEMP[115], IMM[2].wwww',
              'UCMP TEMP[115], TEMP[115], IMM[0].zzzz, IMM[0].yyyy',
              'MOV '+('OUT[1]' if stage=='vertex' else 'OUT[0]')+', TEMP[115]']
    if stage=='vertex': lines += ['MOV OUT[0], IN[0]']
    return '\n'.join(lines+['END'])+'\n',dict(width=w,payload=p,fallback=b,weight=t,result=r,selector=s,scalar=scalar,mask=mask,form=form)


def main():
    cases=[];kernels=[];pairs=[]
    for stage in ('vertex','fragment'):
        for form in ('a','b'):
            for variant,mask in [('plain','xyzw'),('negative-zero','xyzw'),('payload-alias','xyzw'),
                                 ('final-lrp','xyzw'),('final-selector','xyzw'),('selector-weight','xyzw'),
                                 ('old-destination','xyzw'),('swizzle','xyzw'),('fallback-disjoint','x'),
                                 ('nested-payload','xyzw'),('finite-payload','xyzw'),('finite-width','xyzw'),
                                 ('discarded-nan','xyzw')]+[('lane-'+m,m) for m in ('x','y','z','w','xy','xyz')]:
                text,roles=shader(stage,form,mask,variant)
                name=f'{form}-{variant}-{stage}'
                profile='virgl-webgl2-raw-bits-v9' if variant.startswith('finite-') else 'virgl-webgl2-raw-bits-v8'
                cases.append(dict(name=name,stage=stage,text=text,ok=True,expected=dict(profile=profile,constantCount=46)))
                kernels.append(dict(name=name,case=name,stage=stage,roles=roles,variant=variant))
            text,roles=shader(stage,form)
            w,p,b,t,r,s=[roles[k] for k in ('width','payload','fallback','weight','result','selector')];sc=roles['scalar'];ss=sc*4
            mutations={
                'reverse-final':(f'TEMP[{s}].{ss}, TEMP[{r}], TEMP[{b}]',f'TEMP[{s}].{ss}, TEMP[{b}], TEMP[{r}]'),
                'nonzero-missing-width':(f'ELSE\nMOV TEMP[{w}].{sc}, IMM[0].yyyy',f'ELSE\nMOV TEMP[{w}].{sc}, IMM[0].zzzz'),
                'nonzero-zero-arm':(f'IMM[0].yyyy, TEMP[{base_index(form,8)}].{ss}',f'IMM[0].zzzz, TEMP[{base_index(form,8)}].{ss}'),
                'nan-zero-arm':(f'IMM[0].yyyy, TEMP[{base_index(form,8)}].{ss}',f'IMM[3].zzzz, TEMP[{base_index(form,8)}].{ss}'),
                'missing-selected-lane':(f'MOV TEMP[{p}], IN[2].xyxy',f'MOV TEMP[{p}].xyz, IN[2].xyxy'),
                'missing-selected-predecessor':(f'MOV TEMP[{p}], IN[2].xyxy\n', ''),
                'wrong-selector':(f'FSNE TEMP[{s}].{sc}, TEMP[{t}].{ss}',f'FSEQ TEMP[{s}].{sc}, TEMP[{t}].{ss}'),
                'weight-clobber':(f'LRP TEMP[{r}],',f'LRP TEMP[{t}],'),
                'fallback-version':(f'LRP TEMP[{r}],',f'LRP TEMP[{b}],'),
                'predicate-overwrites-width':(f'FSLT TEMP[{base_index(form,3)}].{sc}',f'FSLT TEMP[{w}].{sc}'),
                'precise':('FSNE ','FSNE_PRECISE '),
                'zero-lower-bound':('FLT32 {0.125,4,0.25,0.75}','FLT32 {0,4,0.25,0.75}'),
            }
            for label,(before,after) in mutations.items():
                assert before in text,(form,label)
                cases.append(dict(name=f'reject-{form}-{label}-{stage}',stage=stage,text=text.replace(before,after,1),ok=False,expected=dict(errorCode='parse-error' if label=='predicate-overwrites-width' else 'unsupported-feature')))
            for label,prefix in [('unguarded-use',''),('old-value-use',f'MOV TEMP[{r}], IMM[1].wwww\n')]:
                bad=text.replace('UIF CONST[45].xxxx',prefix+'UIF CONST[45].xxxx',1).replace('USHR TEMP[100].x',f'FSNE TEMP[116], TEMP[{r}], IMM[0].yyyy\nUSHR TEMP[100].x',1)
                cases.append(dict(name=f'reject-{form}-{label}-{stage}',stage=stage,text=bad,ok=False,expected=dict(errorCode='unsupported-feature')))
            body=text[text.index('MOV TEMP[117]'):text.index('USHR TEMP[100]')]
            cases.append(dict(name=f'reject-{form}-two-certificates-{stage}',stage=stage,text=text.replace(body,body+body,1),ok=False,expected=dict(errorCode='unsupported-feature')))
        for depth in (8,9):
            text,_=shader(stage,'a',depth=depth)
            cases.append(dict(name=f'depth-{depth}-{stage}',stage=stage,text=text,ok=depth==8,expected=dict(profile='virgl-webgl2-raw-bits-v8',constantCount=46) if depth==8 else dict(errorCode='unsupported-feature')))
        text,_=shader(stage)
        count=sum(not x.startswith(('VERT','FRAG','DCL','IMM')) and x!='END' for x in text.splitlines())
        for limit in (179,180):
            expanded=text.replace('END\n','MOV TEMP[114], IMM[0]\n'*(limit-count)+'END\n')
            cases.append(dict(name=('instruction-limit' if limit==179 else 'reject-instruction180')+'-'+stage,stage=stage,text=expanded,ok=limit==179,expected=dict(profile='virgl-webgl2-raw-bits-v8',constantCount=46) if limit==179 else dict(errorCode='unsupported-feature')))
        for size in (16384,16385):
            cases.append(dict(name=f'text-{size}-{stage}',stage=stage,text=text+'\n'*(size-len(text)),ok=size==16384,expected=dict(profile='virgl-webgl2-raw-bits-v8',constantCount=46) if size==16384 else dict(errorCode='input-too-large')))
    for form in ('a','b'):
        for stage in ('vertex','fragment'):
            pairs.append(dict(name=f'{form}-{stage}-pair',vertex=f'{form}-plain-vertex' if stage=='vertex' else 'loop::pass-vertex',fragment='loop::pass-fragment' if stage=='vertex' else f'{form}-plain-fragment',ok=True))
    for kernel in kernels:
        pairs.append(dict(name='gpu-'+kernel['case']+'-pair',vertex=kernel['case'] if kernel['stage']=='vertex' else 'loop::pass-vertex',fragment='loop::pass-fragment' if kernel['stage']=='vertex' else kernel['case'],ok=True))
    vectors=[dict(name='defined',selector=1,outer=1,nested=1,payload=[0x3e800000,0x3f400000,0x3e800000,0x3f400000],width=0x40000000),
             dict(name='discarded',selector=0,outer=1,nested=1,payload=[0x3f800000,0x40000000,0x3f000000,0x3e800000],width=0x40000000),
             dict(name='defined-nested-false',selector=1,outer=1,nested=0,payload=[0x3f000000,0x3e800000,0x3f800000,0],width=0x40000000),
             dict(name='outer-discarded',selector=1,outer=0,nested=1,payload=[0x3e800000]*4,width=0x40000000)]
    fixture=dict(schema='selected-lanes-cases-v1',cases=cases,pairs=pairs,kernels=kernels,vectors=vectors)
    (ROOT/'renderer/virgl-shader/tests/selected-lanes-cases.json').write_text(json.dumps(fixture,indent=2)+'\n')
    print('authored',len(cases),'stages',len(kernels),'hardware kernels')


def base_index(form,index):return (0 if form=='a' else 20)+index


if __name__=='__main__':main()
