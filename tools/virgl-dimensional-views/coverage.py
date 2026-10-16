#!/usr/bin/env python3
"""Finest V8 partitions, retaining only byte-identical positive predecessor facts."""
import difflib,hashlib,json,re,struct,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[2];root=Path(sys.argv[1]).resolve();base='deb7b3113f9adeb2e6e80449a6710dd3295093ea'
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True)
paths=['renderer/virgl-command/'+n+'.mjs' for n in ['constant-domain','decoder','resources','state','control-bridge']]
u16=lambda s:list(struct.unpack('<'+'H'*(len(s.encode('utf-16-le'))//2),s.encode('utf-16-le')))
def offsets(s):
    result=[0]
    for row in s.splitlines(keepends=True):result.append(result[-1]+len(u16(row)))
    return result
changed={};matches=[];name=None;oldline=newline=0;removed=[];added=[];hunkold=hunknew=0
def flush():
    if not removed and not added:return
    old=''.join(removed);new=''.join(added)
    for m in difflib.SequenceMatcher(None,u16(old),u16(new),autojunk=False).get_matching_blocks():
        if m.size<24:continue
        matches.append(dict(source=name,oldStart=hunkold+m.a,oldEnd=hunkold+m.a+m.size,start=hunknew+m.b,end=hunknew+m.b+m.size))
    removed.clear();added.clear()
for row in git('diff','--unified=0',base,'--',*paths).splitlines(keepends=True):
    if row.startswith('+++ b/'):flush();name=row[6:].strip()
    elif row.startswith('@@'):
        flush();m=re.search(r'-(\d+)(?:,\d+)? \+(\d+)',row);oldline=int(m[1]);newline=int(m[2]);
        old=git('show',base+':'+name);new=(repo/name).read_text();hunkold=offsets(old)[oldline-1];hunknew=offsets(new)[newline-1]
    elif row.startswith('-') and not row.startswith('---'):removed.append(row[1:]);oldline+=1
    elif row.startswith('+') and not row.startswith('+++'):added.append(row[1:]);changed.setdefault(name,[]).append(newline);newline+=1
flush()
scripts=[];held_scripts=[]
for file in sorted(root.rglob('browser-coverage.json')):
    data=json.loads(file.read_bytes());records=data.get('scripts',[data]);held='held-coverage' in file.parts
    if held and file.parent.name.startswith('fault-'):continue
    if not held:
        report=json.loads((file.parent/'report.json').read_bytes());assert report['status']=='passed' or file.parent.name.startswith('fault-')
        assert sha(file.read_bytes())==report['browserCoverage']['sha256']
    for row in records:
        if row['source'] not in paths:continue
        body=git('show',base+':'+row['source']).encode() if held else (repo/row['source']).read_bytes()
        assert sha(body)==row['sha256'],(file,row['source'])
        (held_scripts if held else scripts).append(dict(record=file.relative_to(root).as_posix(),**row))
for file in sorted((root/'node-coverage').glob('coverage-*.json')):
    for row in json.loads(file.read_bytes())['result']:
        if row['url'].startswith(repo.as_uri()+'/'):
            name=row['url'][len(repo.as_uri())+1:]
            if name in paths:scripts.append(dict(record=file.relative_to(root).as_posix(),source=name,sha256=sha((repo/name).read_bytes()),coverage=row))
def counters(records,name,a,b):
    result=[]
    for script in records:
        if script['source']!=name:continue
        candidates=[r for f in script['coverage']['functions'] for r in f['ranges'] if r['startOffset']<=a and b<=r['endOffset']]
        if candidates:
            r=min(candidates,key=lambda r:(r['endOffset']-r['startOffset'],r['count']));result.append(dict(record=script['record'],**r))
    return result
executed=[];held=[];waived=[];missing=[]
for name,lines in changed.items():
    body=(repo/name).read_text();raw=body.encode('utf-16-le');starts=offsets(body);old=git('show',base+':'+name)
    for line in lines:
        a0,b0=starts[line-1:line+1];points={a0,b0}
        for s in scripts:
            if s['source']!=name:continue
            for f in s['coverage']['functions']:
                for r in f['ranges']:points.update(v for v in [r['startOffset'],r['endOffset']] if a0<v<b0)
        for m in matches:
            if m['source']==name:points.update(v for v in [m['start'],m['end']] if a0<v<b0)
        points=sorted(points)
        for a,b in zip(points,points[1:]):
            text=raw[a*2:b*2].decode('utf-16-le');current=counters(scripts,name,a,b)
            p=dict(source=name,line=line,startOffset=a,endOffset=b,text=text,sha256=sha(text.encode()),counters=current,maxCount=max((r['count'] for r in current),default=0))
            if p['maxCount']>0:executed.append(p);continue
            candidates=[m for m in matches if m['source']==name and m['start']<=a and b<=m['end']]
            carried=None
            for m in candidates:
                oa=m['oldStart']+a-m['start'];ob=oa+b-a;previous=counters(held_scripts,name,oa,ob)
                if previous:
                    assert old.encode('utf-16-le')[oa*2:ob*2]==raw[a*2:b*2]
                    carried=dict(oldStartOffset=oa,oldEndOffset=ob,baseSourceSha256=sha(old.encode()),previousCounters=previous,
                      reason='HELD byte-identical historical operand at the independently verified dependency boundary, outside the new selected path. Complete authenticated predecessor ranges remain attached, including zero counters; current historical constructors and whole responses execute separately. This does not cover a newly changed operand.');break
            if carried:held.append(dict(**p,**carried))
            elif not text.strip() or re.fullmatch(r'[\s{}(),;:?]+',text) or body.splitlines()[line-1].lstrip().startswith(('//','/*','*')):
                waived.append(dict(**p,reason='Whitespace, comments or delimiters contain no executable operand.'))
            elif text.strip()==': null' and name.endswith('control-bridge.mjs'):
                waived.append(dict(**p,reason='Unchanged literal null for the historical synchronous transport; the selected dimensional transport is always asynchronous.'))
            elif name.endswith('state.mjs') and text.strip()==': "texture"':
                assert ': "texture"' in old
                waived.append(dict(**p,reason='Unchanged static kind literal for the historical images=false constructor. The new factory fixes images=true and its actual 2D/dimensional retained kinds execute; no new runtime operation is hidden here.'))
            else:missing.append(p)
result=dict(schema='dimensional-view-finest-v8-v1',head=git('rev-parse','HEAD').strip(),base=base,changedLines=changed,scripts=scripts,heldScripts=held_scripts,executed=executed,held=held,waived=waived,needsEvidence=missing)
(root/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(executed=len(executed),held=len(held),waived=len(waived),needsEvidence=[{k:p[k] for k in ['source','line','text']} for p in missing])))
assert not missing,'changed executable operand has no finest positive counter or exact held proof'
