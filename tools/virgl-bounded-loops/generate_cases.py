#!/usr/bin/env python3
"""Independently author the counted-table graph and literal bound witnesses."""
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
CASES = []

def expectation(stage, extra=(), count=46):
    bank = dict(stage=stage, slot=0, name=('vs' if stage=='vertex' else 'fs')+'const0', count=count)
    return dict(profile='virgl-webgl2-raw-bits-v12', constantCount=count,
        constantDomains=[dict(kind='constant-bank-finite-f32-v1', **bank)],
        constantAccesses=[dict(kind='constant-bank-static-indirect-v1', **bank, indices=sorted(set(range(10,46))|set(extra)))],
        constantConstraints=[dict(kind='constant-bank-counted-table-i32-v1', **bank, register=9, component=0, maximum=18)])

def shader(stage):
    vertex = stage=='vertex'
    lines = ['VERT' if vertex else 'FRAG', 'DCL IN[0]' if vertex else 'DCL IN[1], GENERIC[0], CONSTANT']
    lines += ['DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]'] if vertex else ['DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]','DCL CONST[0..45]','DCL ADDR[0]',
              'IMM[0] UINT32 {0,1,4,16}','IMM[1] UINT32 {11,176,432,144}',
              'IMM[2] UINT32 {448,8388607,1056964608,0}','IMM[3] FLT32 {0.5,0.25,0,1}']
    lines += '''MOV TEMP[0].x, IMM[3].zzzz
MOV TEMP[1].x, IMM[1].xxxx
MOV TEMP[2].x, IMM[0].wwww
MOV TEMP[3].x, IMM[0].yyyy
BGNLOOP :0
UARL ADDR[0].x, TEMP[1]
MOV TEMP[4].x, CONST[ADDR[0].x].xxxx
FSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx
ISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx
OR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx
UIF TEMP[7].xxxx
BRK
ENDIF
UADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy
SHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz
UADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww
UADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx
USHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz
MOV TEMP[3].x, TEMP[8].xxxx
ENDLOOP :0
USNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx
UIF TEMP[11].xxxx
SHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz
UADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx
USHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz
MOV TEMP[15].x, TEMP[14].yxxx
UARL ADDR[0].x, TEMP[15].xxxx
MOV TEMP[16].x, CONST[ADDR[0].x].xxxx
UADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx
USHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz
UARL ADDR[0].x, TEMP[18].xxxx
MOV TEMP[19], CONST[ADDR[0].x]
MOV TEMP[20].x, TEMP[14].xxxx
UARL ADDR[0].x, TEMP[20].xxxx
MOV TEMP[21], CONST[ADDR[0].x]
ENDIF'''.splitlines()
    lines += ['MOV OUT[1], IN[0]','MOV OUT[0], IN[0]','END'] if vertex else ['MOV OUT[0], IN[1]','END']
    return '\n'.join(lines)+'\n'

def add(name,stage,text,ok=True,extra=(),count=46,code='unsupported-feature'):
    CASES.append(dict(name=name+'-'+stage,stage=stage,text=text,ok=ok,
        expected=expectation(stage,extra,count) if ok else dict(errorCode=code)))

def labeled(text):
    lines=text.splitlines(); ops=[i for i,l in enumerate(lines) if not l.startswith(('VERT','FRAG','DCL','IMM','PROPERTY'))]
    code=[lines[i] for i in ops]
    stack=[]
    for pc,line in enumerate(code):
        if line.startswith('UIF '): stack.append(pc)
        elif line=='ENDIF':
            start=stack.pop(); code[start]+=' :'+str(pc)
    for pc,i in enumerate(ops):lines[i]=str(pc)+': '+code[pc]
    return '\n'.join(lines)+'\n'

def rename(text,offset):
    return re.sub(r'TEMP\[(\d+)\](?!\.\.)',lambda m:'TEMP['+str((int(m[1])+offset)%118)+']',text)

def scalar_lanes(text,lane):
    scalar=set(range(13))|{15,16,17,18,20}
    def change(m):
        n=int(m[1]); selectors=m[2]
        if n not in scalar:return m[0]
        if not selectors:return f'TEMP[{n}].'+lane*4
        return f'TEMP[{n}].'+selectors.replace('x',lane)
    return re.sub(r'TEMP\[(\d+)\](?:\.([xyzw]+))?',change,text.replace('TEMP[14].yxxx','TEMP[14].yyyy'))

def derive_bound():
    sites=[set() for _ in range(4)]; exits=0
    for n in [0,-1,-2147483648]+list(range(1,19)):
        for stop in range(1,max(1,n)+1):
            # Any numeric early exit is possible; the signed terminal forces n.
            exits+=1
            for j in range(1,stop+1): sites[0].add(j+10)
            if stop!=n:
                sites[1].add((144+(stop<<4))>>4)
                sites[2].add((448+16*stop)>>4)
                sites[3].add((432+(stop<<4))>>4)
    expected=[list(range(11,29)),list(range(10,27)),list(range(29,46)),list(range(28,45))]
    assert [sorted(s) for s in sites]==expected
    assert ((448+16*18)>>4)==46  # count19, early exit18 is the unsafe neighbor.
    return dict(schema='counted-table-bound-enumeration-v1', maximum=18,
        countRepresentatives=[0,-1,-2147483648]+list(range(1,19)), possibleExits=exits,
        siteIndices=expected, union=list(range(10,46)), unsafeCount=19, unsafeExit=18, unsafeUpperIndex=46)

