"""Independently unpack original layouts and compare full fenced GPU bodies."""
import hashlib,json,struct,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
def metadata(words,buffer):
    count=words[0];strides=words[1:5] if count else [0]*4;outputs=[];varyings=[];offset=0
    for i in range(count):
        v=words[5+2*i];reg=v&255;start=(v>>8)&3;num=(v>>10)&7;buf=(v>>13)&7;dest=v>>16
        outputs.append(dict(registerIndex=reg,startComponent=start,numComponents=num,outputBuffer=buf,destinationOffset=dest,stream=words[6+2*i]))
        if buf==buffer:
            varyings.append(dict(outputIndex=i,name='wv_so_'+str(i),type='uint' if num==1 else 'uvec'+str(num),components=num,packedOffset=offset));offset+=num*4
    return dict(encoding='raw-32bit-words',captureBuffer=buffer,strides=strides,outputs=outputs,varyings=varyings,packedStrideBytes=offset)
def original(f,c):
    values={0:c[0][:]};reg=f.get('register')
    if f['kind']=='wide':values.update({i+1:c[i][:] for i in range(16)});return values
    if reg!=0 or f['mode']!='copy':
        value=c[0][:] if reg==0 else [0,0,0,0];source=c[1]
        if f['mode']=='copy':value=source[:]
        elif f['mode']=='alias':value=[source[1],source[0],source[2],source[3]]
        elif f['mode']=='partial':value[0]=source[3];value[2]=source[1]
        elif f['mode']=='conditional' and source[0]!=0:value[2:]=source[2:]
        values[reg]=value
    return values
reports=[]
folders=[root] if (root/'report.json').is_file() else [root/name for name in ['hardware-54831','hardware-90107','hardware-171281','fault-varying-order']]
for folder in folders:
    data=json.loads((folder/'report.json').read_bytes());fault=bool(data.get('fault'));assert data['status']==('failed' if fault else 'passed');assert not data['errors'];payload=data['partial'] if fault else data['result'];rows=payload['rows'];calls=payload['nativeCalls']
    assert rows and calls;checked=0;mismatches=0
    for row in rows:
        f=row['fixture'];words=f['words'];buffer=f['buffer'];want=metadata(words,buffer);got=row['result']['vertex']['metadata']['streamOutput'];assert got==want,(f['name'],want,got)
        assert row['result']['vertex']['metadata']['profile']=='virgl-webgl2-standard-stream-output-gles3-v1'
        original_words=original(f,row['constants']);packed=[]
        for item in want['outputs']:
            if item['outputBuffer']==buffer:packed+=original_words[item['registerIndex']][item['startComponent']:item['startComponent']+item['numComponents']]
        expected=b'\xa3'*16+struct.pack('<'+'I'*len(packed)*3,*(packed*3))+b'\xa3'*16
        assert bytes(row['expected'])==expected;assert dict(row['original'])==original_words
        actual=bytes(row['actual']);assert len(actual)==len(expected);different=[i for i,(a,b) in enumerate(zip(actual,expected)) if a!=b]
        assert [m['offset'] for m in row['mismatches']]==different;mismatches+=len(different);checked+=len(actual)
        native=[c for c in calls if c['fixture']==f['name']];methods=[c['method'] for c in native]
        for required in ['transformFeedbackVaryings','linkProgram','beginTransformFeedback','drawArrays','endTransformFeedback','fenceSync','clientWaitSync','getBufferSubData','deleteTransformFeedback']:assert required in methods,(f['name'],required)
        selected=next(c for c in native if c['method']=='transformFeedbackVaryings')['args'][1];assert selected==row['nativeVaryingNames'];assert row['fence'] in [0x911a,0x911c]
        assert len(row['nativeVaryings'])==len(want['varyings']);types={1:0x1405,2:0x8dc6,3:0x8dc7,4:0x8dc8}
        by_name={v['name']:v for v in want['varyings']}
        for reflection,name in zip(row['nativeVaryings'],selected):
            generated=by_name[name];assert reflection==dict(name=name,type=types[generated['components']],size=1)
        if not different:assert selected==[v['name'] for v in want['varyings']]
    if fault:assert payload['completedNativeReadback'] and payload['fixture']=='floor64/3' and mismatches>0
    else:assert len(rows)==160 and not mismatches
    reports.append(dict(record=folder.name,rows=len(rows),fullBytes=checked,mismatches=mismatches,nativeCalls=len(calls),reportSha256=sha((folder/'report.json').read_bytes())))
(root/'physical-audit.json').write_text(json.dumps(dict(status='passed',reports=reports,completedPhysicalRefutations=sum(bool(r['mismatches']) for r in reports)),indent=2)+'\n');print(json.dumps(reports))
