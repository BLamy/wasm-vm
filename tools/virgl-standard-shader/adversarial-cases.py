#!/usr/bin/env python3
"""Fresh verifier regression inputs and independently specified dynamic plans."""
from pathlib import Path
import json,struct,math,random,sys
OUT=Path(sys.argv[1] if len(sys.argv)>1 else 'target/evidence/virgl-standard-shader-adversarial');NATIVE=OUT/'native';NATIVE.mkdir(parents=True,exist_ok=True)
VS='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n'
FS='FRAG\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: MOV OUT[0], CONST[0]\n1: END\n'
cases=[]
def add(name,a,okay=True,kind=0,b='',code=None):cases.append(dict(name=name,a=a,b=b,okay=okay,kind=kind,code=code))
def prog(stage,decl,body):return ('VERT' if stage==0 else 'FRAG')+'\n'+decl+'\n'+''.join(f'{i}: {s}\n' for i,s in enumerate(body+['END']))
def ordinary(stage,decl='',read='CONST[0]'):
 return prog(stage,decl+'\nDCL OUT[0], '+('COLOR' if stage else 'POSITION'),['MOV OUT[0], '+read])
add('healthy-owned-vertex',VS)
add('healthy-owned-fragment',FS,kind=1)
# Record predictions first. Each rejection changes precisely one grammatical
# boundary in otherwise valid input; its cause cannot hide behind undeclared IO.
for s in ['', ' ', '\n', 'VERT', 'VERT\n', '\tFRAG\n', 'GEOM\n', 'VERTX\n', 'VERT_\n', 'VERT 0\n']:
 add('missing-header-or-end-'+repr(s),s,False)
for op in ['MOV','SIN','COS','RCP','EX2','LG2','SQRT','RSQ','I2F','U2F','INEG','NOT']:
 for mod in ['', '-', '|', '-|']:
  floating=op not in ['I2F','U2F','INEG','NOT']
  operand=mod+'CONST[0].wzyx'+('|' if mod.endswith('|') else '')
  add('modifier-'+op+'-'+mod,prog(1,'DCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR',[op+' TEMP[0], '+operand,'MOV OUT[0], TEMP[0]']),not mod.endswith('|') or floating,kind=1)
for name,decl in [
 ('out-missing-semantic','DCL OUT[1]'),('frag-output-position','DCL OUT[1], POSITION'),('frag-output-generic','DCL OUT[1], GENERIC[0]'),('sv-generic','DCL SV[0], GENERIC[0]'),('sv-position','DCL SV[0], POSITION'),('sv-instance-frag','DCL SV[0], INSTANCEID'),
 ('no-semantic','DCL IN[0]'),('io-range','DCL IN[0..1], GENERIC[0], CONSTANT'),('out-range','DCL OUT[1..2], COLOR[1]'),('imm-decl','DCL IMM[0]'),('masked-temp','DCL TEMP[0].xy'),('masked-const','DCL CONST[0].xy'),('missing-sview-type','DCL SVIEW[0], 2D'),('bad-sview-dim','DCL SVIEW[0], 3D, FLOAT'),('nonconstant-frag-position','DCL IN[0], POSITION, PERSPECTIVE'),('generic-linear','DCL IN[0], GENERIC[0], LINEAR'),('unknown-interp','DCL IN[0], GENERIC[0], FLAT'),('out-color-wrap','DCL OUT[1], COLOR[4294967296]'),('dup-color','DCL OUT[1], COLOR'),('broadcast-extra','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nDCL OUT[1], COLOR[1]')]:
 add(name,prog(1,'DCL CONST[0]\nDCL OUT[0], COLOR\n'+decl,['MOV OUT[0], CONST[0]']),False,kind=1)
for decl in ['DCL OUT[1].x, POSITION','DCL SV[0], COLOR','DCL SV[0], VERTEXID\nDCL SV[1], VERTEXID']:
 add('vertex-decl-'+decl,VS.replace('0: MOV',decl+'\n0: MOV'),False)
for immed in ['IMM[0] UINT32 {01,0,0,0}','IMM[0] UINT32 {-1,0,0,0}','IMM[0] INT32 {2147483648,0,0,0}','IMM[0] INT32 {-2147483648,0,0,0}','IMM[0] FLT32 {0x1234567,0,0,0}','IMM[0] FLT32 {0x12345678f,0,0,0}','IMM[0] FLT32 {0x,0,0,0}','IMM[0] FLT32 {1e-99,0,0,0}','IMM[0] FLT32 {1e+99,0,0,0}','IMM[0] FLT32 {nan,0,0,0}','IMM[0] FLT64 {0,0,0,0}','IMM[0] UINT32 {0,0,0}','IMM[0] UINT32 {0,0,0,0,0}','IMM[0] UINT32 {0,0,0,0} suffix','IMM[0 UINT32 {0,0,0,0}','IMM[1] UINT32 {0,0,0,0}']:
 add(immed,FS.replace('0: MOV',immed+'\n0: MOV'),False,kind=1)
