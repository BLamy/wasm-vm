#!/usr/bin/env python3
"""Recompute the recorded, predeclared E5.5-T03bg performance acceptance."""
import hashlib
import json
from pathlib import Path
from statistics import median

root = Path(__file__).resolve().parent
read = lambda p: json.loads((root / p).read_text())
checks = []
def check(label, held):
    checks.append({'prediction': label, 'held': bool(held)})

micro = []
for batch in (1, 2):
    report = read(f'micro-final-{batch}/report.json')
    check(f'micro {batch}: exact runtime', report['wasm']['candidate'] == read('frozen.json')['sha256']['web/dist/pkg/wasm_vm_wasm_bg.wasm'])
    check(f'micro {batch}: correctness and errors', report['passed'] and not report['errors'])
    for row in report['workloads']:
        pairs = [{r['arm']: r for r in p['runs']} for p in row['pairs']]
        a = median(p['baseline']['elapsedMs'] for p in pairs)
        b = median(p['candidate']['elapsedMs'] for p in pairs)
        ratio = a / b
        paired = median(p['baseline']['elapsedMs'] / p['candidate']['elapsedMs'] for p in pairs)
        name = row['spec']['name']
        affected = not name.endswith('control')
        check(f'micro {batch} {name}: predeclared speed budget', ratio > 1.02 and paired > 1.02 if affected else min(ratio, paired) >= 1 / 1.05)
        check(f'micro {batch} {name}: seven complete pairs', len(pairs) == 7 and all(set(p) == {'baseline', 'candidate'} for p in pairs))
        states = [r['state'] for p in pairs for r in p.values()]
        check(f'micro {batch} {name}: identical final state', all(s == states[0] for s in states))
        check(f'micro {batch} {name}: exact retired budget', all(r['result'] == {'done':False,'state':None,'retired':row['spec']['budget']} for p in pairs for r in p.values()))
        micro.append({'batch':batch,'workload':name,'baselineMips':row['spec']['budget']/a/1000,'candidateMips':row['spec']['budget']/b/1000,'speedup':ratio,'pairedSpeedup':paired})

report = read('browser-final/browser.json')
real = []
check('real: all twenty runs succeeded', len(report['records']) == 20 and all(r['ok'] and r['bootOk'] for r in report['records']))
for rec in report['records']:
    label = f"{rec['case']} {rec['label']} rep{rec['rep']}"
    check(label + ': no snapshots', rec['snapshotRequests'] == [])
    check(label + ': only identified favicon errors', len(rec['consoleErrors']) == len(rec['consoleErrorDetails']) and all(d['url'].endswith('/favicon.ico') and '404' in d['text'] for d in rec['consoleErrorDetails']) and all(e['url'].endswith('/favicon.ico') and e['status'] == 404 for e in rec['httpErrors']))
for case in ('busybox-jit','busybox-nojit'):
    rows = [r for r in report['records'] if r['case'] == case]
    pairs = [{r['label']:r for r in rows if r['rep']==i} for i in range(5)]
    check(case + ': five equal-policy pairs', all(set(p)=={'baseline','candidate'} and p['baseline']['policy']==p['candidate']['policy'] for p in pairs))
    for field in ('readyMs','regionMs'):
        a = median(p['baseline'][field] for p in pairs)
        b = median(p['candidate'][field] for p in pairs)
        paired = median(p['candidate'][field] / p['baseline'][field] for p in pairs)
        check(f'{case} {field}: <=5% time regression', b/a <= 1.05 and paired <= 1.05)
        real.append({'case':case,'phase':field,'baselineSeconds':a/1000,'candidateSeconds':b/1000,'timeRatio':b/a,'pairedTimeRatio':paired})

result = {'passed':all(c['held'] for c in checks),'planSha256':hashlib.sha256((root/'final-timing-plan.json').read_bytes()).hexdigest(),'analyzerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'micro':micro,'real':real,'checks':checks,'limitations':'Real workloads use live RTC; timed work varies. No 300 MIPS desktop or responsiveness improvement claim. All recorded samples retained.'}
(root/'performance-acceptance.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ('passed','micro','real')},indent=2))
raise SystemExit(0 if result['passed'] else 1)
