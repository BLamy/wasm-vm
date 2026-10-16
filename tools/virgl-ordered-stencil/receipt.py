#!/usr/bin/env python3
"""Reopen every full original/native body at the frozen ordered-stencil head."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
MODES={'matrix':168,'functions':72,'segments':140,'failures':22,'limits':20,'absent':6}
SEEDS=['0xd9453211','0x13579bdf','0x9e3779b9'];FAULTS=['order','operation','value-mask','completed-output','completed-stencil']
def main(directory):
 directory=Path(directory);head=git('rev-parse','HEAD');assert not git('diff','--name-only','HEAD')
 for _ in range(500):
  if b'\nORDERED_STENCIL_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
  time.sleep(.01)
 else:raise ValueError('incomplete final frozen recording')
 load=lambda name:json.loads((directory/name).read_text());sources={};generated={};audits={}
 predecessor=load('predecessor-audit.json');assert predecessor['status']=='passed' and predecessor['predecessor']==BASE and predecessor['reopenedMembers']==48980
 def source(name,digest=None):
  raw=(ROOT/name).read_bytes();actual=sha(raw);assert digest is None or actual==digest,name
  if '/build/wasm/' in name:generated[name]=actual
  else:assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),name;sources[name]=actual
 names=['wire']+['hardware-'+m for m in MODES]+['hardware-boundaries-'+s for s in SEEDS]+['fault-'+f for f in FAULTS]+['retained-common']
 counts=dict(runs=0,frames=0,pixels=0,nativePasses=0,normalizedBytes=0,publicBytes=0,consumedSyncs=0,disposalOnlySyncs=0)
 for name in names:
  report=load(name+'/report.json');fault=name.startswith('fault-');assert report['gitHead']==head and report['status']==('failed' if fault else 'passed');assert report['browserErrors']==dict(console=[],page=[],requests=[])
  for row in report['sources']:
   source(row['path'],row['sha256']);raw=(directory/name/'source'/row['path']).read_bytes();assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
  if name=='wire':assert report['wire']['status']=='passed' and len(report['wire']['rows'])==20;continue
  assert report['browser']['headless'] is False and not any(any(s in arg.lower() for s in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine']);assert sha(Path(report['browser']['executable']).read_bytes())==report['browser']['sha256']
  e=report.get('partial') or report['browserResult']['result'];assert 'Metal' in str(e.get('gpu',e.get('renderer'))) and 'M4' in str(e.get('gpu',e.get('renderer')));assert not e['guestExecution'] and not e['productionNegotiation']
  for ref in e['runs']:
   if 'path' in ref:raw=(directory/name/ref['path']).read_bytes();assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];run=json.loads(raw)
   else:run=ref
   if not fault:assert all(r['held'] for r in run.get('predictions',[]))
   for history in run['history']:assert isinstance(history['hex'],str) and len(history['hex'])%8==0
  if name.startswith('hardware-'):
   value=load(name+'/values-audit.json');physical=load(name+'/physical-audit.json');assert value['status']==physical['status']=='passed' and value['reportSha256']==physical['reportSha256']==sha((directory/name/'report.json').read_bytes());assert physical['allCompleteBodiesReopened'] and physical['oracleImportsProductCode'] is False;expected=MODES.get(name[len('hardware-'):],16);assert len(e['runs'])==expected;audits[name]={'values':value,'physical':physical}
   for k,v in value['counts'].items():counts[k]+=v
   for k in ['consumedSyncs','disposalOnlySyncs']:counts[k]+=physical['counts'][k]
   if name.startswith('hardware-boundaries-'):assert physical['counts']['disposalOnlySyncs']==8
  elif fault:
   audit=load(name+'/control-audit.json');assert audit['reportSha256']==sha((directory/name/'report.json').read_bytes());assert audit['status']=='refuted' and audit['differences'] and len(e['runs'])==1 and audit['citations'];audits[name]=audit
   if name=='fault-order':assert report['mutation']['path']=='renderer/virgl-command/state.mjs';raw=(directory/name/'served/renderer/virgl-command/state.mjs').read_bytes();assert sha(raw)==report['mutation']['delivered']['sha256']
  else:
   audit=load(name+'/independent-values.json');assert audit['status']=='passed' and not audit['oracleImportsProductCode'];audits[name]=audit;assert len(e['runs'])==12
  served={r['path']:r['sha256'] for r in report['servedFiles']};coverage=load(name+'/'+report['browserCoverage']['path']);assert 'renderer/virgl-command/state.mjs' in {r['source'] for r in coverage['scripts']}
  for row in coverage['scripts']:assert sha(row['sourceBody'].encode())==row['sha256']==served['/'+row['source']]
  for row in e['blobs']:
   zipped=(directory/name/row['path']).read_bytes();assert sha(zipped)==row['gzipSha256'];raw=gzip.decompress(zipped);assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
  for k in ['screenshot','browserCoverage']:
   row=report[k];assert sha((directory/name/row['path']).read_bytes())==row['sha256']
 assembly=load('retained-assembly/hardware/report.json');assert assembly['gitHead']==head and assembly['status']=='passed';assert assembly['browserErrors']==dict(console=[],page=[],requests=[]);audit=load('retained-assembly/physical-audit.json');assert audit['status']=='passed';audits['retained-assembly']=audit
 assert generated==predecessor['generated'];coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero']
 changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')};assert changed=={'renderer/virgl-command/state.mjs'};assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest')
 roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-ordered-stencil','tools/verify-virgl-ordered-stencil.mjs','tools/verify-virgl-ordered-stencil.sh','Makefile','tools/check_task_policy.py','AGENTS.md','web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d45-ordered-stencil.md']
 for name in git('ls-files',*roots).splitlines():source(name)
 for row in predecessor['records']:
  for name,digest in row['digests'].items():source(row['path']+'/'+name,digest)
 for name,digest in predecessor['unchangedBoundaries'].items():source(name,digest)
 for row in predecessor['primary']['sources']:source(row['path'],row['sha256'])
 files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
 receipt=dict(schema='original-ordered-stencil-receipt-v1',task='E6-T11d45',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,dependency=predecessor,audits=audits,counts=counts,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
 (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original ordered S8 fields and native planes authenticated.')
if __name__=='__main__':main(sys.argv[1])
