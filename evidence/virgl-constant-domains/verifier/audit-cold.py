import pathlib,json,hashlib,subprocess,os
root=pathlib.Path.cwd();out=root/'evidence/virgl-constant-domains/verifier';cold=root/'evidence/virgl-constant-domains/cold-clone';warm=root/'evidence/virgl-constant-domains/worker'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
r=json.loads((cold/'report.json').read_text());head=r['gitHead'];clone=pathlib.Path(r['clone']);original=clone/'target/evidence/virgl-constant-domains-cold'
assert sha(cold/'report.json')=='d877a5c5d25bf88b68887d6a820658bc9a01e29d53c3cf85d4e4abe39be7f95c'
assert r['status']=='passed' and r['exitCode']==0 and r['command']==['make','verify-E6-T12e6a']
assert r['statusBefore']==r['statusAfter']=='' and r['cloneHead']==r['cloneHeadAfter']==head=='32509356c18af1c18e59bf14375f4402b434bd7d'
assert r['harnessSha256']==sha(clone/'tools/virgl-constant-domains/cold.py')==sha(root/'tools/virgl-constant-domains/cold.py')
assert r['receiptSha256']==sha(cold/'acceptance/receipt.json')=='c910b5fac8ba5e11d2b0e8388268d9f6fbf2d1f5a4738b7fb4b1162d0e6563e6';assert r['logSha256']==sha(cold/'cold.log')
def git(*args,cwd=clone):return subprocess.check_output(['git',*args],cwd=cwd,text=True).strip()
assert git('rev-parse','HEAD')==head and git('status','--porcelain','--untracked-files=all')==''
assert len(r['acceptanceFiles'])==48
for item in r['acceptanceFiles']:
 copy=cold/item['path'];live=original/pathlib.Path(item['path']).relative_to('acceptance');assert copy.read_bytes()==live.read_bytes() and sha(copy)==item['sha256'] and copy.stat().st_size==item['bytes']
code="""import pathlib,json,sys;sys.path.insert(0,'tools/virgl-constant-domains');import receipt;p=pathlib.Path('target/evidence/virgl-constant-domains-cold');r=json.loads((p/'receipt.json').read_text());actual=receipt.verify(p,r['gitHead']);assert actual==r;print(json.dumps({'status':'passed','sources':len(r['sources']),'records':len(r['records']),'gitHead':r['gitHead']}))"""
env=dict(os.environ);env['PYTHONDONTWRITEBYTECODE']='1'
checked=subprocess.check_output(['python3','-c',code],cwd=clone,env=env,text=True)
assert git('status','--porcelain','--untracked-files=all')==''
cr=json.loads((cold/'acceptance/receipt.json').read_text());wr=json.loads((warm/'receipt.json').read_text());assert cr['sources']==wr['sources'];assert cr['compilerSha256']==wr['compilerSha256'];assert cr['unit']==wr['unit']
for name in ['native/native-report.json','legacy/native/native-report.json']:
 a=json.loads((cold/'acceptance'/name).read_text());b=json.loads((warm/name).read_text())
 for key in ['cases','originals']:
  if key in a:assert a[key]==b[key]
 # Binary path is an honest clone difference; binary bytes and compiler source hashes stay exact.
 assert a['binarySha256']==b['binarySha256']
current=git('rev-parse','HEAD',cwd=root);changed=git('diff','--name-only',head,current,cwd=root).splitlines();assert all(x.startswith('evidence/virgl-constant-domains/') or x in ['tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T12e6a-constant-domain-consumer.md'] for x in changed)
result={'status':'passed','frozenHead':head,'submissionHead':current,'clone':str(clone),'coldReportSha256':sha(cold/'report.json'),'coldReceiptSha256':r['receiptSha256'],'coldLogSha256':r['logSha256'],'copiedArtifacts':len(r['acceptanceFiles']),'retainedCloneCleanBeforeAndAfterAudit':True,'receiptReplay':json.loads(checked),'warmColdSourcesEqual':True,'warmColdCompilerBytesEqual':True,'warmColdFullNativeResultsEqual':True,'warmColdUnitResultsEqual':True,'submissionOnlyEvidenceAndTaskMetadata':True,'removedEnvironmentNames':r['removedEnvironmentNames']}
(out/'cold-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
