#!/usr/bin/env python3
"""Consolidate scoped findings without changing implementation or worker seals."""
from pathlib import Path
import json,hashlib,re,subprocess
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;O=ROOT/'target/evidence/virgl-known-arithmetic-critic'
sha=lambda b:hashlib.sha256(b).hexdigest()
r=json.loads((E/'coverage-audit.json').read_bytes());rows=[]
for item in r['nativeChangedLines']:
 if item['kind']!='hot':continue
 s=item['source'].strip();name=item['file'];line=item['line'];why=None
 if name.endswith('raw_bits.h'):why='Pure enum/macro/type layout declaration. Runtime flags and fixed IR/instruction sizes are independently exercised and recorded; declaration itself has no execution.'
 elif s.startswith(('#','/*','*')):why='Include, header guard or explanatory comment has no executable behavior.'
 elif s.startswith('static '):why='Function declaration/signature has no statement to execute; corresponding body regions are audited separately.'
 elif re.fullmatch(r'[{};]+',s):why='Block delimiter or empty syntax has no separate executable statement.'
 if why:rows.append({'file':name,'line':line,'status':'WAIVED','reason':why,'source':item['source']});continue
 if name.endswith('raw_known_arithmetic.h')and line in[34,35]:
  rows.append({'file':name,'line':line,'status':'NEEDS EVIDENCE','reason':'Condition executes, but the nested identity return region has count 0 in both original translation-unit instances and both hot/cold recordings.','source':item['source']});continue
 if name.endswith('bridge.c')and line==1710:
  rows.append({'file':name,'line':line,'status':'NEEDS EVIDENCE','reason':'Known wrapper runs, including discard base, but its new coordinate-base selection at columns115-142 has count 0 in both original recordings.','source':item['source']});continue
 positives=[x for x in item['regions']if x['count']>0];assert positives,(name,line,item['source'])
 rows.append({'file':name,'line':line,'status':'HELD','source':item['source'],'positiveOriginalCodeRegions':positives})
js=[]
seen=set()
for item in r['originalV8ChangedLines']:
 if item['kind']!='hot' or item['recording']!='gpu-1779033703':continue
 line=item['line'];s=item['source'].strip()
 if not s or s=='}':why='Block syntax has no separate executable behavior.'
 elif s.startswith('export const KNOWN_')or s.startswith('const KNOWN_ARITHMETIC_BASES'):why='Fixed policy constants/base-profile table, evaluated at module initialization and authenticated as source bytes.'
 else:why=None
 if why:js.append({'file':item['file'],'line':line,'status':'WAIVED','reason':why});continue
 if line in[152,156]:js.append({'file':item['file'],'line':line,'status':'NEEDS EVIDENCE','reason':'Containing function/line executes, but the new nested branch is never covered in any original browser V8 profile; semantically exercised original Node consumer has no sealed Node V8 profile.'});continue
 positives=[x for x in item['ranges']if x['count']>0];assert positives,(item['file'],line)
 js.append({'file':item['file'],'line':line,'status':'HELD','positiveOriginalV8Ranges':positives})
r['status']='needs-evidence';r['nativeLineClassification']=rows;r['javascriptLineClassification']=js
r['nestedZeroRegionClassifications']=[
 {'point':'raw_bits.c:raw_record LLVM kind0 ranges 367/388/392/402 through478','status':'WAIVED','reason':'These are earlier switch-case regions with broad source extents, not the active ADD/MUL case. The narrower ADD/MUL region430:7-446:15 has15312 hits, and fold body433:120-443:11 has4192. Zero broad regions do not refute these active instructions.'},
 {'point':'raw_known_arithmetic.h:25 and46, raw_bits.c helper instances','status':'HELD','reason':'The same source return bodies execute in the standalone integer-oracle instance of the same original executable, including zero underflow and exact cancellation. Their integration facts also use the common normal-or-zero gate and emitted zero carrier already exercised by signed-zero fixtures. Source-line execution is proven; no claim that every duplicate instantiation has the same hit counts.'},
 {'point':'raw_bits.c:819:34-828:8 (old UCMP arm)','status':'WAIVED','reason':'The UCMP arm is unchanged inherited behavior. New RAW_KNOWN_RESULT is produced only by ADD/MUL, so it cannot alter UCMP selection. Complete inherited old UCMP results and source semantics are carried from predecessor and independently compared here.'},
 {'point':'bridge.c:1655:66-93 and110-137 (old standalone discard/coordinate profile literals)','status':'WAIVED','reason':'These unchanged predecessor selectors are nested after the new known flag and retain their old successful results, independently byte-compared from original Wasm. New known flag path itself executes1564 times; new known-coordinate composition is separately flagged at1710.'}]
