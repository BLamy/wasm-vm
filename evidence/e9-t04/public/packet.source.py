import gzip,hashlib,json,pathlib,shutil,subprocess
root=pathlib.Path.cwd();out=root/'target/evidence/e9-t04-public-final';packet=root/'evidence/e9-t04/public'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
r=json.loads((out/'report.json').read_text());assert r['head']==head and r['status']=='passed' and r['errors']==[]
assert r['checks']['suite']=={'passed':127,'failed':0} and len(r['checks']['publicBytes'])==15
g=r['checks']['gpu'];assert g['scheduler']['retiredInstructions']>0 and g['gpu']['qualified'] and not g['gpu']['lost'] and not g['gpu']['poisoned']
assert any(x['epoch']==g['gpu']['epoch'] and x['status']=='drawn' for x in g['gpu']['scanout']['retirements'])
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
packet.mkdir(exist_ok=False)
for p in sorted(out.iterdir()):
 if p.is_file() and p.suffix not in ('.ext4','.zip') and p.name!='javascript-coverage.json':shutil.copyfile(p,packet/p.name)
with (packet/'javascript-coverage.json.gz').open('wb') as f:
 with gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as z:z.write((out/'javascript-coverage.json').read_bytes())
shutil.copyfile('/tmp/e9-t04-public-final.log',packet/'browser.log')
shutil.copyfile('/tmp/e9-t04-deploy.log',packet/'deploy.log')
shutil.copyfile(__file__,packet/'packet.source.py')
source_names=list(json.loads((root/'target/evidence/e9-t04-cold-browser-final/receipt.json').read_text())['source_sha256'])
provenance={'task':'E9-T04','status':'passed','head':head,'runtime_head':'b5baad0a4b1cddcbd08299b438292258352b2c08',
 'deployment':'https://7a2f6b85.wasm-vm.pages.dev','production':'https://wasm-vm.pages.dev/',
 'command':['node','tools/verify/e9-disk-roots-browser.mjs','--url','https://wasm-vm.pages.dev/','--output','target/evidence/e9-t04-public-final'],
 'source_clean_before_and_after':True,'source_sha256':{n:sha(root/n) for n in source_names},
 'original_evidence':str(out),'report_sha256':sha(out/'report.json'),
 'files':[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.rglob('*')) if p.is_file()],
 'packet':[{'path':str(p.relative_to(packet)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(packet.rglob('*')) if p.is_file()]}
(packet/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
p=root/'tasks/epic-9-session-time-travel/E9-T04-historical-disk-roots.md'
with p.open('a') as f:f.write(f'''\n### 2026-10-17 — worker — verified runtime published and checked\n\nPublished source `{head}` to <https://7a2f6b85.wasm-vm.pages.dev>\nand production <https://wasm-vm.pages.dev/> with `bash tools/deploy-cloudflare.sh`.\nThe exact build identity remains `8947b88d248365ce6991d01dc22ec74170ed99f7d7444620793a4dd21ae7744c`;\nonly the verified task catalog/service-worker stamp changed after the critic's proof.\nThe built dist is committed, and the five deploy-only R2 URL rewrites were restored.\n\n`node tools/verify/e9-disk-roots-browser.mjs --url https://wasm-vm.pages.dev/ --output target/evidence/e9-t04-public-final`\npassed: all 15 published asset digests match the committed dist, suite 127/0,\nzero console errors, verified pip, all owner/I/O attacks, real before/after/live/fork\nLinux files, same-block private writes, unchanged live database and independent\nfilesystem reconstruction. The retained factory resumed {g['scheduler']['retiredInstructions']:,} instructions\nand physically drew in fresh epoch 4 without loss or poisoning. Report SHA-256\n`{sha(out/'report.json')}`.\nCompact raw deltas, roots, oracle witnesses, screenshots, logs, coverage and all\noriginal-file digests are in `evidence/e9-t04/public/`; the full browser trace/profile\nand reconstructed images remain at the recorded external evidence path.\n''')
print(json.dumps({'packet':str(packet),'original_files':len(provenance['files']),'packet_files':len(provenance['packet']),'report_sha256':provenance['report_sha256']}))
