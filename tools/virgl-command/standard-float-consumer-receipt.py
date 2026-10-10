#!/usr/bin/env python3
"""Authenticate full original floating consumer programs, packets and native planes."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='7a58efee480e38ebad14dedcc57bde0e747088ae'
TASK='E6-T11d26'
CONFIRMATION='Frozen original floating programs, native outputs and retained consumers authenticated.\n'
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def need(value,message):
 if not value:raise ValueError(message)
def main(directory):
 directory=Path(directory).resolve();head=git('rev-parse','HEAD');files,sources,generated={},{},{}
 need(not git('diff','--name-only','HEAD'),'freeze tracked source before recording')
 def record(name,digest=None):
  raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record drift '+name);files[name]=sha(raw);return raw
 def source(name,digest=None):
  raw=(ROOT/name).read_bytes();need(digest is None or sha(raw)==digest,'source drift '+name)
  if '/build/'in name:generated[name]=sha(raw)
  else:need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=sha(raw)
 for _ in range(500):
  if b'\nFLOAT_CONSUMER_RECORDING_COMPLETE\n'in(directory/'acceptance.log').read_bytes():break
  time.sleep(.01)
 else:raise ValueError('submission log incomplete')
 wire=json.loads(record('wire/report.json'));need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed','original wire exact-head identity');need(len(wire['wire']['records'])==26 and all(p['held']for p in wire['wire']['predictions']),'original float packets and historical refusal')
 for row in wire['sources']:source(row['path'],row['sha256'])
 names=['hardware-matrix']+['hardware-boundaries-'+s for s in['0xa5471e03','0x13579bdf','0x9e3779b9']];faults=['fault-'+n for n in['storage-precision','linear-filter','implicit-alpha']]
 for name in names+faults:
  fault=name.startswith('fault-');report=json.loads(record(name+'/report.json'));need(report['task']==TASK and report['gitHead']==head and report['status']==('failed'if fault else'passed'),'native exact-head identity '+name);need(report['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser errors');need(not report['browser']['headless'],'headed native proof');need(not any(any(s in arg.lower()for s in['swiftshader','llvmpipe','softpipe','lavapipe'])or arg.startswith('--disable-gpu')for arg in report['browser']['commandLine']),'no software GPU flags')
  result=report['partial']if fault else report['browserResult']['result'];need('Metal'in result['gpu']and'M4'in result['gpu'],'actual M4 Metal');need(not result['guestExecution']and not result['productionNegotiation'],'isolated consumer authority');served={r['path']:r['sha256']for r in report['servedFiles']}
  for row in report['sources']:
   source(row['path'],row['sha256'])
   if '/'+row['path']in served:need(served['/'+row['path']]==row['sha256'],'served source identity')
  for key in['browserCoverage','screenshot']:record(name+'/'+report[key]['path'],report[key]['sha256'])
  coverage=json.loads(record(name+'/'+report['browserCoverage']['path']));need({'renderer/virgl-command/'+n+'.mjs'for n in['decoder','state']}<={r['source']for r in coverage['scripts']},'full changed runtime coverage')
  for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']],'full V8 source custody')
  need(len({r['key']for r in result['blobs']})==len(result['blobs']),'unique complete native blob keys')
  for row in result['blobs']:
   packed=record(name+'/'+row['path'],row['gzipSha256']);raw=gzip.decompress(packed);need(len(raw)==row['bytes']and sha(raw)==row['sha256'],'complete native planes and input words')
  for run in result['runs']:
   need(all(n==0 for n in run['final']['resources']['budgets'].values()),'bounded native owner cleanup');need(all(n==0 for n in run['final']['renderer']['budgets'].values()),'bounded consumer cleanup');need(all(r['deleted']==1 for r in run['nativeObjects']),'each native object retires once')
  if fault:need(result['sabotage']['fenceCompleted']and not result['sabotage']['held'],'original inverse detects wrong native selection after physical fence');need(any(run['faultEvents']for run in result['runs']),'actual wrong native calls')
  else:
   need(all(row['held']for row in result['predictions']),'worker predictions held');need(len(result['runs'])==(384 if name=='hardware-matrix'else 25),'complete original format/output/lifetime matrix')
   if name!='hardware-matrix':need(result['seed']==int(name.rsplit('-',1)[1],16),'independent schedule identity');need(len(result['hostRefusals'])==3 and all(r['result']['error']['code']=='unsupported-host'and r['allocations']==0 for r in result['hostRefusals']),'each floating host capability refused before allocation')
 audit=json.loads(record('physical-audit.json'));need(audit['status']=='passed'and audit['originalInputReconstruction']and len(audit['faults'])==3,'independent full original packet/program/native inverse');need(audit['components']>100000 and audit['nativeComponents']>100000 and audit['publicBytes']>100000,'complete output/source/public planes')
 coverage=json.loads(record('coverage-audit.json'));need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'],'diff/full nested coverage')
 for name,task in[('retained-async-jobs','E6-T11b1'),('retained-texture-consumer','E6-T11d24'),('retained-byte-colors','E6-T11d22'),('retained-float-storage','E6-T11d25')]:
  report=json.loads(record(name+'/report.json'));need(report['status']=='passed'and report['gitHead']==head and report['task']==task,'unchanged historical gate '+name)
  for row in report['sources']:source(row['path'],row['sha256'])
 inverse=json.loads((ROOT/'tools/virgl-command/standard-float-consumer-boundary.json').read_text());need(inverse['predecessor']==BASE and len(inverse['changes'])==2,'explicit isolated consumer boundary');boundaries={}
 for name,rows in inverse['changes'].items():
  current=(ROOT/name).read_text()
  for row in reversed(rows):need(current.count(row['after'])==1,'unambiguous original float consumer migration');current=current.replace(row['after'],row['before'],1)
  original=subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT);need(current.encode()==original,'consumer diff escapes selected boundary '+name);boundaries[name]=sha(original)
 for name in['renderer/virgl-command/'+n+'.mjs'for n in['resources','float-images','color-images','cache','constant-domain']]:source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged storage/compiler/cache boundary');boundaries[name]=sources[name]
 need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'unqualified production/compiler/guest unchanged')
 carried={}
 for prefix in['evidence/virgl-standard-float-images','evidence/virgl-standard-texture-operations']:
  for name in git('ls-files',prefix).splitlines():source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'verified carried evidence changed');carried[name]=sources[name]
  for suffix in['worker','verifier']:
   folder=prefix+'/'+suffix+'/';manifest=json.loads((ROOT/(folder+'manifest.json')).read_text());need(carried[folder+'recording.tar.gz']==manifest['archiveSha256']and carried[folder+'records.json']==manifest['recordIndexSha256'],'exact predecessor archive/index custody')
 for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/verify-virgl-standard-float-consumer*','tools/virgl-command/standard-float-consumer*','Makefile','tasks/epic-6-transcendence/E6-T11d26-standard-float-consumer.md').splitlines():source(name)
 for file in directory.rglob('*'):
  if file.is_file()and file.name!='receipt.json':record(file.relative_to(directory).as_posix())
 receipt=dict(schema='original-float-consumer-receipt-v1',task=TASK,status='passed',gitHead=head,nativePrograms=384,nativeSchedules=3,physicalAudit=audit,historicalEvidenceHead=BASE,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=boundaries,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-float-consumer');(directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(CONFIRMATION,end='')
if __name__=='__main__':main(sys.argv[1])
