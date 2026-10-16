#!/usr/bin/env python3
"""Recompute every critic GPU pixel from uploaded words, ignoring stored expectations."""
from pathlib import Path
import gzip,hashlib,json,math,struct,sys

def main(root):
    plans=json.loads((root/'physical-plan.json').read_text())
    report=json.loads((root/'hardware/report.json').read_text())
    assert report['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    points=[]
    assert len(plans)==len(report['acceptance']['frames'])==8
    for plan,frame in zip(plans,report['acceptance']['frames']):
        words=frame['banks'][0]['actualWords'];assert words==plan.get('fragmentWords',plan.get('vertexWords'))
        f=lambda i:struct.unpack('<f',struct.pack('<I',words[i]))[0]
        a=[f(i) for i in range(4,8)];scale=[f(i) for i in range(8,12)]
        assert math.floor(f(0))==1 and words[16:]==[3,5,63,67]
        e=math.exp(a[1]*math.log(2));l=math.log(a[2])/math.log(2);s=math.sin(-abs(a[3]));c=math.cos(a[2]);m=[x*y for x,y in zip(a,scale)]
        expected=[m[0]+e-s,m[1]+e+c,m[2]-l-s,m[3]-l+c]
        assert max(abs(x-y) for x,y in zip(plan['expected'],expected))<1e-14
        pix=frame['outputs'][0]['pixels'];raw=gzip.decompress((root/'hardware'/pix['path']).read_bytes())
        assert hashlib.sha256(raw).hexdigest()==pix['sha256'] and len(raw)==frame['width']*frame['height']*16
        actual=struct.unpack('<'+'f'*(len(raw)//4),raw);max_error=0
        for i,x in enumerate(actual):
            error=abs(x-expected[i%4]);max_error=max(max_error,error)
            assert math.isfinite(x) and error<=.00005,(plan['seed'],i,expected[i%4],x)
        points.append(dict(seed=plan['seed'],name=frame['name'],point=[0,0],expected=expected,observed=list(actual[:4]),pixels=len(raw)//16,maxError=max_error,pixelSha256=pix['sha256']))
    faults=[]
    for kind in ['sine','oracle']:
        r=json.loads((root/f'sabotage-{kind}/report.json').read_text())
        assert r['status']=='failed' and r['browserErrors']==dict(console=[],page=[],requests=[])
        frame=r['acceptance']['frames'][0]
        assert frame['mismatches'] and 'independent standard pixels' in r['failure']['message']
        point=frame['mismatches'][0]
        assert point['errors'][0]>(1 if kind=='sine' else .12)
        if kind=='sine':
            healthy=report['acceptance']['frames'][0]
            assert frame['fragment']['glsl']==healthy['fragment']['glsl'].replace('sin(','cos(')
            assert frame['banks']==healthy['banks']
        faults.append(dict(kind=kind,point=point))
    result=dict(status='passed',frames=len(points),pixels=sum(p['pixels'] for p in points),points=points,faults=faults)
    (root/'physical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(f"{result['frames']} critic dynamic frames/{result['pixels']} independently recomputed pixels; both sabotages caught")

if __name__=='__main__':main(Path(sys.argv[1]))
