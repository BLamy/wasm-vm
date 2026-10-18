import hashlib,json,struct,zipfile
from pathlib import Path
root=Path.cwd(); output=root/'target/evidence/e9-t05-final-review'; evidence=root/'target/evidence/e9-t05-public-final'
sha=lambda x:hashlib.sha256(x).hexdigest()
b=json.loads((evidence/'report.json').read_text());c=b['checks'];oracle=json.loads((evidence/'tuple-oracle.json').read_text());result={'scope':'Recorded bytes/results only; no program test execution','browser_report_sha256':sha((evidence/'report.json').read_bytes()),'oracle_sha256':sha((evidence/'tuple-oracle.json').read_bytes()),'tuples':{}}
assert b['head']=='3508ad16ca0de135f06e6f7cc8d2fb4b3a879332' and b['url']=='https://wasm-vm.pages.dev/app.html?noAutoBoot&testHooks=1'
assert sha((evidence/'report.json').read_bytes())=='6b31a2af91a67ab9f6eac8bec336bc96d9e543fb18ffbddbb18b2be83cf03217'
assert b['status']==oracle['status']=='passed' and not b['development'] and b['errors']==[]
assert c['suite']=={'passed':127,'failed':0} and c['roadmap']=='cap-pip verified'
for name in ['before','after','restored']:
 frame=(evidence/(name+'.checkpoint')).read_bytes();o=oracle['checkpoints'][name]
 assert frame[:12]==b'WVSOFT01'+struct.pack('<I',1);at=212;parts={}
 for n,label in enumerate(['context','native','disk','input','output']):
  length=struct.unpack_from('<Q',frame,12+n*40)[0];part=frame[at:at+length];expected={'offset':at,'bytes':length,'sha256':sha(part)}
  assert len(part)==length and sha(part)==frame[20+n*40:52+n*40].hex() and expected==o[label],(name,label)
  suffix={'context':'context.json','disk':'disk.wvod'}.get(label,label);assert part==(evidence/(name+'.'+suffix)).read_bytes()
  parts[label]=part;at+=length
 assert at==len(frame) and sha(frame)==o['frame_sha256']
 context=json.loads(parts['context']);assert context['held']['keyboard']==[30] and context['runtime']=='c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc'
 native=parts['native'];assert native[:12]==b'WVMRESU1'+struct.pack('<I',1);at=84;sections={}
 while at<len(native):
  tag,length=struct.unpack_from('<II',native,at);at+=8;part=native[at:at+length];at+=length
  assert tag not in sections and len(part)==length;sections[tag]=part
 assert at==len(native) and set(sections)==set(range(1,17))
 assert {str(tag):{'bytes':len(part),'sha256':sha(part)} for tag,part in sections.items()}==o['sections']
 ram=sections[2];at=0;ram_bytes=0;h=hashlib.sha256()
 while at<len(ram):
  kind=ram[at];length=struct.unpack_from('<I',ram,at+1)[0];at+=5;assert kind in [0,1] and length>0
  if kind==0:
   remaining=length
   while remaining:count=min(remaining,1<<20);h.update(bytes(count));remaining-=count
  else:
   part=ram[at:at+length];assert len(part)==length;h.update(part);at+=length
  ram_bytes+=length
 assert at==len(ram) and ram_bytes==int(context['ram_bytes']);assert {'bytes':ram_bytes,'sha256':h.hexdigest()}==o['ram']
 expected=b'e9:after\n' if name=='after' else b'e9:before\n';file=(evidence/(name+'.file')).read_bytes();assert file==expected and file.hex()==o['file']['hex'] and sha(file)==o['file']['sha256']
 assert o['file']['read_command'][-2]=='cat /root/e9-session/state' and any(x.endswith(':/evidence:ro') for x in o['file']['read_command'])
 result['tuples'][name]={'bytes':len(frame),'sha256':sha(frame),'components':5,'native_sections':len(sections),'ram_sha256':h.hexdigest(),'file_hex':file.hex(),'file_sha256':sha(file)}
