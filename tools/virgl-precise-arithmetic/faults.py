#!/usr/bin/env python3
"""Inject isolated real helper faults; require a named physical GPU mismatch."""
import argparse,json,os,shutil,subprocess
from pathlib import Path
from shared import ROOT,binding,require
HEADER='renderer/virgl-shader/raw_binary32.h'
FAULTS={
 'sticky':('return (value >> distance) | uint((value << (32u - distance)) != 0u);','return value >> distance;','arithmetic-add-xyzw-direct-vertex','sticky-neighbors'),
 'round-even':('tail > 4u || (tail == 4u && (rounded & 1u) != 0u)','tail >= 4u','arithmetic-add-xyzw-direct-fragment','halfway-even-odd'),
 'limb-carry':('a0 * b1 + a1 * b0 + (bottom >> 16u)','a0 * b1 + a1 * b0','arithmetic-mul-xyzw-direct-vertex','limb-carries'),
 'normalize':('/* exact:mul-normalize-a */ sa <<= 1u; ea -= 1;','/* exact:mul-normalize-a */ sa <<= 1u; ea -= 0;','arithmetic-mul-xyzw-direct-fragment','subnormal-leading-22'),
 'zero-sign':('return (a & b) & 2147483648u;','return 0u;','arithmetic-add-xyzw-direct-vertex','zero-signs'),
 'intermediate-rounding':('return raw_exact_pack(sign, exponent, significand);','return raw_exact_pack(sign, exponent, significand & 4294967288u);','arithmetic-chain-xyzw-direct-fragment','contraction')}
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
 manifest=dict(schema='precise-arithmetic-source-faults-v1',status='running',modes={})
 for mode,(before,after,kernel,vector) in FAULTS.items():
  directory=out/mode;original=ROOT/HEADER;text=original.read_text();require(text.count(before)==1,'unique actual GPU helper mutation')
  clone=directory/'source';shutil.copytree(ROOT/'renderer/virgl-shader',clone,ignore=shutil.ignore_patterns('build','__pycache__','.DS_Store'),dirs_exist_ok=True)
  fault=clone/Path(HEADER).name;fault.write_text(text.replace(before,after));env=dict(os.environ);require(env.get('EMCC'),'pinned compiler supplied')
  with (directory/'build.log').open('wb') as log:subprocess.run(['bash','build.sh','wasm'],cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
  wasm=directory/'fault.wasm';shutil.copy2(clone/'build/wasm/virgl-shader.wasm',wasm)
  record=dict(before=before,after=after,original=binding(original),fault=binding(fault,out),wasm=binding(wasm,out),buildLog=binding(directory/'build.log',out),buildCommand=['bash','build.sh','wasm'],served=[binding(wasm,out)],kernel=kernel,vector=vector)
  manifest['modes'][mode]=record;(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  command=['node','tools/virgl-precise-arithmetic/browser.mjs','--output',str(directory/'gpu'),'--fault-wasm','/'+str(wasm.relative_to(ROOT)),'--fault-kernel',kernel,'--fault-vector',vector]
  with (directory/'gpu.log').open('wb') as log:run=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=150)
  report=json.loads((directory/'gpu/report.json').read_bytes());actual=report['acceptance']
  require(run.returncode!=0 and report['status']=='failed' and actual['status']=='failed','actual source fault rejected')
  require(len(actual['rigs'])==1 and actual['rigs'][0]['kernel']['case']==kernel and len(actual['rigs'][0]['draws'])==1 and actual['rigs'][0]['draws'][0]['vector']['name']==vector,'literal independent fault witness')
  require(actual['rigs'][0]['draws'][0].get('failure') and 'independent exact word pixel mismatch' in actual['failure']['message'],'physical bits refute actual helper source mutation')
  record.update(exitCode=run.returncode,browserReport=binding(directory/'gpu/report.json',out),failureMessage=actual['failure']['message']);require(original.read_text()==text and fault.read_text()==text.replace(before,after),'isolated exact source fault')
 manifest['status']='passed';(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Six actual integer arithmetic faults independently refuted on the GPU')
if __name__=='__main__':main()
