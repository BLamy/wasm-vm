#!/usr/bin/env python3
"""Fresh selected-lane compiler attacks; independent of recorded compiler results."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess


def shader(stage, form, mask, seed, alias=False):
    rng = random.Random(seed)
    w, p, b, lt, gt, c, m, a, d, t, r, s = rng.sample(range(30, 90), 12)
    if alias:
        r = p
    lane = 'xyzw'[seed % 4]
    ss = lane * 4
    swizzle = ''.join(rng.sample(list('xyzw'), 4))
    suffix = '' if mask == 'xyzw' else '.' + mask
    width, lower, upper = (4, .25, 8) if seed % 2 else (8, .5, 16)
    roles = dict(w=w, p=p, b=b, lt=lt, gt=gt, c=c, m=m, a=a, d=d, t=t, r=r, s=s, lane=lane, ss=ss, swizzle=swizzle)
    lines = ['VERT' if stage == 'vertex' else 'FRAG']
    lines += ['DCL IN[0]', 'DCL IN[2]', 'DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]'] if stage == 'vertex' else ['DCL IN[2], GENERIC[1], CONSTANT', 'DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]', 'DCL CONST[0..45]', f'IMM[0] FLT32 {{{width},0,1,0.5}}', f'IMM[1] FLT32 {{{lower},{upper},0.125,0.875}}', 'IMM[2] UINT32 {2143289345,2147483648,0,0}', 'MOV TEMP[117], IMM[1].zzzz']
    if form == 'b':
        lines += ['UIF CONST[43].xxxx']
    lines += ['UIF CONST[45].xxxx', f'MOV TEMP[{w}].{lane}, IMM[0].xxxx', 'UIF CONST[42].xxxx', f'MOV TEMP[{p}], IN[2].xyxy', 'ELSE', f'MOV TEMP[{p}], IN[2].yxxy', 'ENDIF', f'MOV TEMP[{b}], IMM[1].zzzz', 'ELSE', f'MOV TEMP[{w}].{lane}, IMM[0].yyyy', f'MOV TEMP[{b}], IMM[1].zzzz', 'ENDIF', f'FSLT TEMP[{lt}].{lane}, TEMP[{w}].{ss}, IMM[1].xxxx', f'FSLT TEMP[{gt}].{lane}, IMM[1].yyyy, TEMP[{w}].{ss}', f'OR TEMP[{c}].{lane}, TEMP[{lt}].{ss}, TEMP[{gt}].{ss}', f'MUL TEMP[{m}].{lane}, IMM[0].zzzz, IMM[0].wwww', f'ADD TEMP[{a}].{lane}, IMM[0].wwww, TEMP[{m}].{ss}', f'DIV TEMP[{d}].{lane}, TEMP[{a}].{ss}, TEMP[{w}].{ss}', f'UCMP TEMP[{t}].{lane}, TEMP[{c}].{ss}, IMM[0].yyyy, TEMP[{d}].{ss}', f'LRP TEMP[{r}]{suffix}, TEMP[{t}].{ss}, TEMP[{p}].{swizzle}, TEMP[{b}]', f'FSNE TEMP[{s}].{lane}, TEMP[{t}].{ss}, IMM[0].yyyy', f'UCMP TEMP[117]{suffix}, TEMP[{s}].{ss}, TEMP[{r}], TEMP[{b}]']
    if form == 'b':
        lines += ['ELSE', 'MOV TEMP[117], IMM[1].wwww', 'ENDIF']
    lines += [('MOV OUT[1], TEMP[117]' if stage == 'vertex' else 'MOV OUT[0], TEMP[117]')]
    if stage == 'vertex':
        lines += ['MOV OUT[0], IN[0]']
    return '\n'.join(lines + ['END']) + '\n', roles


def changed(text, before, after):
    assert before in text, before
    return text.replace(before, after)


def attacks(stage, form, seed):
    text, q = shader(stage, form, 'xyzw', seed)
    w,p,b,lt,gt,c,m,a,d,t,r,s = [q[k] for k in ('w','p','b','lt','gt','c','m','a','d','t','r','s')]
    l, ss = q['lane'], q['ss']
    yield 'reverse-final', changed(text, f'TEMP[{s}].{ss}, TEMP[{r}], TEMP[{b}]', f'TEMP[{s}].{ss}, TEMP[{b}], TEMP[{r}]')
    yield 'selector-changed', changed(text, 'FSNE ', 'FSEQ ')
    yield 'nonzero-missing-width', changed(text, f'ELSE\nMOV TEMP[{w}].{l}, IMM[0].yyyy', f'ELSE\nMOV TEMP[{w}].{l}, IMM[0].wwww')
    yield 'nan-missing-width', changed(text, f'ELSE\nMOV TEMP[{w}].{l}, IMM[0].yyyy', f'ELSE\nMOV TEMP[{w}].{l}, IMM[2].xxxx')
    yield 'nonzero-zero-arm', changed(text, f'IMM[0].yyyy, TEMP[{d}].{ss}', f'IMM[0].zzzz, TEMP[{d}].{ss}')
    yield 'nan-zero-arm', changed(text, f'IMM[0].yyyy, TEMP[{d}].{ss}', f'IMM[2].xxxx, TEMP[{d}].{ss}')
    yield 'missing-selected-lane', changed(text, f'MOV TEMP[{p}],', f'MOV TEMP[{p}].xyz,')
    yield 'nested-missing-one-selected-lane', text.replace(f'MOV TEMP[{p}], IN[2].xyxy', f'MOV TEMP[{p}].xyz, IN[2].xyxy', 1)
    yield 'aliased-weight-clobber', changed(changed(text, f'LRP TEMP[{r}],', f'LRP TEMP[{t}],'), f'TEMP[{s}].{ss}, TEMP[{r}],', f'TEMP[{s}].{ss}, TEMP[{t}],')
    yield 'aliased-selector-clobber', changed(changed(text, f'FSNE TEMP[{s}].{l}', f'FSNE TEMP[{r}].{l}'), f'TEMP[{s}].{ss}, TEMP[{r}],', f'TEMP[{r}].{ss}, TEMP[{r}],')
    yield 'predicate-clobber', changed(changed(text, f'FSLT TEMP[{gt}].{l}', f'FSLT TEMP[{lt}].{l}'), f'TEMP[{lt}].{ss}, TEMP[{gt}].{ss}', f'TEMP[{lt}].{ss}, TEMP[{lt}].{ss}')
    yield 'width-clobber', changed(changed(text, f'FSLT TEMP[{lt}].{l}', f'FSLT TEMP[{w}].{l}'), f'TEMP[{lt}].{ss}, TEMP[{gt}].{ss}', f'TEMP[{w}].{ss}, TEMP[{gt}].{ss}')
    yield 'condition-clobber', changed(changed(text, f'MUL TEMP[{m}].{l}', f'MUL TEMP[{c}].{l}'), f'IMM[0].wwww, TEMP[{m}].{ss}', f'IMM[0].wwww, TEMP[{c}].{ss}')
    yield 'width-numeric-clobber', changed(changed(text, f'MUL TEMP[{m}].{l}', f'MUL TEMP[{w}].{l}'), f'IMM[0].wwww, TEMP[{m}].{ss}', f'IMM[0].wwww, TEMP[{w}].{ss}')
    for name, target in [('payload-clobber', p), ('fallback-producer-clobber', b)]:
        yield name, changed(changed(text, f'MUL TEMP[{m}].{l}', f'MUL TEMP[{target}].{l}'), f'IMM[0].wwww, TEMP[{m}].{ss}', f'IMM[0].wwww, TEMP[{target}].{ss}')
    yield 'fallback-selector-clobber', changed(changed(text, f'FSNE TEMP[{s}].{l}', f'FSNE TEMP[{b}].{l}'), f'TEMP[{s}].{ss}, TEMP[{r}],', f'TEMP[{b}].{ss}, TEMP[{r}],')
    yield 'fallback-publication-clobber', changed(changed(text, f'LRP TEMP[{r}],', f'LRP TEMP[{b}],'), f'TEMP[{s}].{ss}, TEMP[{r}],', f'TEMP[{s}].{ss}, TEMP[{b}],')
    yield 'vector-predicate', changed(text, f'FSLT TEMP[{lt}].{l}', f'FSLT TEMP[{lt}].xy')
    yield 'nonliteral-lower', changed(text, f'TEMP[{w}].{ss}, IMM[1].xxxx', f'TEMP[{w}].{ss}, TEMP[{b}].xxxx')
    yield 'no-else-predecessor', changed(text, f'ELSE\nMOV TEMP[{w}].{l}, IMM[0].yyyy\nMOV TEMP[{b}], IMM[1].zzzz\n', '')
    full = changed(text, f'MOV TEMP[{w}].{l}, IMM[0].yyyy', f'MOV TEMP[{w}].{l}, IMM[0].yyyy\nMOV TEMP[{p}], IN[2].xyxy')
    yield 'fully-defined-graph-unrelated-missing', changed(full, 'END\n', 'MOV TEMP[116], TEMP[115]\nEND\n')
    yield 'old-destination-unconditional-read', changed(changed(text, 'UIF CONST[45].xxxx', f'MOV TEMP[{r}], IMM[1].wwww\nUIF CONST[45].xxxx'), 'END\n', f'FSNE TEMP[116], TEMP[{r}], IMM[0].yyyy\nEND\n')
    yield 'precise', changed(text, 'FSNE ', 'FSNE_PRECISE ')
    body = text[text.index('UIF CONST[45]'):text.index('MOV OUT[')]
    if form == 'a':
        yield 'second-graph', changed(text, body, body + body)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--profile-dir',type=Path)
    args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ)
    if args.profile_dir:
        args.profile_dir.mkdir(parents=True,exist_ok=True);env['LLVM_PROFILE_FILE']=str(args.profile_dir.resolve()/'%m.%p.profraw')
    records=[]
    def check(name,stage,text,wanted):
        p=subprocess.run([str(args.binary.resolve()),stage],input=text.encode(),capture_output=True,check=True,env=env,timeout=10);assert not p.stderr,p.stderr
        result=json.loads(p.stdout);record={'name':name,'stage':stage,'text':text,'textSha256':hashlib.sha256(text.encode()).hexdigest(),'predictedOk':wanted,'result':result};records.append(record)
        assert result['ok'] is wanted,(name,result)
        if wanted:assert result['glsl'].count('/* guarded interpolation */')==1,name
    for stage in ('vertex','fragment'):
        for form in ('a','b'):
            for mask_bits in range(1,16):
                mask=''.join(c for i,c in enumerate('xyzw') if mask_bits&(1<<i))
                for alias in (False,True):
                    seed=0x923f0157+mask_bits*197+(form=='b')*571+(stage=='fragment')*941+(alias)*1249
                    text,_=shader(stage,form,mask,seed,alias);check(f'{form}/mask-{mask}/alias-{alias}',stage,text,mask in ('x','y','z','w','xy','xyz','xyzw'))
            for name,text in attacks(stage,form,0x817ace36+(form=='b')*291+(stage=='fragment')*117):check(form+'/'+name,stage,text,False)
    for stage in ('vertex','fragment'):
        legacy=('VERT\nDCL TEMP[0]\nDCL OUT[0], POSITION\nMOV OUT[0], TEMP[0]\nEND\n' if stage=='vertex' else 'FRAG\nDCL TEMP[0]\nDCL OUT[0], COLOR\nMOV OUT[0], TEMP[0]\nEND\n')
        check('legacy-missing-no-IR',stage,legacy,False)
    args.output.write_text(json.dumps({'schema':'selected-lanes-fresh-verifier-attacks-v1','status':'passed','positive':sum(r['predictedOk'] for r in records),'negative':sum(not r['predictedOk'] for r in records),'records':records},indent=2)+'\n')
    print('fresh selected-lane attacks:',len(records),'passed')


if __name__=='__main__':main()
