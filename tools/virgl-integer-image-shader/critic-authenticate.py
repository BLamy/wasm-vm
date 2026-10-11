import hashlib,json,subprocess,tarfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__import__('sys').argv[1]).resolve();OUT.mkdir(parents=True,exist_ok=True)
HEAD='3c0a3e348048c0ff293a6b67638a96fb5c3561cb';BASE='d8d510a689cfb5440cc8b3b65fd94adb9baee109'
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(v,why):
 if not v:raise AssertionError(why)
def wasm_memory(raw):
 need(raw[:8]==b'\0asm\x01\0\0\0','actual Wasm magic/version');at=8
 def leb():
  nonlocal at
  value=shift=0
  while True:
   byte=raw[at];at+=1;value|=(byte&127)<<shift
   if byte<128:return value
   shift+=7;need(shift<=35,'bounded Wasm unsigned LEB')
 memories=[]
 while at<len(raw):
  section=raw[at];at+=1;size=leb();end=at+size;need(end<=len(raw),'whole Wasm section')
  if section==5:
   count=leb()
   for _ in range(count):
    flags=leb();initial=leb();maximum=leb() if flags&1 else None
    need(flags==1 and initial==maximum==256,'actual fixed 16MiB memory limits');memories.append({'flags':flags,'initialPages':initial,'maximumPages':maximum,'bytes':initial*65536})
   need(at==end,'whole memory section')
  at=end
 need(len(memories)==1,'one actual defined Wasm memory');return memories[0]
def reopen(base,extract=None,exact=None,extract_prefix=None):
 manifest=(base/'manifest.json').read_bytes();index=(base/'records.json').read_bytes();archive=(base/'recording.tar.gz').read_bytes();m=json.loads(manifest);idx=json.loads(index)
 need(sha(index)==m['recordIndexSha256'],'index digest '+str(base));need(sha(archive)==m['archiveSha256'],'archive digest '+str(base));rows=idx['records'];expected={r['path']:r for r in rows};need(len(rows)==len(expected)==m['records'],'unique index');seen=set();total=0
 with tarfile.open(base/'recording.tar.gz','r:gz') as tar:
  for entry in tar:
   need(entry.isfile() and entry.name in expected and entry.name not in seen,'regular unique indexed member '+entry.name)
   name=Path(entry.name);need(not name.is_absolute() and '..' not in name.parts,'member containment');raw=tar.extractfile(entry).read();r=expected[entry.name];need(len(raw)==r['bytes'] and sha(raw)==r['sha256'],'member digest '+entry.name);total+=len(raw);seen.add(entry.name)
   if extract and (extract_prefix is None or entry.name.startswith(extract_prefix)):
    target=extract/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 need(seen==set(expected),'complete membership')
 if exact:
  for name in ['manifest.json','records.json','recording.tar.gz']:
   relative=(base/name).relative_to(ROOT).as_posix();need((base/name).read_bytes()==subprocess.check_output(['git','show',exact+':'+relative],cwd=ROOT),'changed predecessor seal '+relative)
 return {'path':base.relative_to(ROOT).as_posix(),'manifestSha256':sha(manifest),'indexSha256':sha(index),'archiveSha256':sha(archive),'members':len(seen),'uncompressedBytes':total,'everyMemberSizeHashHeld':True,'sourceHead':m.get('sourceHead'),'records':rows}
def run():
 record=reopen(ROOT/'evidence/virgl-integer-image-shader/worker',OUT/'worker')
 need(record['archiveSha256']=='6489b7d7b97effba826b3f8555efc192b9dcfae59ca8a232142cea6355f68be0','claimed archive');need(record['indexSha256']=='7d670a9b824d7fc96f02c307b5e98d505658af4876430e80e77ac61b41e3f8dd','claimed index');need(record['sourceHead']==HEAD,'worker source head')
 predecessors=[reopen(ROOT/'evidence/virgl-standard-integer-images'/role,OUT/('d31-'+role),BASE,'hot-generated/renderer/virgl-shader/build/wasm/') for role in ['worker','verifier']]
 source=OUT/'worker/source';source_rows=[]
 for p in sorted(source.rglob('*')):
  if p.is_file():
   name=p.relative_to(source).as_posix();raw=p.read_bytes();need(raw==subprocess.check_output(['git','show',HEAD+':'+name],cwd=ROOT),'source mismatch '+name);source_rows.append({'path':name,'sha256':sha(raw),'bytes':len(raw)})
 required=['evidence/virgl-production-readiness/standard-integer-image-shader-gap.json','evidence/virgl-production-readiness/standard-texture-operation-gap.json','tools/virgl-original-corpus/toolchain.py','tools/virgl-original-corpus/shared.py','tools/setup-virgl-emsdk.sh','web/package.json','web/package-lock.json','tools/lib/virgl-browser-runner.mjs','tools/virgl-standard-texture/abi.mjs','tools/virgl-standard-texture/tokens.mjs','renderer/virgl-shader/vendor/src/virgl_hw.h','renderer/virgl-shader/vendor/src/gallium/include/pipe/p_shader_tokens.h']
 need(all((source/name).is_file() for name in required),'explicit input/toolchain/package/header closure')
 receipts=[];memories=[]
 for prefix in ['hot','cold']:
  base=OUT/'worker'/prefix;raw=(base/'receipt.json').read_bytes();r=json.loads(raw);need(r['status']=='passed' and r['gitHead']==HEAD and r['predecessor']==BASE,'exact-head receipt')
  for name,digest in r['files'].items():need(sha((base/name).read_bytes())==digest,'receipt file '+prefix+'/'+name)
  for name,digest in r['sources'].items():need(sha((source/name).read_bytes())==digest,'receipt source '+name)
  for name,digest in r['generated'].items():need(sha((OUT/'worker'/(prefix+'-generated')/name).read_bytes())==digest,'generated '+name)
  module=OUT/'worker'/(prefix+'-generated')/'renderer/virgl-shader/build/wasm/virgl-shader.wasm';memories.append({'prefix':prefix,'sha256':sha(module.read_bytes()),**wasm_memory(module.read_bytes())})
  receipts.append({'prefix':prefix,'sha256':sha(raw),'files':len(r['files']),'sources':len(r['sources']),'generated':len(r['generated'])})
 cold=json.loads((OUT/'worker/cold/report.json').read_text());need(cold['status']=='passed' and cold['gitHead']==cold['cloneHead']==HEAD and not cold['statusBefore'] and not cold['statusAfter'] and cold['exitCode']==0,'clean cold')
 need(sha((OUT/'worker/cold/cold.log').read_bytes())==cold['logSha256'],'cold log');need(sha((OUT/'worker/cold/receipt.json').read_bytes())==cold['receiptSha256'],'cold receipt')
 unchanged=['renderer/virgl-command','crates','web','tools/guest'];need(not subprocess.check_output(['git','diff','--name-only',BASE,HEAD,'--',*unchanged],cwd=ROOT).strip(),'carried unchanged source boundary')
 result={'schema':'d32-independent-full-authentication-v1','status':'HELD','worker':record,'predecessors':predecessors,'sourceClosure':source_rows,'explicitRequiredClosure':required,'receipts':receipts,'actualWasmMemoryLimits':memories,'cold':cold,'unchangedBoundary':unchanged}
 (OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'status':'HELD','workerMembers':record['members'],'sourceFiles':len(source_rows),'receipts':receipts,'predecessorMembers':[p['members'] for p in predecessors]}))
if __name__=='__main__':run()
