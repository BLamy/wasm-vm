#!/usr/bin/env python3
"""Fresh critic: authenticate durable production objects and independently model RTC guest words."""
import argparse,copy,gzip,hashlib,json,struct
from pathlib import Path
MASK=(1<<64)-1
sha=lambda b:hashlib.sha256(b).hexdigest()
u64=lambda b,i=0:struct.unpack_from('<Q',b,i)[0]
def signed(n,bits):return n-(1<<bits) if n>>(bits-1) else n

def immediate_word(kernel,retired):
    value=0
    for i in range(retired-4,retired):
        w=struct.unpack_from('<I',kernel,4*i)[0];op=w&127;rd=(w>>7)&31;rs=(w>>15)&31;f=(w>>12)&7
        assert rd==5
        if op==0x37:value=signed(w&0xfffff000,32)&MASK
        else:
            assert op==0x13 and rs==5
            if f==0:value=(value+signed(w>>20,12))&MASK
            elif f==1:value=(value<<((w>>20)&63))&MASK
            else:assert f==5;value>>=(w>>20)&63
    return value&0xffffffff

def model(kernel,rows,uart):
    assert len(uart)==113
    words=struct.unpack('<'+'I'*(len(kernel)//4),kernel)
    status_index=[i for i,w in enumerate(words)if w==0x01816283]
    assert len(status_index)==1
    status_index=status_index[0]
    offset=0;alarm=None;armed=False;observations=[];reads=[];status=None
    counts={k:0 for k in range(1,6)}
    for row in rows:
        if row['channel']!=17:continue
        k=int(row['outcome'][1]);ret=int(row['retired']);raw=bytes(row['bytes']);assert k in counts
        assert row['phase']=='observe' and row['outcome'][0]=='0' and row['outcome'][2:] == ['8','0'] and len(raw)==8
        if ret>status_index and status is None:status=int(armed)
        host=u64(raw);now=(host+offset)&MASK;word=words[ret]
        if k==1:
            assert word==0x00016283
            reads.append(now)
        elif k in (2,3):
            off=0 if k==2 else 4
            assert word&127==0x23 and ((word>>15)&31)==2 and ((word>>20)&31)==5 and ((word>>12)&7)==2
            assert ((word>>25)<<5 | (word>>7)&31)==off
            v=immediate_word(kernel,ret)
            offset=(((now&0xffffffff00000000)|v) if k==2 else ((now&0xffffffff)|(v<<32)))-host
            offset&=MASK
        elif k==4:
            assert ((word>>25)<<5 | (word>>7)&31)==8 and word&127==0x23
            assert len(reads)==1
            alarm=(reads[0]+100000000)&MASK;armed=now<alarm
        else:
            assert armed and alarm is not None
            if now>=alarm:armed=False
        counts[k]+=1
        observations.append({'sequence':row['sequence'],'transition':row['transition'],'retired':row['retired'],'kind':k,'host_ns':str(host),'guest_ns':str(now)})
    if status is None:status=int(armed)
    actual=[u64(uart,i)for i in [0,56,8,16]]
    assert len(reads)==4 and reads==actual,('RTC output',reads,actual)
    assert u64(uart,48)==status,('alarm status',u64(uart,48),status,status_index)
    assert counts[1]==4 and counts[2]==counts[3]==counts[4]==1 and counts[5]>0
    rng=[bytes(r['bytes'])for r in rows if r['channel']==18]
    assert rng==[uart[64:80],uart[80:113]]
    return {'counts':counts,'rtc_words':[str(v)for v in reads],'alarm_status':status,'alarm_status_instruction':status_index,'samples':observations}

def check(root,label,sabotage):
    folder=root/label;prefix=json.loads((folder/'prefix.json').read_text());manifest=json.loads((folder/'manifest.json').read_text());assert manifest==prefix['manifest']
    objects={}
    for ref in prefix['files']:
        raw=gzip.decompress((folder/(ref['sha256']+'.gz')).read_bytes());assert sha(raw)==ref['sha256'] and len(raw)==int(ref['length']);objects[ref['sha256']]=raw
    rows=[]
    for chunk in manifest['events']:
        for e in json.loads(objects[chunk['content']['sha256']]):
            intent=json.loads(bytes(e['intent']));payload=e['payload'];raw=bytes(payload['bytes'])if payload['storage']=='inline'else objects[payload['content']['sha256']]
            rows.append({**{k:e[k]for k in ['transition','retired','phase','ordinal','sequence']},'channel':intent['channel'],'outcome':intent['outcome'],'bytes':list(raw)})
    assert rows==prefix['receipts']
    uart=(folder/'guest.uart.bin').read_bytes();kernel=(folder/'kernel.bin').read_bytes();capture=json.loads((folder/'capture.json').read_text());assert sha(kernel)==capture['kernel']['sha256'] and len(kernel)==capture['kernel']['bytes']
    result=model(kernel,rows,uart)
    if sabotage:
        poisoned=copy.deepcopy(rows)
        first=next(r for r in poisoned if r['channel']==17 and r['outcome'][1]=='1');first['bytes'][0]^=1
        try:model(kernel,poisoned,uart)
        except AssertionError as error:result['sabotage']={'status':'rejected','sequence':first['sequence'],'mutation':'first RTC raw sample low bit xor1','assertion':str(error)}
        else:raise AssertionError('sabotaged RTC payload passed independent production oracle')
    result.update(label=label,manifest_sha256=sha((folder/'manifest.json').read_bytes()),kernel_sha256=sha(kernel),uart_sha256=sha(uart),events=len(rows))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--sabotage',action='store_true');a=p.parse_args()
    result={'status':'passed','source':'authenticated durable production events, no emulator codec','prefixes':[check(a.directory.resolve(),label,a.sabotage)for label in ['direct-prefix','worker-prefix']]}
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','prefixes':[{k:v for k,v in r.items()if k not in ['samples']}for r in result['prefixes']]}))