(E/'coverage-audit.json').write_text(json.dumps(r,indent=2)+'\n')
source=[{'path':s['path'],'sha256':s['sha256']}for s in json.loads((E/'authentication.json').read_bytes())['recordings'][0]['sources']if s['path']in['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/raw_known_arithmetic.h','renderer/virgl-command/constant-domain.mjs']]
preds=json.loads((E/'predictions.json').read_bytes());statuses={p['id']:'HELD'for p in preds['predictions']};statuses['P12']='NEEDS EVIDENCE'
demands=[
 {'id':'C1','status':'NEEDS EVIDENCE','prediction':'Both zero+nonzero known ADD identity returns execute in a recorded public retry.','observed':'Count0 in every original hot/cold raw_bits.c:known_add and known_arithmetic.c:known_add return region.','points':['renderer/virgl-shader/raw_known_arithmetic.h:34:13-21','renderer/virgl-shader/raw_known_arithmetic.h:35:13-21'],'originalMergedProfileSha256':'abf869666cf3e495ad5e89059cf61f6e235df038d67ed592effdd5709f1cb863','demand':'Supplement the frozen original native binary recording with the public fixture supplemental-zero-return-vector, plus ADD(0,0x3fc00000) and ADD(0x3fc00000,0) rational WORD inputs to cover both helper instances. Record original raw/merged profiles and export with that executable; retain old seals.','fixture':{'path':'attack-predictions.json','name':'supplemental-zero-return-vector','index':16,'textSha256':sha(json.loads((E/'attack-predictions.json').read_bytes())['cases'][16]['text'].encode())}},
 {'id':'C2','status':'NEEDS EVIDENCE','prediction':'The new known arithmetic wrapper selects and validates inherited v38 coordinate metadata.','observed':'bridge.c:stage_result region1710:115-142 count0 in original hot/cold recordings.','points':['renderer/virgl-shader/bridge.c:1710:115-142'],'demand':'Record public supplemental-coordinate-wrapper at the frozen original native executable, assert v40 wrapper/base v38 and inherited coordinate policy, check whole native/Wasm pair parity and Node parse approval, and retain its original LLVM profile.','fixture':{'path':'attack-predictions.json','name':'supplemental-coordinate-wrapper','index':54}},
 {'id':'J1','status':'NEEDS EVIDENCE','prediction':'Canonical ADD+MUL validation and inherited-base recursive rejection have original-source V8 execution evidence.','observed':'All sealed original browser V8 profiles have count0 at offsets11519-11565 (second operation) and11978-11987 (:checked). Original consumer result report semantically exercises these paths, but its Node V8 profile was not captured.','points':['renderer/virgl-command/constant-domain.mjs:152','renderer/virgl-command/constant-domain.mjs:156'],'demand':'Capture NODE_V8_COVERAGE while replaying original-source consumer inputs: valid both-operation-wrapper metadata with operations [ADD,MUL], and an otherwise valid v40/SIN metadata record with inherited sineContract deleted. Bind script source hash and show positive counts for both specific nested ranges; include zero getter-invocation assertions. No GPU re-run is demanded for these inert metadata branches.'}
]
attack=json.loads((E/'attack-predictions.json').read_bytes())
for d in demands:
 if 'fixture'in d:
  c=next(c for c in attack['cases']if c['name']==d['fixture']['name']);d['fixture']['index']=attack['cases'].index(c);d['fixture']['textSha256']=sha(c['text'].encode());d['fixture']['text']=c['text']
verdict={'schema':'virgl-known-arithmetic-critic-verdict-v1','task':'E6-T12g6m1','verdict':'needs-evidence','sourceHead':'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee','submissionHead':'5c6daa5fd87bccc7dc39398b6f6ba6d22991585c','base':'bfd5c97f7d71f510fccd2bd120f43b3d8b54159f','predictionsSha256':sha((E/'predictions.json').read_bytes()),'predictionResults':[{'id':p['id'],'status':statuses[p['id']],'boundary':p['boundary']}for p in preds['predictions']],'findings':demands,'productContradictions':[],'unchangedBoundarySources':source,'proofs':{p.name:sha(p.read_bytes())for p in E.glob('*.json')if p.name!='verdict.json'},'incrementalInstruction':'Carry all HELD semantic, independent attack/sabotage, original hardware, old result, and pristine-clone results forward while these boundary source hashes and their worker evidence digests remain unchanged. Record only the named supplementary native/Node proof and touched harness gates; no unrelated gauntlet or new pristine clone absent portability finding.','suite':'No promotion until proof sufficiency is complete. Independent deterministic oracle, exact fixtures/seed and real sabotage recordings are sealed candidates for promotion; no runtime code was edited.'}
(E/'verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
print(json.dumps({'verdict':verdict['verdict'],'nativeClassification':{s:sum(x['status']==s for x in rows)for s in['HELD','WAIVED','NEEDS EVIDENCE']},'jsClassification':{s:sum(x['status']==s for x in js)for s in['HELD','WAIVED','NEEDS EVIDENCE']},'findings':len(demands),'boundarySources':source}))