assert (evidence/'before.checkpoint').read_bytes()==(evidence/'restored.checkpoint').read_bytes()
assert (evidence/'before.checkpoint').read_bytes()!=(evidence/'after.checkpoint').read_bytes()
assert (evidence/'before.input').read_bytes()==(evidence/'restored.input').read_bytes()==b'e9_queue=queued-before\n'
assert c['before']['frameHash']==c['restored']['hash']==result['tuples']['before']['sha256']
assert c['before']['before']['clock']==c['before']['after']['clock']==c['restored']['clock']
assert c['before']['before']['ram']==c['before']['after']['ram']==c['restored']['ram']==result['tuples']['before']['ram_sha256']
assert c['before']['before']['scheduler']['retiredInstructions']==c['before']['after']['scheduler']['retiredInstructions']
assert c['restored']['paused'] and c['restored']['scheduler']['retiredInstructions']==0 and 'restored' in c['restored']['events']
assert c['restored']['held']==c['before']['held'] and c['restored']['input']==c['before']['input']
assert c['queuedLive']==c['restoredMemory']=={'stdout':'memory-before/queued-before\n','exit':0};assert c['liveSurvives']=={'stdout':'memory-after/queue-after\n','exit':0}
for name,label in [('beforeFile','before'),('afterFile','after'),('restoredFile','restored')]:assert c[name]['sha256']==result['tuples'][label]['file_sha256']
f=c['failures'];assert 'pause the software guest' in f['running'] and 'digest' in f['corruptCapture'] and f['publication']=='injected-before-commit' and f['committedSame'] and f['revision']=='1' and 'Corrupt' in c['rejectedRestore']
io=c['io'];rd=io['read'];wr=io['write'];bd=io['bounded'];assert rd['pending'] and rd['remaining']==[] and rd['exactRestored'] and rd['beforeClock']==rd['afterClock'] and rd['afterFetch']['fetches']>rd['beforeFetch']['fetches']
assert all(x['unchanged'] and x['error']!='accepted' for x in rd['corruption']) and len(rd['corruption'])==5 and rd['sibling']=='session_checkpoint_disk_mismatch'
assert wr['pressure']['pendingBytes']==4096 and wr['pressure']['writeWaiting'] and wr['after']['pendingBytes']==0 and not wr['after']['writeWaiting'] and not wr['after']['flushWaiting'] and wr['beforeClock']==wr['afterClock']
assert bd['error']=='session_checkpoint_busy_or_budget' and bd['beforeClock']==bd['afterClock']==bd['recovered']['clock'] and bd['recovered']['remaining']==[] and bd['recovered']['run']['retired']==49997
assert len(io['expectedConsoleErrors'])==16 and io['pageErrors']==[]
cr=c['critic'];assert len(cr['native'])==16 and all(x['unchanged'] and x['error']!='accepted' for x in cr['native'])
assert all(x['coherent'] or x['unchanged'] for x in cr['publication']);assert cr['configurationPinned'] and cr['sourceUnchanged'] and cr['sourceRetired']==0 and cr['originalStillAdmitted']
assert cr['directLoaderRestore']=={'paused':True,'restored':True,'retired':0,'exact':True}
assert cr['loaderTopology']=='session checkpoint device topology differs from the actual machine'
assert cr['profile']=={'wall':'session_checkpoint_profile','restoreDescriptor':'invalid software session restore profile','loaderWall':'software session checkpoints require the isolated ICount software profile','microphone':'session_checkpoint_profile'}
assert sorted(cr['race']['results'])==['WriterBusy','committed'] and len(cr['race']['ids'])==len(cr['expectedAppend'])+1
assert len(c['aba'])==2
for n,x in enumerate(c['aba']):
 assert x['schedule']==n and x['changed'] and x['restored'] and x['frameHash']==x['finalFrameHash'] and x['publication']['accepted'] and x['admission']=='accepted'
 assert x['previousRevision']=='1' and x['newRevision']=='2' and x['previousRoot']==x['publishedRoot'] and x['frameDiskHash']==x['rootDiskHash'] and x['frameLeafByte']==x['rootLeafByte']==67+n
assert c['gpuBoot']['ok'];g=c['gpu']['gpu'];assert g['qualified'] and not g['lost'] and not g['poisoned'] and g['epoch']=='0000000000000004'
draws=[x for x in g['scanout']['retirements'] if x['epoch']==g['epoch'] and x['status']=='drawn'];assert draws and c['gpu']['scheduler']['retiredInstructions']==2499808
with zipfile.ZipFile(evidence/'browser-trace.zip') as z:
 names=z.namelist();assert any(x.endswith('.trace') for x in names);trace={'sha256':sha((evidence/'browser-trace.zip').read_bytes()),'entries':len(names),'trace_files':[x for x in names if x.endswith('.trace')]}
result.update({'status':'passed','suite':c['suite'],'errors':b['errors'],'roadmap':c['roadmap'],'exact_restore':{'paused':True,'retired':0,'pending_uart':c['restored']['input'],'held':c['restored']['held'],'ram_uart_witness':c['restoredMemory'],'live_after_rejected_restore':c['liveSurvives']},'io':{'original_read_drained':True,'original_write_bytes':4096,'bounded_error_count':16,'recovered_retired':49997},'critics':{'native_component_refusals':16,'producer_buffers':cr['publication'],'direct_loader':cr['directLoaderRestore'],'original_source_unchanged':True,'race':cr['race']['results'],'aba_leaf_pairs':[[x['frameLeafByte'],x['rootLeafByte']] for x in c['aba']]},'gpu':{'qualified':True,'epoch':g['epoch'],'retired':c['gpu']['scheduler']['retiredInstructions'],'draws':draws},'trace':trace,'screenshots':{name:sha((evidence/name).read_bytes()) for name in ['browser.png','restored.png','gpu-factory-ready.png']}})
lines=(evidence/'report.json').read_text().splitlines();result['citations']={key:next(i for i,line in enumerate(lines,1) if line.startswith('    "'+key+'":')) for key in ['suite','before','failures','rejectedRestore','restored','restoredMemory','restoredFile','io','critic','aba','gpu']}
(output/'public-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['critics','gpu','citations']},indent=2));print('GPU',g['epoch'],c['gpu']['scheduler']['retiredInstructions'],'retired,',len(draws),'fresh-epoch drawn receipts; both ABA leaf pairs agree.')
