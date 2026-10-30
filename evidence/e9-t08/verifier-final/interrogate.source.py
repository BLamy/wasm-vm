#!/usr/bin/env python3
"""Fresh E9-T08 verifier: authenticate retained artifacts and independently parse raw state."""
import gzip, hashlib, json, struct, subprocess, sys
from pathlib import Path
root=Path.cwd();wrapper=Path(sys.argv[1]).resolve();out=root/'target/e9-t08-verifier';browser=wrapper/'browser'
expected_head='1b3c68c0def3fb98c8803ed6f95089f90ed7dfe7'
sha=lambda data:hashlib.sha256(data).hexdigest()
def file_sha(filename):
    h=hashlib.sha256()
    with filename.open('rb') as stream:
        for part in iter(lambda:stream.read(4<<20),b''):h.update(part)
    return h.hexdigest()
def load(filename):return json.loads(filename.read_text())
checks=[]
def held(name,**details):checks.append(dict(prediction=name,result='HELD',**details))
submission=load(wrapper/'report.json');record=load(browser/'report.json');witness=load(browser/'milestone-witnesses.json')
assert submission['head']==record['head']==expected_head
assert submission['status']==record['status']=='passed' and record['development'] is False and record['errors']==[]
assert all(command['exit_code']==0 for command in submission['commands'])
assert record['checks']['suite']=={'passed':127,'failed':0}
for source,digest in submission['source_sha256'].items():
    frozen=subprocess.check_output(['git','show',expected_head+':'+source],cwd=root)
    assert sha(frozen)==digest,source
for directory,report in [(wrapper,submission),(browser,record)]:
    for entry in report['files']:
        filename=(directory/entry['path']).resolve();assert filename.is_relative_to(directory)
        assert filename.stat().st_size==entry['bytes'] and file_sha(filename)==entry['sha256'],str(filename)
held('P0',head=expected_head,submission_sha256=file_sha(wrapper/'report.json'),browser_report_sha256=file_sha(browser/'report.json'),commands=len(submission['commands']),artifacts=len(submission['files']))
frames={};parts_by_name={}
for filename in sorted(browser.glob('*.checkpoint.gz')):
    data=gzip.decompress(filename.read_bytes());assert data[:8]==b'WVSOFT01' and struct.unpack_from('<I',data,8)[0]==1
    parts={};cursor=212;components={}
    for i,name in enumerate(('context','native','disk','input','output')):
        header=12+40*i;length=int.from_bytes(data[header:header+8],'little');end=cursor+length
        assert end<=len(data);part=data[cursor:end];expected=data[header+8:header+40].hex();assert sha(part)==expected
        parts[name]=part;components[name]={'offset':cursor,'length':length,'sha256':expected};cursor=end
    assert cursor==len(data)
    context=load_context=json.loads(parts['context']);native=parts['native'];delta=parts['disk']
    assert native[:12]==b'WVMRESU1'+(1).to_bytes(4,'little') and delta[:5]==b'WVOD1'
    assert native[44:76]==delta[17:49] and native[76:84]==delta[49:57]
    tags={};at=84
    while at<len(native):
        tag,length=struct.unpack_from('<II',native,at);at+=8;assert tag not in tags and at+length<=len(native)
        tags[tag]=native[at:at+length];at+=length
    assert at==len(native) and set(tags)==set(range(1,17))
    ram=tags[2];ram_digest=hashlib.sha256();at=0;decoded=0
    while at<len(ram):
        kind=ram[at];length=int.from_bytes(ram[at+1:at+5],'little');at+=5;assert kind in (0,1) and length>0
        if kind:assert at+length<=len(ram);ram_digest.update(ram[at:at+length]);at+=length
        else:
            left=length
            while left:amount=min(left,1<<20);ram_digest.update(bytes(amount));left-=amount
        decoded+=length;assert decoded<=int(context['ram_bytes'])
    assert decoded==int(context['ram_bytes'])==256*1024*1024 and at==len(ram)
    block_size,image_size=struct.unpack_from('<IQ',delta,5);generation,count=struct.unpack_from('<QI',delta,49)
    assert block_size==4096 and len(delta)==61+count*4104
    leaves=[]
    for i in range(count):
        at=61+i*4104;block=int.from_bytes(delta[at:at+8],'little');assert block<(image_size+4095)//4096
        assert not leaves or int(leaves[-1]['index'])<block
        leaves.append({'index':str(block),'sha256':sha(delta[at+8:at+4104])})
    disk_root={'version':{'major':1,'minor':0},'base':delta[17:49].hex(),'image_len':str(image_size),'generation':str(generation),'blocks':leaves}
    frames[filename.name]={'raw_sha256':sha(data),'raw_bytes':len(data),'components':components,'native_sections':{str(tag):sha(payload) for tag,payload in tags.items()},'ram_sha256':ram_digest.hexdigest(),'ram_bytes':decoded,'context':context,'input_hex':parts['input'].hex(),'disk_root_sha256':sha(json.dumps(disk_root,separators=(',',':')).encode()),'disk_blocks':count,'image_size':image_size,'generation':generation}
    parts_by_name[filename.name]=parts
for name in ('alpha','beta','betaPrefix','betaAfterDelete'):
    w=witness[name];f=frames[w['evidence']];point=next(p for p in w['manifest']['checkpoints'] if p['id']==w['point'])
    assert f['raw_sha256']==w['frameHash']==point['machine']['sha256'];assert f['disk_root_sha256']==point['disk_root']
    assert f['context']['position']==point['position'];assert f['context']['held']==w['held'];assert f['input_hex']==w['input'].encode().hex()
