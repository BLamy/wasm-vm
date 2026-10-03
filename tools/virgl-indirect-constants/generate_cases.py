#!/usr/bin/env python3
"""Author bounded indirect-address witnesses and literal complete-set expectations."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
CASES = []

def expectation(stage, indices, conditional=False, count=46):
    bank = {'stage': stage, 'slot': 0, 'name': ('vs' if stage == 'vertex' else 'fs')+'const0', 'count': count}
    return {'profile': 'virgl-webgl2-raw-bits-v'+('11' if conditional else '10'), 'constantCount': count,
            'constantDomains': [dict(kind='constant-bank-finite-f32-v1', **bank)] if conditional else None,
            'constantAccesses': [dict(kind='constant-bank-static-indirect-v1', **bank, indices=indices)]}

def shader(stage, body, terminal=True):
    vertex = stage == 'vertex'
    lines = ['VERT' if vertex else 'FRAG']
    lines += [f'DCL IN[{i}]'+('' if vertex else f', GENERIC[{i}], PERSPECTIVE') for i in range(3)]
    lines += ['DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]'] if vertex else ['DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]', 'DCL CONST[0..45]', 'DCL ADDR[0]',
              'IMM[0] UINT32 {0, 1, 23, 45}', 'IMM[1] UINT32 {31, 46, 2147483648, 4294967295}',
              'IMM[2] UINT32 {8388607, 1056964608, 1065353216, 4}',
              'IMM[3] FLT32 {0, 1, 0.5, 2}', 'IMM[4] UINT32 {176, 144, 432, 448}']
    lines += body
    if terminal: lines += ['MOV OUT[1], TEMP[0]', 'MOV OUT[0], IN[0]', 'END'] if vertex else ['MOV OUT[0], TEMP[0]', 'END']
    return '\n'.join(lines)+'\n'

def finish(source='CONST[ADDR[0].x]'):
    return ['MOV TEMP[1], '+source, 'AND TEMP[0], TEMP[1], IMM[2].xxxx', 'OR TEMP[0], TEMP[0], IMM[2].yyyy']

def add(name, stage, body, indices=None, conditional=False, code='unsupported-feature', mutate=None, count=46, terminal=True):
    text = shader(stage, body, terminal)
    if mutate: text = mutate(text)
    CASES.append({'name':name+'-'+stage,'stage':stage,'text':text,'ok':indices is not None,
                  'expected':expectation(stage, indices, conditional, count) if indices is not None else {'errorCode':code}})

def main():
    for stage in ('vertex','fragment'):
        for index in range(46):
            add('literal-'+str(index),stage,['UARL ADDR[0].x, IMM[0].xxxx']+finish(),[index],
                mutate=lambda s,i=index:s.replace('UINT32 {0, 1, 23, 45}',f'UINT32 {{{i}, 1, 23, 45}}'))
        for selector,index in zip('xyzw',(0,1,23,45)):
            add('uarL-swizzle-'+selector,stage,['UARL ADDR[0].x, IMM[0].'+selector*4]+finish(),[index])
        add('scalar-default-x',stage,['UARL ADDR[0].x, IMM[0]']+finish(),[0])
        add('minimal-bank',stage,['UARL ADDR[0].x, IMM[0].xxxx']+finish(),[0],count=1,mutate=lambda s:s.replace('DCL CONST[0..45]','DCL CONST[0]'))
        add('single-interior-declaration',stage,['UARL ADDR[0].x, IMM[0].zzzz']+finish(),[23],count=24,mutate=lambda s:s.replace('DCL CONST[0..45]','DCL CONST[23]'))
        add('upper-mask',stage,['AND TEMP[2].x,CONST[9].xxxx,IMM[1].xxxx','OR TEMP[2].x,TEMP[2].xxxx,IMM[0].yyyy','UARL ADDR[0].x,TEMP[2].xxxx']+finish(),[32,33,36,37,40,41,44,45],mutate=lambda s:s.replace('UINT32 {31, 46','UINT32 {13, 46').replace('UINT32 {0, 1, 23, 45}','UINT32 {0, 32, 23, 45}'))
        add('reject-mask-includes46',stage,['AND TEMP[2].x,CONST[9].xxxx,IMM[1].xxxx','UARL ADDR[0].x,TEMP[2].xxxx']+finish(),mutate=lambda s:s.replace('UINT32 {31, 46','UINT32 {46, 46'))
        add('scalar-x-only',stage,['MOV TEMP[117].y, IMM[0].wwww','UARL ADDR[0].x, TEMP[117].yxxx']+finish(),[45])
        add('move-chain',stage,['MOV TEMP[116].z, IMM[0].zzzz','MOV TEMP[117].y, TEMP[116].zzzz','UARL ADDR[0].x, TEMP[117].yyyy']+finish(),[23])
        add('address-reassignment',stage,['UARL ADDR[0].x, IMM[0].xxxx','MOV TEMP[2], CONST[ADDR[0].x]',
                'UARL ADDR[0].x, IMM[0].wwww']+finish(),[0,45])
        add('indirect-masked-swizzle',stage,['UARL ADDR[0].x, IMM[0].zzzz','MOV TEMP[1].x, CONST[ADDR[0].x].wwww','MOV TEMP[1].z, CONST[ADDR[0].x].yyyy',
                'AND TEMP[0], TEMP[1].zxzx, IMM[2].xxxx','OR TEMP[0], TEMP[0], IMM[2].yyyy'],[23])
        add('scalar-declaration-x',stage,['UARL ADDR[0].x, IMM[0].yyyy']+finish(),[1],mutate=lambda s:s.replace('DCL ADDR[0]','DCL ADDR[0].x'))
        add('extent47',stage,['UARL ADDR[0].x, IMM[0].wwww']+finish(),[45],count=47,
                mutate=lambda s:s.replace('DCL CONST[0..45]','DCL CONST[1..45]\nDCL CONST[0]'))
        for mask in (0,1,3,7,15,31):
            add('dynamic-mask-'+str(mask),stage,['AND TEMP[2].x, CONST[9].xxxx, IMM[1].xxxx','UARL ADDR[0].x, TEMP[2].xxxx']+finish(),list(range(mask+1)),
                mutate=lambda s,m=mask:s.replace('UINT32 {31, 46',f'UINT32 {{{m}, 46'))
        joined=[0,1,4,5,8,9,12,13,32,33,36,37,40,41,44,45]
        for pred,indices in [('IMM[0].xxxx',[45]),('IMM[0].yyyy',[0]),('IN[2].xxxx',joined),('CONST[9].xxxx',joined)]:
            add('select-'+pred.replace('[','').replace(']',''),stage,['UCMP TEMP[2].x, '+pred+', IMM[0].xxxx, IMM[0].wwww','UARL ADDR[0].x, TEMP[2].xxxx']+finish(),indices)
        for pred in ('IN[2].xxxx','IMM[0].yyyy','IMM[0].xxxx'):
            add('branch-'+pred.replace('[','').replace(']',''),stage,['UIF '+pred,'UARL ADDR[0].x, IMM[0].xxxx','ELSE','UARL ADDR[0].x, IMM[0].wwww','ENDIF']+finish(),joined)
        add('no-else-entry',stage,['UARL ADDR[0].x, IMM[0].xxxx','UIF IN[2]','UARL ADDR[0].x, IMM[0].wwww','ENDIF']+finish(),joined)
        for depth in (1,8):
            add('depth-'+str(depth),stage,['UARL ADDR[0].x, IMM[0].zzzz']+['UIF IN[2]']*depth+['UARL ADDR[0].x, IMM[0].zzzz']+['ENDIF']*depth+finish(),[23])
        add('read-as-predicate',stage,['UARL ADDR[0].x, IMM[0].yyyy','UIF CONST[ADDR[0].x].wxyz','MOV TEMP[0], IMM[3]','ELSE','MOV TEMP[0], IN[1]','ENDIF'],[1])
        # Exact captured arithmetic: j literals and offsets are authored independently.
        for shift in (False,True):
            for component,offset in zip('xyzw',(176,144,432,448)):
                for j in (0,1,17):
                    before=['MOV TEMP[2].x, IMM[0].xxxx']
                    if shift: before+=['SHL TEMP[2].x, TEMP[2].xxxx, IMM[2].wwww']
                    before+=['UADD TEMP[2].x, TEMP[2].xxxx, IMM[4].'+component*4,'USHR TEMP[2].x, TEMP[2].xxxx, IMM[2].wwww','UARL ADDR[0].x, TEMP[2].xxxx']
                    index=((j<<4) if shift else j)+offset; index >>=4
                    add('captured-'+str(int(shift))+'-'+str(offset)+'-'+str(j),stage,before+finish(),[index],mutate=lambda s,j=j:s.replace('UINT32 {0, 1, 23, 45}',f'UINT32 {{{j}, 1, 23, 45}}'))
        for op,args in [('ADD','CONST[ADDR[0].x],IMM[3].yyyy'),('MUL','CONST[ADDR[0].x],IMM[3].yyyy'),
                        ('MAD','CONST[ADDR[0].x],IMM[3].yyyy,IMM[3].xxxx'),('DIV','CONST[ADDR[0].x],IMM[3].yyyy'),
                        ('MAX','CONST[ADDR[0].x],IMM[3].yyyy'),('FRC','CONST[ADDR[0].x]'),
                        ('LRP','IMM[3].zzzz,CONST[ADDR[0].x],IMM[3].yyyy'),('DP3','CONST[ADDR[0].x],IMM[3].yyyy'),
                        ('RCP','CONST[ADDR[0].x].yyyy'),('RSQ','CONST[ADDR[0].x].yyyy')]:
            add('numeric-'+op,stage,['UARL ADDR[0].x,IMM[0].zzzz',op+' TEMP[0], '+args],[23],True)
        for name,payload in [('mov',['MOV TEMP[1],CONST[ADDR[0].x]']),
                ('select',['UCMP TEMP[1],IN[2],CONST[ADDR[0].x],CONST[0]']),
                ('join',['UIF IN[2]','MOV TEMP[1],CONST[ADDR[0].x]','ELSE','MOV TEMP[1],CONST[45]','ENDIF'])]:
            add('numeric-provenance-'+name,stage,['UARL ADDR[0].x,IMM[0].zzzz']+payload+['ADD TEMP[0],TEMP[1],IMM[3].yyyy'],[23],True)
        add('numeric-direct-authority',stage,['UARL ADDR[0].x,IMM[0].zzzz']+finish()+['ADD TEMP[0],CONST[0],IMM[3].yyyy'],[23],True)
        add('numeric-negation',stage,['UARL ADDR[0].x,IMM[0].zzzz','ADD TEMP[0],-CONST[ADDR[0].x],IMM[3].yyyy'],[23],True)
        good=['UARL ADDR[0].x,IMM[0].xxxx']+finish()
        for name,source in [('one-past','IMM[1].yyyy'),('sign-bit','IMM[1].zzzz'),('uint-max','IMM[1].wwww'),
                            ('float-one','IMM[3].yyyy'),('unbounded-bank','CONST[9].xxxx'),('unbounded-input','IN[2].xxxx')]:
            add('reject-'+name,stage,['UARL ADDR[0].x,'+source]+finish())
        for name,body in {
            'unwritten':finish(), 'one-sided':['UIF IN[2]','UARL ADDR[0].x,IMM[0].xxxx','ENDIF']+finish(),
            'known-true-one-sided':['UIF IMM[0].yyyy','UARL ADDR[0].x,IMM[0].xxxx','ENDIF']+finish(),
            'other-arm':['UIF IN[2]','UARL ADDR[0].x,IMM[0].xxxx','ELSE']+finish()+['ENDIF'],
            'invalid-hidden-arm':['UIF IMM[0].yyyy','UARL ADDR[0].x,IMM[0].xxxx','ELSE','UARL ADDR[0].x,IMM[1].yyyy','ENDIF']+finish(),
            'unknown-add':['UADD TEMP[2].x,CONST[9].xxxx,IMM[0].xxxx','UARL ADDR[0].x,TEMP[2].xxxx']+finish(),
            'select-unbounded':['UCMP TEMP[2].x,IN[2],IMM[0].xxxx,CONST[9].xxxx','UARL ADDR[0].x,TEMP[2].xxxx']+finish(),
            'address-reuse':['UARL ADDR[0].x,IMM[0].xxxx','UARL ADDR[0].x,CONST[ADDR[0].x]']+finish(),
            'dead-address':['UARL ADDR[0].x,IMM[0].xxxx','MOV TEMP[0],IMM[3]'],
            'numeric-output':['UARL ADDR[0].x,IMM[0].xxxx','MOV TEMP[0],CONST[ADDR[0].x]'],
            'numeric-mutation':['UARL ADDR[0].x,IMM[0].xxxx','MOV TEMP[1],CONST[ADDR[0].x]','NOT TEMP[1],TEMP[1]','ADD TEMP[0],TEMP[1],IMM[3]'],
            'suffix-loop':good+['BGNLOOP','ENDLOOP'], 'suffix-precise':good+['MOV_PRECISE TEMP[0],IMM[3]'],
        }.items(): add('reject-'+name,stage,body)
        for op,args in [('AND','TEMP[2],CONST[9]'),('OR','TEMP[2],CONST[9]'),('NOT','TEMP[2]'),('UADD','TEMP[2],CONST[9]')]:
            # AND(0,unknown) stays zero; use known45 so AND may still produce bounded set (legitimate).
            if op=='AND': continue
            add('reject-stale-'+op,stage,['MOV TEMP[2],IMM[0].wwww',op+' TEMP[2].x,'+args,'UARL ADDR[0].x,TEMP[2].xxxx']+finish())
        mutations={
          'missing-declaration':('DCL ADDR[0]\n',''), 'duplicate-declaration':('DCL ADDR[0]','DCL ADDR[0]\nDCL ADDR[0]'),
          'address-one':('ADDR[0]','ADDR[1]'), 'address-y':('ADDR[0].x','ADDR[0].y'),
          'address-z':('ADDR[0].x','ADDR[0].z'), 'address-w':('ADDR[0].x','ADDR[0].w'),
          'address-mask':('UARL ADDR[0].x','UARL ADDR[0].xy'), 'dst-default':('UARL ADDR[0].x','UARL ADDR[0]'),
          'dst-temp':('UARL ADDR[0].x','UARL TEMP[0].x'), 'dst-out':('UARL ADDR[0].x','UARL OUT[0].x'),
          'uarL-extra':('UARL ADDR[0].x,IMM[0].xxxx','UARL ADDR[0].x,IMM[0].xxxx,IMM[0]'),
          'uarL-minus':('UARL ADDR[0].x,IMM[0].xxxx','UARL ADDR[0].x,-IMM[0].xxxx'),
          'uarL-no-source':('UARL ADDR[0].x,IMM[0].xxxx','UARL ADDR[0].x'),
          'offset':('CONST[ADDR[0].x]','CONST[ADDR[0].x+1]'), 'negative-offset':('CONST[ADDR[0].x]','CONST[ADDR[0].x-1]'),
          'slot-one':('CONST[ADDR[0].x]','CONST[1][ADDR[0].x]'), 'dimension':('CONST[ADDR[0].x]','CONST[ADDR[0].x][0]'),
          'temp-indirect':('CONST[ADDR[0].x]','TEMP[ADDR[0].x]'), 'imm-indirect':('CONST[ADDR[0].x]','IMM[ADDR[0].x]'),
          'undeclared-constant':('DCL CONST[0..45]\n',''),
        }
        for name,(before,after) in mutations.items():add('reject-'+name,stage,good,code='parse-error' if name=='slot-one' else 'unsupported-feature',mutate=lambda s,b=before,a=after:s.replace(b,a))
        add('reject-declaration-hole',stage,['AND TEMP[2].x,CONST[9].xxxx,IMM[1].xxxx','UARL ADDR[0].x,TEMP[2].xxxx']+finish(),
            mutate=lambda s:s.replace('DCL CONST[0..45]','DCL CONST[0..16]\nDCL CONST[18..45]'))
        add('reject-extent47-index46',stage,['UARL ADDR[0].x,IMM[1].yyyy']+finish(),mutate=lambda s:s.replace('DCL CONST[0..45]','DCL CONST[1..45]\nDCL CONST[0]'))
        add('reject-wrong-prefix',stage,['1: UARL ADDR[0].x,IMM[0].xxxx']+finish(),code='parse-error')
        final=2 if stage=='vertex' else 1
        body=['UARL ADDR[0].x,IMM[0].xxxx']*(179-final-3)+finish()
        add('instruction-limit',stage,body,[0]);add('reject-instruction-limit',stage,['UARL ADDR[0].x,IMM[0].xxxx']+body,code='parse-error')
    path=ROOT/'renderer/virgl-shader/tests/indirect-constant-cases.json'
    require_names=[c['name'] for c in CASES];assert len(require_names)==len(set(require_names))
    path.write_text(json.dumps(CASES,indent=2)+'\n');print(len(CASES),'authored cases')
if __name__=='__main__':main()
