#!/usr/bin/env python3
"""Independently authenticate original lifetimes and completed native byte records."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SEEDS = ['0x501bc239', '0x98ef03a7', '0xdd31658b']
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def planes(rows, seed):
    count = 0
    for row in rows:
        expected = [(row['id'] * 17 + j * 29 + (seed >> 8)) & 255 for j in range(128)]
        assert row['input'] == expected and row['observed'] == expected, row['id']
        count += len(expected)
    return count


def original_calls(name):
    directory = ROOT/'evidence/virgl-corpus/captures'/name
    manifest = json.loads((directory/'manifest.json').read_text())
    raw = (directory/manifest['events']['path']).read_bytes()
    assert sha(raw) == manifest['events']['sha256'] and len(raw) == manifest['events']['bytes']
    pending, calls = {}, []
    for event in map(json.loads, raw.decode().splitlines()):
        if event['type'] not in {'resource_create', 'resource_unref'}:
            continue
        if event['phase'] == 'enter':
            assert event['seq'] not in pending
            pending[event['seq']] = event
        else:
            enter = pending.pop(event['callSeq'])
            assert enter['type'] == event['type'] and event['result'] == 0
            calls.append(dict(enter=enter, returned=event))
    assert not pending
    bootstrap = [c for c in calls if c['enter'].get('flags', 0)]
    assert len(bootstrap) == 1
    enter = bootstrap[0]['enter']
    assert (enter['seq'], enter['resourceId'], enter['target'], enter['format'], enter['flags'], enter['iovCount']) == (10, 2, 2, 2, 1, 0)
    return [c for c in calls if c['enter']['resourceId'] != 2], bootstrap[0]


def main(directory):
    directory = Path(directory).resolve()
    names = ['hardware-replay', 'hardware-limits', 'hardware-historical'] + ['hardware-lifetime-'+s for s in SEEDS] + ['fault-count', 'fault-bytes']
    counts = dict(originalCalls=0, historicalFactories=0, limitCases=0, nativeBytes=0, completedFences=0)
    reports, head = {}, None
    for name in names:
        raw = (directory/name/'report.json').read_bytes()
        report = json.loads(raw)
        head = head or report['gitHead']
        assert report['gitHead'] == head and report['task'] == 'E6-T11d50'
        assert report['status'] == ('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        browser = report['browser']
        assert not browser['headless'] and browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled'
        assert sha(Path(browser['executable']).read_bytes()) == browser['sha256']
        assert not any(any(w in a.lower() for w in ('swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu')) for a in browser['commandLine'])
        body = report['browserResult'].get('result') or report['browserResult']['partial']
        assert 'Metal' in body['gpu'] and 'M4' in body['gpu']
        assert not body['guestExecution'] and not body['productionAuthority']
        for key in ('browserCoverage', 'screenshot'):
            assert sha((directory/name/report[key]['path']).read_bytes()) == report[key]['sha256']
        served = {r['path']:r for r in report['servedFiles']}
        for source in report['sources']:
            assert sha((ROOT/source['path']).read_bytes()) == source['sha256']
            assert (ROOT/source['path']).read_bytes() == (directory/name/'source'/source['path']).read_bytes()
            if '/'+source['path'] in served:
                assert served['/'+source['path']]['sha256'] == source['sha256']
        for row in body['fences']:
            assert row['completed'] and row['polls'][-1] in {37146, 37148} and all(p in {37146, 37147, 37148} for p in row['polls'])
        assert [r['sequence'] for r in body['fences']] == list(range(1, len(body['fences'])+1))
        counts['completedFences'] += len(body['fences'])
        if name == 'hardware-replay':
            assert len(body['runs']) == 6
            for row in body['runs']:
                calls, bootstrap = original_calls(row['workload'])
                assert row['bootstrap2D'] == bootstrap
                expected_failure = (454 if row['workload']=='compositor' else 463) if row['historical'] and row['workload']!='kmscube' else 3025 if row['workload']=='glmark2-es2' else None
                model, peak = {}, 0
                for i, operation in enumerate(row['operations']):
                    assert {k:operation[k] for k in ['enter','returned']} == calls[i]
                    event = operation['enter']
                    result = operation['result']
                    if result['ok']:
                        if event['type']=='resource_create':
                            assert event['resourceId'] not in model
                            assert event['lastLevel']==0 and event['depth']==event['arraySize']==1
                            assert event['target']==0 and event['format']==64 or event['target']==2 and event['format'] in {1,2,20,67}
                            gpu = 0 if event['bind']==524288 else event['width'] if event['target']==0 else event['width']*event['height']*4
                            model[event['resourceId']] = gpu
                            peak=max(peak,len(model))
                        else:
                            model.pop(event['resourceId'])
                    else:
                        assert event['seq']==expected_failure and i==len(row['operations'])-1
                        assert operation['allocationCallsAfter']==operation['allocationCallsBefore']
                    assert operation['after']['budgets']['resources']==len(model)
                    assert operation['after']['budgets']['gpuBytes']==sum(model.values())
                assert row['peak']==peak
                if expected_failure is None:
                    assert len(row['operations'])==len(calls) and row['failure'] is None
                else:
                    assert row['failure']['enter']['seq']==expected_failure
                    assert row['failure']['result']['error']['code']==('unsupported-resource' if expected_failure==3025 else 'limit-exceeded')
                assert all(v==0 for v in row['final']['budgets'].values())
                counts['originalCalls'] += len(row['operations'])
        elif name == 'hardware-historical':
            assert len(body['runs'])==15
            for row in body['runs']:
                assert row['current']==row['predecessor']
                assert row['current']['defaults']['limits']['resources']==16
                assert [x['ok'] for x in row['current']['operations']]==[True]*16+[False]
            counts['historicalFactories']=15
        elif name == 'hardware-limits':
            assert body['getters']==0 and len(body['runs'])==33
            counts['limitCases']=33
        else:
            seed=body['seed']
            rows=body['runs']
            for i,row in enumerate(rows):
                counts['nativeBytes'] += planes(row['planes'],seed)
                assert row['baselinePassed'] and row['fences'][0]['completed']
                if name=='fault-count' and i==1:
                    assert row['overflow']['result']['ok'] and row['overflow']['after']['calls']==65
                    assert 'resource65 refused' in report['browserResult']['error']['message']
                elif name=='fault-bytes':
                    assert row['fences'][0]['sequence'] != row['fences'][1]['sequence'] and row['fences'][1]['completed']
                    differences=[(r['id'],j,a,b) for r in row['corruptPlanes'] for j,(a,b) in enumerate(zip(r['input'],r['observed'])) if a!=b]
                    assert len(differences)==1 and differences[0][0:2]==(1032,17) and differences[0][2]^differences[0][3]==128
                    assert 'independent original native bytes for resource 1032' in report['browserResult']['error']['message']
                else:
                    assert not row['overflow']['result']['ok'] and row['overflow']['before']==row['overflow']['after']
                    assert row['hidden']['state']['budgets']['resources']==64 and not row['hidden']['result']['ok']
                    assert row['readRetained']['state']['budgets']['resources']==64 and not row['readRetained']['result']['ok']
                    assert row['read']['polls'][-1]['status']=='ready'
                    assert row['reused']['oldGeneration']!=row['reused']['newResource']['generation']
                    assert row['reused']['state']['budgets']['resources']==64
                    counts['nativeBytes'] += planes(row['remaining'],seed)
                assert all(v==0 for v in row['final']['budgets'].values())
        reports[name] = dict(sha256=sha(raw),status=report['status'])
    inherited=json.loads((directory/'inherited-resources/receipt.json').read_text())
    assert inherited['status']=='passed' and inherited['gitHead']==head
    result=dict(schema='resource-capacity-audit-v1',task='E6-T11d50',status='passed',gitHead=head,reports=reports,counts=counts,inheritedReceiptSha256=sha((directory/'inherited-resources/receipt.json').read_bytes()),guestExecution=False,productionAuthority=False)
    (directory/'values-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(counts))


if __name__=='__main__':
    main(sys.argv[1])
