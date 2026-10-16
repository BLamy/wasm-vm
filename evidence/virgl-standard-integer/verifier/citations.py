#!/usr/bin/env python3
import hashlib,json
from pathlib import Path
OUT=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
rows=[]
def cite(path,label,fault=False):
 raw=path.read_bytes();text=raw.decode();r=json.loads(text);result=r['partial'] if fault else r['browserResult']['result'];frame=next(f for f in result['frames'] if f['label']==label)
 needle='"label": "'+label+'"';line=text[:text.index(needle)].count('\n')+1
 rows.append({'record':path.relative_to(OUT).as_posix(),'line':line,'recordSha256':sha(raw),'label':label,'pixelSha256':frame['pixels']['sha256'],'gpuComplete':frame['history'][-1]['result']['gpuComplete'],'fetches':frame['history'][-1]['result']['draws'][-1]['vertexFetches'],'nativeTypes':[{'name':a['name'],'shaderType':a.get('shaderType'),'pointerType':a.get('type'),'integer':a.get('integer'),'genericKind':a.get('genericKind'),'genericWords':a.get('genericWords')} for a in frame['native']['state'][-1]['attributes']], 'audit':frame['audit']})
worker=OUT/'unpacked/hot/hardware/report.json'
for label in ['integer-narrow-word-189-0-true','integer32-word-193-2-2-true','integer-high-slot-constant','integer-mixed-shared-constant','exact-compact-staging','integer-exact-work','pending-waiting-attributes-reuse','typed-variant-false-1','typed-variant-false-2','typed-variant-true-3','restore-A-last']:
 cite(worker,label)
for mode in ['native-signedness','constant-word','shader-conversion']:
 cite(OUT/'unpacked/hot'/('fault-'+mode)/'report.json','integer-smoke',True)
positive=OUT/'final-gpu/report.json';r=json.loads(positive.read_text())['browserResult']['result']
for label in [r['frames'][48]['label'],'critic-high16-pending-reuse','critic-high16-variant-False-1'.replace('False','false'),'critic-high16-variant-true-3']:
 cite(positive,label)
for mode in ['native-signedness','constant-word','shader-conversion']:
 cite(OUT/('final-fault-'+mode)/'report.json','critic-high16-sabotage-'+mode,True)
(OUT/'citations.json').write_text(json.dumps({'status':'HELD','citations':rows},indent=2)+'\n')
for row in rows:print(row['record']+':'+str(row['line']),row['label'],'pixels='+row['pixelSha256'])
