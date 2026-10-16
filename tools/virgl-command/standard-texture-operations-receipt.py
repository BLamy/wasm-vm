#!/usr/bin/env python3
"""Authenticate original texture inputs, retained images and physical outcomes."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import time
ROOT=Path(__file__).resolve().parents[2]
BASE='71853cd302a2a39cd8f5af001fd8ad1b791b7da6'
TASK='E6-T11d24'
CONFIRMATION='Frozen original texture operations, retained image queries and full native evidence authenticated.\n'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def need(value,message):
 if not value:raise ValueError(message)
def main(directory):
 directory=Path(directory).resolve();head=git('rev-parse','HEAD');files={};sources={};generated={}
 need(not git('diff','--name-only','HEAD'),'freeze tracked source before recording')
 def record(name,digest=None):
  raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record drift '+name);files[name]=sha(raw);return raw
 def source(name,digest=None):
  raw=(ROOT/name).read_bytes();need(digest is None or sha(raw)==digest,'source drift '+name)
  if '/build/' in name:generated[name]=sha(raw)
  else:
   need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=sha(raw)
 for _ in range(500):
  if b'\nTEXTURE_OPERATIONS_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
  time.sleep(.01)
 else:raise ValueError('submission log incomplete')
 wire=json.loads(record('wire/report.json'));need(wire['task']==TASK and wire['gitHead']==head and wire['status']=='passed','strict owned metadata exact-head proof');need(len(wire['wire']['records'])>=34 and all(r['held'] for r in wire['wire']['predictions']),'strict metadata predictions')
 for row in wire['sources']:source(row['path'],row['sha256'])
 healthy={};names=['hardware-matrix']+['hardware-boundaries-'+s for s in ['0xa5471e03','0x13579bdf','0x9e3779b9']]
 for name in names+['fault-'+s for s in ['upload-channel','query-levels','mip-state']]:
  fault=name.startswith('fault-');report=json.loads(record(name+'/report.json'));need(report['task']==TASK and report['gitHead']==head and report['status']==('failed' if fault else 'passed'),'physical exact-head identity '+name)
  need(report['fixedMemory']['bytes']==16777216,'unchanged compiler fixed memory');need(report['browserErrors']==dict(console=[],page=[],requests=[]),'browser errors '+name);need(not report['browser']['headless'],'headed physical proof')
  need(not any(any(w in a.lower() for w in ['swiftshader','llvmpipe','softpipe','lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine']),'software browser flags')
  result=report['partial'] if fault else report['browserResult']['result'];need('Metal' in result['gpu'] and 'M4' in result['gpu'],'actual M4 Metal');need(not result['guestExecution'] and not result['productionNegotiation'],'isolated retained-image boundary')
  served={row['path']:row['sha256'] for row in report['servedFiles']}
  for row in report['sources']:
   source(row['path'],row['sha256'])
   if '/'+row['path'] in served:need(served['/'+row['path']]==row['sha256'],'served source identity')
  for key in ['browserCoverage','screenshot']:record(name+'/'+report[key]['path'],report[key]['sha256'])
  coverage=json.loads(record(name+'/'+report['browserCoverage']['path']));need({'renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs'}<={r['source'] for r in coverage['scripts']},'complete changed runtime coverage')
  for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']],'full nested coverage custody')
  need(len({r['key'] for r in result['blobs']})==len(result['blobs']),'unique original/native blob keys')
  for row in result['blobs']:
   raw=gzip.decompress(record(name+'/'+row['path'],row['gzipSha256']));need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete original/native blob custody')
  for run in result['runs']:
   need(all(v==0 for v in run['final']['resources']['budgets'].values()),'terminal resource budgets');need(all(v==0 for v in run['final']['renderer']['budgets'].values()),'terminal renderer budgets');need(all(r['deleted']==1 for r in run['nativeObjects']),'exactly-once native retirement')
  if fault:
   need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'],'wrong native selection must fail original oracle after physical fence');need('independent original texture-operation pixels at completed native fence' in report['browserResult']['error']['message'],'unchanged complete original pixel control');need(any(r['faultEvents'] for r in result['runs']),'actual native control executed')
  else:
   healthy[name]=result;need(all(r['held'] for r in result['predictions']),'worker falsifiable predictions held')
   if name=='hardware-matrix':
    need(len(result['runs'])>=969 and len(result['frames'])==2*len(result['runs']),'complete original overload/range/format/mask/swizzle/warm matrix');need({r['opcode'] for r in result['runs']}=={'TEX','TXL','TXF','TXD','TXB','TXQ'},'all selected original opcode families')
   else:
    need(result['seed']==int(name.rsplit('-',1)[1],16),'varied native schedule');need(sum(r.get('kind')=='query-uniform-vertex-composition' for r in result['runs'])==16,'raw-bank/typed/packed/query composition');need({r.get('nativeFault') for r in result['runs'] if r.get('kind')=='native-query-failure'}=={'query-type','query-size','query-location','query-budget','query-write'},'query native failure paths')
 audit=json.loads(record('physical-audit.json'));need(audit['status']=='passed' and audit['pixels']>=1938*64 and len(audit['faults'])==3,'independent original-input full native oracle');need(all(r['held'] for r in audit['rows']),'all independent healthy predictions');need(all(r['fenceCompleted'] for r in audit['faults']),'all actual wrong selections consumed physical fences')
 coverage=json.loads(record('coverage-audit.json'));need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'],'full diff coverage authority')
 for name,task in [('retained-async-jobs','E6-T11b1'),('retained-uniform-bindings','E6-T11d17'),('retained-byte-colors','E6-T11d22')]:
  report=json.loads(record(name+'/report.json'));need(report['task']==task and report['gitHead']==head and report['status']=='passed','affected historical gate '+name)
  for row in report['sources']:source(row['path'],row['sha256'])
 inverse=json.loads((ROOT/'tools/virgl-command/standard-texture-operations-boundary.json').read_text());boundaries={}
 need(set(inverse['changes'])=={'renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs'},'only explicitly selected consumer runtime changes')
 for name,rows in inverse['changes'].items():
  current=(ROOT/name).read_text()
  for row in reversed(rows):need(current.count(row['after'])==1,'unambiguous inverse '+name);current=current.replace(row['after'],row['before'],1)
  original=subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT);need(current.encode()==original,'runtime diff escapes retained texture boundary '+name);boundaries[name]=sha(original)
 need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'unchanged compiler and unqualified production boundaries')
 for name in ['renderer/virgl-command/cache.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/color-images.mjs']:
  source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged cache/wire/storage boundary');boundaries[name]=sources[name]
 carried={};authenticated={}
 for family in ['virgl-standard-byte-color-images','virgl-standard-texture']:
  for role in ['worker','verifier']:
   prefix='evidence/'+family+'/'+role+'/';manifest=json.loads((ROOT/(prefix+'manifest.json')).read_text());index=json.loads((ROOT/(prefix+'records.json')).read_text())
   for name in ['manifest.json','records.json','recording.tar.gz']:
    source(prefix+name);need((ROOT/(prefix+name)).read_bytes()==subprocess.check_output(['git','show',BASE+':'+prefix+name],cwd=ROOT),'carried proof drift');carried[prefix+name]=sources[prefix+name]
   need(carried[prefix+'recording.tar.gz']==manifest['archiveSha256'] and carried[prefix+'records.json']==manifest['recordIndexSha256'],'verified dependency seal identity')
   expected={r['path']:r for r in index['records']};seen=set();total=0
   with tarfile.open(ROOT/(prefix+'recording.tar.gz'),'r|gz') as archive:
    for member in archive:
     need(member.isfile() and member.name in expected and member.name not in seen,'sealed dependency member admission');raw=archive.extractfile(member).read();row=expected[member.name];need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete verified dependency member');seen.add(member.name);total+=len(raw)
   need(seen==set(expected) and len(seen)==manifest['records'],'complete verified dependency archive');authenticated[prefix]=dict(members=len(seen),bytes=total,archiveSha256=manifest['archiveSha256'],recordIndexSha256=manifest['recordIndexSha256'])
 for name in git('ls-files','renderer/virgl-shader','renderer/virgl-command','tools/verify-virgl-standard-texture-operations*','tools/virgl-command/standard-texture-operations*','Makefile','tasks/epic-6-transcendence/E6-T11d24-standard-texture-consumer.md').splitlines():source(name)
 for file in directory.rglob('*'):
  if file.is_file() and file.name!='receipt.json':record(file.relative_to(directory).as_posix())
 receipt=dict(schema='original-texture-operations-receipt-v1',task=TASK,status='passed',gitHead=head,frames=len(healthy['hardware-matrix']['frames']),pixels=audit['pixels'],texels=audit['texels'],nativeSchedules=3,historicalEvidenceHead=BASE,carriedVerifiedEvidence=carried,authenticatedDependencies=authenticated,carriedUnchangedBoundaries=boundaries,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,authority='isolated-original-texture-operations',productionDrawAuthority=False)
 (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(CONFIRMATION,end='')
if __name__=='__main__':main(sys.argv[1])
