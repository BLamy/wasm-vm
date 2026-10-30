"""Compact authenticated copies, preserving original T11 recordings and raw guest artifacts."""
import argparse, gzip, hashlib, json, shutil, subprocess
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--deployment');p.add_argument('--cold',type=Path);a=p.parse_args()
root=Path.cwd();source=a.source.resolve();destination=a.destination
report=json.loads((source/'report.json').read_text());assert report['status']=='passed'
head=report['head'];subprocess.run(['git','cat-file','-e',head+'^{commit}'],check=True)
def sha(file):
    digest=hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda:stream.read(1<<20),b''):digest.update(part)
    return digest.hexdigest()
for name,digest in report.get('source_sha256',{}).items():
    if name.startswith('web/pkg/') or name.startswith('web/session-pkg/'):continue
    expected=subprocess.check_output(['git','show',head+':'+name])
    assert hashlib.sha256(expected).hexdigest()==digest,name
for entry in report.get('files',[]):
    file=source/entry['path'];assert file.stat().st_size==entry['bytes'] and sha(file)==entry['sha256'],entry['path']
destination.mkdir(parents=True,exist_ok=False);copies=[];aliases=[];seen={}
def copy(file,name,compress=False):
    target=destination/name;target.parent.mkdir(parents=True,exist_ok=True)
    if compress:
        with file.open('rb') as stream,target.open('wb') as output:
            with gzip.GzipFile(fileobj=output,mode='wb',mtime=0) as zipped:shutil.copyfileobj(stream,zipped)
    else:shutil.copyfile(file,target)
    copies.append({'source':str(file),'path':name,'source_bytes':file.stat().st_size,'source_sha256':sha(file),'bytes':target.stat().st_size,'sha256':sha(target),'encoding':'gzip' if compress else 'identity'})
for file in sorted(source.rglob('*')):
    if not file.is_file():continue
    relative=file.relative_to(source)
    if any(part in ('chromium-profile','cloned-profile','profile') for part in relative.parts):continue
    if file.name=='javascript-coverage.json':copy(file,str(relative)+'.gz',True);continue
    if file.suffix=='.gz':
        digest=sha(file)
        if digest in seen:aliases.append({'source':str(file),'packet':seen[digest],'sha256':digest})
        else:copy(file,str(relative));seen[digest]=str(relative)
        continue
    if file.suffix=='.json' and file.stat().st_size>1024**2:
        copy(file,str(relative)+'.gz',True)
    elif file.suffix in ('.resume','.trace','.bin','.disk','.observations'):
        copy(file,str(relative)+'.gz',True)
    elif file.suffix in ('.json','.jsonl','.txt','.log','.png','.file','.sha256') and file.stat().st_size<=16*1024**2:
        copy(file,str(relative))
    elif file.name=='browser-trace.zip' and file.stat().st_size<=32*1024**2:copy(file,str(relative))
copy(Path(__file__),'packet.source.py')
if a.deployment:copy(Path('/tmp/e9-t11-deploy.log'),'deploy.log')
if a.cold:
    copy(a.cold/'receipt.json','cold-receipt.json');copy(Path('target/e9-t11-cold-wrapper.py'),'cold-wrapper.source.py')

provenance={'task':'E9-T11','status':'passed','head':head,'runtime_head':report.get('runtime_head',head),'carried_from':report.get('carried_from'),'original':str(source),'report_sha256':sha(source/'report.json'),'capture_head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'deployment':a.deployment,'production':'https://wasm-vm.pages.dev/' if a.deployment else None,'source_sha256':report.get('source_sha256',{}),'originals':report.get('files',[]),'packet':copies,'aliases':aliases,'retained':'Original browser traces/profiles, native frames/instruction traces, reconstructed disks and all original logs remain at their source paths; compact copies never replace them.'}
(destination/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'head':head,'report_sha256':provenance['report_sha256'],'copies':len(copies),'aliases':len(aliases),'originals':len(report.get('files',[]))}))
