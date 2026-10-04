#!/usr/bin/env python3
"""Build actual isolated compiler-source faults and require hardware oracle failures."""
import argparse,hashlib,json,os,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FAULTS={
 'widen-yz':('bridge.c','   return true;\n}\nstatic bool source(', '   if (kind == DESTINATION && r->mask == 6u) r->mask |= 1u;\n   return true;\n}\nstatic bool source('),
 'packed-source':('raw_bits.c','} else operand(&w, p, &instruction->src[0], lane);','} else operand(&w, p, &instruction->src[0], (op == RAW_MOV && instruction->dst.mask != 15u) ? (unsigned)__builtin_popcount(instruction->dst.mask & ((1u << lane) - 1u)) : lane);'),
 'neighbor-write':('raw_bits.c','for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);\n      emit(&w, " = raw_rhs.");\n      for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);', 'for (unsigned lane = 0; lane < 4; ++lane) emit(&w, "%c", "xyzw"[lane]);\n      emit(&w, " = raw_rhs.");\n      for (unsigned lane = 0; lane < 4; ++lane) emit(&w, "%c", "xyzw"[lane]);'),
 'early-alias':('raw_bits.c','      if (instruction->float_mask && !raw_shadow) float_snapshot(&w, p, instruction);','      if (instruction->opcode == RAW_MOV && instruction->dst.file == TEMP && instruction->dst.index == 0 && instruction->dst.mask == 6u && instruction->src[0].file == TEMP && instruction->src[0].index == 0) emit(&w, " raw_temp[0].y = raw_temp[0].z;\\n");\n      if (instruction->float_mask && !raw_shadow) float_snapshot(&w, p, instruction);')}

def sha(raw):return hashlib.sha256(raw).hexdigest()
def binding(p,base):
 raw=p.read_bytes();return dict(path=str(p.relative_to(base)),bytes=len(raw),sha256=sha(raw))
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
 source=ROOT/'renderer/virgl-shader';manifest=dict(schema='ordered-mask-source-faults-v1',status='running',modes={})
 for mode,(filename,before,after) in FAULTS.items():
  directory=out/mode;clone=directory/'source';shutil.copytree(source,clone,ignore=shutil.ignore_patterns('build','node_modules','__pycache__','.DS_Store'),dirs_exist_ok=True)
  original=(clone/filename).read_text();assert original.count(before)==1,mode
  (clone/filename).write_text(original.replace(before,after));record=dict(before=before,after=after,original=binding(source/filename,ROOT),fault=binding(clone/filename,out))
  env=dict(os.environ);assert env.get('EMCC'),'pinned compiler supplied by acceptance'
  command=['bash','build.sh','wasm']
  with (directory/'build.log').open('wb') as log:subprocess.run(command,cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
  wasm=directory/'fault.wasm';shutil.copy2(clone/'build/wasm/virgl-shader.wasm',wasm)
  record.update(wasm=binding(wasm,out),sourceFault=record['fault'],buildCommand=command,buildLog=binding(directory/'build.log',out))
  manifest['modes'][mode]=record;(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  command=['node','tools/virgl-ordered-masks/browser.mjs','--output',str(directory/'gpu'),'--fault',mode,'--fault-artifacts',str(out)]
  with (directory/'gpu.log').open('wb') as log:run=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=150)
  report=json.loads((directory/'gpu/report.json').read_bytes());acceptance=report.get('acceptance');assert run.returncode!=0 and report['status']=='failed' and acceptance and acceptance['status']=='failed',mode
  assert 'independent exact word pixel mismatch' in acceptance['failure']['message'],acceptance['failure']
  assert acceptance['faultWasmSha256']==record['wasm']['sha256'] and any(e['draws'] and e['draws'][-1].get('failure') for e in acceptance['rigs'])
  record['exitCode']=run.returncode;record['failureMessage']=acceptance['failure']['message'];record['browserReport']=binding(directory/'gpu/report.json',out)
  # Bind exact fault text and artifacts; keep sources for independent replay.
  assert (source/filename).read_text()==original and (clone/filename).read_text()==original.replace(before,after)
 manifest['status']='passed';(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Four actual compiler-source faults fail independent hardware word oracles')
if __name__=='__main__':main()
