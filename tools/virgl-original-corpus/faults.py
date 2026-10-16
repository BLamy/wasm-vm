#!/usr/bin/env python3
"""Compile an actual MAX selection fault; original lighting must contradict it."""
import argparse,json,os,shutil,subprocess
from pathlib import Path
from shared import ROOT,binding,require
HEADER='renderer/virgl-shader/raw_bits.c'
BEFORE='return raw_float_mask(b, a, false) != 0u ? a : b;'
AFTER='return raw_float_mask(b, a, false) != 0u ? b : a;'
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);original=ROOT/HEADER;text=original.read_text();require(text.count(BEFORE)==1,'unique exercised MAX mechanism')
 clone=out/'source';shutil.copytree(ROOT/'renderer/virgl-shader',clone,ignore=shutil.ignore_patterns('build','__pycache__','.DS_Store'),dirs_exist_ok=True);fault=clone/'raw_bits.c';fault.write_text(text.replace(BEFORE,AFTER))
 with (out/'build.log').open('wb') as log:subprocess.run(['bash','build.sh','wasm'],cwd=clone,env=dict(os.environ),stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
 wasm=out/'fault.wasm';shutil.copy2(clone/'build/wasm/virgl-shader.wasm',wasm)
 record=dict(schema='original-corpus-source-fault-v1',original=binding(original),fault=binding(fault,out),before=BEFORE,after=AFTER,wasm=binding(wasm,out),buildLog=binding(out/'build.log',out),originalPrefix='12f6d594',command=['bash','build.sh','wasm'])
 (out/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
 with (out/'gpu.log').open('wb') as log:run=subprocess.run(['node','tools/virgl-original-corpus/browser.mjs','--output',str(out/'gpu'),'--fault-wasm','/'+str(wasm.relative_to(ROOT)),'--fault-original',record['originalPrefix']],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=180)
 actual=json.loads((out/'gpu/report.json').read_bytes());require(run.returncode!=0 and actual['status']=='failed' and actual['acceptance']['status']=='failed','actual source fault rejected')
 vertex=actual['acceptance']['vertices'][0];require(vertex['sha256'].startswith(record['originalPrefix']) and vertex['vectors'][0]['failure']['lane']==4 and 'independent original vertex mismatch' in actual['acceptance']['failure']['message'],'actual original lighting value refutes compiled source fault')
 record.update(status='passed',exitCode=run.returncode,point=vertex['vectors'][0]['failure'],browserReport=binding(out/'gpu/report.json',out));(out/'manifest.json').write_text(json.dumps(record,indent=2)+'\n');print('Original lighting refutes an actual inverted MAX selector')
if __name__=='__main__':main()