for instruction in ['MOV_SAT_PRECISE_BAD OUT[0], CONST[0]','MOV_PRECISE_SAT OUT[0], CONST[0]','SIN_'+('A'*40)+' OUT[0], CONST[0]','MOV OUT[0]., CONST[0]','MOV OUT[0].zx, CONST[0]','MOV OUT[0], CONST[0].xxy','MOV OUT[0], CONST[0].xyzwx','MOV OUT[0], |CONST[0]','MOV OUT[0], CONST[0] :1','MOV OUT[0], CONST[0] #comment','MOV OUT[0], CONST[0] garbage','MOV OUT[0], CONST[0], CONST[0]','TEX OUT[0], CONST[0], CONST[0], 2D','TEX OUT[0], CONST[0], -SAMP[0], 2D','TEX OUT[0], CONST[0], SAMP[0].xxxx, 2D','TEX OUT[0], CONST[0], SAMP[0], 3D','TEX OUT[0], CONST[0], SAMP[0], 2D','UARL ADDR[0].xy, CONST[0]','ARL_SAT ADDR[0].x, CONST[0]','UARL_PRECISE ADDR[0].x, CONST[0]','MOV OUT[0], CONST[ADDR[1].x]','MOV OUT[0], CONST[ADDR[0].y]','MOV OUT[0], CONST[ADDR[0].x+1]','MOV OUT[0], CONST[ADDR[0].x][0]','MOV OUT[0], CONST[ADDR[0].x].xxxxx','UIF |CONST[0]|','ELSE :0','ENDLOOP :0','BGNLOOP :0','IF CONST[0] :0','BRK :0']:
 add(instruction,prog(1,'DCL CONST[0]\nDCL ADDR[0]\nDCL SAMP[0]\nDCL OUT[0], COLOR',[instruction]),False,kind=1)
for props in ['PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 0','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1']:
 add('property-positive-'+props,FS.replace('DCL CONST',props+'\nDCL CONST'),kind=1)
for prop in ['PROPERTY FS_COORD_ORIGIN','PROPERTY FS_COORD_PIXEL_CENTER','PROPERTY FS_COORD_ORIGIN LOWER_LEFT extra','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 01','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS -1']:
 add(prop,FS.replace('DCL CONST',prop+'\nDCL CONST'),False,kind=1)
for stage in [0,1]:
 for resource,bound in [('CONST',512),('TEMP',512),('SAMP',16),('SVIEW',16),('ADDR',1)]:
  for n in [bound,bound+1,2**32-1,2**32,10**20]:
   decl=f'DCL {resource}[{n}]'+(', 2D, FLOAT' if resource=='SVIEW' else '')
   add('extent-'+str(stage)+decl,(VS if stage==0 else FS).replace('0: MOV',decl+'\n0: MOV'),False,kind=stage)
 for n in [32,33]:
  decl='DCL CONST[0]\nDCL OUT[0], '+('POSITION' if stage==0 else 'COLOR')
  add('depth-'+str(stage)+'-'+str(n),prog(stage,decl,['IF CONST[0]']*n+['MOV OUT[0], CONST[0]']+['ENDIF']*n),n==32,kind=stage)
for sid in range(16):
 v=prog(0,f'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[31].xz, GENERIC[{sid}]',['MOV OUT[0], IN[0]','MOV OUT[31].xz, IN[0]'])
 f=prog(1,f'DCL IN[31].xz, GENERIC[{sid}], '+('CONSTANT' if sid%2 else 'PERSPECTIVE')+'\nDCL OUT[0], COLOR',['MOV OUT[0].xz, IN[31].xxxx'])
 add('partial-pair-'+str(sid),v,kind=2,b=f)
 add('mask-mismatch-'+str(sid),v,False,kind=2,b=f.replace('IN[31].xz,','IN[31].xy,'),code='incompatible-interface')
 add('semantic-mismatch-'+str(sid),v,False,kind=2,b=f.replace(f'GENERIC[{sid}]',f'GENERIC[{(sid+1)%16}]'),code='incompatible-interface')
