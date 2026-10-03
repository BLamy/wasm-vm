#!/usr/bin/env python3
import copy,hashlib,json,shutil,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'tools/virgl-structured-conditionals'))
import faults
BASE=ROOT/'evidence/virgl-structured-conditionals/worker';native=json.loads((BASE/'native/native-report.json').read_bytes());clean={c['inputSha256']:c['result'] for c in native['cases']};results=[]
for name in ['clean','schema-bool','wasm-stability-int','native-exit-bool']:
 target=Path(tempfile.mkdtemp(prefix='e7-fault-receipt-audit-'))/'fault';shutil.copytree(BASE/'fault-artifacts',target);manifest=json.loads((target/'manifest.json').read_bytes());mode=manifest['modes']['join-union'];mutation={}
 if name=='schema-bool':manifest['schema']=True;mutation={'field':'schema','before':1,'after':True}
 if name=='wasm-stability-int':
  path=target/mode['wasmTranslations']['path'];record=json.loads(path.read_bytes());record['memory']['bufferIdentityStable']=1;path.write_text(json.dumps(record));mode['wasmTranslations']=faults.binding(path,target);mutation={'field':'join-union/wasm.memory.bufferIdentityStable','before':True,'after':1}
 if name=='native-exit-bool':
  path=target/mode['nativeTranslations']['path'];record=json.loads(path.read_bytes());record[0]['returnCode']=False;path.write_text(json.dumps(record));mode['nativeTranslations']=faults.binding(path,target)
  path=target/mode['wasmTranslations']['path'];record=json.loads(path.read_bytes());record['nativeTranslations']=mode['nativeTranslations'];path.write_text(json.dumps(record));mode['wasmTranslations']=faults.binding(path,target);mutation={'field':'join-union/native[0].returnCode','before':0,'after':False}
 (target/'manifest.json').write_text(json.dumps(manifest))
 try:faults.verify_recording(target,clean);outcome='ACCEPTED';error=None
 except Exception as e:outcome='REJECTED';error=str(e)
 results.append({'attack':name,'outcome':outcome,'mutation':mutation,'error':error});print(json.dumps(results[-1]),flush=True);shutil.rmtree(target.parent)
(OUT/'fault-receipt-results.json').write_text(json.dumps({'originalSourceHead':'242ad5705dbdfd07b269c3e5850857c893af41e7','results':results},indent=2)+'\n')
