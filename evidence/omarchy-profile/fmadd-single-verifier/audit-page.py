#!/usr/bin/env python3
"""Independently recount saved parcels; carry the unchanged verified page walker."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

repo=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
worker=repo/'evidence/omarchy-profile/fmadd-single-r1'
sha=lambda b:hashlib.sha256(b).hexdigest()
r=json.loads((worker/'saved-fmadd-encodings.json').read_text())
snap=repo/'target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz'
assert sha(snap.read_bytes())==r['snapshotSha256']=='2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'
page=(repo/'target/omarchy-user-symbols/renderer-page.bin').read_bytes()
assert len(page)==4096
assert sha(page)==r['pageSha256']=='68e042889bbbe68b7fb56eb2bca604d2b79f384620da6d33a1e3b1bb6b680f9b'
profile_raw=(repo/'evidence/omarchy-profile/renderer-opcodes-r1/profile.json').read_bytes()
assert sha(profile_raw)==r['sourceProfileSha256']=='5133c92488d51075599604a79eff7f649e5743ada8a6f60fb0bfa506672bc521'
p=json.loads(profile_raw)
assert p['total_retired']==99998678 and p['fp_compute']==13424839
assert p['fma_opcode7']=={'0x43':1278792} and p['fp_region64_dropped']==0
assert sum(x['fp_compute'] for x in p['fp_region64'])==p['fp_compute']
regions={int(x['pc'],16):x for x in p['fp_region64']}
found=[];offset=0
while offset<4096:
    half=struct.unpack_from('<H',page,offset)[0]
    length=4 if half&3==3 else 2
    if offset+length>4096:
        assert offset==4094 and length==4
        break
    if length==4:
        word=struct.unpack_from('<I',page,offset)[0]
        if word&127==0x43:
            pc=0x7fff6c08a000+offset
            assert (word>>25)&3==0 and (word>>12)&7==7
            assert regions[pc&~63]['fp_compute']>0
            found.append({'pc':hex(pc),'word':f'{word:08x}','format':0,'rm':7,'region':hex(pc&~63)})
    offset+=length
assert found==r['parcels'] and len(found)==24
# Check the recorded Sv57 witness arithmetic independently, then carry the
# unchanged previously verified raw-memory walker. Do not claim a second RAM
# decode: the worker performs the fresh raw-snapshot/page walk in its log.
root=int(r['renderer']['userAddressSpace']['physicalRoot'],16)
va=int(r['translation']['virtual'],16)
for row in r['translation']['translation']:
    level=row['level'];address=root+((va>>(12+9*level))&511)*8
    assert address==int(row['physical'],16)
    pte=int(row['pte'],16);assert pte&1
    if level:
        assert pte&14==0
        root=(pte>>10)<<12
    else:
        assert pte&0x58==0x58 # user, execute, accessed
        assert (pte>>10)<<12 | (va&4095)==int(r['translation']['physical'],16)==0x9cab1000
walker='tools/verify/omarchy-wait-checkpoint.mjs'
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
old=subprocess.check_output(['git','show','29ea3537:'+walker],cwd=repo,env=env)
assert old==(repo/walker).read_bytes()
receipt=dict(snapshotSha256=r['snapshotSha256'],pageSha256=sha(page),profileSha256=sha(profile_raw),
    independentlyRecountedParcels=len(found),allFormatSingleAndDynamic=True,
    completeComputeRegionSum=p['fp_compute'],fmaOpcodeRetirements=1278792,
    eachParcelInMeasuredComputeRegion=True,recordedSv57WitnessArithmeticCorrect=True,
    unchangedVerifiedWalkerSha256=sha(old),trailingPartialParcelExcluded=True,
    limitation='Static page identifies S parcels; the historical dynamic opcode histogram has no per-PC S/D attribution. Fresh full raw page walk is worker evidence; this critic checks its unchanged walker, input pins, witness arithmetic, and actual output bytes without repeating the full decode.')
(out/'page-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
