#!/usr/bin/env python3
import hashlib,json,os,pathlib,random,struct,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
R=ROOT/'renderer/virgl-shader'
HEAD='347dc59d60fa7e77cec58b14a36bcc8adb88db8d'
PARENT='f643c50d3379e4e27a1daf1784f67287fe36d562'
def sha(x): return hashlib.sha256(x).hexdigest()
def save(name,x): (OUT/name).write_text(json.dumps(x,indent=2)+'\n')
def src(stage='fragment',body='OR TEMP[117], CONST[45], IMM[0]\n',out='TEMP[117]',imm=[0,0,0,0],extra='',encode=True):
 h=('VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n' if stage=='vertex' else 'FRAG\nDCL OUT[0], COLOR\n')
 h+='DCL TEMP[0..117]\nDCL CONST[0..45]\n'
 h+=f'IMM[0] UINT32 {{{", ".join(map(str,imm))}}}\nIMM[1] UINT32 {{8388607, 8388607, 8388607, 8388607}}\nIMM[2] UINT32 {{1056964608, 1056964608, 1056964608, 1056964608}}\n'+extra+body
 if encode: h+=f'AND TEMP[116], {out}, IMM[1]\nOR TEMP[116], TEMP[116], IMM[2]\n'; out='TEMP[116]'
 return h+(f'MOV OUT[0], IN[0]\nMOV OUT[1], {out}\n' if stage=='vertex' else f'MOV OUT[0], {out}\n')+'END\n'
cases=[]
def add(name,text,ok=None,stage='fragment',legacy=False): cases.append(dict(name=name,stage=stage,text=text,ok=ok,legacy=legacy))
words=[0,1,2,0x7fffffff,0x80000000,0xffffffff,0xaaaaaaaa,0x55555555,0x7f800001,0x7fc12345,0xff800000,0x7f800000,0x00000001,0x007fffff,0x80000001,0x3f800000]
for stage in ['vertex','fragment']:
 for op in ['AND','OR','NOT','SHL','USHR']:
  for i in range(0,len(words),4):
   imm=words[i:i+4]
   body=f'{op} TEMP[117], CONST[45]'+('' if op=='NOT' else ', IMM[0]')+'\n'
   add(f'{stage}-{op}-{i}',src(stage,body,imm=imm),True,stage)
 for op in ['MOV','AND','OR','NOT','SHL','USHR']:
  for mask in ['x','y','z','w','xy','xyz','xyzw']:
   body='OR TEMP[117], CONST[45], IMM[0]\n'+f'{op} TEMP[117].{mask}, TEMP[117].wzyx'+('' if op in ['MOV','NOT'] else ', CONST[44].ywxz')+'\n'
   # .xyzw destination is excluded by the existing textual profile.
   add(f'{stage}-alias-{op}-{mask}',src(stage,body),mask!='xyzw',stage)
 for consumed in range(4):
  for source_lane in range(4):
   c='xyzw'[consumed]; s='xyzw'[source_lane]
   body=f'MOV TEMP[117].{s}, IMM[0]\nOR TEMP[116].{c}, TEMP[117].{s*4}, IMM[2]\n'
   # Fill remaining output lanes before output, making only the intended source necessary.
   body+='MOV TEMP[115], IMM[2]\n'+f'MOV TEMP[115].{c}, TEMP[116].{c*4}\n'
   add(f'{stage}-consumed-{c}-{s}',src(stage,body,out='TEMP[115]',encode=False),True,stage)
   wrong='xyzw'[(source_lane+1)%4]
   add(f'{stage}-uninitialized-{c}-{s}',src(stage,body.replace(f'TEMP[117].{s*4}',f'TEMP[117].{wrong*4}'),out='TEMP[115]',encode=False),False,stage)
 for token in ['4294967296','99999999999','00000000000','-1','+1','0xffffffff','1e3','1.0','1u','1foo','1 2']:
  for lane in range(4):
   vals=['0']*4; vals[lane]=token
   text=src(stage).replace('IMM[0] UINT32 {0, 0, 0, 0}',f'IMM[0] UINT32 {{{", ".join(vals)}}}')
   add(f'{stage}-lex-{token}-{lane}',text,False,stage)
 for word in words:
  text=src(stage,body='OR TEMP[117], IMM[0], IMM[0]\n',imm=[word]*4,encode=False)
  exponent=word&0x7f800000; mantissa=word&0x7fffff
  safe=exponent!=0x7f800000 and (exponent!=0 or mantissa==0)
  add(f'{stage}-output-{word:08x}',text,safe,stage)
 # All unproven origins stay unsafe, while direct IN MOV stays ordinary float ABI.
 add(f'{stage}-unknown-const-output',src(stage,encode=False),False,stage)
 if stage=='vertex':
  add('vertex-origin',src(stage,body='OR TEMP[116], CONST[45], IMM[0]\nMOV TEMP[117], IN[0].wzyx\n',encode=False),True,stage)
  add('vertex-origin-raw-lane',src(stage,body='MOV TEMP[117], IN[0]\nOR TEMP[117].w, CONST[45], IMM[0]\n',encode=False),False,stage)
  add('vertex-origin-overwrite-safe',src(stage,body='MOV TEMP[117], IN[0]\nOR TEMP[117].w, CONST[45], IMM[0]\nMOV TEMP[117].w, IN[0].xxxx\n',encode=False),True,stage)
 for op in ['ADD','MUL','MAD','TEX','UADD','USEQ','USNE','UCMP','FSLT','FSGE','ISGE']:
  body='OR TEMP[117], CONST[45], IMM[0]\n'+f'{op} TEMP[117], TEMP[117], IMM[0]'+(', IMM[1]' if op in ['MAD','UCMP'] else '')+'\n'
  add(f'{stage}-mixed-reject-{op}',src(stage,body),False,stage)
 # Exactly 179 instructions; encoder and output consume 3/4, one initialization then tail operations.
 overhead=4 if stage=='fragment' else 5
 body='OR TEMP[117], CONST[45], IMM[0]\n'+('NOT TEMP[117], TEMP[117]\n'*(179-overhead))
 text=src(stage,body)
 assert sum(line.startswith(('MOV ','OR ','AND ','NOT ')) for line in text.splitlines())==179
 add(f'{stage}-179',text,True,stage)
 add(f'{stage}-180',text.replace('END\n','NOT TEMP[117], TEMP[117]\nEND\n'),False,stage)
 add(f'{stage}-16384',text+'\n'*(16384-len(text)),True,stage)
 add(f'{stage}-16385',text+'\n'*(16385-len(text)),False,stage)
 for bank,index in [('TEMP',118),('CONST',46),('IN',8)]:
  text=src(stage).replace('TEMP[0..117]',f'TEMP[0..{index}]') if bank=='TEMP' else src(stage).replace('CONST[0..45]',f'CONST[0..{index}]') if bank=='CONST' else src(stage).replace('DCL TEMP[0..117]',f'DCL IN[{index}]\nDCL TEMP[0..117]')
  add(f'{stage}-{bank}-bound',text,False,stage)
