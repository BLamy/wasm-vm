"""Verify actual final-head browser reruns without rewriting earlier evidence."""
import hashlib,importlib.util,json,pathlib,subprocess
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2];E=ROOT/'evidence/virgl-dot-reciprocals/worker-incremental';OLD=ROOT/'evidence/virgl-dot-reciprocals/worker';HEAD='cb6726dc68eebecdaf9b848ea846e525003e86c9';PREVIOUS='72a8695ba92d734a6bead0c42ead3089d8611806'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_bytes())
def module(n,p):
 s=importlib.util.spec_from_file_location(n,ROOT/p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
path='renderer/virgl-shader/tests/dot-reciprocals.mjs';old_source=subprocess.check_output(['git','show',PREVIOUS+':'+path],cwd=ROOT);new_source=subprocess.check_output(['git','show',HEAD+':'+path],cwd=ROOT)
assert old_source.replace(b'const fraction=(n,d=1n)=>SCALE*n/d;\n',b'')==new_source==(ROOT/path).read_bytes()
assert subprocess.check_output(['git','diff','--name-only',PREVIOUS,HEAD],cwd=ROOT,text=True).splitlines()==[path]
main=module('scalar_incremental_receipt','tools/virgl-dot-reciprocals/receipt.py');recip=module('scalar_incremental_reciprocal','tools/virgl-dot-reciprocals/reciprocal_receipt.py');extra=module('scalar_incremental_extra','tools/virgl-dot-reciprocals/browser_receipt.py');h=vars(main)
n=read(OLD/'native/native-report.json');assert sha(OLD/'native/native-report.json')==read(V/'native-recording-audit.json')['nativeReportSha256'];fixtures=read(ROOT/'renderer/virgl-shader/tests/dot-reciprocal-cases.json');hardware=read(ROOT/'renderer/virgl-shader/tests/dot-reciprocal-hardware.json');cases={e['name']:e for e in n['cases']};pairs={e['name']:e for e in n['pairs']};originals={e['sha256']:e for e in n['originals']};contract=read(ROOT/'docs/gpu-3d-contract.json')
labels=['hardware','sabotage-dp3-lane','sabotage-rcp-source','sabotage-rsq-operation','sabotage-numeric-negate'];reports={};hits={}
for label in labels:
 r=main.base.verify_browser(E/label,HEAD,contract,passed=label=='hardware',task='E6-T12e6');reports[label]=r
 main.translations(r['acceptance'],fixtures,hardware,cases,pairs,originals);extra.verify_orientation(r['acceptance'],cases,helpers=h)
 for s in read(E/label/r['browserCoverage']['path'])['scripts']:
  if s['source']==path:
   assert s['sha256']==sha(ROOT/path)
   for f in s['coverage']['functions']:
    z=f['ranges'][0];key=(f['functionName'],z['startOffset'],z['endOffset']);hits[key]=hits.get(key,0)+z['count']
p=reports['hardware']['acceptance'];main.verify_sequences(p,hardware);main.verify_source_contracts(p,hardware,cases)
values={'numeric':main.verify_numeric(p,hardware,cases),'textures':main.verify_textures(p,hardware,cases),'reciprocals':recip.verify_reciprocals(p,hardware,cases,helpers=h),'observations':recip.verify_observations(p,hardware,cases,helpers=h),'pixels':main.verify_pairs(p,hardware,pairs)}
faults=[extra.verify_sabotage(E/('sabotage-'+mode),mode,reports['hardware'],cases,hardware,helpers=h) for mode in ['dp3-lane','rcp-source','rsq-operation','numeric-negate']]
assert len(hits)==151 and all(hits.values())
assert p['objects']['live']==0 and p['objects']['created']==p['objects']['deleted']
assert p['checkedWords']==488 and p['exactWords']==310 and p['boundedReciprocalWords']==178 and p['observedSpecialWords']==72
r={'status':'passed','head':HEAD,'previousHead':PREVIOUS,'sourceDelta':'Only unreferenced/uncalled fraction helper removed. Runtime and all other sources identical. Historical recording remains bound to previous head.','nativeEvidenceSha256':sha(OLD/'native/native-report.json'),'reports':{label:sha(E/label/'report.json') for label in labels},'values':values,'faults':faults,'harnessFunctions':len(hits),'unenteredHarnessFunctions':[],'memory':p['memory'],'objects':p['objects'],'screenshot':reports['hardware']['screenshot']}
(V/'incremental-browser-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k not in ['objects','reports']}))
