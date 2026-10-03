#!/usr/bin/env python3
"""Promoted bounded forgeries against typed words, demand traces and fixed-heap records."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
from shared import ROOT,require,read,binding,git
import receipt
import wasm_receipt

GPU_ATTACKS = ['total-float','total-bool','omit-kernel','word-float','word-corruption',
               'pixel-corruption','trace-predecessor','trace-definition-version','trace-demand',
               'physical-shader','owned-bank','native-buffer','live-object','budget-bool','capture-count-float']
WASM_ATTACKS = ['calls-float','memory-bool','schedule-bool','capacity-float','omit-source','omit-pressure']


def gpu_forgery(p,name):
    p=copy.deepcopy(p); rig=p['rigs'][0]; draw=rig['draws'][0]
    if name=='total-float':p['checkedWords']=float(p['checkedWords'])
    elif name=='total-bool':p['checkedPixels']=True
    elif name=='omit-kernel':p['rigs'].pop()
    elif name=='word-float':draw['words'][0]=float(draw['words'][0])
    elif name=='word-corruption':draw['words'][0]^=1
    elif name=='pixel-corruption':draw['rgbaBytes'][0]^=255
    elif name=='trace-predecessor':draw['oracle']['branches'][0]['taken']=not draw['oracle']['branches'][0]['taken']
    elif name=='trace-definition-version':draw['oracle']['reads'][0]['version']='forged'
    elif name=='trace-demand':draw['oracle']['demanded']=False
    elif name=='physical-shader':next(e for e in rig['glEvents'] if e['call']=='shaderSource')['source']+='\n// forged\n'
    elif name=='owned-bank':next(e for e in rig['glEvents'] if e['call']=='uniform4uiv')['observed'][0]^=1
    elif name=='native-buffer':rig['bufferReadbacks'][0]['bytes'][0]^=1
    elif name=='live-object':rig['objects']['live']=1
    elif name=='budget-bool':rig['finalBudgets']['programs']=False
    elif name=='capture-count-float':draw['checkedPixels']=4096.0
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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args(); folder=args.evidence.resolve()
    native=read(folder/'native/native-report.json');primary=read(folder/'gpu/report.json')['acceptance']
    fixture=read(ROOT/'renderer/virgl-shader/tests/selected-lanes-cases.json');oracle=read(folder/'oracle.json')
    receipt.verify_gpu(primary,native,fixture,oracle)
    wasm_receipt.verify(folder/'wasm',git('rev-parse','HEAD').decode().strip(),native)
    results=[]
    def attack(name,operation):
        try:operation()
        except (ValueError,KeyError,IndexError) as error:results.append({'name':name,'outcome':'rejected','reason':str(error)})
        else:raise ValueError('forgery escaped: '+name)
    for name in GPU_ATTACKS:
        attack('gpu/'+name,lambda name=name:receipt.verify_gpu(gpu_forgery(primary,name),native,fixture,oracle))
    with tempfile.TemporaryDirectory(prefix='selected-lanes-receipts-') as tmp:
        tmp=Path(tmp);(tmp/'native').symlink_to(folder/'native',target_is_directory=True)
        target=tmp/'wasm';target.mkdir();(target/'calls.jsonl').symlink_to(folder/'wasm/calls.jsonl')
        original=read(folder/'wasm/report.json')
        for name in WASM_ATTACKS:
            (target/'report.json').write_text(json.dumps(wasm_forgery(original,name))+'\n')
            attack('wasm/'+name,lambda:wasm_receipt.verify_recording(target,native))
    result={'schema':'selected-lanes-negative-receipts-v1','status':'passed',
            'positiveReceipt':binding(folder/'receipt.json',folder),'results':results}
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print('rejected',len(results),'bounded recorded-data forgeries')


if __name__=='__main__':main()
