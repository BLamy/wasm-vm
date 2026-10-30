#!/usr/bin/env python3
"""Decode retained guest tuples independently and inspect their reconstructed ext4 files."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
out=p.parse_args().output.resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1<<20),b''):h.update(b)
    return h.hexdigest()
base=json.loads((out/'base.json').read_text());source=Path(base['source'])
assert source.stat().st_size==base['bytes'] and file_sha(source)==base['sha256']
witnesses=json.loads((out/'milestone-witnesses.json').read_text())
report={'status':'running','base':base,'frames':{},'files':{}}
frames={}
for path in sorted(out.glob('*.checkpoint.gz')):
    frame=gzip.decompress(path.read_bytes());assert frame[:12]==b'WVSOFT01'+struct.pack('<I',1)
    at=212;parts={};record={'frame_sha256':sha(frame),'frame_bytes':len(frame),'components':{}}
    for i,label in enumerate(['context','native','disk','input','output']):
        h=12+i*40;length=struct.unpack_from('<Q',frame,h)[0];part=frame[at:at+length]
        assert len(part)==length and sha(part)==frame[h+8:h+40].hex();parts[label]=part
        record['components'][label]={'bytes':len(part),'sha256':sha(part)};at+=length
    assert at==len(frame)
    context=json.loads(parts['context']);native=parts['native'];assert native[:12]==b'WVMRESU1'+struct.pack('<I',1)
    sections={};at=84
    while at<len(native):
        tag,length=struct.unpack_from('<II',native,at);at+=8;assert tag not in sections
        part=native[at:at+length];assert len(part)==length;sections[tag]=part;at+=length
    assert at==len(native) and set(sections)==set(range(1,17))
    record['native_sections']={str(tag):{'bytes':len(part),'sha256':sha(part)} for tag,part in sections.items()}
    ram=sections[2];at=0;count=0;digest=hashlib.sha256()
    while at<len(ram):
        kind=ram[at];length=struct.unpack_from('<I',ram,at+1)[0];at+=5
        assert kind in (0,1) and length>0 and count+length<=int(context['ram_bytes'])
        if kind==1:
            part=ram[at:at+length];assert len(part)==length;digest.update(part);at+=length
        else:
            remaining=length
            while remaining:n=min(remaining,1<<20);digest.update(bytes(n));remaining-=n
        count+=length
    assert count==int(context['ram_bytes']) and at==len(ram)
    record['ram']={'bytes':count,'sha256':digest.hexdigest()}
    delta=parts['disk'];assert delta[:5]==b'WVOD1'
    block_size,image_len=struct.unpack_from('<IQ',delta,5);generation,blocks=struct.unpack_from('<QI',delta,49)
    assert block_size==4096 and image_len==base['bytes'] and delta[17:49].hex()==base['manifest_sha256']
    assert native[44:76]==delta[17:49] and struct.unpack_from('<Q',native,76)[0]==generation
    assert len(delta)==61+blocks*4104
    entries=[]
    for i in range(blocks):
        at=61+i*4104;index=struct.unpack_from('<Q',delta,at)[0]
        assert index<(image_len+4095)//4096 and (not entries or index>int(entries[-1]['index']))
        entries.append({'index':str(index),'sha256':sha(delta[at+8:at+4104])})
    root={'version':{'major':1,'minor':0},'base':base['manifest_sha256'],'image_len':str(image_len),'generation':str(generation),'blocks':entries}
    record['disk_root_sha256']=sha(json.dumps(root,separators=(',',':')).encode());record['disk_generation']=str(generation)
    record['position']=context['position'];record['held']=context['held'];record['input_hex']=parts['input'].hex()
    report['frames'][path.name]=record;frames[path.name]=parts
for name in ['alpha','beta','betaPrefix','betaAfterDelete']:
    details=witnesses[name];record=report['frames'][details['evidence']]
    point=next(point for point in details['manifest']['checkpoints'] if point['id']==details['point'])
    assert record['frame_sha256']==point['machine']['sha256']==details['frameHash']
    assert record['disk_root_sha256']==point['disk_root'] and record['position']==point['position']
    assert record['held']==details['held'] and record['input_hex']==details['input'].encode().hex()
for label,original in [('alpha-restored','alpha'),('beta-restored','beta'),('beta-reopened','beta')]:
    assert report['frames'][label+'.checkpoint.gz']==report['frames'][witnesses[original]['evidence']]
assert report['frames'][witnesses['alpha']['evidence']]['ram']!=report['frames'][witnesses['beta']['evidence']]['ram']
assert report['frames'][witnesses['beta']['evidence']]['ram']!=report['frames']['beta-unsaved.checkpoint.gz']['ram']
assert report['frames'][witnesses['alpha']['evidence']]['held']['keyboard']==[30]
assert report['frames'][witnesses['beta']['evidence']]['held']['keyboard']==[48]
assert report['frames'][witnesses['alpha']['evidence']]['input_hex']==b'e9_queue=queued-alpha\n'.hex()
assert report['frames'][witnesses['beta']['evidence']]['input_hex']==b'e9_queue=queued-beta\n'.hex()
image_id=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}','wasm-vm-rootfs-build:local'],text=True).strip();report['docker_image']=image_id
# Reconstruct each distinct filesystem, then inspect through a read-only mount.
# Any journal recovery affects only this disposable derived image, never the base or raw frame.
for label,filename,expected in [('alpha',witnesses['alpha']['evidence'],b'alpha-file\n'),('beta',witnesses['beta']['evidence'],b'beta-file\n'),('unsaved','beta-unsaved.checkpoint.gz',b'beta-unsaved\n'),('reopened','beta-reopened.checkpoint.gz',b'beta-file\n')]:
    delta=frames[filename]['disk'];blocks=struct.unpack_from('<I',delta,57)[0];target=out/(label+'.ext4')
    clone=subprocess.run(['cp','-c',str(source),str(target)],capture_output=True)
    if clone.returncode:shutil.copyfile(source,target)
    with target.open('r+b') as disk:
        for i in range(blocks):
            at=61+i*4104;index=struct.unpack_from('<Q',delta,at)[0];disk.seek(index*4096);disk.write(delta[at+8:at+4104])
    before=file_sha(target)
    recovery=['docker','run','--rm','--network','none','-v',str(out)+':/evidence:rw','--entrypoint','/sbin/e2fsck',image_id,'-fy','/evidence/'+target.name]
    with (out/(label+'.fsck.log')).open('wb') as log:result=subprocess.run(recovery,stdout=log,stderr=subprocess.STDOUT)
    assert result.returncode in (0,1)
    read_command=['docker','run','--rm','--network','none','-v',str(out)+':/evidence:ro','--entrypoint','/usr/sbin/debugfs',image_id,'-R','cat /root/e9-milestone/state','/evidence/'+target.name]
    read=subprocess.run(read_command,capture_output=True);(out/(label+'.file')).write_bytes(read.stdout);(out/(label+'.debugfs.log')).write_bytes(read.stderr)
    assert read.returncode==0 and read.stdout==expected,(label,read.stdout,read.stderr)
    report['files'][label]={'frame':filename,'hex':read.stdout.hex(),'sha256':sha(read.stdout),'image_before_recovery':before,'image_after_recovery':file_sha(target),'recover':recovery,'read':read_command}
assert file_sha(source)==base['sha256'];report['status']='passed'
(out/'milestone-oracle.json').write_text(json.dumps(report,indent=2)+'\n')
print('Independent two-guest native16/RAM/input/disk-root and actual ext4 witnesses passed.')
