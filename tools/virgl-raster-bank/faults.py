#!/usr/bin/env python3
"""Actual source faults meet a pre-effect domain oracle or safe physical words."""
import argparse,json,os,shutil,subprocess
from pathlib import Path
from shared import ROOT,binding,require
FAULTS={
 'drop-component':('renderer/virgl-shader/raw_bits.c','      c->components[index] |= 1u << component;','      if (component != 3) c->components[index] |= 1u << component;'),
 'unapproved-decode':('renderer/virgl-shader/raw_bits.c','if (raster) emit(&w, "uintBitsToFloat(raw_out[%u].%c)", index, "xyzw"[lane]);','if (raster) emit(&w, "uintBitsToFloat(%sconst0[1].%c)", p->stage ? "fs" : "vs", "xyzw"[lane]);'),
 'missing-guard':('renderer/virgl-command/constant-domain.mjs','if ((entry.mask & (1 << lane)) && !rasterBinary32Word(checked.words[entry.register * 4 + lane]))','if (false && (entry.mask & (1 << lane)) && !rasterBinary32Word(checked.words[entry.register * 4 + lane]))')}
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
 manifest=dict(schema='raster-bank-source-faults-v1',status='running',modes={})
 for mode,(filename,before,after) in FAULTS.items():
  directory=out/mode;original=ROOT/filename;text=original.read_text();require(text.count(before)==1,'unique actual runtime guard mutation')
  record=dict(before=before,after=after,original=binding(original),served=[],adaptations=[])
  if mode=='missing-guard':
   directory.mkdir(parents=True,exist_ok=True);fault=directory/'constant-domain.mjs';fault.write_text(text.replace(before,after))
   state=ROOT/'renderer/virgl-command/state.mjs';adapt=state.read_text();edits=[('"./decoder.mjs"','"/renderer/virgl-command/decoder.mjs"'),('"../virgl-shader/index.mjs"','"/renderer/virgl-shader/index.mjs"')]
   for old,new in edits:require(adapt.count(old)==1,'single module-resolution adaptation');adapt=adapt.replace(old,new)
   dest=directory/'state.mjs';dest.write_text(adapt);record.update(stateModule=str(dest.relative_to(out)),adaptations=[dict(original=binding(state),fault=binding(dest,out),edits=edits)])
   record['served']=[binding(fault,out),binding(dest,out)]
  else:
   clone=directory/'source';shutil.copytree(ROOT/'renderer/virgl-shader',clone,ignore=shutil.ignore_patterns('build','__pycache__','.DS_Store'),dirs_exist_ok=True)
   fault=clone/Path(filename).name;fault.write_text(text.replace(before,after));env=dict(os.environ);require(env.get('EMCC'),'pinned compiler supplied')
   with (directory/'build.log').open('wb') as log:subprocess.run(['bash','build.sh','wasm'],cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
   wasm=directory/'fault.wasm';shutil.copy2(clone/'build/wasm/virgl-shader.wasm',wasm);record.update(wasm=binding(wasm,out),buildLog=binding(directory/'build.log',out),buildCommand=['bash','build.sh','wasm']);record['served']=[binding(wasm,out)]
  record['fault']=binding(fault,out);manifest['modes'][mode]=record;(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  command=['node','tools/virgl-raster-bank/browser.mjs','--output',str(directory/'gpu'),'--fault',mode,'--fault-artifacts',str(out)]
  with (directory/'gpu.log').open('wb') as log:run=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=150)
  report=json.loads((directory/'gpu/report.json').read_bytes());actual=report['acceptance'];require(run.returncode!=0 and report['status']=='failed' and actual['status']=='failed','actual source fault rejected')
  if mode=='unapproved-decode':require(any(d.get('failure') for r in actual['rigs'] for d in r['draws']) and 'Independent copied-word pixel mismatch' in actual['failure']['message'],'unapproved normal word refuted by physical bits')
  else:require(any(r['oracleStops'] and all(s['unsafeGpuCalled'] is False and s['word']==1 for s in r['oracleStops']) for r in actual['rigs']),'actual removed domain obligation reaches independent before-effect oracle')
  record.update(exitCode=run.returncode,browserReport=binding(directory/'gpu/report.json',out),failureMessage=actual['failure']['message']);require(original.read_text()==text and fault.read_text()==text.replace(before,after),'isolated exact source fault')
 manifest['status']='passed';(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Three actual raster boundary faults independently refuted')
if __name__=='__main__':main()
