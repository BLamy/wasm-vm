#!/usr/bin/env python3
"""Independent frame/CPU/device/RAM, input and native ext4 witnesses for E9-T05."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
out=parser.parse_args().output.resolve()
sha=lambda data:hashlib.sha256(data).hexdigest()
def file_sha(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1<<20),b''):value.update(chunk)
    return value.hexdigest()
base=json.loads((out/'base.json').read_text());source=Path(base['source'])
assert file_sha(source)==base['sha256']
image_id=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}','wasm-vm-rootfs-build:local'],text=True).strip()
report={'status':'running','base':base,'docker_image':image_id,'checkpoints':{}}
all_sections={}
for name in ['before','after','restored']:
    frame=(out/(name+'.checkpoint')).read_bytes();assert frame[:8]==b'WVSOFT01' and frame[8:12]==struct.pack('<I',1)
    offset=212;parts={};witness={}
    for index,label in enumerate(['context','native','disk','input','output']):
        at=12+index*40;length=struct.unpack_from('<Q',frame,at)[0];part=frame[offset:offset+length]
        assert len(part)==length and sha(part)==frame[at+8:at+40].hex();parts[label]=part
        witness[label]={'offset':offset,'bytes':length,'sha256':sha(part)};offset+=length
        suffix={'context':'context.json','disk':'disk.wvod'}.get(label,label)
        assert part==(out/(name+'.'+suffix)).read_bytes()
    assert offset==len(frame)
    context=json.loads(parts['context']);assert context['held']['keyboard']==[30]
    native=parts['native'];assert native[:8]==b'WVMRESU1' and native[8:12]==struct.pack('<I',1)
    sections={};at=84
    while at<len(native):
        tag,length=struct.unpack_from('<II',native,at);at+=8;assert tag not in sections
        payload=native[at:at+length];assert len(payload)==length;sections[tag]=payload;at+=length
    assert at==len(native) and set(sections)==set(range(1,17))
    # Decode sparse RAM independently, streaming zero runs into the SHA oracle.
    ram=sections[2];at=0;ram_bytes=0;digest=hashlib.sha256()
    while at<len(ram):
        kind=ram[at];length=struct.unpack_from('<I',ram,at+1)[0];at+=5
        assert kind in (0,1) and length>0 and ram_bytes+length<=int(context['ram_bytes'])
        if kind==0:
            remaining=length
            while remaining:count=min(remaining,1<<20);digest.update(bytes(count));remaining-=count
        else:
            part=ram[at:at+length];assert len(part)==length;digest.update(part);at+=length
        ram_bytes+=length
    assert at==len(ram) and ram_bytes==int(context['ram_bytes'])
    witness['ram']={'bytes':ram_bytes,'sha256':digest.hexdigest()}
    witness['sections']={str(tag):{'bytes':len(payload),'sha256':sha(payload)} for tag,payload in sections.items()}
    all_sections[name]=sections
    delta=parts['disk'];assert delta[:5]==b'WVOD1'
    block,image_len=struct.unpack_from('<IQ',delta,5);generation,count=struct.unpack_from('<QI',delta,49)
    assert block==4096 and image_len==base['bytes'] and delta[17:49].hex()==base['manifest_sha256']
    assert native[44:76]==delta[17:49] and struct.unpack_from('<Q',native,76)[0]==generation
    assert len(delta)==61+count*4104
    target=out/(name+'.ext4');result=subprocess.run(['cp','-c',str(source),str(target)],capture_output=True)
    if result.returncode:shutil.copyfile(source,target)
    previous=-1
    with target.open('r+b') as disk:
        for index in range(count):
            at=61+index*4104;block_index=struct.unpack_from('<Q',delta,at)[0]
            assert previous<block_index<(image_len+4095)//4096;previous=block_index
            disk.seek(block_index*4096);disk.write(delta[at+8:at+4104])
    recover=['docker','run','--rm','--network','none','-v',str(out)+':/evidence:rw','--entrypoint','/sbin/e2fsck',image_id,'-fy','/evidence/'+target.name]
    with (out/(name+'.fsck.log')).open('wb') as log:result=subprocess.run(recover,stdout=log,stderr=subprocess.STDOUT)
    assert result.returncode in (0,1)
    command=['docker','run','--rm','--network','none','-v',str(out)+':/evidence:ro','--entrypoint','/usr/sbin/debugfs',image_id,'-R','cat /root/e9-session/state','/evidence/'+target.name]
    result=subprocess.run(command,capture_output=True);(out/(name+'.debugfs.log')).write_bytes(result.stderr)
    (out/(name+'.file')).write_bytes(result.stdout)
    expected=b'e9:after\n' if name=='after' else b'e9:before\n'
    assert result.returncode==0 and result.stdout==expected,(name,result.stdout,result.stderr)
    witness['file']={'hex':result.stdout.hex(),'sha256':sha(result.stdout),'recovery_command':recover,'read_command':command}
    witness['frame_sha256']=sha(frame);witness['generation']=str(generation);report['checkpoints'][name]=witness
assert (out/'before.checkpoint').read_bytes()==(out/'restored.checkpoint').read_bytes()
assert all_sections['before']==all_sections['restored'] and all_sections['before'][2]!=all_sections['after'][2]
assert (out/'before.input').read_bytes()==b'e9_queue=queued-before\n'
assert file_sha(source)==base['sha256']
report['status']='passed';(out/'tuple-oracle.json').write_text(json.dumps(report,indent=2)+'\n')
print('All 16 CPU/RAM/device sections and queued input match exactly after reload; native ext4 file witnesses match.')
