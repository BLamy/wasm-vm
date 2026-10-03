#!/usr/bin/env python3
"""Bounded falsification of physical pixels, generations and typed heap evidence."""
import argparse,copy,json,tempfile
from pathlib import Path
from shared import ROOT,require,read,binding,git
import receipt,wasm_receipt
GPU_ATTACKS=['total-float','total-bool','omit-rig','coefficient-float','bank-corruption','pixel-corruption','predicate-corruption','shader-source','uniform-readback','geometry','shader-generation','live-object','budget-bool','capture-count-float','omit-async-interference']
WASM_ATTACKS=['calls-float','memory-bool','schedule-bool','capacity-float','omit-source','omit-pressure']

def gpu_forgery(p,name):
 p=copy.deepcopy(p);rig=p['rigs'][0];draw=rig['draws'][0]
 if name=='total-float':p['drawCount']=float(p['drawCount'])
 elif name=='total-bool':p['checkedPixels']=True
 elif name=='omit-rig':p['rigs'].pop()
 elif name=='coefficient-float':draw['coefficient']=float(draw['coefficient'])
 elif name=='bank-corruption':draw['bank'][16]^=1
 elif name=='pixel-corruption':draw['rgbaBytes'][0]^=255
 elif name=='predicate-corruption':draw['oracle']['branches'][0]['taken']=True
 elif name=='shader-source':next(e for e in rig['glEvents'] if e['call']=='shaderSource')['source']+='\n// forged\n'
 elif name=='uniform-readback':next(e for e in rig['glEvents'] if e['call']=='uniform4uiv')['observed'][0]^=1
 elif name=='geometry':rig['geometry']['vertexWords'][0]^=1
 elif name=='shader-generation':draw['program']['vertexGeneration']+=1
 elif name=='live-object':rig['glObjects']['live']=1
 elif name=='budget-bool':rig['finalBudgets']['programs']=False
 elif name=='capture-count-float':draw['checkedPixels']=4096.0
 elif name=='omit-async-interference':p['rigs'][13]['yieldAttacks']=[]
 else:raise ValueError(name)
 return p

def wasm_forgery(r,name):
 r=copy.deepcopy(r)
 if name=='calls-float':r['counts']['calls']=float(r['counts']['calls'])
 elif name=='memory-bool':r['memory']['bufferIdentityStable']=1
 elif name=='schedule-bool':r['allocationPressure']['releaseSchedule'][0]=False
 elif name=='capacity-float':r['allocationPressure']['targets'][0]['capacityBefore']['availableChunks']=1.0
 elif name=='omit-source':r['sources'].pop()
 elif name=='omit-pressure':r['allocationPressure']['targets'].pop()
 else:raise ValueError(name)
 return r

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--evidence',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();folder=args.evidence.resolve()
 n=read(folder/'native/native-report.json');p=read(folder/'gpu/report.json')['acceptance'];fixture=read(ROOT/'renderer/virgl-shader/tests/radial-domain-cases.json');reference=read(folder/'reference.json')
 receipt.verify_gpu(p,n,fixture,reference);wasm_receipt.verify_recording(folder/'wasm',n);results=[]
 def attack(name,operation):
  try:operation()
  except (ValueError,KeyError,IndexError,StopIteration) as error:results.append({'name':name,'outcome':'rejected','reason':str(error)})
  else:raise ValueError('forgery escaped: '+name)
 for name in GPU_ATTACKS:attack('gpu/'+name,lambda name=name:receipt.verify_gpu(gpu_forgery(p,name),n,fixture,reference))
 with tempfile.TemporaryDirectory(prefix='radial-domain-forgeries-') as tmp:
  tmp=Path(tmp);(tmp/'native').symlink_to(folder/'native',target_is_directory=True);target=tmp/'wasm';target.mkdir();(target/'calls.jsonl').symlink_to(folder/'wasm/calls.jsonl');r=read(folder/'wasm/report.json')
  for name in WASM_ATTACKS:
   (target/'report.json').write_text(json.dumps(wasm_forgery(r,name))+'\n');attack('wasm/'+name,lambda:wasm_receipt.verify_recording(target,n))
 report={'schema':'radial-negative-receipts-v1','status':'passed','positiveReceipt':binding(folder/'receipt.json',folder),'results':results};args.output.write_text(json.dumps(report,indent=2)+'\n');print('Rejected',len(results),'physical/typed evidence forgeries.')
if __name__=='__main__':main()