# Legacy complete results are compared against a separately compiled frozen parent.
for stage in ['vertex','fragment']:
 prefix='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n' if stage=='vertex' else 'FRAG\nDCL OUT[0], COLOR\n'
 for token in ['0','1065353216','2147483648','4294967295','1','0000000000','4294967296','1e3','-1']:
  text=prefix+f'IMM[0] UINT32 {{{token}, {token}, {token}, {token}}}\nMOV OUT[0], IMM[0]\nEND\n'
  add(f'legacy-{stage}-{token}',text,None,stage,True)
 for garbage in ['','MOV OUT[0], IN[0]\n','NOTIFY OUT[0], IMM[0]\n','0000: MOV OUT[0], IMM[0]\n','ORANGE TEMP[0], IMM[0]\n']:
  text=prefix+'IMM[0] FLT32 {0.0, 1.0, 0.0, 1.0}\n'+garbage+'MOV OUT[0], IMM[0]\nEND\n'
  add(f'legacy-{stage}-garbage-{len(cases)}',text,None,stage,True)
# Novel independent mutation seeds. Their acceptance is not presupposed; sanitizer,
# bounded result shape and exact good-call recovery are the assertions.
seeds=[0x65af8013,0xc2917e4b,0x09d33a67,0xb4106fcd]
base=src()
for seed in seeds:
 rng=random.Random(seed)
 for i in range(256):
  text=base
  p=rng.randrange(len(text)); mode=rng.randrange(4)
  if mode==0: text=text[:p]+chr(rng.randrange(1,128))+text[p+1:]
  elif mode==1: text=text[:p]+text[p+1:]
  elif mode==2: text=text[:p]+chr(rng.randrange(1,128))+text[p:]
  else: text=text[:p]
  add(f'mutate-{seed:08x}-{i}',text)
