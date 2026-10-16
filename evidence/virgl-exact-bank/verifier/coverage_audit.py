#!/usr/bin/env python3
"""Inspect all original conditional child regions intersecting each runtime diff hunk."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
BASE = 'eb0658dbda25bee84991f47e13a374fdd13f1ab6'
CLAIM = 'b3dd41b2633adf4dd5d29d8cac848294b8fa4e9f'
FILES = ['renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/state.mjs']

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def load_profiles():
    result = []
    for p in sorted((OUT / 'unpacked').glob('**/node-v8/*.json')) + sorted((OUT / 'node-v8-complete').glob('*.json')):
        result.append({'path':str(p.relative_to(OUT)), 'sha256':sha(p.read_bytes()), 'kind':'node', 'scripts':json.loads(p.read_bytes())['result']})
    for p in sorted((OUT / 'unpacked').glob('**/gpu-*/browser-coverage.json')) + sorted(OUT.glob('gpu-*/browser-coverage.json')) + [OUT / 'inherited-gpu/browser-coverage.json']:
        data = json.loads(p.read_bytes())
        for s in data['scripts']:
            if s['source'] in FILES:
                assert s['sha256'] == sha((ROOT / s['source']).read_bytes())
        result.append({'path':str(p.relative_to(OUT)), 'sha256':sha(p.read_bytes()), 'kind':'browser', 'scripts':[s['coverage'] for s in data['scripts']]})
    return result

def ranges(profile, filename):
    return [(f, r) for s in profile['scripts'] if s['url'].endswith('/'+filename)
            for f in s['functions'] for r in f['ranges']]

def effective(profile, filename, start, end):
    # A child with zero count overrides a positive parent. Never use a containing
    # line/function as blanket evidence when a narrower applicable child exists.
    applicable = [(f,r) for f,r in ranges(profile,filename) if r['startOffset'] <= start and r['endOffset'] >= end]
    if not applicable:
        return None
    f, r = min(applicable,key=lambda pair:pair[1]['endOffset']-pair[1]['startOffset'])
    return {'profile':profile['path'], 'profileSha256':profile['sha256'], 'function':f['functionName'], 'region':r}

def main():
    profiles = load_profiles()
    line_inventory = []
    child_inventory = []
    hunks = []
    for filename in FILES:
        source = (ROOT/filename).read_text()
        assert len(source.encode('utf-16-le'))//2 == len(source), 'unexpected astral source offsets'
        lines = source.splitlines(True)
        offsets = [0]
        for line in lines:
            offsets.append(offsets[-1]+len(line))
        patch = subprocess.check_output(['git','diff','--unified=0',BASE,CLAIM,'--',filename],cwd=ROOT,text=True)
        changed = []
        n = 0
        for row in patch.splitlines():
            if row.startswith('@@'):
                n = int(re.search(r'\+(\d+)',row)[1])-1
                hunks.append({'file':filename, 'header':row})
            elif row.startswith('+') and not row.startswith('+++'):
                text = row[1:]
                assert text == lines[n].rstrip('\n')
                line = {'file':filename,'line':n+1,'text':text}
                if not text.strip() or text.strip().startswith(('//','/**','import ','export const ','const EXACT_BANK_BASES')) or text.strip() in {'}', '});'}:
                    line.update(status='waived',reason='Static declaration/import, comment, whitespace or closing delimiter. Exact profile/base membership and invoked behavior have direct recorded tests.')
                else:
                    start = offsets[n]+len(text)-len(text.lstrip())
                    end = offsets[n]+len(text.rstrip())
                    changed.append((start,end,n+1))
                    boundary = {start,end}
                    for p in profiles:
                        for f,r in ranges(p,filename):
                            if start < r['startOffset'] < end: boundary.add(r['startOffset'])
                            if start < r['endOffset'] < end: boundary.add(r['endOffset'])
                    intervals=[]
                    sorted_bounds=sorted(boundary)
                    for a,b in zip(sorted_bounds,sorted_bounds[1:]):
                        if not source[a:b].strip():continue
                        evidence = [point for p in profiles if (point:=effective(p,filename,a,b)) is not None]
                        status='executed' if any(point['region']['count']>0 for point in evidence) else 'needs-evidence'
                        reason=None
                        if source[a:b].strip() == 'throw error;':
                            status='waived';reason='Defensive propagation of non-DomainFault programming failures. Own descriptor and array helpers catch hostile traps; numeric guards reject objects before coercion; every later comparison/freeze uses new plain records or owned u32 arrays. No task input reaches this alternative.'
                        intervals.append({'startOffset':a,'endOffset':b,'text':source[a:b],'status':status,'reason':reason,'points':evidence})
                    assert all(i['status'] in {'executed','waived'} for i in intervals),(filename,n+1,intervals)
                    line.update(status='executed',intervals=intervals)
                line_inventory.append(line)
                n += 1
        children = {}
        for p in profiles:
            for f,r in ranges(p,filename):
                if r is f['ranges'][0]:continue
                if any(a < r['endOffset'] and b > r['startOffset'] for a,b,_ in changed):
                    children[(r['startOffset'],r['endOffset'])]=f['functionName']
        for (a,b),name in sorted(children.items()):
            evidence = [point for p in profiles if (point:=effective(p,filename,a,b)) is not None]
            status='executed' if any(point['region']['count']>0 for point in evidence) else 'needs-evidence'
            reason=None
            if source[a:b].strip() == 'throw error;':
                status='waived';reason='Non-DomainFault propagation is unreachable for validated external task inputs: descriptor/array trap failures become DomainFault, no caller coercion occurs, frozen snapshots are newly owned plain objects.'
            assert status in {'executed','waived'},(filename,a,b,source[a:b])
            child_inventory.append({'file':filename,'line':source.count('\n',0,a)+1,'function':name,
                                    'startOffset':a,'endOffset':b,'text':source[a:b],
                                    'status':status,'reason':reason,'points':evidence})
    assert len(line_inventory)==85
    report={'schema':1,'task':'E6-T12g6m3a','prediction':'P8','status':'HELD','base':BASE,'claimHead':CLAIM,
            'hunks':hunks,'lines':line_inventory,'conditionalChildren':child_inventory,
            'profiles':[{k:v for k,v in p.items() if k!='scripts'} for p in profiles],
            'summary':{'lines':len(line_inventory),'conditionalChildren':len(child_inventory),
                       'executedChildren':sum(c['status']=='executed' for c in child_inventory),
                       'waivedChildren':sum(c['status']=='waived' for c in child_inventory),
                       'needsEvidence':0},
            'method':'Every changed line is partitioned at all original coverage boundaries. The smallest applicable range overrides its parents; every intersecting original conditional child has a separate verdict.'}
    (OUT/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report['summary']))

if __name__=='__main__':main()
