from pathlib import Path
import hashlib, json

OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
def need(value, message):
    if not value: raise AssertionError(message)
def literal_index_extent(history):
    size = count = None
    for r in history:
        raw = bytes.fromhex(r['hex']); at = 0
        while at < len(raw):
            header = int.from_bytes(raw[at:at+4], 'little'); op = header & 255; words = header >> 16
            if op == 11 and words == 3: size = int.from_bytes(raw[at+8:at+12], 'little')
            if op == 8: count = int.from_bytes(raw[at+8:at+12], 'little')
            at += 4 * (words + 1)
    return size * count
facts = []
for prefix in ['hot', 'cold']:
    directory = OUT/'unpacked'/prefix
    p = directory/'hardware/report.json'; raw = p.read_bytes(); report = json.loads(raw); result = report['browserResult']['result']
    wire = json.loads((directory/'wire/report.json').read_bytes())
    need(wire['wire'] == result['wire'], prefix + ' literal Node/browser matrix differs')
    need(len(wire['wire']['records']) == 292, 'literal matrix count')
    runs = {r['history'][-1]['label']: r for r in result['runs']}
    ownership = {r['label']: r for r in result['ownership']}
    expected = {
      'short-{"shortSlot":0}': ('out-of-bounds', 0), 'short-{"shortIndex":true}': ('out-of-bounds', 0),
      'short-{"shortSlot":1}': ('out-of-bounds', 0), 'work-35': ('limit-exceeded', 0),
      'scratch-minus-one': ('limit-exceeded', 63), 'scratch-draw-65': ('limit-exceeded', 64),
      'read-minus-one': ('limit-exceeded', 0), 'nonrestart-u32-max': ('unsupported-draw', 0),
    }
    need(set(expected) == {r['label']for r in result['rejections']}, 'complete exact rejection set')
    for label, (code, draws) in expected.items():
        r = runs[label]; outcome = r['history'][-1]['result']
        need(outcome['error']['code'] == code and len(outcome['draws']) == len(r['calls']) == draws, label + ' exact rejected prefix')
        if draws == 0: need(not r['normalizationEvents'], label + ' no normalization before rejection')
    for label, (buffers, bytes_, count) in {'scratch-exact-one': (1,262144,1),'scratch-exact-64':(64,262144,64),
                                         'scratch-minus-one':(63,258048,63),'scratch-draw-65':(64,262144,64)}.items():
        r = ownership[label]; peaks = r['peaks']; outcome = r['record']['result']
        need(max(p['normalizedBuffers']for p in peaks) == buffers and max(p['normalizedBytes']for p in peaks) == bytes_, label + ' exact retained limits')
        need(all(p['normalizationScratchBytes'] == 0 for p in peaks), 'CPU scratch across yield')
        need(len(outcome['draws']) == count and sum(d['vertexWork']for d in outcome['draws']) == (64512 if count == 63 else 65536), label + ' exact original source work')
        facts.append({'prefix':prefix,'label':label,'nativeBuffers':buffers,'nativeBytes':bytes_,'draws':count,'sourceWork':sum(d['vertexWork']for d in outcome['draws']),
                      'point': 'browserResult.result.ownership['+str(result['ownership'].index(r))+']','reportSha256':sha(raw)})
    need(max(p['stagingBytes']for p in ownership['read-exact']['peaks']) == 65552, 'exact original index+generic read staging')
    need(ownership['read-minus-one']['record']['result']['error']['code'] == 'limit-exceeded' and not ownership['read-minus-one']['record']['result']['draws'], 'one-short read staging')
    for label, count in [('native-create-fails',1),('native-upload-fails',2)]:
        r = runs[label]; o = r['history'][-1]['result']; uploads = [e for e in r['normalizationEvents']if e['name']=='normalized-upload']; deletes = [e for e in r['normalizationEvents']if e['name']=='normalized-delete']
        need(o['error']['code']=='backend-error' and o['gpuComplete'] and len(o['draws'])==len(r['calls'])==1, 'actual partial native failure prefix')
        need(len(uploads)==len(deletes)==count and {e['nativeBuffer']for e in uploads} == {e['nativeBuffer']for e in deletes}, 'partial ownership released')
        if label=='native-create-fails':need([e for e in r['normalizationEvents']if e['name']=='forced-createBuffer-null']==[{'name':'forced-createBuffer-null','allocation':2}], 'explicit allocation-null is a non-byte event')
    for r in result['suspensions']:
        o = r['record']['result']; need(r['point']['inspection']['jobs']['reads']==2,'whole pending source batch retained')
        if r['action']=='reuse':need(o['ok'] and o['gpuComplete'] and r['newGeneration']>r['oldGeneration'] and o['draws'][0]['indexResourceGeneration']==r['oldGeneration'], 'old source identity despite reused public name')
        else:
            need(not o['ok'] and o['gpuComplete'] and not o['draws'] and o['error']['code']==('cancelled'if r['action']=='cancel'else'stale-storage'), 'source revision/cancel never draws')
            if r['action']=='collected-index':need(any(e['name']=='getBufferSubData' and e['bytes']==literal_index_extent(runs[r['record']['label']]['history']) for e in r['point']['events']), 'original index already collected before rejected constant completion')
    for phase in ['waiting-attributes','finishing']:
        r = ownership['owned-cancel-'+phase]; inspection = r['point']['inspection']; o = r['record']['result']
        need(inspection['status']==phase and inspection['draws']==inspection['normalizedBuffers']==1 and inspection['normalizedBytes']==36 and inspection['normalizationScratchBytes']==0, 'owned native EBO through '+phase)
        need(o['gpuComplete'] and o['error']['code']=='cancelled' and len(o['draws'])==1,'owned cancellation drains '+phase)
    r = ownership['owned-dispose']; before = r['before']['inspection']; after = r['after']['jobs']
    need(before['status']=='waiting-attributes' and before['draws']==before['normalizedBuffers']==1 and before['reads']==2,'explicit disposal with live scratch and reads')
    need(all(after[k]==0 for k in ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes']),'explicit disposal releases every owned budget')
    need(len([e for e in r['normalizationEvents']if e['name']=='normalized-delete'])==1,'explicit disposal deletes actual owned EBO')
    for run in result['runs']:
        jobs=run['inspection']['jobs']; need(all(jobs[k]==0 for k in ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes']),'all final budgets zero')
        for event in run['normalizationEvents']:
            if event['name']=='normalized-upload':need(event['inspection']['normalizationScratchBytes']==event['bytes'],'CPU scratch charged on actual GPU upload')
    frames = {f['label']:f for f in result['frames']}
    for mode in range(1,7):
        for suffix in ['custom','wide-custom','fixed-byte','fixed-short','fixed-wide','byte-maximum','short-maximum','out-of-type']:
            for delay in [0,2,5]:need('mode-'+str(mode)+'-'+suffix+'-'+str(delay)in frames,'missing mode/width/restart/schedule')
        for tail in ['edges','all','1','2','3']:need('tail-'+str(mode)+'-'+tail in frames,'missing segmentation/tail')
    empty = frames['all-custom-empty']['history'][-1]['result']['draws'][-1]
    need(empty['validIndexCount']==0 and empty['restartCount']==5 and empty['actualMinIndex']is None and empty['actualMaxIndex']is None and empty['vertexWork']==20,'all-restart charged exact source work')
    need(all(f['fetchEmpty'] and all(f[k]is None for k in ['firstElement','lastElement','firstByte','requiredEnd'])for f in empty['vertexFetches']),'explicit no-vertex original fetch report')
    need([frames[n]['native']['calls'][-1]['args'][0]for n in ['restore-A-first','restore-B','restore-A-last']]==[2,3,2],'actual A/B/A native modes restored')

    # Only directly affected D6 sentinel/fetch authority is renewed. Historical
    # old sentinel rejection remains scoped to its recorded original source.
    d6 = json.loads((directory/'retained-standard-draw/hardware/report.json').read_bytes())['browserResult']['result']
    old = {r['label']:r for r in d6['rejections']}
    need(old['fixed-sentinel-1']['result']['error']['code']==old['fixed-sentinel-2']['result']['error']['code']=='out-of-bounds','D6 legal maxima now tested as true short source')
    need(old['fixed-sentinel-4']['result']['error']['code']==old['max-native-index']['result']['error']['code']=='unsupported-draw','native maximum rejects explicitly')
    for name, count, pixels in [('constant',31,12500),('topology',87,50176)]:
        audit = json.loads((directory/('retained-'+name)/'physical-audit.json').read_bytes()); need(audit['status']=='passed' and len(audit['frames'])==count and audit['pixels']==pixels,'direct affected physical '+name)

fresh_path = OUT/'final-promoted/hardware/report.json'; fresh_raw=fresh_path.read_bytes(); fresh = json.loads(fresh_raw)['browserResult']['result']
need(fresh['status']=='passed' and fresh['seed']==0xc37a4d29,'independent seed')
for run in fresh['runs']:
    for y in run['yields']:
        need(y['inspection']['normalizationScratchBytes']==0 and len(y['owned'])==y['inspection']['normalizedBuffers'],'fresh actual yield scratch state')
        need(y['binding']is None or y['binding']not in y['owned'],'actual private native EBO detached before yield')
    need(all(run['inspection']['jobs'][k]==0 for k in ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes']),'fresh zero final ownership')
need(len({s['ticks']for s in fresh['schedules']})>3,'independently varied per-fence schedule')
need({r['action']for r in fresh['suspensions']}=={'stale-index','collected-index','cancel','reuse'},'fresh whole-batch source attacks')
for r in fresh['ownership']:
    if r['label']=='critic-all-restart-budget-65536':
        need(len(r['record']['result']['draws'])==64 and all(d['validIndexCount']==0 and d['vertexWork']==1024 for d in r['record']['result']['draws']),'exact all-restart source work counted')
    if r['label']=='critic-all-restart-budget-65535':need(r['record']['result']['error']['code']=='limit-exceeded' and len(r['record']['result']['draws'])==63,'one-short all-restart work rejects suffix')
fault_path=OUT/'final-promoted/fault-restart/report.json'; fault_raw=fault_path.read_bytes(); fault=json.loads(fault_raw); frame=fault['partial']['frames'][0]
need(len(frame['native']['calls'])==1 and frame['native']['calls'][0]['name']=='drawElementsInstanced' and frame['history'][-1]['result']['ok'] and frame['history'][-1]['result']['gpuComplete'],'promoted sabotage completes actual native draw and final fence')
need(not frame['audit']['held'] and 'promoted independent restart pixel oracle' in fault['browserResult']['error']['message'],'promoted pixel oracle sensitive to real served mutation')
fresh_poll=fresh['runs'][0]['events']; fault_poll=frame['native']['events'];
need(any(e['name']=='clientWaitSync' and e['actual']in[37146,37148]for e in fault_poll),'promoted sabotage real fence signal')
result={'schema':'standard-restart-fresh-boundary-audit-v1','status':'passed','exactBounds':facts,
        'nodeBrowserLiteralMatrices':2,'workerSourceRejectionsPerRun':8,'workerPendingAttacksPerRun':4,'workerOwnershipScenariosPerRun':11,
        'freshFrames':len(fresh['frames']),'freshPixels':sum(f['width']*f['height']for f in fresh['frames']),'freshRuns':len(fresh['runs']),
        'freshActualYieldPoints':sum(len(r['yields'])for r in fresh['runs']),'freshScheduleDelayValues':sorted({s['ticks']for s in fresh['schedules']}),
        'freshReportSha256':sha(fresh_raw),'promotedFaultSha256':sha(fault_raw),'promotedFaultFirstMiss':frame['audit']['misses'][0],
        'carryReason':'D6/D7/D8 historical HELD results retain original source/digest scopes. Changed D6 u8/u16 sentinel rejection authority is renewed by actual one-byte-short failures; new legal maximum behavior is proven by D9 full GPU bytes/pixels. No compiler/resource/cache/constant/link boundary changed; no provoking or production authority is granted.'}
(OUT/'boundary-audit.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps({k:result[k]for k in ['status','freshFrames','freshPixels','freshRuns','freshActualYieldPoints','freshScheduleDelayValues','promotedFaultFirstMiss']}))
