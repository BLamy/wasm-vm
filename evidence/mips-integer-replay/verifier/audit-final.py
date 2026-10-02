"""Independent raw-record audit; no benchmark/test execution and no worker analyzer import."""
from pathlib import Path
from statistics import median
import hashlib
import json
import math
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]

def read(name):
    return json.loads((ROOT / name).read_bytes())

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def same_number(a, b):
    assert math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12), (a, b)

result = {"micro": [], "native": [], "input_sha256": {}, "artifact_checks": {}}
for batch in [1, 2]:
    name = f"micro-final-{batch}/report.json"
    doc = read(name)
    result['input_sha256'][name] = sha(ROOT/name)
    assert doc['head'] == 'ee7ed352dae84efac4a2fa867ee9aaa99ec83af2'
    assert doc['baseline']['head'] == 'a6ae84fd1c71c76ecadcff9000c40ed6319ef4b5'
    assert doc['errors'] == [] and doc['passed']
    assert sha(REPO/'tools/verify/clock-fast-path-benchmark.mjs') == doc['harnessSha256']
    assert sha(REPO/'crates/core/examples/clock_loop_probe.rs') == doc['producerSha256']
    for arm in ['baseline','candidate']:
        assert sha(ROOT/f'micro-final-{batch}'/f'native-{arm}') == doc['nativeBinaries'][arm]
        pkg = Path('/tmp/wasm-vm-mips-baseline') if arm == 'baseline' else REPO/'web/dist'
        for file, digest in doc['browserArtifacts'][arm].items():
            assert sha(pkg/file) == digest, (pkg/file, digest)
        assert sha(ROOT/f'micro-final-{batch}'/f'{arm}-guest-trace64.txt') == doc['guestTraces'][arm]['traceSha256']
    for surface, key, amount, scale in [('native','seconds',8_000_000,1),('browser','elapsedMs',None,1000)]:
        for row in doc[surface]:
            assert len(row['pairs']) == 5
            values = {'baseline': [], 'candidate': []}
            ratios = []
            for index, pair in enumerate(row['pairs']):
                expect_order = ['baseline','candidate'] if index % 2 == 0 else ['candidate','baseline']
                assert pair['pair'] == index and pair['order'] == expect_order
                assert [r['arm'] for r in pair['runs']] == expect_order
                arms = {r['arm']: r for r in pair['runs']}
                for arm, record in arms.items():
                    assert record[key] > 0
                    values[arm].append(record[key])
                    if surface == 'native':
                        assert record['retired'] == amount
                        assert record['pc'] == 0x80000000
                        assert record['xregs'][5:8] == [2_000_000,4_000_000,6_000_000]
                        if row['divider']:
                            assert record['mtime'] == amount // row['divider']
                            assert record['phase'] == amount % row['divider']
                    else:
                        count = row['config']['budget']
                        assert record['result'] == {'done':False,'state':None,'retired':count}
                        assert record['prefix'] == {'done':False,'state':None,'retired':20000}
                        assert int(record['clock']['mtime']) == (count+20000)//row['config']['divider']
                        assert int(record['phase']) == (count+20000)%row['config']['divider']
                        assert record['jit']['guestRetired'] == count+20000
                        if not row['config']['jit']:
                            assert record['jit']['retiredViaJit'] == 0
                if surface == 'native':
                    assert {k:v for k,v in arms['baseline'].items() if k not in ['seconds','arm']} == {k:v for k,v in arms['candidate'].items() if k not in ['seconds','arm']}
                else:
                    for field in ['clock','phase','cpuSha256','clintSha256','clockSha256','ramSha256']:
                        assert arms['baseline'][field] == arms['candidate'][field]
                ratios.append(arms['baseline'][key]/arms['candidate'][key])
            b, c = median(values['baseline']), median(values['candidate'])
            same_number(b/c,row['speedup'])
            count = amount if surface=='native' else row['config']['budget']
            result['micro'].append({'batch':batch,'surface':surface,'config':row.get('config',{'cached':row.get('cached'),'divider':row.get('divider')}),'ratio_of_medians':b/c,'paired_median':median(ratios),'paired_min':min(ratios),'paired_max':max(ratios),'baseline_mips':count*scale/b/1e6,'candidate_mips':count*scale/c/1e6})