# Hardware programs are authored independently and appended by hardware_audit.py.
hw=OUT/'hardware-fixture.json'
if hw.exists():
 for e in json.loads(hw.read_text())['shaders']: add('hardware-'+e['name'],e['text'],True,e['stage'])
save('native-cases.json',cases)
# The stream driver prints the full result then two full recovery results per case.
(OUT/'driver.c').write_text(r'''#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *v="VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n";
static const char *f="FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\nIMM[0] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\nOR TEMP[0], IMM[0], IMM[0]\nMOV OUT[0], TEMP[0]\nEND\n";
int main(void){uint32_t head[2];while(fread(head,sizeof(head),1,stdin)==1){if(head[1]>16385)return 2;char *s=malloc(head[1]+1);if(!s)return 3;if(fread(s,1,head[1],stdin)!=head[1])return 4;s[head[1]]=0;puts(bridge_translate(head[0],s,head[1]));free(s);puts(bridge_translate(1,f,strlen(f)));puts(bridge_translate_pair(v,strlen(v),f,strlen(f)));}return ferror(stdin)?5:0;}
''')
common=['clang','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']
for p in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']: common+=['-I'+str(R/p)]
vendor=[R/'generated/u_format_table.c',R/'vendor/src/vrend/vrend_shader.c',*sorted((R/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),R/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',R/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',R/'vendor/src/mesa/util/u_debug.c']
commands=[]
def build(name,source):
 command=common+['-g','-O1','-fno-omit-frame-pointer','-fsanitize=address,undefined']+[str(p) for p in source+vendor]+[str(OUT/'driver.c'),'-lm','-o',str(OUT/name)]
 commands.append(command); subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
build('audit-native',[R/'bridge.c',R/'raw_bits.c'])
# Parent recovery raw shader rejects, deliberately ignored for legacy comparisons.
(OUT/'parent-bridge.c').write_bytes(subprocess.check_output(['git','show',PARENT+':renderer/virgl-shader/bridge.c'],cwd=ROOT))
build('audit-parent',[OUT/'parent-bridge.c'])
env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1')
def execute(name,entries):
 stream=b''.join(struct.pack('<II',0 if c['stage']=='vertex' else 1,len(c['text'].encode()))+c['text'].encode() for c in entries)
 (OUT/(name+'.input')).write_bytes(stream)
 run=subprocess.run([str(OUT/name)],input=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd=ROOT,timeout=120)
 (OUT/(name+'.jsonl')).write_bytes(run.stdout); (OUT/(name+'.stderr')).write_bytes(run.stderr)
 assert run.returncode==0,(name,run.returncode,run.stderr[-2000:])
 assert not run.stderr,run.stderr
 lines=run.stdout.splitlines(); assert len(lines)==3*len(entries)
 return [json.loads(x) for x in lines]
results=execute('audit-native',cases)
recoveries=results[1:3]
assert recoveries[0]['ok'] and recoveries[1]['ok']
for i,c in enumerate(cases):
 r=results[i*3]
 assert results[i*3+1:i*3+3]==recoveries,(c['name'],'recovery')
 assert set(r)==({'ok','glsl','metadata'} if r['ok'] else {'ok','error'}),(c['name'],'shape')
 if c['ok'] is not None: assert r['ok']==c['ok'],(c['name'],c['ok'],r)
 assert len(json.dumps(r))<147456
legacy=[c for c in cases if c['legacy']]; old=execute('audit-parent',legacy)
for i,c in enumerate(legacy): assert results[cases.index(c)*3]==old[i*3],(c['name'],'legacy drift')
report={'schema':'independent-raw-bit-native-v1','frozenHead':HEAD,'parent':PARENT,'cases':len(cases),'explicitExpectations':sum(c['ok'] is not None for c in cases),'legacyFullComparisons':len(legacy),'mutations':1024,'seeds':[f'{x:08x}' for x in seeds],'conversions':len(results),'recoveryConversions':len(cases)*2,'sanitizers':['address','undefined'],'commands':commands,'sources':{str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in [R/'bridge.c',R/'raw_bits.c',R/'raw_bits.h',OUT/'driver.c',OUT/'native-cases.json']},'records':{n:sha((OUT/n).read_bytes()) for n in ['audit-native.input','audit-native.jsonl','audit-native.stderr','audit-parent.input','audit-parent.jsonl','audit-parent.stderr']},'status':'passed'}
save('native-report.json',report)
print(json.dumps({k:report[k] for k in ['cases','explicitExpectations','legacyFullComparisons','mutations','conversions','status']}))
