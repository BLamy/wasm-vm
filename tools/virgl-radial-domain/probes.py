#!/usr/bin/env python3
"""Record bounded radial graph coverage without re-running unrelated recovery gates."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def binding(p,base):
 raw=p.read_bytes();return {'path':str(p.relative_to(base)),'bytes':len(raw),'sha256':sha(raw)}
def require(ok,label):
 if not ok:raise ValueError(label)
def inputs():
 fixture=json.loads((ROOT/'renderer/virgl-shader/tests/radial-domain-cases.json').read_bytes());rows=[]
 for stage in ('vertex','fragment'):
  plain=next(x['text'] for x in fixture['cases'] if x['name']=='plain-'+stage)
  nested=plain.replace('MOV TEMP[3], IMM[0].yyyy','UIF IMM[0].yyyy\nMOV TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[3], IMM[0].zzzz\nENDIF')
  alias=plain.replace('FSLT TEMP[1].x','FSLT TEMP[0].x').replace('UIF TEMP[1].xxxx','UIF TEMP[0].xxxx')
  moved=plain.replace('MAX TEMP[0].x, CONST[4].xxxx, -CONST[4].xxxx','MOV TEMP[9], CONST[4]\nMAX TEMP[0].x, TEMP[9].xxxx, -TEMP[9].xxxx')
  missing=plain.replace('ELSE\nMOV TEMP[2], CONST[5]\n','')
  nonadjacent=plain.replace('FSLT TEMP[1].x','MOV TEMP[9], IMM[0].yyyy\nFSLT TEMP[1].x')
  badloop=next(x['text'] for x in fixture['cases'] if x['name']=='loop-'+stage).replace('SHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz','SHL TEMP[9].x, TEMP[3].xxxx, IMM[0].yyyy')
  for name,text,prediction in [('nested-linear',nested,True),('predicate-alias',alias,True),('nonconstant-magnitude',moved,False),('missing-else',missing,False),('nonadjacent-producer',nonadjacent,False),('bad-loop-recurrence',badloop,False)]:
   rows.append({'name':name+'-'+stage,'stage':stage,'text':text,'inputSha256':sha(text.encode()),'predictedOk':prediction})
 return rows

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);out=ap.parse_args().output.resolve();out.mkdir(parents=True,exist_ok=True)
 compiler=ROOT/'renderer/virgl-shader';sources=[binding(compiler/p,ROOT) for p in ['bridge.c','raw_bits.c','raw_bits.h','bridge.h','build.sh','cli.c']]+[binding(Path(__file__).resolve(),ROOT),binding(ROOT/'tools/virgl-radial-domain/probes.mjs',ROOT)]
 report={'schema':'radial-graph-probes-v1','status':'running','gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sources':sources,'cases':inputs(),'coverage':{}}
 try:
  with tempfile.TemporaryDirectory(prefix='radial-graph-probes-') as tmp:
   temp=Path(tmp);clone=temp/'shader';shutil.copytree(compiler,clone,ignore=shutil.ignore_patterns('build','__pycache__','.DS_Store'))
   cc=temp/'cc.sh';cc.write_text('#!/bin/sh\nexec clang -g -fsanitize=address,undefined -fprofile-instr-generate -fcoverage-mapping "$@"\n');cc.chmod(0o755)
   shutil.copy2(cc,out/'compiler-wrapper.sh');report['buildCommand']=['bash','build.sh','native'];report['instrumentation']={'wrapper':binding(out/'compiler-wrapper.sh',out),'clang':subprocess.check_output(['clang','--version'],text=True).strip()}
   env=dict(os.environ,CC=str(cc),ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1',LLVM_PROFILE_FILE=str(out/'%p.profraw'))
   with (out/'build.log').open('wb') as log:subprocess.run(['bash','build.sh','native'],cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
   binary=out/'native';shutil.copy2(clone/'build/native/virgl-shader',binary);report['binary']=binding(binary,out)
   for row in report['cases']:
    run=subprocess.run([str(binary),row['stage']],input=row['text'].encode(),capture_output=True,env=env,check=True,timeout=10);require(not run.stderr,'no sanitizer diagnostic');row['stdout']=run.stdout.decode();row['result']=json.loads(run.stdout);require(row['result']['ok'] is row['predictedOk'],'literal radial graph prediction '+row['name'])
   profdata=Path(subprocess.check_output(['xcrun','--find','llvm-profdata'],text=True).strip());cov=Path(subprocess.check_output(['xcrun','--find','llvm-cov'],text=True).strip())
   command=[str(profdata),'merge','-sparse',*map(str,sorted(out.glob('*.profraw'))),'-o',str(out/'native.profdata')];subprocess.run(command,check=True,capture_output=True)
   command=[str(cov),'export',str(binary),'-instr-profile='+str(out/'native.profdata'),str(clone/'bridge.c'),str(clone/'raw_bits.c'),'-ignore-filename-regex=(/vendor/|/generated/|bridge[.]h$|raw_bits[.]h$|cli[.]c$)'];run=subprocess.run(command,check=True,capture_output=True);require(not run.stderr,'no coverage diagnostic');(out/'coverage.json').write_bytes(run.stdout)
   report['coverageCommand']=command;export=json.loads(run.stdout);require({Path(f['filename']).name for f in export['data'][0]['files']}=={'bridge.c','raw_bits.c'},'both actual implementation coverage files')
   for f in export['data'][0]['files']:require(Path(f['filename']).read_bytes()==(compiler/Path(f['filename']).name).read_bytes(),'coverage is exact frozen source')
   report['coverage']={'sources':[dict(binding(compiler/Path(f['filename']).name,ROOT),recordedFilename=f['filename'],summary=f['summary']) for f in export['data'][0]['files']],'tools':[{'path':str(p),'sha256':sha(p.read_bytes())} for p in (profdata,cov)]}
  (out/'native.json').write_text(json.dumps(report['cases'],indent=2)+'\n')
  run=subprocess.run(['node','tools/virgl-radial-domain/probes.mjs',str(out/'native.json'),str(out/'wasm.json')],cwd=ROOT,capture_output=True,check=True,timeout=90);(out/'wasm.log').write_bytes(run.stdout+run.stderr)
  for s in sources:require(binding(ROOT/s['path'],ROOT)==s,'source unchanged during probes')
  report['records']=[binding(p,out) for p in sorted(out.iterdir()) if p.is_file() and p.name!='report.json'];report['status']='passed'
 finally:(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Twelve radial nested/version/control probes passed with actual native/Wasm parity.')
if __name__=='__main__':main()