native = read('native-final/native.json')
result['input_sha256']['native-final/native.json'] = sha(ROOT/'native-final/native.json')
assert len(native['records']) == 36
for case, metric, count in [('busybox-legacy','wall_s',5),('busybox-fast','wall_s',5),('compute-fast','region_s',5),('coremark-fast','region_s',3)]:
    rows = [r for r in native['records'] if r['case']==case]
    assert len(rows)==2*count
    arms={'baseline':[],'candidate':[]}
    ratios=[]
    for index in range(count):
        pair = rows[index*2:index*2+2]
        assert [r['label'] for r in pair] == (['baseline','candidate'] if index%2==0 else ['candidate','baseline'])
        assert all(r['rep']==index and r['ok'] and r['exit']==0 and r['concurrency']==1 for r in pair)
        byarm={r['label']:r for r in pair}
        for arm,r in byarm.items():
            assert r[metric]>0
            arms[arm].append(r[metric])
        if case.startswith('busybox'):
            assert byarm['baseline']['retired']==byarm['candidate']['retired']
            assert byarm['baseline']['cmd'][1:]==byarm['candidate']['cmd'][1:]
            assert '--fixed-rtc-ns' in byarm['baseline']['cmd']
        if case=='compute-fast':
            assert all(r['iterations']==10000 and r['match'][0]=='10000' for r in pair)
        if case=='coremark-fast':
            assert all(r['match']==['0'] for r in pair)
        ratios.append(byarm['baseline'][metric]/byarm['candidate'][metric])
    b,c=median(arms['baseline']),median(arms['candidate'])
    for arm,value in [('baseline',b),('candidate',c)]:
        same_number(value,native['summary'][case][arm][metric])
    assert c/b<=1.05 and 1/median(ratios)<=1.05
    result['native'].append({'case':case,'metric':metric,'pairs':count,'baseline_median':b,'candidate_median':c,'ratio_of_medians':b/c,'paired_median':median(ratios),'candidate_time_change_percent':(c/b-1)*100,'paired_ratios':ratios})
for arm,record in native['meta']['bins'].items():
    assert sha(record['path'])==record['sha256']
    result['artifact_checks'][f'native_{arm}']=record['sha256']

frozen = read('frozen.json')
for file, digest in frozen['sha256'].items():
    assert sha(REPO/file)==digest,(file,digest)
result['artifact_checks']['frozen_sources_and_builds']='all matched'
diag=read('gates/diagnostics.json')
for file in diag['preexistingFailureFilesMatchParent']:
    parent=subprocess.check_output(['git','show',f'a6ae84fd:{file}'],cwd=REPO)
    assert parent==(REPO/file).read_bytes(),file
result['artifact_checks']['preexisting_failure_files']='all five byte-identical to parent'
text=(ROOT/'gates/affected-native-tests.log').read_text()
counts=[tuple(map(int,m)) for m in re.findall(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',text)]
assert len(counts)==248
assert tuple(map(sum,zip(*counts)))==(1294,1,16)
result['gate_counts']={'passed':1294,'failed_preexisting':1,'ignored':16,'summaries':248}
accept=(ROOT/'gates/frozen-acceptance.log').read_text()
acceptcounts=[tuple(map(int,m)) for m in re.findall(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',accept)]
assert acceptcounts==[(5,0,0),(2,0,0),(5,0,0)],acceptcounts
result['frozen_acceptance']={'native':7,'wasm':5,'failed':0}

browser=read('browser-final/browser.json')
result['browser_records_current']=len(browser['records'])
result['browser_complete']=len(browser['records'])==20
if result['browser_complete']:
    result['input_sha256']['browser-final/browser.json']=sha(ROOT/'browser-final/browser.json')
    result['browser']=[]
    result['browser_console_errors']=[{'case':r['case'],'label':r['label'],'rep':r['rep'],'errors':r['consoleErrors']} for r in browser['records'] if r['consoleErrors']]
    for case in ['busybox-jit','busybox-nojit']:
        rows=[r for r in browser['records'] if r['case']==case]
        assert len(rows)==10
        for metric in ['readyMs','regionMs']:
            arms={'baseline':[],'candidate':[]};ratios=[]
            for i in range(5):
                pair=rows[2*i:2*i+2]
                assert [r['label'] for r in pair]==(['baseline','candidate'] if i%2==0 else ['candidate','baseline'])
                assert all(r['rep']==i and r['ok'] and r['bootOk'] and r['echoed'] for r in pair)
                assert all(r['backend']=='whole-machine-worker' and r['crossOriginIsolated'] for r in pair)
                byarm={r['label']:r for r in pair}
                assert byarm['baseline']['policy']==byarm['candidate']['policy']
                for arm,r in byarm.items():
                    arms[arm].append(r[metric])
                ratios.append(byarm['baseline'][metric]/byarm['candidate'][metric])
            b,c=median(arms['baseline']),median(arms['candidate'])
            assert c/b<=1.05 and 1/median(ratios)<=1.05
            result['browser'].append({'case':case,'metric':metric,'baseline_median':b,'candidate_median':c,'ratio_of_medians':b/c,'paired_median':median(ratios),'candidate_time_change_percent':(c/b-1)*100,'paired_ratios':ratios})
(ROOT/'verifier/final-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
