#!/usr/bin/env python3
"""Authenticate the fresh critic's complete original/native/source bodies."""
import gzip,hashlib,json,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[2];directory=pathlib.Path(sys.argv[1]).resolve()
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
head=git('rev-parse','HEAD').decode().strip();assert not git('diff','--name-only','HEAD')
for _ in range(500):
 if b'\nINSTANCED_STENCIL_CRITIC_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
 time.sleep(.01)
else:raise ValueError('unfinished critic recording')
predecessor=json.loads((directory/'predecessor/authentication.json').read_text());assert predecessor['status']=='passed' and predecessor['reopenedMembers']==97179
metadata=json.loads((directory/'metadata/metadata.json').read_text());assert metadata['status']=='passed' and metadata['gitHead']==head and len(metadata['rows'])==84
seeds=['0x510e527f','0x9b05688c','0x1f83d9ab'];sources={};reports={};counts={'runs':0,'frames':0,'pixels':0,'nativePasses':0,'normalizedBytes':0}
for name in [part+'-'+s for s in seeds for part in ['boundaries','novel']]+['fault-novel-order']:
 folder=directory/name;raw=(folder/'report.json').read_bytes();report=json.loads(raw);fault=name.startswith('fault-')
 assert report['gitHead']==head and report['status']==('failed' if fault else 'passed')
 assert report['browserErrors']=={'console':[],'page':[],'requests':[]} and not report['browser']['headless']
 assert sha(pathlib.Path(report['browser']['executable']).read_bytes())==report['browser']['sha256']
 assert not any(any(w in a.lower() for w in ['swiftshader','llvmpipe','softpipe','lavapipe']) or a.startswith('--disable-gpu') for a in report['browser']['commandLine'])
 data=report.get('partial') or report['browserResult']['result'];assert 'M4' in data['gpu'] and 'Metal' in data['gpu']
 assert not data['guestExecution'] and not data['productionNegotiation']
 assert len(data['runs'])==(1 if fault else 24 if name.startswith('boundaries-') else 2)
 for source in report['sources']:
  actual=(ROOT/source['path']).read_bytes();assert sha(actual)==source['sha256'] and len(actual)==source['bytes']
  assert actual==(folder/'source'/source['path']).read_bytes()
  if '/build/wasm/' not in source['path']:assert actual==git('show',head+':'+source['path']);sources[source['path']]=source['sha256']
 for ref in data['runs']:
  if 'path' in ref:
   body=(folder/ref['path']).read_bytes();assert sha(body)==ref['sha256'] and len(body)==ref['bytes'];run=json.loads(body)
  else:run=ref
  if not fault:assert all(p['held'] for p in run.get('predictions',[]))
 for ref in data['blobs']:
  zipped=(folder/ref['path']).read_bytes();body=gzip.decompress(zipped);assert sha(zipped)==ref['gzipSha256'] and sha(body)==ref['sha256'] and len(body)==ref['bytes']
 audit=json.loads((folder/('control-audit.json' if fault else 'values-audit.json')).read_text());assert audit['status']==('refuted' if fault else 'passed') and audit['reportSha256']==sha(raw)
 if fault:assert audit['differences'] and audit['citations']
 else:
  physical=json.loads((folder/'physical-audit.json').read_text());assert physical['status']=='passed' and physical['reportSha256']==sha(raw) and physical['allCompleteBodiesReopened']
  for k in counts:counts[k]+=audit['counts'].get(k,0)
 served={r['path']:r['sha256'] for r in report['servedFiles']}
 for s in json.loads((folder/'browser-coverage.json').read_text())['scripts']:assert sha(s['sourceBody'].encode())==s['sha256']==served['/'+s['source']]
 if fault:
  mutation=report['mutation'];assert sha((folder/'served'/mutation['path']).read_bytes())==mutation['delivered']['sha256']
 for k in ['browserCoverage','screenshot']:assert sha((folder/report[k]['path']).read_bytes())==report[k]['sha256']
 reports[name]={'reportSha256':sha(raw),'originalAuditStatus':audit['status'],'runs':len(data['runs'])}
for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/virgl-instanced-stencil','tools/virgl-ordered-stencil','tools/virgl-unorm-depth','tools/verify-virgl-instanced-stencil.mjs','tools/verify-virgl-instanced-stencil-critic.sh','Makefile','AGENTS.md','web/package.json','web/package-lock.json').decode().splitlines():
 raw=(ROOT/name).read_bytes();assert raw==git('show',head+':'+name);sources[name]=sha(raw)
files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
result={'schema':'fresh-instanced-stencil-critic-receipt-v1','task':'E6-T11d47','status':'passed','gitHead':head,'sources':sources,'generated':predecessor['generated'],'files':files,'reports':reports,'counts':counts,'metadataCases':84,'independentSeeds':seeds,'guestExecution':False,'productionNegotiation':False,'productionDrawAuthority':False}
(directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('Frozen fresh instanced-stencil critic bodies authenticated.')
