#!/usr/bin/env python3
"""Fresh critic: authenticate sealed bodies and reconstruct admission/native oracles."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FROZEN = '64bf6ed58a27a52a20e1548166e12d09dd719031'
BASE = 'e1066c663b64df546f9644f1a25508b4e71db636'
SOURCE = 'renderer/virgl-command/resources.mjs'
PINS = {'manifest.json': '59cea015984012bb2bbd8c8ac469e509ae272c5ca10814dbf80af669566dbdd7',
        'records.json': '4a948c805eaf6d5c165a88694e81d575a630069d49292098274de625e4f1c4c8',
        'recording.tar.gz': '7abb50b55a92b45ceec07aa52a95f0a024c94837dc0a44773465e3d4d3999420'}
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)


def authenticate(directory):
    for name, digest in PINS.items():
        assert sha((directory/name).read_bytes()) == digest, name
    manifest = json.loads((directory/'manifest.json').read_bytes())
    index = json.loads((directory/'records.json').read_bytes())
    assert manifest['sourceHead'] == index['sourceHead'] == FROZEN
    assert manifest['records'] == manifest['reopenedMembers'] == len(index['records']) == 642
    indexed = {row['path']: row for row in index['records']}
    assert len(indexed) == 642
    bodies = {}
    archive = (directory/'recording.tar.gz').read_bytes()
    assert len(archive) == manifest['archiveBytes'] == 2620778
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        entries = tar.getmembers()
        physical = {entry.name: entry for entry in entries}
        assert len(entries) == len(physical) == 642 and set(physical) == set(indexed)
        for entry in entries:
            assert entry.isfile() or entry.islnk(), entry.name
            assert not Path(entry.name).is_absolute() and '..' not in Path(entry.name).parts
            target = physical[entry.linkname] if entry.islnk() else entry
            assert target.isfile() and (not entry.islnk() or target.offset < entry.offset)
            raw = tar.extractfile(target).read()
            expected = indexed[entry.name]
            assert len(raw) == expected['bytes'] and sha(raw) == expected['sha256'], entry.name
            bodies[entry.name] = raw
    return bodies, indexed


def original(name):
    folder = 'evidence/virgl-corpus/captures/'+name
    raw_manifest = (ROOT/folder/'manifest.json').read_bytes()
    assert raw_manifest == git('show', BASE+':'+folder+'/manifest.json')
    manifest = json.loads(raw_manifest)
    event_path = folder+'/'+manifest['events']['path']
    raw = (ROOT/event_path).read_bytes()
    assert raw == git('show', BASE+':'+event_path)
    assert sha(raw) == manifest['events']['sha256'] and len(raw) == manifest['events']['bytes']
    pending, calls, excluded = {}, [], []
    for event in map(json.loads, raw.splitlines()):
        if event['type'] not in ('resource_create', 'resource_unref'):
            continue
        if event['phase'] == 'enter':
            assert event['seq'] not in pending
            pending[event['seq']] = event
        else:
            enter = pending.pop(event['callSeq'])
            assert event['type'] == enter['type'] and event['result'] == 0
            call = dict(enter=enter, returned=event)
            if enter['resourceId'] == 2:
                excluded.append(call)
            else:
                calls.append(call)
    assert not pending and len(excluded) == 1
    boot = excluded[0]['enter']
    assert tuple(boot[k] for k in ('seq','resourceId','target','format','flags','iovCount')) == (10,2,2,2,1,0)
    live, peak, old_overflow = set(), 0, None
    for call in calls:
        event = call['enter']
        if event['type'] == 'resource_create':
            assert event['resourceId'] not in live
            if len(live) == 16 and old_overflow is None:
                old_overflow = event['seq']
            live.add(event['resourceId'])
            peak = max(peak, len(live))
        else:
            live.remove(event['resourceId'])
    return dict(calls=calls, bootstrap=excluded[0], peak=peak, overflow=old_overflow,
                eventPath=event_path, eventSha256=sha(raw), manifestSha256=sha(raw_manifest))


def native_planes(rows, seed):
    assert len({row['id'] for row in rows}) == len(rows)
    for row in rows:
        expected = [(row['id']*17 + j*29 + (seed >> 8)) & 255 for j in range(128)]
        assert row['input'] == row['observed'] == expected, row['id']
    return len(rows)*128


def report_check(raw, mode, models):
    report = json.loads(raw)
    fault = mode.startswith('fault-')
    assert report['status'] == ('failed' if fault else 'passed')
    assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
    browser = report['browser']
    assert browser['headless'] is False and browser['version'].startswith('155.')
    assert browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled'
    assert not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', a, re.I) for a in browser['commandLine'])
    assert sha(Path(browser['executable']).read_bytes()) == browser['sha256']
    body = report['browserResult'].get('result') or report['browserResult']['partial']
    assert 'Metal' in body['gpu'] and 'M4 Max' in body['gpu']
    assert body['guestExecution'] is False and body['productionAuthority'] is False
    for i, fence in enumerate(body['fences'], 1):
        assert fence['sequence'] == i and fence['completed'] is True
        assert fence['polls'][-1] in (37146,37148) and set(fence['polls']) <= {37146,37147,37148}
    counts = dict(originalCalls=0, nativeBytes=0, factories=0, limits=0, completedFences=len(body['fences']))
    if mode == 'replay':
        assert len(body['runs']) == 6
        for row in body['runs']:
            model = models[row['workload']]
            assert row['bootstrap2D'] == model['bootstrap']
            failure = model['overflow'] if row['historical'] else 3025 if row['workload']=='glmark2-es2' else None
            live, peak, allocation_calls = {}, 0, 0
            for i, operation in enumerate(row['operations']):
                assert {k:operation[k] for k in ('enter','returned')} == model['calls'][i]
                assert operation['before']['budgets']['resources'] == len(live)
                assert operation['before']['budgets']['gpuBytes'] == sum(live.values())
                event = operation['enter']
                assert operation['allocationCallsBefore'] == allocation_calls
                expected_ok = event['seq'] != failure
                assert operation['result']['ok'] == expected_ok
                if expected_ok:
                    if event['type'] == 'resource_create':
                        assert event['lastLevel']==0 and event['depth']==event['arraySize']==1
                        assert event['nrSamples']==event['flags']==0
                        if event['target']==0:
                            assert event['format']==64 and event['height']==1
                            charge = 0 if event['bind']==524288 else event['width']
                        else:
                            assert event['target']==2 and event['format'] in (1,2,20,67)
                            charge = event['width']*event['height']*4
                        live[event['resourceId']] = charge
                        allocation_calls += bool(charge)
                        peak=max(peak,len(live))
                    else:
                        del live[event['resourceId']]
                else:
                    assert i==len(row['operations'])-1 and row['failure']==operation
                    assert operation['result']['error']['code'] == ('unsupported-resource' if failure==3025 else 'limit-exceeded')
                    if failure==3025:
                        assert event['format']==17 and event['resourceId']==32 and len(live)==25
                    else:
                        assert len(live)==16
                assert operation['allocationCallsAfter'] == allocation_calls
                assert operation['after']['budgets']['resources'] == len(live)
                assert operation['after']['budgets']['gpuBytes'] == sum(live.values())
            if failure is None:
                assert len(row['operations'])==len(model['calls']) and row['failure'] is None
            assert row['peak']==peak
            assert not any(row['final']['budgets'].values())
            counts['originalCalls'] += len(row['operations'])
    elif mode == 'historical':
        assert len(body['runs'])==15
        for row in body['runs']:
            assert row['current']==row['predecessor']
            old=row['current']
            assert old['defaults']['limits']['resources']==16
            assert [r['ok'] for r in old['operations']]==[True]*16+[False]
            assert old['tightenRefusal']['error']['code']=='invalid-input'
            assert not any(old['final']['budgets'].values())
        counts['factories']=15
    elif mode == 'limits':
        assert len(body['runs'])==33 and body['getters']==0
        for row in body['runs']:
            if 'ceiling' in row:
                assert row['ceiling'] in (0,1,16,63,64)
                assert len(row['operations'])==row['ceiling']+1
                for n, op in enumerate(row['operations']):
                    assert op['result']['ok']==(n<row['ceiling'])
                    if n==row['ceiling']:
                        assert op['before']==op['after'] and op['result']['error']['code']=='limit-exceeded'
                assert not any(row['final']['budgets'].values())
            elif row['kind'] in ('invalid-limit','old-ceiling'):
                assert row['result']['error']['code']=='invalid-input'
            elif row['kind']=='inherited-refusal':
                assert row['result']['ok'] is False and row['before']==row['after']
            elif row['kind']=='allocation-failure':
                assert row['result']['error']['code']=='backend-error' and row['before']==row['after'] and row['calls']['calls']==1
            elif row['kind']=='inherited-accounting':
                assert all(r['error']['code']=='limit-exceeded' for r in row['refusals'].values())
        counts['limits']=33
    else:
        assert len(body['runs'])==(2 if mode=='fault-count' else 1)
        for i,row in enumerate(body['runs']):
            assert len(row['planes'])==64
            counts['nativeBytes'] += native_planes(row['planes'],body['seed'])
            assert row['baselinePassed'] is True and row['fences'][0]['completed'] is True
            assert not any(row['final']['budgets'].values())
            if mode=='fault-count' and i==1:
                assert row['overflow']['result']['ok'] is True
                assert row['overflow']['after']['calls']==65 and row['nativeCalls']['calls']==65
                assert report['browserResult']['error']['message'].startswith('resource65 refused:')
            elif mode=='fault-bytes':
                assert len(row['fences'])==2 and row['fences'][0]['sequence']!=row['fences'][1]['sequence']
                differences=[]
                for plane in row['corruptPlanes']:
                    expected=[(plane['id']*17+j*29+(body['seed']>>8))&255 for j in range(128)]
                    assert plane['input']==expected
                    differences.extend((plane['id'],j,expect,actual) for j,(expect,actual) in enumerate(zip(expected,plane['observed'])) if expect!=actual)
                assert len(differences)==1 and differences[0][:2]==(1032,17)
                assert differences[0][2]^differences[0][3]==128
                assert report['browserResult']['error']['message'].startswith('independent original native bytes for resource 1032:')
            else:
                assert row['overflow']['result']['error']['code']=='limit-exceeded' and row['overflow']['before']==row['overflow']['after']
                order=list(range(1000,1064));rng=body['seed'] & 0xffffffff
                for at in range(63,0,-1):
                    rng=(rng ^ (rng << 13)) & 0xffffffff
                    rng=(rng ^ (rng >> 17)) & 0xffffffff
                    rng=(rng ^ (rng << 5)) & 0xffffffff
                    selected=rng % (at+1);order[at],order[selected]=order[selected],order[at]
                assert row['unrefOrder']==order and row['read']['resource']==order[0]
                for key in ('hidden','readRetained'):
                    assert row[key]['result']['error']['code']=='limit-exceeded' and row[key]['state']['budgets']['resources']==64
                    assert row[key]['state']['budgets']['gpuBytes']==64*128+128
                    assert all(res['public'] is False for res in row[key]['state']['resources'])
                assert row['hidden']['state']['budgets']['leases']==64
                assert row['readRetained']['state']['budgets']['leases']==63
                assert row['read']['polls'][-1]['status']=='ready'
                first=row['read']['resource']
                before=next(p for p in row['planes'] if p['id']==first)
                assert row['reused']['oldGeneration']==before['generation']
                assert row['reused']['newResource']['id']==first and row['reused']['newResource']['generation']!=before['generation']
                assert row['reused']['state']['budgets']['resources']==64
                assert row['reused']['state']['budgets']['gpuBytes']==64*128
                assert len(row['remaining'])==63 and {p['id'] for p in row['remaining']}=={p['id'] for p in row['planes']}-{first}
                counts['nativeBytes'] += native_planes(row['remaining'],body['seed'])
                assert row['nativeCalls']=={'calls':65,'destroyed':65}
                assert row['revokedRelease']['ok'] is True
    return report, counts


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--fresh',type=Path)
    args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
    bodies,indexed=authenticate(ROOT/'evidence/virgl-resource-capacity/worker')
    citations=[]
    models={name:original(name) for name in ('compositor','glmark2-es2','kmscube')}
    assert [models[n]['overflow'] for n in models]==[454,463,None]
    assert [models[n]['peak'] for n in models]==[24,35,4]
    assert len(models['compositor']['calls'])==56 and len(models['kmscube']['calls'])==8
    current_waivers=[]
    for name,raw in bodies.items():
        if name.startswith('source/'):
            source=name.removeprefix('source/')
            assert raw==git('show',FROZEN+':'+source),source
            if (ROOT/source).read_bytes()!=raw:
                if source=='Makefile':
                    suffix=b'\n.PHONY: verify-E6-T11d50-critic\nverify-E6-T11d50-critic:\n\tbash tools/virgl-resource-capacity/critic.sh\n'
                    assert (ROOT/source).read_bytes()==raw+suffix
                    current_waivers.append(source+': exact appended critic target; original acceptance unchanged')
                else:
                    assert source=='tasks/epic-6-transcendence/E6-T11d50-resource-capacity.md'
                    current_waivers.append(source+': submission/verdict log; no runtime input')
        elif '/predecessor-source/' in name:
            source=name.split('/predecessor-source/',1)[1]
            assert raw==git('show',BASE+':'+source),source
    assert (ROOT/SOURCE).read_bytes()==git('show',FROZEN+':'+SOURCE)
    carried_count=0;dependency_seals=[]
    for prefix in ('hot','cold'):
        receipt=json.loads(bodies[prefix+'/receipt.json'])
        assert receipt['gitHead']==FROZEN and receipt['status']=='passed'
        for source,digest in receipt['sources'].items():
            assert sha(bodies['source/'+source])==digest
        for name,digest in receipt['files'].items():
            assert sha(bodies[prefix+'/'+name])==digest,(prefix,name)
        for source,digest in receipt['carriedSources'].items():
            raw=(ROOT/source).read_bytes()
            assert sha(raw)==digest and raw==git('show',BASE+':'+source)
        carried_count=len(receipt['carriedSources'])
        for source,digest in receipt['dependencyIndexes'].items():
            raw=bodies['predecessor-index/'+source]
            assert sha(raw)==digest and raw==(ROOT/source).read_bytes()==git('show',BASE+':'+source)
        for source,digest in receipt['carriedGenerated'].items():
            previous=json.loads(bodies['predecessor-index/evidence/virgl-shadow-samplers/worker/records.json'])
            records={r['path']:r for r in previous['records']}
            assert records['hot-generated/'+source]['sha256']==records['cold-generated/'+source]['sha256']==digest
            if (ROOT/source).exists():assert sha((ROOT/source).read_bytes())==digest
    for role in ('worker','verifier'):
        directory=ROOT/'evidence/virgl-shadow-samplers'/role
        manifest=json.loads((directory/'manifest.json').read_bytes())
        assert sha((directory/'records.json').read_bytes())==manifest['recordIndexSha256']
        h=hashlib.sha256();size=0
        for part in manifest['archiveParts']:
            raw=(directory/part['path']).read_bytes()
            assert len(raw)==part['bytes'] and sha(raw)==part['sha256']
            h.update(raw);size+=len(raw)
        assert h.hexdigest()==manifest['archiveSha256'] and size==manifest['archiveBytes']
        dependency_seals.append(dict(role=role,manifestSha256=sha((directory/'manifest.json').read_bytes()),indexSha256=sha((directory/'records.json').read_bytes()),archiveSha256=h.hexdigest(),logicalBodies=manifest['records']))
    cold=json.loads(bodies['cold/report.json'])
    assert cold['status']=='passed' and cold['gitHead']==cold['cloneHead']==FROZEN
    assert cold['statusBefore']==cold['statusAfter']=='' and cold['exitCode']==0
    assert sha(bodies['cold/receipt.json'])==cold['receiptSha256'] and sha(bodies['cold/cold.log'])==cold['logSha256']
    clone=Path(cold['clone'])
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==FROZEN
    assert subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=clone,text=True)==''
    source=(ROOT/SOURCE).read_text();scripts=[];reports={};totals={}
    for prefix in ('hot','cold'):
        for name in ('hardware-replay','hardware-limits','hardware-historical','hardware-lifetime-0x501bc239','hardware-lifetime-0x98ef03a7','hardware-lifetime-0xdd31658b','fault-count','fault-bytes'):
            key=prefix+'/'+name+'/report.json';mode=name.removeprefix('hardware-').split('-0x')[0]
            report,counts=report_check(bodies[key],mode,models)
            assert report['gitHead']==FROZEN
            for label in ('browserCoverage','screenshot'):
                assert sha(bodies[prefix+'/'+name+'/'+report[label]['path']])==report[label]['sha256']
            for entry in report['sources']:
                path=prefix+'/'+name+'/source/'+entry['path'];assert sha(bodies[path])==entry['sha256']
                assert bodies[path]==git('show',FROZEN+':'+entry['path'])
            for served in report['servedFiles']:
                path=served['path']
                if path.startswith('/predecessor/'):
                    raw=bodies[prefix+'/'+name+'/predecessor-source/'+path.removeprefix('/predecessor/')]
                elif path.startswith('/fault/'):
                    source_name=path.removeprefix('/fault/')
                    raw=bodies[prefix+'/'+name+'/source/'+source_name]
                    if source_name==SOURCE:
                        raw=raw.replace(b'live.size < limits.resources',b'live.size <= limits.resources')
                elif path.startswith('/renderer/'):
                    raw=bodies[prefix+'/'+name+'/source/'+path.removeprefix('/')]
                elif path=='/inputs.json':
                    raw=bodies[prefix+'/'+name+'/inputs.json']
                    inputs=json.loads(raw)
                    for workload in inputs['workloads']:
                        model=models[workload['name']]
                        assert workload['expectedPeak']==model['peak'] and workload['bootstrap2D']==model['bootstrap']
                        assert [c for c in workload['calls'] if c['enter']['resourceId']!=2]==model['calls']
                        assert [c for c in workload['calls'] if c['enter']['resourceId']==2]==[model['bootstrap']]
                else:
                    assert path=='/'
                    continue
                assert len(raw)==served['bytes'] and sha(raw)==served['sha256'],(prefix,name,path)
            if not mode.startswith('fault-'):
                coverage=json.loads(bodies[prefix+'/'+name+'/browser-coverage.json'])
                assert coverage['sourceBody']==source
                script=[s for s in coverage['scripts'] if s['url'].endswith('/'+SOURCE) and '/predecessor/' not in s['url']]
                assert len(script)==1;scripts.append((prefix+'/'+name+'/browser-coverage.json',script[0]))
            reports[key]=counts;citations.append(dict(body=key,sha256=sha(bodies[key]),counts=counts))
        inherited=json.loads(bodies[prefix+'/inherited-resources/receipt.json'])
        assert inherited['status']=='passed' and inherited['gitHead']==FROZEN
        for name,status in (('decoder','passed'),('hardware','passed'),('sabotage-texture-texel','failed'),('sabotage-index-byte','failed')):
            record=json.loads(bodies[prefix+'/inherited-resources/'+name+'/report.json']);assert record['status']==status
            if name=='hardware':
                served=[r for r in record['servedFiles'] if r['path']=='/renderer/virgl-command/unorm-depth-images.mjs']
                assert len(served)==1 and served[0]['sha256']==sha(bodies['source/renderer/virgl-command/unorm-depth-images.mjs'])
        endpoint='source/renderer/virgl-command/unorm-depth-images.mjs'
        assert bodies[endpoint]==git('show',BASE+':renderer/virgl-command/unorm-depth-images.mjs')
    changed=set()
    diff=git('diff','--unified=0',BASE,FROZEN,'--',SOURCE).decode()
    for match in re.finditer(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',diff,re.M):
        first,count=int(match[1]),int(match[2] or 1);changed.update(range(first,first+count))
    offset=0;coverage_rows=[]
    for number,line in enumerate(source.splitlines(keepends=True),1):
        start=offset;offset+=len(line.encode('utf-16-le'))//2
        if number not in changed:continue
        if not line.strip() or line.lstrip().startswith(('//','/*','*')) or line.strip()=='}':
            coverage_rows.append(dict(line=number,verdict='waived',reason='Only comment, whitespace or closing delimiter.'));continue
        points=[]
        for i,char in enumerate(line):
            if char.isspace() or char in '{};,':continue
            at=start+len(line[:i].encode('utf-16-le'))//2;witness=None
            for key,script in scripts:
                ranges=[r for f in script['functions'] for r in f['ranges'] if r['startOffset']<=at<r['endOffset']]
                smallest=min(r['endOffset']-r['startOffset'] for r in ranges)
                ranges=[r for r in ranges if r['endOffset']-r['startOffset']==smallest]
                if all(r['count']>0 for r in ranges):witness=dict(offset=at,body=key,sha256=sha(bodies[key]),ranges=ranges);break
            assert witness is not None,(number,at);points.append(witness)
        coverage_rows.append(dict(line=number,verdict='executed',operands=points))
    assert sum(r['verdict']=='executed' for r in coverage_rows)==9
    assert sum(r['verdict']=='waived' for r in coverage_rows)==5
    fresh={}
    if args.fresh:
        for folder in sorted(args.fresh.glob('*/report.json')):
            if folder.parent.name=='novel':continue
            mode=folder.parent.name.split('-0x')[0];report,counts=report_check(folder.read_bytes(),mode,models)
            for entry in report['sources']:
                raw=(folder.parent/'source'/entry['path']).read_bytes()
                assert raw==(ROOT/entry['path']).read_bytes() and sha(raw)==entry['sha256']
            for entry in report['predecessorSources']:
                raw=(folder.parent/'predecessor-source'/entry['path']).read_bytes()
                assert raw==git('show',BASE+':'+entry['path']) and sha(raw)==entry['sha256']
            for key in ('browserCoverage','screenshot'):
                assert sha((folder.parent/report[key]['path']).read_bytes())==report[key]['sha256']
            fresh[folder.parent.name]=dict(sha256=sha(folder.read_bytes()),counts=counts)
        novel_path=args.fresh/'novel/report.json'
        if novel_path.exists():
            novel=json.loads(novel_path.read_bytes());body=novel['browserResult']
            assert novel['status']==body['status']=='passed' and len(body['steps'])==24
            assert novel['browserErrors']=={'console':[],'page':[],'requests':[]}
            assert body['oldGeneration']!=body['newGeneration'] and body['nativeCalls']=={'calls':5,'destroyed':4}
            assert not any(body['final']['budgets'].values())
            assert len(body['nativePlanes'])==2
            for plane,length,base,multiplier in zip(body['nativePlanes'],(128,256),(0x71,0xc3),(61,37)):
                expected=[(base+multiplier*j)&255 for j in range(length)]
                assert plane['input']==plane['observed']==expected
            for entry in novel['sources']:
                raw=(novel_path.parent/'source'/entry['path']).read_bytes()
                assert raw==(ROOT/entry['path']).read_bytes() and sha(raw)==entry['sha256']
            for fence in body['fences']:
                assert fence['completed'] and fence['polls'][-1] in (37146,37148)
            fresh['novel']=dict(sha256=sha(novel_path.read_bytes()),steps=24,nativeBytes=384,nativeCalls=body['nativeCalls'])
    result=dict(schema='resource-capacity-independent-critic-v1',task='E6-T11d50',verdict='held',workerPins=PINS,
                authenticatedLogicalBodies=642,sourceHead=FROZEN,carriedSources=carried_count,dependencySeals=dependency_seals,
                currentSourceWaivers=current_waivers,cold=dict(head=FROZEN,clone=str(clone),cleanBefore=True,cleanAfter=True,reportSha256=sha(bodies['cold/report.json'])),
                originalModels={n:{k:v for k,v in model.items() if k not in ('calls','bootstrap')} for n,model in models.items()},
                reports=reports,citations=citations,coverage=coverage_rows,fresh=fresh)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(authenticatedLogicalBodies=642,carriedSources=carried_count,originalModels=result['originalModels'],fresh=fresh,changedRuntimeLines=9,waivers=5)))


if __name__=='__main__':main()
