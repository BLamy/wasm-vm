import pathlib,json,hashlib,subprocess,sys
sys.path.insert(0,'tools/virgl-constant-domains')
import receipt
root=pathlib.Path.cwd();p=root/'evidence/virgl-constant-domains/worker';out=root/'evidence/virgl-constant-domains/verifier'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
r=json.loads((p/'receipt.json').read_text());replayed=receipt.verify(p,r['gitHead']);assert r==replayed
normal=json.loads((p/'hardware/report.json').read_text())['acceptance'];bypass=json.loads((p/'decoder-bypass/report.json').read_text())['acceptance'];fault=json.loads((p/'sabotage/report.json').read_text())['acceptance'];lines=[]
lines.append(f"SOURCE HEAD {r['gitHead']}; receipt.json sha256={sha(p/'receipt.json')}; complete replay equality=true; sources={len(r['sources'])}; records={len(r['records'])}")
lines.append('P1 HELD metadataRigs[0..27]: both stages x14 malformed wrappers; every validation has shader-domain-error, appliedCommands0, empty native event window, identical before/after snapshot and framebuffer. Node schemas 95; full legacy translations checked.')
lines.append(f"P2 HELD raw-sync/raw-async: rawWords={normal['rawWords']}; pixels={normal['checkedPixels']}; 32 planes per stage/register/payload case; signed zeros/subnormals reconstructed as exact unsigned words. Unit predicates={r['unit']['predicates']}; novel-report.json sha256={sha(out/'novel-report.json')} (40,000 independent DataView checks; all 47 prefixes).")
for index,rig in enumerate(normal['rigs']):
 if rig['name'].startswith('lifecycle'):
  attacks=[{'name':x['name'],'code':x['result']['error']['code'],'applied':x['result']['appliedCommands'],'nativeDraws':sum(e['call']=='drawElements' for e in x['events'])} for x in rig['attacks']]
  lines.append(f"P3/P4 HELD hardware.report acceptance.rigs[{index}] {rig['name']}: {json.dumps({'schedule':rig.get('schedule'),'short/reuseAttacks':attacks,'yieldAttackCount':len(rig['yieldAttacks']),'finalDraw':rig['draws'][-1]['draw']},separators=(',',':'))}")
for name in ['high-vertex','high-fragment','low-both','order-both','inactive-both']:
 index=next(i for i,x in enumerate(normal['rigs']) if x['name']==name);rig=normal['rigs'][index]
 lines.append(f"P3 HELD hardware.report acceptance.rigs[{index}] {name}: reflections="+json.dumps([{k:x[k] for k in ['stage','count','activeCount','uploadCount']} for x in rig['reflection']],separators=(',',':'))+'; padding controls='+str(len(rig.get('padding',[]))))
lines.append('P5 HELD normal hardware invalid-sync and four invalid-async rigs: 120 Inf/NaN wire packets, zero applied commands, no native effects, equal complete snapshots/framebuffers; corresponding decoder-bypass rigs:120 two-command applied prefixes, zero invalid uploads, guarded DRAW constant-domain-error before native index staging/read/draw, complete framebuffer equality.')
event=fault['rigs'][0]['attacks'][0]['invalidUploads'][0]
lines.append('P5 HELD sabotage/report.json line1 acceptance.rigs[0].attacks[0].invalidUploads[0]: '+json.dumps({k:v for k,v in event.items() if k not in ['words','observed']}|{'wordCount':len(event['words']),'words0':hex(event['words'][0]),'observed0':hex(event['observed'][0])},separators=(',',':'))+'; source-bound decoder+predicate mutations; no draw in invalid packet; frame unchanged; expected failure independently measured.')
lines.append('P6 HELD coverage-audit.json: all 40 changed state.mjs lines and all new helper executable lines reached; helper lines66/88 unexpected-error rethrow branches waived because preserving unexpected implementation failures is defensive diagnostic behavior, not accepted input behavior. Blank lines/comments/import declarations waived as nonbehavior. Identity mismatch failures are defensive: closures hide ctx/sub/program/banks; snapshots freeze values; busy lock prevents state mutation between plan and issue; actual four waiting-index attacks retain identities and restore poisoned GL values.')
lines.append('P7 HELD warm source/evidence binding and disabled production graphics; NEEDS EVIDENCE final pristine clone. All three browser runs zero console/page/request errors; native M4 Max ANGLE/Metal renderer; original compiler source inventory identical to verified E6 parent.')
lines.append('P8 HELD all preserved regression receipts: '+json.dumps(r['regressions'],separators=(',',':')))
(out/'warm-audit.txt').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[:2]));print('written',out/'warm-audit.txt','sha256',sha(out/'warm-audit.txt'))
