#!/usr/bin/env python3
"""One actual compiler source mutation per isolated artifact; no live edits."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[2]
COMPILER=ROOT/'renderer/virgl-shader'
MUTATIONS={
 'nan-guard':('" bool equal = !unordered && (a == b || (magnitude_a == 0u && magnitude_b == 0u));\\n"','" bool equal = (a == b || (magnitude_a == 0u && magnitude_b == 0u));\\n"'),
 'zero-sign':('" bool equal = !unordered && (a == b || (magnitude_a == 0u && magnitude_b == 0u));\\n"','" bool equal = !unordered && (a == b);\\n"'),
 'ne-complement':('" return (not_equal ? !equal : equal) ? 4294967295u : 0u;\\n}\\n"','" return (not_equal ? equal : equal) ? 4294967295u : 0u;\\n}\\n"'),
 'mask-one':('" return (not_equal ? !equal : equal) ? 4294967295u : 0u;\\n}\\n"','" return (not_equal ? !equal : equal) ? 1u : 0u;\\n}\\n"'),
 'known-nan':('bool equal = !unordered && (a == b || (magnitude_a == 0 && magnitude_b == 0));','bool equal = (a == b || (magnitude_a == 0 && magnitude_b == 0));')}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def binding(p,base):return dict(path=str(p.relative_to(base)),bytes=p.stat().st_size,sha256=sha(p.read_bytes()))
def require(ok,message):
 if not ok:raise ValueError(message)
def main():
 a=argparse.ArgumentParser();a.add_argument('--output',required=True,type=Path);args=a.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
 fixture=ROOT/'renderer/virgl-shader/tests/raw-equality-cases.json';cases=json.loads(fixture.read_bytes())['cases']
 original=(COMPILER/'raw_bits.c').read_bytes();sources=[binding(p,ROOT) for p in sorted(COMPILER.rglob('*')) if p.is_file() and not any(s.startswith('.') or s in ('build','__pycache__') for s in p.relative_to(COMPILER).parts)]
 report=dict(schema='raw-equality-actual-source-faults-v1',status='running',gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),fixture=binding(fixture,ROOT),sources=sources,modes={})
 try:
  for name,(before,after) in MUTATIONS.items():
   require(original.count(before.encode())==1,'unique source seam '+name)
   folder=output/name;folder.mkdir(exist_ok=True);mutated=original.replace(before.encode(),after.encode());(folder/'raw_bits.c').write_bytes(mutated)
   with tempfile.TemporaryDirectory(prefix='raw-equality-fault-') as tmp:
    clone=Path(tmp)/'shader';shutil.copytree(COMPILER,clone,ignore=shutil.ignore_patterns('build','__pycache__','.DS_Store'));(clone/'raw_bits.c').write_bytes(mutated)
    log=folder/'build.log';commands=[]
    with log.open('wb') as stream:
     for mode in ('native','wasm'):
      command=['bash','build.sh',mode];commands.append(command);subprocess.run(command,cwd=clone,stdout=stream,stderr=subprocess.STDOUT,check=True,timeout=240)
    shutil.copy2(clone/'build/native/virgl-shader',folder/'native');shutil.copy2(clone/'build/wasm/virgl-shader.wasm',folder/'fault.wasm')
   records=[]
   for e in cases:
    run=subprocess.run([str(folder/'native'),e['stage']],input=e['text'].encode(),capture_output=True,check=True,timeout=10)
    require(not run.stderr,'fault native stderr');records.append(dict(name=e['name'],stage=e['stage'],inputSha256=sha(e['text'].encode()),stdout=run.stdout.decode(),result=json.loads(run.stdout)))
   (folder/'native.json').write_text(json.dumps(records,indent=2)+'\n')
   wasm_command=['node',str(ROOT/'tools/virgl-raw-equality/fault-wasm.mjs'),'--wasm',str(folder/'fault.wasm'),'--native',str(folder/'native.json'),'--output',str(folder/'wasm.json')]
   run=subprocess.run(wasm_command,cwd=ROOT,capture_output=True,check=True,timeout=90);(folder/'wasm.log').write_bytes(run.stdout+run.stderr)
   if name=='known-nan':
    witnesses=[e for e in records if e['name'].startswith('known-nan-')];require(len(witnesses)==4 and all(e['result']['ok'] is False for e in witnesses),'bad known facts refuted at admission; never GPU')
   report['modes'][name]=dict(before=before,after=after,originalSha256=sha(original),mutatedSha256=sha(mutated),source=binding(folder/'raw_bits.c',output),native=binding(folder/'native',output),wasm=binding(folder/'fault.wasm',output),translations=binding(folder/'native.json',output),wasmParity=binding(folder/'wasm.json',output),buildLog=binding(folder/'build.log',output),buildCommands=commands,wasmCommand=wasm_command)
  for item in sources:require(binding(ROOT/item['path'],ROOT)==item,'fault source changed during recording')
  report['status']='passed'
 finally:(output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
 print('built five real source faults and native/Wasm parity')
if __name__=='__main__':main()