seeds=[0x243f6a88,0x85a308d3,0x13198a2e]
plans=[]
for seed in seeds:
 n=seed
 def rand():
  global n
  n^=(n<<13)&0xffffffff;n^=n>>17;n^=(n<<5)&0xffffffff;n&=0xffffffff;return n
 for i in range(80):
  val=rand()
  mutations=[f'IN[{512+val}]',f'IN[-{1+val}]',f'IN[0..{val+512}]',f'IN[0][{val}]',f'IN[0{val}]',f'IN[{val+2**32}]',f'IN[ADDR[0].x]',f'IN[0].xyzw_{val}']
  add(f'seed-{seed}-{i}',VS.replace('IN[0]',mutations[i%len(mutations)]),False)
 # quarter/eighth values are exactly represented in f32; all floating domains
 # below are finite and positive for EX2/LG2. Inputs never depend on emission.
 a=[.5+(rand()%12)/16 for _ in range(4)];scale=[.125+(rand()%8)/32 for _ in range(4)];base=[.125,.25,.375,.5]
 body=['MOV TEMP[5], CONST[3]','MOV TEMP[1], CONST[3]','MOV TEMP[2], CONST[3]','MOV TEMP[3], CONST[3]','ARL ADDR[0].x, CONST[0].xxxx','MOV TEMP[0], CONST[ADDR[0].x]','EX2 TEMP[1].yz, TEMP[0].yxwz','LG2 TEMP[2].xw, TEMP[0].zwxy','SIN TEMP[3].xz, -|TEMP[0].wzyx|','COS TEMP[5].zw, TEMP[0].zywx','NOT TEMP[4], IMM[0]','UADD TEMP[4], -TEMP[4], IMM[0]','USEQ TEMP[4], TEMP[4], CONST[4]','UIF TEMP[4].xxxx','MUL TEMP[0], TEMP[0], CONST[2]','ADD TEMP[0].xy, TEMP[0], TEMP[1].yzyz','SUB TEMP[0].zw, TEMP[0], TEMP[2].wxwx','ADD TEMP[0].xz, TEMP[0], -TEMP[3].xzxz','ADD TEMP[0].yw, TEMP[0], TEMP[5].zwzw','MOV OUT[0], TEMP[0]','ELSE','MOV OUT[0], CONST[3]','ENDIF']
 fs=prog(1,'DCL CONST[0..4]\nDCL ADDR[0]\nDCL TEMP[0..5]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {1,2,31,33}',body)
 mul=[x*y for x,y in zip(a,scale)];s=math.sin(-abs(a[3]));e=2**a[1];l=math.log2(a[2]);expected=[mul[0]+e-s,mul[1]+e+math.cos(a[2]),mul[2]-l-s,mul[3]-l+math.cos(a[2])]
 floats=[1.75,0,0,0]+a+scale+base;words=[struct.unpack('<I',struct.pack('<f',x))[0] for x in floats]+[3,5,63,67]
 plans.append(dict(seed=seed,vertexText=VS,fragmentText=fs,a=a,scale=scale,base=base,fragmentWords=words,expected=expected,budget=.00005,width=16,height=16))
 add('novel-'+str(seed),fs,kind=1)

# Complete the reachable rejection arms exposed by source coverage. Predictions
# are literal and are emitted before any native/Wasm result is observed.
for value in ['10000000000','42949672960']:
 add('uint-digit-limit-'+value,FS.replace('0: MOV',f'IMM[0] UINT32 {{{value},0,0,0}}\n0: MOV'),False,kind=1)
for decl in ['DCL IN0','DCL OUT[1], GENERIC 0','DCL OUT[1], GENERIC[0','DCL OUT[1], VERTEXID','DCL OUT[1], INSTANCEID','DCL SVIEW[0] 2D, FLOAT']:
 add('missing-field-vertex-'+decl,VS.replace('0: MOV',decl+'\n0: MOV'),False)
for decl in ['DCL IN[0], COLOR','DCL IN[0], GENERIC[0] PERSPECTIVE','DCL OUT[1], COLOR[0','DCL SV[0], VERTEXID','DCL IN[0], INSTANCEID']:
 add('missing-field-fragment-'+decl,FS.replace('0: MOV',decl+'\n0: MOV'),False,kind=1)
