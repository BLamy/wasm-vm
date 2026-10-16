#!/usr/bin/env python3
"""Invert the promoted original UN16 subrectangle/stale-ticket attack."""
import gzip,hashlib,json,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from lifetimes import audit_lifetimes
sha=lambda b:hashlib.sha256(b).hexdigest()
def packets(text):
    data=bytes.fromhex(text);at=0
    while at<len(data):
        header,=struct.unpack_from('<I',data,at);count=header>>16;end=at+(count+1)*4;assert end<=len(data)
        yield header&255,list(struct.unpack_from('<'+'I'*count,data,at+4))
        at=end

def main(directory):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text());e=report['browserResult']['result']
    assert report['status']==e['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    assert e['mode']=='critic-subrectangle' and len(e['runs'])==1
    refs={r['key']:r for r in e['blobs']};assert len(refs)==len(e['blobs'])
    def load(ref):
        r=refs[ref['key']];assert r['sha256']==ref['sha256'];z=(directory/r['path']).read_bytes();assert sha(z)==r['gzipSha256'];raw=gzip.decompress(z);assert len(raw)==r['bytes'] and sha(raw)==r['sha256'];return raw
    comparisons=[]
    def native(ref,wanted,width,height,where):
        raw=load(ref);assert len(raw)==width*height*20 and len(wanted)==width*height*2
        for i in range(width*height):
            word,=struct.unpack_from('<H',wanted,i*2);expected,=struct.unpack('<I',struct.pack('<f',word/65535));observed,*constant=struct.unpack_from('<4I',raw,i*16)
            assert observed<=0x3f800000 and abs(observed-expected)<=1 and constant==[0,0,1],(where,i,word,observed,expected,constant)
        assert raw[width*height*16:]==bytes(width*height*4)
        comparisons.append(dict(where=where,pixels=width*height,nativeSha256=sha(raw),originalSha256=sha(wanted)))
    r=e['runs'][0];m=r['source'];assert (m['format'],m['width'],m['height'],m['lastLevel'],m['bind'])==(16,13,11,3,9)
    backing=load(r['sourceBacking']);wanted=bytearray([0xa7]*len(backing));planes={}
    for p in r['planes']:
        level=p['level'];w=max(1,13>>level);h=max(1,11>>level);raw=load(p['input']);assert (p['width'],p['height'],len(raw))==(w,h,w*h*2)
        for y in range(h):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+w*2]=raw[y*w*2:(y+1)*w*2]
        planes[level]=raw;native(r['originalNative'][level],raw,w,h,'initial/'+str(level))
    assert wanted==backing and load(r['sourceBackingAfterPatch'])==backing
    patch=r['patch'];op,w=next(packets(patch['wire']));assert op==45 and w==[6,1,0,7,0,2,1,0,3,3,1,7,5,1]
    original=load(patch['input']);assert original==struct.pack('<9H',0,65535,32768,1,65534,24575,24576,49151,16384)
    strided=bytearray([0x6d]*32)
    for y in range(3):strided[5+y*7:11+y*7]=original[y*6:y*6+6]
    assert load(patch['backing'])==strided
    updated=bytearray(planes[1])
    for y in range(3):updated[((1+y)*6+2)*2:((1+y)*6+5)*2]=original[y*6:y*6+6]
    native(patch['native'],updated,6,5,'patched/mip1')
    p=r['pending'];op,w=next(packets(p['wire']));assert op==45 and w==[6,1,0,7,0,2,1,0,3,3,1,8,5,3]
    layout=p['layout'];assert layout['rowBytes']==6 and layout['rowStride']==7 and layout['footprintBytes']==20 and layout['requiredEnd']==25 and layout['tightBytes']==18
    assert layout['nativeReadBytes']==layout['scratchBytes']==layout['conversionBytes']==36 and layout['stagingBytes']==72
    assert p['issued']['gpuBytes']-p['before']['gpuBytes']==72 and p['issued']['stagingBytes']-p['before']['stagingBytes']==72
    assert p['refusal']['error']['code']=='stale-ticket' and p['cpuReadsBefore']==p['cpuReadsAfter']
    assert p['discardCompletion']['actual'] in [37146,37148]
    assert load(r['stagingBefore'])==load(r['stagingAfter'])==bytes([0x2e]*32)
    replacement=r['replacement'];assert replacement['metadata']['format']==126 and replacement['generation']>r['originalGeneration']
    assert load(replacement['backing'])==load(replacement['after'])
    assert p['released']['stagingBytes']==p['before']['stagingBytes']==0 and p['released']['scratchBytes']==p['before']['scratchBytes']-36
    v=r['view'];assert (v['first'],v['last'],v['generation'],v['resolvedGeneration'])==(1,2,r['originalGeneration'],r['originalGeneration'])
    assert v['metadata']['format']==16 and v['metadata']['width']==6 and v['metadata']['height']==5 and v['metadata']['gpuByteLength']==72
    for p in v['planes']:
        assert p['original']==p['local']+1;native(p['native'],updated if p['original']==1 else planes[2],p['width'],p['height'],'retained/'+str(p['original']))
    # The full raw returned native bytes must back each diagnostic, rather than
    # only accepting a counter or a fixture-produced compact diagnostic.
    physical=[load(row['bytes']) for row in r['readbacks'] if row['cpu']]
    for ref in [*r['originalNative'],patch['native'],*[p['native'] for p in v['planes']]]:
        body=load(ref);assert body[:-len(body)//5] in physical
    counts=audit_lifetimes(r);assert r['final']['async']['stagingBytes']==0
    result=dict(status='passed',oracleImportsProductCode=False,originalPacketsInputsAndReturnedNativeBytesAreAuthority=True,comparisons=comparisons,counts=counts,staleSourceBeforeCPU=True,oldGenerationPreserved=True)
    (directory/'critic-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',comparisons=len(comparisons),counts=counts)))
if __name__=='__main__':main(sys.argv[1])
