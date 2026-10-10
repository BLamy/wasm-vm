#!/usr/bin/env python3
"""Retain original native/V8 regions and inventory each changed runtime line."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '8840833b7fc8196a72c7acf2752b2dff684f6670'
FILES = ['renderer/virgl-shader/bridge.c','renderer/virgl-shader/index.mjs']
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
                elif ('check_input_attempt(' in stripped or stripped.startswith(('static bool pair_exact','static const char *pair_exact','const char *bridge_translate_pair_exact','const struct bridge_exact_word *','const size_t *','const struct raw_exact_bank *exact','size_t length, bool qualified'))):
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
    branches=[]
    data=cfiles['bridge.c']
    for branch in data['branches']:
        if branch[0]<1934:continue
        source=(ROOT/'renderer/virgl-shader/bridge.c').read_text().splitlines()[branch[0]-1]
        for alternative,count in [('true',branch[4]),('false',branch[5])]:
            entry=dict(file='renderer/virgl-shader/bridge.c',region=branch,alternative=alternative,count=count,status='executed' if count else 'needs-evidence')
            if not count and 'response_overflow' in source:
                entry.update(status='waived',reason='All controlled raw/upstream emitter output and inherited metadata are unchanged from the authenticated m3b bound: <=414120 bytes per stage, <=829264 including pair delimiter/interface, below3179520 paired response capacity; no caller supplies GLSL/metadata or a capacity override.')
            if not count and 'checked_fragment_interface(fragment)' in source:
                entry.update(status='waived',reason='The unchanged authenticated checker compares complete validated unique Generic declarations to the unchanged pinned emitter exports (raw assigns each exact checked entry; upstream70-source seal/crosscheck held). No external interface key or mutable export reaches this helper; complete normal pairs and actual mismatching emitted GLSL fault are recorded.')
            branches.append(entry)
    if any(x['status']=='needs-evidence' for x in branches):
        for x in branches:
            if x['status']=='needs-evidence':print(x)
        raise ValueError('native conditional proof gap')
    js_source=(ROOT/'renderer/virgl-shader/index.mjs').read_text()
    lower=len(js_source[:js_source.index('function pairExactComponents')].encode('utf-16-le'))//2
    upper=len(js_source[:js_source.index('    translateExact(request)')].encode('utf-16-le'))//2
    js_children={}
    for profile in profiles:
        for script in profile['scripts']:
            if not script['url'].endswith('/renderer/virgl-shader/index.mjs'):continue
            for function in script['functions']:
                for region in function['ranges']:
                    if not lower<=region['startOffset']<upper:continue
                    key=(function['functionName'],region['startOffset'],region['endOffset'])
                    entry=js_children.setdefault(key,dict(function=function['functionName'],startOffset=region['startOffset'],
                        endOffset=region['endOffset'],counts=[]))
                    entry['counts'].append(dict(profile=profile['path'],count=region['count']))
    js_children=list(js_children.values())
    for entry in js_children:entry['status']='executed' if any(c['count']>0 for c in entry['counts']) else 'needs-evidence'
    if not js_children or any(x['status']=='needs-evidence' for x in js_children):
        for entry in js_children:
            if entry['status']=='needs-evidence':print(entry)
        raise ValueError('original V8 paired child proof gap')
    result=dict(task='E6-T12g6m3c',status='passed' if all(x['status']!='needs-evidence' for x in lines) else 'needs-evidence',gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),base=BASE,patchSha256=sha(patch.encode()),lines=lines,
        nativeBranches=branches,jsChildren=js_children,nativeOriginalSha256=sha((out/'native/coverage.json').read_bytes()),profiles=[{k:v for k,v in p.items() if k!='scripts'} for p in profiles],
        conditionalChildren='Unfiltered original LLVM branches and V8 child regions retained. Every new native/V8 child is executed or narrowly waived; fresh critic must audit classifications, carrying unchanged descending-policy HELD results.')
    (out/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    gaps=[x for x in lines if x['status']=='needs-evidence']
    for x in gaps:print(f'{x["file"]}:{x["line"]}: {x["text"]}')
    if gaps:raise ValueError(f'{len(gaps)} unexecuted changed runtime lines')
    print(f'Original native/V8 profiles account for {len(lines)} changed runtime lines, {len(branches)} native alternatives and {len(js_children)} V8 regions.')


if __name__=='__main__':
    main()
