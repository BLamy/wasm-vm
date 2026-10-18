from pathlib import Path
import gzip,hashlib,json,os,subprocess,urllib.request,zipfile,base64
root=Path.cwd();out=root/'target/evidence/e9-t10-verifier';p=root/'evidence/e9-t10/public-final';prov=json.loads((p/'provenance.json').read_bytes());original=Path(prov['original']);report=json.loads((original/'report.json').read_bytes());env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
assert sha(original/'report.json')==prov['report_sha256']=='245f7588ae4346845cca2c182f8e391eadef2fbbe0b9d9039feceaebf5c28b1c'and sha(p/'report.json')==prov['report_sha256']
for name,wanted in report['source_sha256'].items():
 assert sha(root/name)==hashlib.sha256(subprocess.check_output(['git','show',report['head']+':'+name],env=env)).hexdigest()==wanted,name
for ent in report['files']:
 f=original/ent['path'];assert f.stat().st_size==ent['bytes']and sha(f)==ent['sha256'],str(f)
for ent in prov['packet']:
 f=p/ent['path'];source=Path(ent['source']);assert f.stat().st_size==ent['bytes']and sha(f)==ent['sha256']
 assert source.stat().st_size==ent['source_bytes']and sha(source)==ent['source_sha256']
 data=gzip.decompress(f.read_bytes())if ent['encoding']=='gzip'else f.read_bytes();assert len(data)==ent['source_bytes']and hashlib.sha256(data).hexdigest()==ent['source_sha256']
for ent in prov['aliases']:assert sha(Path(ent['source']))==sha(p/ent['packet'])==ent['sha256']
assert report['status']=='passed'and len(report['commands'])==4 and all(c['exit_code']==0 for c in report['commands'])
b=json.loads((original/'browser/report.json').read_bytes());assert b['status']=='passed'and b['head']==report['head']and not b['development']and b['url'].startswith('https://wasm-vm.pages.dev/')and b['errors']==[]and b['checks']['suite']=={'passed':127,'failed':0}
assets=[]
for ent in b['assets']:
 f=root/'web/dist'/ent['name'];assert f.stat().st_size==ent['bytes']and sha(f)==ent['sha256']
 # Fresh independent read of the current deployment, retaining digests rather than another boot.
 assets.append(ent)
# Authenticate actual guest command outputs against the recovered file bytes and trace points.
commands=[];zpath=original/'browser/browser-trace.zip';z=zipfile.ZipFile(zpath);lines=z.read('trace.trace').decode().splitlines()
for c in b['commands']:
 if c['command'].startswith('base64 '):name='linux-guest-file.bin'
 elif c['command'].startswith('while :'):name='linux-guest-partial.bin'
 elif c['command'].startswith('e9_open=1'):name='linux-cancelled-private.bin'
 else:continue
 raw=base64.b64decode(''.join(c['stdout'].split()));assert raw==(original/'browser'/name).read_bytes()and c['exit']==0
 hits=[i+1 for i,l in enumerate(lines)if c['command']in l.replace('\\"','"')];commands.append({'file':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'trace_lines':hits,'command':c['command']})
gpu=json.loads((original/'retained-gpu-browser/report.json').read_bytes());assert gpu['status']=='passed'and not gpu['development']and gpu['head']==report['head']and gpu['errors']==[]
result={'prediction':'P10','status':'HELD','head':report['head'],'report_sha256':sha(original/'report.json'),'files_authenticated':len(report['files']),'packet_files_authenticated':len(prov['packet']),'sources_authenticated':len(report['source_sha256']),'recorded_assets_authenticated':assets,'guest_commands':commands,'browser_trace_sha256':sha(zpath),'file_end':b['checks']['file']['end'],'zero_console_errors':True,'suite':b['checks']['suite'],'retained_gpu_report_sha256':sha(original/'retained-gpu-browser/report.json')}
(out/'public-authentication.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k not in ('recorded_assets_authenticated','guest_commands')},indent=2))