for src in ['CONST0','CONST[0..0]','ADDR[0]','CONST[ADDR0.x]','CONST[ADDR[0.x]','CONST[ADDR[0]x]']:
 add('source-field-'+src,prog(1,'DCL CONST[0]\nDCL ADDR[0]\nDCL OUT[0], COLOR',['MOV OUT[0], '+src]),False,kind=1)
add('undeclared-indirect-address',prog(1,'DCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[ADDR[0].x]']),False,kind=1)
add('no-indirect-bank',prog(1,'DCL ADDR[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[ADDR[0].x]']),False,kind=1)
add('out-write-extent',prog(1,'DCL CONST[0]\nDCL OUT[0].x, COLOR',['MOV OUT[0].xy, CONST[0]']),False,kind=1)
for imm in ['IMM[0] FLT32 {0','IMM[0] FLT32 {1e+,0,0,0}','IMM[0] FLT32 {'+'0.'+'1'*33+',0,0,0}','IMM 0 UINT32 {0,0,0,0}','IMM[0] UINT32 0,0,0,0}']:
 add('literal-closure-'+imm,FS.replace('0: MOV',imm+'\n0: MOV'),False,kind=1)
for op in ['KILL_IF CONST[0]','DDY OUT[0], CONST[0]','ARL OUT[0].x, CONST[0]']:
 add('vertex-stage-destination-'+op,prog(0,'DCL CONST[0]\nDCL OUT[0], POSITION',[op]),False)
tex_decl='DCL CONST[0]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL OUT[0], COLOR'
for op in ['TEX OUT[0], CONST[0], |SAMP[0]|, 2D','TEX OUT[0], CONST[0], SAMP[0] 2D','TEX OUT[0], CONST[0], SAMP[0], 3D']:
 add('texture-token-'+op,prog(1,tex_decl,[op]),False,kind=1)
for name,body in [
 ('bad-label-number',['IF CONST[0] :bad','MOV OUT[0], CONST[0]','ENDIF']),
 ('else-inside-loop',['BGNLOOP','ELSE','BRK','ENDLOOP']),
 ('duplicate-else',['IF CONST[0]','ELSE','ELSE','ENDIF']),
 ('wrong-else-edge',['IF CONST[0] :1','MOV OUT[0], CONST[0]','ELSE','MOV OUT[0], CONST[0]','ENDIF']),
 ('wrong-loop-end',['IF CONST[0]','ENDLOOP']),
 ('zero-loop-edges',['BGNLOOP :0','BRK','ENDLOOP :0','MOV OUT[0], CONST[0]'])]:
 add(name,prog(1,'DCL CONST[0]\nDCL OUT[0], COLOR',body),name=='zero-loop-edges',kind=1)
add('missing-pc-colon',FS.replace('0: MOV','0 MOV'),False,kind=1)
for directive in ['DCL TEMP[0]','IMM[0] UINT32 {0,0,0,0}','PROPERTY FS_COORD_ORIGIN LOWER_LEFT']:
 add('post-instruction-'+directive,FS.replace('1: END',directive+'\n1: END'),False,kind=1)
add('absent-output',prog(0,'',[]),False)
add('position-properties-absent',prog(1,'DCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']),False,kind=1)
add('descending-constant-declarations',prog(1,'DCL CONST[511]\nDCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[511]']),kind=1)
# Run the same dynamic arithmetic through vertex storage and flat word IO too.
for plan in list(plans):
 fs=plan['fragmentText'];decl,numbered=fs.split('\n0: ',1)
 body=[line.split(': ',1)[1] for line in ('0: '+numbered).splitlines() if not line.endswith(': END')]
 decl=decl.split('\n',1)[1].replace('DCL OUT[0], COLOR','DCL OUT[1], GENERIC[0]')
 vertex=prog(0,'DCL IN[0]\nDCL OUT[0], POSITION\n'+decl,['MOV OUT[0], IN[0]']+[line.replace('OUT[0]','OUT[1]') for line in body])
 fragment=prog(1,'DCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]'])
 plan['stage']='fragment'
 other=dict(plan,stage='vertex',vertexText=vertex,fragmentText=fragment,vertexWords=plan['fragmentWords'])
 del other['fragmentWords'];plans.append(other)
 add('novel-vertex-flat-'+str(plan['seed']),vertex,kind=2,b=fragment)