for label,key in [('alpha',30),('beta',48)]:
    w=witness[label];f=frames[w['evidence']]
    assert f['context']['held']['keyboard']==[key]
    assert f['input_hex']==('e9_queue=queued-'+label+'\n').encode().hex()
    assert w['manifest']['policy']['mode']=='checkpoints-only' and w['manifest']['events']==[]
assert witness['alpha']['id']!=witness['beta']['id'];assert frames[witness['alpha']['evidence']]['ram_sha256']!=frames[witness['beta']['evidence']]['ram_sha256']
assert all('fresh-'+label in witness['freshBoots'][index] for index,label in enumerate(('alpha','beta')))
held('P1',alpha=frames[witness['alpha']['evidence']],beta=frames[witness['beta']['evidence']],freshBoots=witness['freshBoots'])
for restored,original in [('beta-restored','beta'),('alpha-restored','alpha'),('beta-reopened','beta')]:
    assert frames[restored+'.checkpoint.gz']==frames[witness[original]['evidence']]
for restored,label in [('betaRestored','beta'),('alphaRestored','alpha'),('betaReopened','beta')]:
    r=witness[restored];assert r['file']==label+'-file\n' and r['memory']==label+'-memory/queued-'+label
    assert r['state']['paused'] is True and r['state']['scheduler']['slices']==0
held('P2',exact_restores=['beta-restored.checkpoint.gz','alpha-restored.checkpoint.gz'],guest_reads=[witness['betaRestored'],witness['alphaRestored']])
q=witness['quota'];assert q['state']=='storage-error' and q['paused'] is True and q['retry'] is True and 'Recording paused' in q['message']
assert witness['betaPrefix']['manifest']==witness['beta']['manifest']==witness['betaAfterDelete']['manifest']
assert frames['beta-unsaved.checkpoint.gz']['ram_sha256']!=frames[witness['beta']['evidence']]['ram_sha256']
held('P3',quota=q,prefix_hash=frames[witness['betaPrefix']['evidence']]['raw_sha256'],unsaved_hash=frames['beta-unsaved.checkpoint.gz']['raw_sha256'])
base=load(browser/'base.json');source=Path(base['source']);assert source.stat().st_size==base['bytes'] and file_sha(source)==base['sha256']
fixture=load(root/'web/session-software-fixture.json');assert base['sha256']==fixture['raw_image_sha256']
image=json.loads(subprocess.check_output(['docker','image','inspect','wasm-vm-rootfs-build:local'],text=True))[0]['Id']
disk_reads=[]
for label,frame_name,expected in [('alpha',witness['alpha']['evidence'],b'alpha-file\n'),('beta',witness['beta']['evidence'],b'beta-file\n'),('unsaved','beta-unsaved.checkpoint.gz',b'beta-unsaved\n'),('reopened','beta-reopened.checkpoint.gz',b'beta-file\n')]:
    delta=parts_by_name[frame_name]['disk'];target=out/(label+'-independent.ext4');assert not target.exists()
    subprocess.run(['cp','-c',str(source),str(target)],check=True)
    with target.open('r+b') as dest:
        for i in range(int.from_bytes(delta[57:61],'little')):
            at=61+4104*i;block=int.from_bytes(delta[at:at+8],'little');dest.seek(block*4096);dest.write(delta[at+8:at+4104])
    before=file_sha(target)
    with (out/(label+'-independent.fsck.log')).open('wb') as log:
        recover=subprocess.run(['docker','run','--rm','--network','none','-v',str(out)+':/proof:rw','--entrypoint','/sbin/e2fsck',image,'-fy','/proof/'+target.name],stdout=log,stderr=subprocess.STDOUT)
    assert recover.returncode in (0,1)
    read=subprocess.run(['docker','run','--rm','--network','none','-v',str(out)+':/proof:ro','--entrypoint','/usr/sbin/debugfs',image,'-R','cat /root/e9-milestone/state','/proof/'+target.name],capture_output=True)
    (out/(label+'-independent.file')).write_bytes(read.stdout);(out/(label+'-independent.debugfs.log')).write_bytes(read.stderr)
    assert read.returncode==0 and read.stdout==expected
    disk_reads.append({'label':label,'frame':frame_name,'expected_hex':expected.hex(),'observed_hex':read.stdout.hex(),'before_recovery':before,'after_recovery':file_sha(target),'file_sha256':sha(read.stdout)})
assert file_sha(source)==base['sha256'];held('P4',durable_beta_hash=frames['beta-reopened.checkpoint.gz']['raw_sha256'],independent_ext4_reads=disk_reads,docker_image=image)
assert witness['keyboardFocus']=='rename' and witness['mobile']['scroll']<=witness['mobile']['width']
assert witness['documentation']['checkpointOnly'] and witness['documentation']['retention']
held('P5',suite=witness['suite'],keyboardFocus=witness['keyboardFocus'],mobile=witness['mobile'],documentation=witness['documentation'],errors=record['errors'])
result={'status':'passed','submission_sha256':file_sha(wrapper/'report.json'),'browser_report_sha256':file_sha(browser/'report.json'),'checks':checks,'frames':frames}
(out/'interrogation.json').write_text(json.dumps(result,indent=2)+'\n')
(out/'interrogation-summary.jsonl').write_text('\n'.join(json.dumps(c,separators=(',',':')) for c in checks)+'\n')
print(json.dumps({'status':result['status'],'checks':len(checks),'frames':len(frames),'submission_sha256':result['submission_sha256']}))
