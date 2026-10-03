#!/usr/bin/env python3
import hashlib,json
from pathlib import Path
root=Path.cwd();p=root/'evidence/virgl-scanout/worker/kernel-network-diagnostic';out=root/'evidence/virgl-scanout/verifier';h=lambda b:hashlib.sha256(b).hexdigest();r=json.loads((p/'report.json').read_text());checks=[]
def check(label,value):
 assert value,label
 checks.append(label)
check('recorded same diagnostic source',h((p/'repro.mjs').read_bytes())==r['inputs']['harnessSha256'])
loader=(root/r['inputs']['loader']['path']).read_bytes();check('same frozen desktop loader',h(loader)==r['inputs']['loader']['sha256'])
s=loader.decode();start=s.index('async function fetchWithProgress(');end=s.index('\n/** Fetch a text resource',start);check('exact production stream function',h(s[start:end].strip().encode())==r['inputs']['fetchFunctionSha256'])
k=(root/'releases/kernel/6.6.63/Image').read_bytes();check('same complete kernel',len(k)==24208896 and h(k)==r['inputs']['kernel']['sha256']=='af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce')
check('12 fresh bounded comparisons',len(r['cases'])==12 and len({x['label'] for x in r['cases']})==12)
for c in r['cases']:
 label=c['label'];a=c['application']['result'];response=c['response'];terminal=c['terminal'];serverId=response['headers']['x-diagnostic-request-id'];server=next(e for e in r['events'] if e['kind']=='server-request' and e['requestId']==serverId)
 check(label+' exact application bytes and EOF',a==dict(bytes=24208896,sha256=h(k),reachedEof=True))
 check(label+' same response identity',response['requestId']==terminal['requestId'] and response['status']==200 and response['headers']['cache-control']==c['policy'])
 check(label+' served same immutable bytes',server['bytes']==24208896 and server['sha256']==h(k) and server['responseHeaders']['Cache-Control']==c['policy'])
 check(label+' server finished body',any(e['kind']=='server-finish' and e['requestId']==serverId and e['writableFinished'] for e in r['events']))
 check(label+' fresh disabled cache no app errors',c['cacheDisabled'] and c['freshContext'] and not c['errors'] and (c['location']!='worker' or c['cdpSetup']))
 if c['policy']=='no-cache':check(label+' normal terminal',terminal['event']=='requestfinished' and terminal['failure'] is None)
 elif terminal['event']=='requestfailed':check(label+' bounded known terminal',terminal['failure']=={'errorText':'net::ERR_ABORTED'})
check('local worker failure reproduced',r['status']=='reproduced' and r['summary']==dict(total=12,fullBytesAndHash=12,noStoreFailures=4,noCacheFailures=0,workerNoStoreFailures=2))
result=dict(status='held',classification='local streamed no-store terminal notification mismatch; not kernel consumption failure',reportSha256=h((p/'report.json').read_bytes()),checks=checks)
(out/'network-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='checks'},indent=2))
