#!/usr/bin/env python3
"""Literal ordered-mask inputs; prior failures are an explicit migration ledger."""
import copy, hashlib, importlib.util, json, re, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASELINE_SHA='dc704cd8aa90f33d75163fd4620c0d102c280cd2d4a1c3e02e3ea19810cbd99f'
MASKS=['x','y','z','w','xy','xz','xw','yz','yw','zw','xyz','xyw','xzw','yzw','xyzw']
spec=importlib.util.spec_from_file_location('word_fixture',ROOT/'tools/virgl-precise-word/generate_cases.py')
word=importlib.util.module_from_spec(spec);spec.loader.exec_module(word)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def expected(stage,text,profile=17,count=6):
 e=dict(profile=f'virgl-webgl2-raw-bits-v{profile}',constantCount=count)
 if profile==17:e['preciseWordContract']=word.contract(stage,text)
 return e

def shader(stage,mask,variant):
 base=word.kernel_text(stage,'MOV','direct');prefix=base.split('MOV_PRECISE TEMP[117]')[0]
 # Each source vector is initialized completely before the masked write.
 if variant in ('numeric','numeric-alias'):
  header=prefix.split('AND TEMP[0]')[0]
  prefix=header+f'ADD TEMP[0], IN[{2 if stage=="vertex" else 1}].xyxy, IMM[3].xxxx\n'
  body=(f'ADD TEMP[0].{mask}, TEMP[0].xzyw, IMM[3].yyyy\nMOV TEMP[117], TEMP[0]\n' if variant=='numeric-alias' else
        f'MOV TEMP[117], IMM[3]\nADD TEMP[117].{mask}, TEMP[0].wzyx, IMM[3].yyyy\n')
 elif variant=='alias':body=f'MOV_PRECISE TEMP[0].{mask}, TEMP[0].xzyw\nMOV_PRECISE TEMP[117], TEMP[0]\n'
 elif variant=='ordinary':body=f'MOV TEMP[117], TEMP[1]\nMOV TEMP[117].{mask}, TEMP[0].wzyx\n'
 elif variant=='output':body='MOV_PRECISE TEMP[117], TEMP[0]\n'
 else:body=f'MOV TEMP[117], TEMP[1]\nMOV_PRECISE TEMP[117].{mask}, TEMP[0].wzyx\n'
 ending=word.codec(stage)
 if variant=='output':
  dest='OUT[1]' if stage=='vertex' else 'OUT[0]'
  ending=ending.replace(f'MOV {dest}, TEMP[115]',f'MOV {dest}, IMM[0].xyxy\nMOV {dest}.{mask}, TEMP[115].wzyx')
 return prefix+body+ending

