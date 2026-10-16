import pathlib,json,hashlib,sys
sys.path.insert(0,'tools/virgl-constant-domains')
import browser_receipt as b,lifecycle_receipt as l,common
root=pathlib.Path.cwd();out=root/'evidence/virgl-constant-domains/verifier';worker=root/'evidence/virgl-constant-domains/worker';head='32509356c18af1c18e59bf14375f4402b434bd7d'
b.SCHEDULES[:]=[(0x92556a61,1),(0xc310478b,2),(0x1058d09d,3),(0x5fff00b7,8)]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
cases={e['name']:e for e in json.loads((worker/'native/native-report.json').read_text())['cases']}
originals={e['sha256']:e['result'] for e in json.loads((worker/'legacy/native/native-report.json').read_text())['originals']}
summaries=[]
for dirname,mode in [('fresh-schedules','normal'),('fresh-bypass','decoder-bypass'),('fresh-sabotage','decoder-and-guard-bypass')]:
 path=out/dirname;r=json.loads((path/'report.json').read_text());a=r['acceptance'];assert r['gitHead']==head
 assert r['status']==('failed' if mode=='decoder-and-guard-bypass' else 'passed');assert r['browserErrors']=={'console':[],'page':[],'requests':[]}
 assert a['mode']==mode and a['guestExecution'] is False and a['productionVirgl'] is False and a['trustedHostMetadataWrapper'] is True and a['compilerAdmissionUnchanged'] is True
 sources={x['path']:x for x in r['sources']};mutations={x['path']:x for x in r['mutations']};served={x['path']:x for x in r['servedFiles']}
 for name,item in sources.items():assert sha(root/name)==item['sha256']
 for name,item in served.items():
  raw=(root/name).read_bytes()
  if name in mutations:
   m=mutations[name];assert m['matches']==1 and m['originalSha256']==hashlib.sha256(raw).hexdigest() and raw.count(m['before'].encode())==1
   raw=raw.replace(m['before'].encode(),m['after'].encode());assert hashlib.sha256(raw).hexdigest()==m['servedSha256']
  assert hashlib.sha256(raw).hexdigest()==item['sha256'] and len(raw)==item['size']
 expected={'renderer/virgl-command/tests/constant-domains.mjs'} if mode=='normal' else {'renderer/virgl-command/decoder.mjs','renderer/virgl-command/tests/constant-domains.mjs'} if mode=='decoder-bypass' else {'renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs'}
 assert set(mutations)==expected
 if mode!='decoder-and-guard-bypass':
  m=mutations['renderer/virgl-command/tests/constant-domains.mjs'];assert m['before']=='const schedules=[{seed:0x7c1209ad,commandsPerStep:1},{seed:0x491be583,commandsPerStep:2},{seed:0xea016f35,commandsPerStep:3},{seed:0x265d8cb7,commandsPerStep:8}];';assert m['after']=='const schedules=[{seed:0x92556a61,commandsPerStep:1},{seed:0xc310478b,commandsPerStep:2},{seed:0x1058d09d,commandsPerStep:3},{seed:0x5fff00b7,commandsPerStep:8}];'
 for name,before,after in b.MUTATIONS:
  if name in mutations:assert mutations[name]['before']==before and mutations[name]['after']==after
 by_body=b.translations(a,cases,originals);totals={'pixels':0,'rawWords':0,'invalidUploads':0};rigs=[]
 for rig in a['rigs']+a['metadataRigs']:
  for k,v in b.gpu(rig,mode,by_body).items():totals[k]+=v
  rigs.append({'name':rig['name'],**l.verify_rig(rig,mode)})
 expectedTotals={'normal':{'pixels':110592,'rawWords':64,'invalidUploads':0},'decoder-bypass':{'pixels':10240,'rawWords':0,'invalidUploads':0},'decoder-and-guard-bypass':{'pixels':1024,'rawWords':0,'invalidUploads':1}}[mode];assert totals==expectedTotals
 coverage=json.loads((path/'browser-coverage.json').read_text());assert sha(path/'browser-coverage.json')==r['browserCoverage']['sha256']
 for entry in coverage['scripts']:assert entry['sha256']==served[entry['source']]['sha256'] and entry['originalSha256']==sources[entry['source']]['sha256']
 image=r.get('screenshot',r.get('failureScreenshot'));assert sha(path/image['path'])==image['sha256']
 summaries.append({'mode':mode,'reportSha256':sha(path/'report.json'),'status':r['status'],'counts':totals,'mutations':r['mutations'],'rigs':rigs})
result={'status':'passed','gitHead':head,'independentSchedules':b.SCHEDULES,'runs':summaries}
(out/'fresh-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','runs':[{k:x[k] for k in ['mode','reportSha256','counts']} for x in summaries]},indent=2))