# Incremental declaration repairs, prepared before inspecting their results.
for stage in (0,1):
    for high in (1,17,127,255,511):
        for order in (0,1,2):
            zero='DCL CONST[0]'; other='DCL CONST[%d]'%high
            gap='\nIMM[0] UINT32 {4294967295,2147483648,1,33}\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nDCL TEMP[511]\n'
            decl = zero+'\n'+other if order==0 else other+'\n'+zero if order==1 else other+gap+zero
            add('constant-high-%d-stage-%d-order-%d'%(high,stage,order), ordinary(stage,decl,'CONST[%d].wzyx'%high),kind=stage)
    for seed in (0x41584117,0x7ec311d4,0x5c099cab):
        rng=random.Random(seed)
        for trial in range(8):
            indices=[0,1,3,17,511];rng.shuffle(indices)
            decl=[]
            for i,index in enumerate(indices):
                decl.append('DCL CONST[%d]'%index)
                if i%2==0:decl.append('DCL SAMP[%d]'%i)
            decl.append('DCL SVIEW[15], 2D, FLOAT')
            add('shuffle-%d-%d-%d'%(seed,stage,trial),ordinary(stage,'\n'.join(decl),'CONST[511]'),kind=stage)
    for name,decl,source in [
        ('duplicate-zero','DCL CONST[511]\nDCL CONST[0]\nDCL CONST[0]','CONST[511]'),
        ('overlap-zero','DCL CONST[511]\nDCL CONST[0..3]\nDCL CONST[0]','CONST[511]'),
        ('direct-hole','DCL CONST[511]\nDCL CONST[0]','CONST[1]'),
        ('multidim-zero','DCL CONST[511]\nDCL CONST[0][0]','CONST[511]'),
        ('indirect-decl','DCL ADDR[0]\nDCL CONST[511]\nDCL CONST[ADDR[0].x]','CONST[511]'),
        ('past-end','DCL CONST[512]\nDCL CONST[0]','CONST[0]'),
        ('wrapped','DCL CONST[4294967296]\nDCL CONST[0]','CONST[0]')]:
        add('constant-reject-%d-%s'%(stage,name),ordinary(stage,decl,source),False,kind=stage)
    for slots in ([],[0],[15],[0,15],[3,11,15],list(range(16))):
        for family in ('samp-only','sview-only','both','both-reverse'):
            decl=['DCL CONST[0]']
            for slot in slots:
                s='DCL SAMP[%d]'%slot;v='DCL SVIEW[%d], 2D, FLOAT'%slot
                decl.extend([s] if family=='samp-only' else [v] if family=='sview-only' else [s,v] if family=='both' else [v,s])
            add('unused-%d-%s-%s'%(stage,family,slots),ordinary(stage,'\n'.join(decl)),kind=stage)
    for used,unused in (([0],[15]),([15],[0]),([0,15],[3,11]),([3,11,15],[0])):
        decl=['DCL CONST[0]','DCL TEMP[0..3]']
        for slot in used+unused:decl.extend(['DCL SVIEW[%d], 2D, FLOAT'%slot,'DCL SAMP[%d]'%slot])
        body=['TEX TEMP[%d], CONST[0], SAMP[%d], 2D'%(i,slot) for i,slot in enumerate(used)]
        body+=['MOV OUT[0], TEMP[0]']
        add('used-mask-%d-%s-%s'%(stage,used,unused),prog(stage,'\n'.join(decl)+'\nDCL OUT[0], '+('COLOR' if stage else 'POSITION'),body),kind=stage)
    for used in (0,15):
        for missing in ('SAMP','SVIEW'):
            other=15-used
            decl=['DCL CONST[0]','DCL SAMP[%d]'%other,'DCL SVIEW[%d], 2D, FLOAT'%other]
            decl.append(('DCL SVIEW[%d], 2D, FLOAT' if missing=='SAMP' else 'DCL SAMP[%d]')%used)
            add('unused-does-not-grant-read-%d-%d-%s'%(stage,used,missing),prog(stage,'\n'.join(decl)+'\nDCL OUT[0], '+('COLOR' if stage else 'POSITION'),['TEX OUT[0], CONST[0], SAMP[%d], 2D'%used]),False,kind=stage)
# These reachable arms were absent from the prior recorded matrices.
for name,decl in [('sv-color','DCL SV[0], COLOR'),('sview-comma','DCL SVIEW[0] 2D, FLOAT')]:
    add('guard-closure-'+name,ordinary(1,'DCL CONST[0]\n'+decl),False,kind=1)

