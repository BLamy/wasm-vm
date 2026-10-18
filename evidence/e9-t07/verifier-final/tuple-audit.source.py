from pathlib import Path
import gzip,hashlib,json,struct,subprocess,sys
root=Path.cwd();source=Path(sys.argv[1]).resolve()if len(sys.argv)>1 else root/'target/evidence/e9-t07-worker-final/browser';out=root/'target/e9-t07-verifier';report_path=Path(sys.argv[2]).resolve()if len(sys.argv)>2 else source/'report.json';result_path=Path(sys.argv[3]).resolve()if len(sys.argv)>3 else out/'raw-tuples.json'
r=json.loads(report_path.read_text());checks=r['checks'];base=json.loads((source/'base.json').read_text());oracle=json.loads((source/'retention-oracle.json').read_text())
digest=lambda x:hashlib.sha256(x).hexdigest()
report={'status':'running','source_report_sha256':digest(report_path.read_bytes()),'frames':{},'witnesses':{},'shared':{}}
for row in checks['rawTuples']:
 data=gzip.decompress((source/row['name']).read_bytes());assert digest(data)==row['sha256']and len(data)==row['bytes']
 assert data[:8]==b'WVSOFT01'and struct.unpack_from('<I',data,8)[0]==1
 sizes=[struct.unpack_from('<Q',data,12+40*i)[0]for i in range(5)];assert sum(sizes)+212==len(data)
 parts={};start=212
 for i,(label,size)in enumerate(zip(['context','native','disk','input','output'],sizes)):
  value=data[start:start+size];start+=size;assert bytes.fromhex(digest(value))==data[20+40*i:52+40*i];parts[label]=value
 context=json.loads(parts['context']);native=parts['native'];assert native[:12]==b'WVMRESU1'+struct.pack('<I',1)
 pos=84;sections={}
 while pos<len(native):
  tag,size=struct.unpack_from('<II',native,pos);pos+=8;assert tag not in sections and pos+size<=len(native);sections[tag]=native[pos:pos+size];pos+=size
 assert pos==len(native)and set(sections)==set(range(1,17))
 ram=sections[2];pos=0;ram_bytes=0;ram_hash=hashlib.sha256();zero=bytes(1<<20)
 while pos<len(ram):
  kind,size=struct.unpack_from('<BI',ram,pos);pos+=5;assert size>0 and kind in (0,1)
  if kind:
   assert pos+size<=len(ram);ram_hash.update(ram[pos:pos+size]);pos+=size
  else:
   remaining=size
   while remaining:
    take=min(remaining,len(zero));ram_hash.update(zero[:take]);remaining-=take
  ram_bytes+=size
 assert ram_bytes==int(context['ram_bytes'])
 delta=parts['disk'];assert delta[:5]==b'WVOD1';block,image_len=struct.unpack_from('<IQ',delta,5);generation,count=struct.unpack_from('<QI',delta,49)
 assert block==4096 and image_len==base['bytes']and delta[17:49].hex()==base['manifest_sha256']
 assert native[44:76]==delta[17:49]and struct.unpack_from('<Q',native,76)[0]==generation
 assert len(delta)==61+4104*count
 leaves=[]
 for i in range(count):
  off=61+4104*i;index=struct.unpack_from('<Q',delta,off)[0];assert index<(image_len+4095)//4096 and (not leaves or index>int(leaves[-1]['index']));leaves.append({'index':str(index),'sha256':digest(delta[off+8:off+4104])})
 disk_root={'version':{'major':1,'minor':0},'base':delta[17:49].hex(),'image_len':str(image_len),'generation':str(generation),'blocks':leaves}
 info={'sha256':digest(data),'bytes':len(data),'ram_bytes':ram_bytes,'ram_sha256':ram_hash.hexdigest(),'disk_root':digest(json.dumps(disk_root,separators=(',',':')).encode()),'generation':str(generation),'position':context['position'],'component_sha256':{k:digest(v)for k,v in parts.items()},'native_section_sha256':{str(k):digest(v)for k,v in sections.items()}}
 assert info['ram_sha256']==oracle['frames'][row['name']]['ram']['sha256']and info['disk_root']==oracle['frames'][row['name']]['disk_root_sha256']
 report['frames'][row['name']]=info
for label in ['prefix','prefixAfterQuota','retried','parentFinal','siblingOriginal','siblingAfterDelete']:
 witness=checks[label];actual=report['frames'][witness['evidence']];point=next(x for x in witness['manifest']['checkpoints']if x['id']==witness['point'])
 assert actual['sha256']==witness['frameHash']==point['machine']['sha256']and str(actual['bytes'])==point['machine']['length']and actual['disk_root']==point['disk_root']and actual['position']==point['position']
 report['witnesses'][label]={'id':witness['id'],'revision':witness['revision'],'point':witness['point'],'frame':actual['sha256'],'root':actual['disk_root']}
a=report['frames'][checks['siblingOriginal']['evidence']]
assert report['frames']['sibling-restored.checkpoint.gz']==a==report['frames']['sibling-reopened.checkpoint.gz']
assert checks['prefix']['manifest']==checks['prefixAfterQuota']['manifest']and checks['prefix']['revision']==checks['prefixAfterQuota']['revision']=='1'
assert checks['retried']['revision']=='2'and checks['retried']['manifest']['checkpoints'][0]==checks['prefix']['manifest']['checkpoints'][0]
assert report['frames'][checks['retried']['evidence']]['ram_sha256']!=report['frames'][checks['prefix']['evidence']]['ram_sha256']
label_point=checks['committedLabelQuota']['manifest']['checkpoints'][0]
assert label_point['machine']['sha256']==a['sha256']and label_point['disk_root']==a['disk_root']
report['survivingLabelQuota']={'frame':label_point['machine']['sha256'],'root':label_point['disk_root'],'matches_original_sibling':True}
storage=checks['storage']
for retained in storage['kept']:
 assert digest(bytes(retained['bytes']))==retained['sha256']==retained['actual'];report['shared'][retained['sha256']]=len(retained['bytes'])
assert storage['payloadStillThere']['sha256']in report['shared']
for crash in checks['crashes']:
 assert all(x['actual']==x['expected']for x in crash['hashes']);assert digest(bytes(crash['manifest']))==storage['siblingOriginal']['hash'];assert crash['cleanup']['collected']
for state in [storage['siblingAfter'],storage['finalSibling'],storage['reopened']]:assert state==storage['siblingOriginal']
report['shared_payload']=storage['payloadStillThere'];report['crash_cuts']=[x['cut']for x in checks['crashes']]
report['guest_files']={}
image=oracle['docker_image'];assert image.startswith('sha256:')
for name,expected in [('shared',b'shared-prefix\n'),('private',b'private-later\n'),('reopened',b'shared-prefix\n')]:
 actual=subprocess.run(['docker','run','--rm','--network','none','-v',str(source)+':/evidence:ro','--entrypoint','/usr/sbin/debugfs',image,'-R','cat /root/e9-retention/state','/evidence/'+name+'.ext4'],capture_output=True,check=True)
 assert actual.stdout==expected==(source/(name+'.file')).read_bytes();report['guest_files'][name]={'hex':actual.stdout.hex(),'sha256':digest(actual.stdout)}
report['status']='passed';result_path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'frames':len(report['frames']),'witnesses':report['witnesses'],'guest_files':report['guest_files'],'shared_refs':len(report['shared']),'survivingLabelQuota':report['survivingLabelQuota']},indent=2))