def main():
 archive=ROOT/'evidence/virgl-precise-word/worker.tar.gz';assert sha(archive.read_bytes())==BASELINE_SHA
 with tarfile.open(archive) as a:held=json.loads(a.extractfile('./native/native-report.json').read())
 ledger=[]
 for group in ('raw','integer','float','numeric','equality'):
  for entry in held[group+'Cases']:
   if entry['ok'] or not re.search(r'^(?:\d+:\s*)?\w+ (?:TEMP|OUT)\[\d+\]\.(?:xz|yw|zw|xyzw),',entry['text'],re.M):continue
   # All sparse raw/integer/order fixtures read other, uninitialized lanes.
   # Equality fixtures already initialize their complete destination.
   full=bool(re.search(r'^(?:\d+:\s*)?\w+ (?:TEMP|OUT)\[\d+\]\.xyzw,',entry['text'],re.M))
   admitted=group=='equality' or full and group!='numeric'
   if group=='numeric':continue # MAD/TEX keep their independent explicit-mask gate.
   e=dict(name=group+'::'+entry['name'],inputSha256=entry['inputSha256'],before={k:entry[k] for k in ('result','resultBytes','resultSha256')},ok=admitted)
   if admitted:e['expected']=dict(profile=f'virgl-webgl2-raw-bits-v{dict(raw=1,integer=2,float=3,equality=13)[group]}',constantCount=46)
   else:e['expected']=dict(errorCode='parse-error')
   ledger.append(e)
 assert len(ledger)==54 and sum(e['ok'] for e in ledger)==24
 cases=[];kernels=[];pairs=[]
 def add(name,stage,text,ok=True,e=None):
  c=dict(name=name,stage=stage,text=text,ok=ok,expected=e or expected(stage,text));cases.append(c);return c
 for stage in ('vertex','fragment'):
  for mask in MASKS:
   for variant in ('direct','alias','ordinary','numeric','numeric-alias','output'):
    name=f'mask-{mask}-{variant}-{stage}';text=shader(stage,mask,variant)
    add(name,stage,text,e=expected(stage,text,4 if variant.startswith('numeric') else 2 if variant=='ordinary' else 17))
    kernels.append(dict(case=name,stage=stage,name=name,kind='mask',variant=variant,mask=mask,count=6,observation='TEMP[117]'))
    opposite='precise::pass-'+('fragment' if stage=='vertex' else 'vertex')
    pairs.append(dict(name='gpu-'+name+'-pair',vertex=name if stage=='vertex' else opposite,fragment=name if stage=='fragment' else opposite,ok=True))
  valid=shader(stage,'yz','direct')
  for mask in ('xx','yx','zy','wx','xzy','xxyw','wxyz','xyzwx',''):
   text=valid.replace('TEMP[117].yz,','TEMP[117].'+mask+',')
   add('reject-mask-'+(mask or 'empty')+'-'+stage,stage,text,False,dict(errorCode='unsupported-feature' if mask=='' else 'parse-error'))
  for label,before,after,error in [
   ('undeclared','DCL TEMP[0..117]','DCL TEMP[0..116]\nDCL TEMP[117].xy','parse-error'),
   ('declaration-mask','DCL OUT[0]','DCL OUT[0].xz','unsupported-feature'),
   ('source-mask','TEMP[0].wzyx','TEMP[0].zyx','parse-error'),
   ('output-source','TEMP[0].wzyx','OUT[0].xyzw','parse-error')]:
   add('reject-'+label+'-'+stage,stage,valid.replace(before,after),False,dict(errorCode=error))
  # Explicit masks on MAD/TEX stay outside this boundary.
  add('reject-mad-mask-'+stage,stage,valid.replace('MOV_PRECISE TEMP[117].yz, TEMP[0].wzyx','MAD TEMP[117].yz, IMM[3], IMM[3], IMM[3]'),False,dict(errorCode='unsupported-feature'))
  for n in (179,180):
   lines=valid.splitlines();position=next(i for i,x in enumerate(lines) if x.startswith('MOV_PRECISE TEMP[117]'))
   count=sum(not x.startswith(('VERT','FRAG','DCL','IMM','PROPERTY','END')) for x in lines)
   lines[position:position]=['MOV_PRECISE TEMP[0].yz, TEMP[0].xzyw']*(n-count)
   add('instruction-'+str(n)+'-'+stage,stage,'\n'.join(lines)+'\n',n==179,expected(stage,valid) if n==179 else dict(errorCode='parse-error'))
 # Preserve the entire captured lighting bodies, not rewritten ports.
 original_names=[]
 observer='FRAG\nDCL IN[0].xyz, GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nIMM[0] UINT32 {0,1065353216,0,0}\nIMM[1] UINT32 {23,127,4294967200,1}\nMOV TEMP[117], IN[0].xzxz\n'+word.codec('fragment').replace('IN[0].xxxx','IN[0].yyyy')
 add('lighting-observer-fragment','fragment',observer,e=dict(profile='virgl-webgl2-raw-bits-v2',constantCount=0))
 for prefix in ('12f6d594','d4f702f7'):
  entry=next(e for e in held['originals'] if Path(e['path']).stem.startswith(prefix));raw=(ROOT/entry['path']).read_bytes();assert sha(raw)==entry['sha256']
  name='original-'+prefix+'-vertex';text=raw.decode('ascii');e=expected('vertex',text,18,8)
  e['preciseWordContract']=word.contract('vertex',text)
  e['constantDomains']=[dict(kind='constant-bank-finite-f32-v1',stage='vertex',slot=0,name='vsconst0',count=8)]
  add(name,'vertex',text,e=e)
  kernels.append(dict(case=name,stage='vertex',name=name,kind='lighting',variant=prefix,count=8,originalPath=entry['path'],originalSha256=entry['sha256']))
  pairs.append(dict(name='gpu-'+name+'-pair',vertex=name,fragment='lighting-observer-fragment',ok=True))
  original_names.append(dict(path=entry['path'],sha256=entry['sha256'],before={k:entry[k] for k in ('result','resultBytes','resultSha256')},expected=e))
 fixture=dict(schema='ordered-mask-cases-v1',baselineSha256=BASELINE_SHA,masks=MASKS,variants=['direct','alias','ordinary','numeric','numeric-alias','output'],migrationCandidates=ledger,originalMigrations=original_names,cases=cases,pairs=pairs,kernels=kernels)
 (ROOT/'renderer/virgl-shader/tests/ordered-mask-cases.json').write_text(json.dumps(fixture,indent=2)+'\n')
 print(len(cases),'cases',len(pairs),'pairs',len(kernels),'GPU kernels',len(ledger),'literal migrations')
if __name__=='__main__':main()