# Two fresh, well-defined physical probes combine the repaired token movement
# with unused high sampler declarations. Immutable CPU math is recorded first.
repair_plans=[]
for stage,seed in [('fragment',0x41584117),('vertex',0x7ec311d4)]:
    rng=random.Random(seed);a=[.5+rng.randrange(12)/16 for _ in range(4)];scale=[.125+rng.randrange(8)/32 for _ in range(4)];base=[.125,.25,.375,.5]
    decl='DCL CONST[4]\nIMM[0] UINT32 {1,2,31,33}\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nDCL CONST[1..3]\nDCL TEMP[0..5]\nDCL ADDR[0]\nDCL CONST[0]'
    body=['MOV TEMP[5], CONST[3]','MOV TEMP[1], CONST[3]','MOV TEMP[2], CONST[3]','MOV TEMP[3], CONST[3]','ARL ADDR[0].x, CONST[0].xxxx','MOV TEMP[0], CONST[ADDR[0].x]','EX2 TEMP[1].yz, TEMP[0].yxwz','LG2 TEMP[2].xw, TEMP[0].zwxy','SIN TEMP[3].xz, -|TEMP[0].wzyx|','COS TEMP[5].zw, TEMP[0].zywx','NOT TEMP[4], IMM[0]','UADD TEMP[4], -TEMP[4], IMM[0]','USEQ TEMP[4], TEMP[4], CONST[4]','UIF TEMP[4].xxxx :21','MUL TEMP[0], TEMP[0], CONST[2]','ADD TEMP[0].xy, TEMP[0], TEMP[1].yzyz','SUB TEMP[0].zw, TEMP[0], TEMP[2].wxwx','ADD TEMP[0].xz, TEMP[0], -TEMP[3].xzxz','ADD TEMP[0].yw, TEMP[0], TEMP[5].zwzw','MOV OUT[0], TEMP[0]','ELSE :23','MOV OUT[0], CONST[3]','ENDIF']
    # Explicit branch labels reference ELSE20/ENDIF22 (shifted by one in vertex).
    body[13]='UIF TEMP[4].xxxx :20';body[20]='ELSE :22'
    fragment=prog(1,decl+'\nDCL OUT[0], COLOR',body);vertex=VS
    if stage=='vertex':
        vb=['MOV OUT[0], IN[0]']+[s.replace('OUT[0]','OUT[1]') for s in body]
        vb[14]='UIF TEMP[4].xxxx :21';vb[21]='ELSE :23'
        vertex=prog(0,'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n'+decl,vb)
        fragment=prog(1,'DCL IN[0], GENERIC[0], CONSTANT\nDCL SAMP[14]\nDCL SVIEW[14], 2D, FLOAT\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]'])
    m=[x*y for x,y in zip(a,scale)];e=2**a[1];l=math.log2(a[2]);s=math.sin(-abs(a[3]));c=math.cos(a[2]);expected=[m[0]+e-s,m[1]+e+c,m[2]-l-s,m[3]-l+c]
    words=[struct.unpack('<I',struct.pack('<f',x))[0] for x in [1.75,0,0,0]+a+scale+base]+[3,5,63,67]
    plan=dict(stage=stage,seed=seed,vertexText=vertex,fragmentText=fragment,a=a,scale=scale,base=base,expected=expected,budget=.00005,width=16,height=16)
    plan['vertexWords' if stage=='vertex' else 'fragmentWords']=words;repair_plans.append(plan)
    add('physical-repair-'+stage,vertex,kind=2,b=fragment)
plans.extend(repair_plans)

# Predict the remaining reachable punctuation and optional-label arms.
add('missing-register-open-bracket',FS.replace('CONST[0]\n1: END','CONST 0\n1: END'),False,kind=1)
add('missing-indirect-open-bracket',prog(1,'DCL CONST[0]\nDCL ADDR[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[ADDR.x]']),False,kind=1)
add('unlabelled-bounded-loop',prog(1,'DCL CONST[0]\nDCL OUT[0], COLOR',['BGNLOOP','BRK','ENDLOOP','MOV OUT[0], CONST[0]']),kind=1)

(NATIVE/'cases.json').write_text(json.dumps(dict(cases=cases,seeds=seeds+[0x41584117,0x7ec311d4,0x5c099cab],originals=[]),indent=2)+'\n')
parts=[struct.pack('<I',len(cases))]
for c in cases:
 parts.append(struct.pack('<I',c['kind']))
 for field in ['a','b']:
  b=c[field].encode();parts.extend([struct.pack('<I',len(b)),b])
(NATIVE/'cases.bin').write_bytes(b''.join(parts));(OUT/'physical-plan.json').write_text(json.dumps(plans,indent=2)+'\n')
print(len(cases),'fresh literal predictions,',len(plans),'novel hardware plans')