def main():
    derive_bound()
    for stage in ('vertex','fragment'):
        text=shader(stage)
        add('loop-small',stage,text)
        add('loop-labels',stage,labeled(text))
        for offset in (1,7,31,61,93):add('renamed-'+str(offset),stage,rename(text,offset))
        for lane in 'yzw':add('scalar-lane-'+lane,stage,scalar_lanes(text,lane))
        add('extent47',stage,text.replace('DCL CONST[0..45]','DCL CONST[1..45]\nDCL CONST[0]'),count=47)
        add('sparse-declarations',stage,text.replace('DCL CONST[0..45]','DCL CONST[9..45]'))
        add('ordinary-extra-index0',stage,text.replace('END\n','UARL ADDR[0].x, IMM[0].xxxx\nMOV TEMP[114], CONST[ADDR[0].x]\nEND\n'),extra=[0])
        add('ordinary-extra-index9',stage,text.replace('IMM[2] UINT32 {448,8388607,1056964608,0}','IMM[2] UINT32 {448,8388607,1056964608,9}').replace('END\n','UARL ADDR[0].x, IMM[2].wwww\nMOV TEMP[114], CONST[ADDR[0].x]\nEND\n'),extra=[9])
        add('loop-numeric',stage,text.replace('MOV TEMP[21], CONST[ADDR[0].x]','MOV TEMP[21], CONST[ADDR[0].x]\nADD TEMP[22], TEMP[19], TEMP[21]'))
        add('initialized-header-exit',stage,text.replace('END\n','ADD TEMP[22], TEMP[4].xxxx, IMM[3].zzzz\nEND\n'))
        for depth in (1,6,7):
            wrapped=text.replace('MOV TEMP[0].x, IMM[3].zzzz','UIF IMM[0].yyyy\n'*depth+'MOV TEMP[0].x, IMM[3].zzzz')
            marker='MOV OUT[1]' if stage=='vertex' else 'MOV OUT[0]'
            wrapped=wrapped.replace(marker,'ENDIF\n'*depth+marker,1)
            add('depth-'+str(depth+2),stage,wrapped,depth<=6)
        ops=sum(not l.startswith(('VERT','FRAG','DCL','IMM','PROPERTY','END\n')) for l in text.splitlines())-1
        for count in (179,180):
            padded=text.replace('END\n','MOV TEMP[114], IMM[0].xxxx\n'*(count-ops)+'END\n')
            add('instruction-limit' if count==179 else 'reject-instruction180',stage,padded,count==179)
        # A syntax error without loop tokens retains the ordinary parse category.
        add('reject-ordinary-parse',stage,('VERT' if stage=='vertex' else 'FRAG')+'\nDCL OUT[0], '+('POSITION' if stage=='vertex' else 'COLOR')+'\nMOV OUT[0] IMM[0]\nEND\n',False,code='parse-error')
        edits={
          'increment-zero':('TEMP[3].xxxx, IMM[0].yyyy','TEMP[3].xxxx, IMM[0].xxxx'),
          'init-j-zero':('MOV TEMP[3].x, IMM[0].yyyy','MOV TEMP[3].x, IMM[0].xxxx'),
          'init-a-wrong':('MOV TEMP[1].x, IMM[1].xxxx','MOV TEMP[1].x, IMM[0].xxxx'),
          'init-b-wrong':('MOV TEMP[2].x, IMM[0].wwww','MOV TEMP[2].x, IMM[0].yyyy'),
          'header-address-wrong':('UARL ADDR[0].x, TEMP[1]','UARL ADDR[0].x, TEMP[2]'),
          'header-component-wrong':('MOV TEMP[4].x, CONST[ADDR[0].x].xxxx','MOV TEMP[4].x, CONST[ADDR[0].x].yyyy'),
          'q-carried':('FSLT TEMP[5].x, TEMP[0].xxxx','FSLT TEMP[5].x, TEMP[8].xxxx'),
          'q-header-alias':('FSLT TEMP[5].x, TEMP[0].xxxx','FSLT TEMP[5].x, TEMP[4].xxxx'),
          'wrong-signed-count':('ISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx','ISGE TEMP[6].x, TEMP[3].xxxx, CONST[8].xxxx'),
          'wrong-count-component':('CONST[9].xxxx','CONST[9].yyyy'),
          'missing-terminal-or':('TEMP[5].xxxx, TEMP[6].xxxx','TEMP[5].xxxx, TEMP[5].xxxx'),
          'wrong-break-predicate':('UIF TEMP[7].xxxx','UIF TEMP[5].xxxx'),
          'increment-shift-wrong':('SHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz','SHL TEMP[9].x, TEMP[3].xxxx, IMM[0].yyyy'),
          'update-b-wrong':('UADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww','UADD TEMP[2].x, TEMP[9].xxxx, IMM[0].zzzz'),
          'update-a-wrong':('UADD TEMP[10].x, IMM[1].yyyy','UADD TEMP[10].x, IMM[1].xxxx'),
          'update-a-shift-wrong':('USHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz','USHR TEMP[1].x, TEMP[10].xxxx, IMM[0].yyyy'),
          'update-j-wrong':('MOV TEMP[3].x, TEMP[8].xxxx','MOV TEMP[3].x, TEMP[9].xxxx'),
          'wrong-tail-test':('USNE TEMP[11]','USEQ TEMP[11]'),
          'wrong-tail-count':('USNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx','USNE TEMP[11].x, TEMP[3].xxxx, CONST[8].xxxx'),
          'wrong-tail-predicate':('UIF TEMP[11].xxxx','UIF TEMP[7].xxxx'),
          'wrong-tail-shift':('SHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz','SHL TEMP[12].x, TEMP[3].xxxx, IMM[0].yyyy'),
          'wrong-tail-numerators':('IMM[1].zwzz, TEMP[12].xxxx','IMM[1].wzzz, TEMP[12].xxxx'),
          'wrong-tail-lanes':('TEMP[13].xyxx','TEMP[13].yxxx'),
          'wrong-prev-copy':('MOV TEMP[15].x, TEMP[14].yxxx','MOV TEMP[15].x, TEMP[14].xxxx'),
          'wrong-prev-address':('UARL ADDR[0].x, TEMP[15].xxxx','UARL ADDR[0].x, TEMP[12].xxxx'),
          'wrong-upper-add':('UADD TEMP[17].x, IMM[2].xxxx','UADD TEMP[17].x, IMM[1].xxxx'),
          'wrong-upper-b':('IMM[2].xxxx, TEMP[2].xxxx','IMM[2].xxxx, TEMP[3].xxxx'),
          'wrong-upper-shift':('USHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz','USHR TEMP[18].x, TEMP[17].xxxx, IMM[0].yyyy'),
          'wrong-lower-copy':('MOV TEMP[20].x, TEMP[14].xxxx','MOV TEMP[20].x, TEMP[14].yyyy'),
          'missing-init-q':('MOV TEMP[0].x, IMM[3].zzzz\n',''),
          'below-break-read':('END\n','MOV TEMP[114].x, TEMP[8].xxxx\nEND\n'),
          'role-clobber':('UADD TEMP[17].x, IMM[2].xxxx','MOV TEMP[2].x, IMM[0].yyyy\nUADD TEMP[17].x, IMM[2].xxxx'),
          'address-pair-clobber':('MOV TEMP[20].x, TEMP[14].xxxx','MOV TEMP[14].x, IMM[0].yyyy\nMOV TEMP[20].x, TEMP[14].xxxx'),
          'tail-nested-if':('UADD TEMP[17].x, IMM[2].xxxx','UIF IMM[0].yyyy\nENDIF\nUADD TEMP[17].x, IMM[2].xxxx'),
          'missing45':('DCL CONST[0..45]','DCL CONST[0..44]'),
          'missing-component45':('DCL CONST[0..45]','DCL CONST[0..44]\nDCL CONST[45].x'),
          'hole27':('DCL CONST[0..45]','DCL CONST[0..26]\nDCL CONST[28..45]'),
          'second-loop':('END\n','BGNLOOP :0\nBRK\nENDLOOP :0\nEND\n'),
          'nested-loop':('BRK\n','BGNLOOP :0\nBRK\nENDLOOP :0\n'),
          'break-outside':('END\n','BRK\nEND\n'),
          'break-operand':('BRK\n','BRK TEMP[0]\n'),
          'loop-label':('ENDLOOP :0','ENDLOOP :1'),
          'loop-no-label':('BGNLOOP :0','BGNLOOP'),
          'continue':('BRK\n','CONT\n'),
          'precise-suffix':('END\n','MOV_PRECISE TEMP[114], IMM[0].xxxx\nEND\n'),
          'trailing-after-end':('END\n','END\nMOV TEMP[114], IMM[0].xxxx\n'),
        }
        for name,(a,b) in edits.items():
            assert a in text,name
            add('reject-'+name,stage,text.replace(a,b),False)
        body=text.splitlines();start=body.index('BGNLOOP :0')
        for offset in range(1,15):
            changed=body[:]; changed.pop(start+offset)
            add('reject-body-missing-'+str(offset),stage,'\n'.join(changed)+'\n',False)
        # Alias each carried/scratch role into the comparison invariant.
        for reg in range(1,11):
            add('reject-alias-q-'+str(reg),stage,re.sub(r'TEMP\['+str(reg)+r'\]', 'TEMP[0]',text),False)
    target=ROOT/'renderer/virgl-shader/tests/bounded-loop-cases.json'
    target.write_text(json.dumps(CASES,indent=2)+'\n')
    print(json.dumps(dict(cases=len(CASES),bound=derive_bound())))

if __name__=='__main__':main()
