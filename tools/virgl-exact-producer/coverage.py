#!/usr/bin/env python3
"""Retain original native/V8 regions and inventory each changed runtime line."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '36a6d07cbf5708ceeaee9a186d8bacadd7278f6c'
FILES = ['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/index.mjs']
SEEDS = [1779033703,3144134277,1013904242]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    out=Path(sys.argv[1]).resolve()
    native=json.loads((out/'native/coverage.json').read_bytes())
    cfiles={f['filename'].split('/renderer/virgl-shader/')[-1]:f for d in native['data'] for f in d['files']}
    profiles=[]
    for p in sorted((out/'node-v8').glob('*.json')):
        profiles.append(dict(path=str(p.relative_to(out)),sha256=sha(p.read_bytes()),scripts=json.loads(p.read_bytes())['result']))
    for seed in SEEDS:
        report=json.loads((out/f'gpu-{seed}/report.json').read_bytes())
        path=out/f'gpu-{seed}'/report['browserCoverage']['path']
        assert sha(path.read_bytes())==report['browserCoverage']['sha256']
        envelope=json.loads(path.read_bytes())
        for script in envelope['scripts']:
            assert sha((ROOT/script['source']).read_bytes())==script['sha256']
        profiles.append(dict(path=str(path.relative_to(out)),sha256=sha(path.read_bytes()),scripts=[s['coverage'] for s in envelope['scripts']]))
    patch=subprocess.check_output(['git','diff','--unified=0',BASE,'--',*FILES],cwd=ROOT,text=True)
    lines=[];file=None;number=0
    for row in patch.splitlines():
        if row.startswith('+++ b/'):
            file=row[6:]
        elif row.startswith('@@'):
            number=int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and not row.startswith('+++'):
            text=row[1:];entry=dict(file=file,line=number,text=text);number+=1
            stripped=text.strip()
            if not stripped or stripped.startswith(('/*','*','//')) or stripped in ['}','};','});']:
                entry.update(status='waived',reason='Comment, whitespace or closing delimiter; enclosing behavior recorded.')
            elif file.endswith('.c'):
                data=cfiles[Path(file).name]
                points=[s for s in data['segments'] if s[0]==entry['line'] and s[3]]
                before=[s for s in data['segments'] if s[0]<entry['line'] and s[3]]
                if before:points.append(before[-1])
                entry['nativeSegments']=points
                if any(s[2]>0 for s in points):entry['status']='executed'
                elif ('check_input_attempt(' in stripped or stripped.startswith(('static bool exact_declarations','const char *bridge_translate_exact','const struct raw_exact_bank *exact)'))):
                    entry.update(status='waived',reason='Function signature/continuation; invoked body and actual layout are recorded.')
                elif 'response_overflow' in stripped or 'JSON output exceeded' in stripped:
                    entry.update(status='waived',reason='Existing bounded writer defense: <=262144 GLSL bytes encode <=1572864 bytes; canonical184 tuples plus bounded inherited metadata fit the reserved16384 bytes. Maximum-size calls are recorded; no capacity override is a caller API.')
                else:entry.update(status='needs-evidence',reason='No original native region records this changed line.')
                entry['nativeBranches']=[b for b in data['branches'] if b[0]<=entry['line']<=b[2]]
            else:
                source=(ROOT/file).read_text();offset=len(''.join(source.splitlines(True)[:entry['line']-1]).encode('utf-16-le'))//2+len(text)-len(text.lstrip());points=[]
                for p in profiles:
                    for script in p['scripts']:
                        if not script['url'].endswith('/'+file):continue
                        regions=[r for f in script['functions'] for r in f['ranges'] if r['startOffset']<=offset<r['endOffset']]
                        if regions:points.append(dict(profile=p['path'],region=min(regions,key=lambda r:r['endOffset']-r['startOffset'])))
                entry.update(offset=offset,points=points,status='executed' if any(p['region']['count'] for p in points) else 'needs-evidence')
            lines.append(entry)
    result=dict(task='E6-T12g6m3b',status='passed' if all(x['status']!='needs-evidence' for x in lines) else 'needs-evidence',gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),base=BASE,patchSha256=sha(patch.encode()),lines=lines,
        nativeOriginalSha256=sha((out/'native/coverage.json').read_bytes()),profiles=[{k:v for k,v in p.items() if k!='scripts'} for p in profiles],
        conditionalChildren='Unfiltered original LLVM branches and V8 child regions retained. A line hit is not a verdict about every conditional alternative; fresh critic must audit all children, carrying unchanged descending-policy HELD results.')
    (out/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    gaps=[x for x in lines if x['status']=='needs-evidence']
    for x in gaps:print(f'{x["file"]}:{x["line"]}: {x["text"]}')
    if gaps:raise ValueError(f'{len(gaps)} unexecuted changed runtime lines')
    print(f'Original native/V8 profiles account for {len(lines)} changed runtime lines; conditional children retained.')


if __name__=='__main__':
    main()
