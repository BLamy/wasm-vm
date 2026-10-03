"""Retain the verified F1 physical-word oracle on the successor compiler."""
import struct
import json
import subprocess
from shared import ROOT,require,sha,read,binding,same
import native_receipt

def verify(output,head,n):
 base=native_receipt.load('retained_browser_envelope','tools/virgl-constants/receipt.py')
 fixtures=read(ROOT/'renderer/virgl-shader/tests/raw-equality-cases.json')
 migrations=read(ROOT/'renderer/virgl-shader/tests/raw-equality-migrations.json')
 current={label+'::'+e['name']:e for label,_,_,_ in native_receipt.producer.GROUPS for e in n[label+'Cases']}
 current_pairs={label+'::'+e['name']:e for label,_,_,_ in native_receipt.producer.GROUPS for e in n[label+'Pairs']}
 # F1's own names are unprefixed in its unchanged GPU harness.
 current.update({e['name']:e for e in n['equalityCases']})
 current_pairs.update({e['name']:e for e in n['equalityPairs']})
 primary=base.verify_browser(output/'retained-equality',head,read(ROOT/'docs/gpu-3d-contract.json'),task='E6-T12f1');p=primary['acceptance'];require(p['schema']=='raw-equality-gpu-v1' and p['status']=='passed' and p['fault'] is None and p['predecessorFullGateClaimed'] is False,'current positive GPU run')
 for e in p['translations']:require(same(e['result'],(current_pairs if e['name'].endswith('-pair') else current)[e['name'] if e['name'] in current or e['name'] in current_pairs else 'float::'+e['name']]['result']),'all actual GPU compiler results equal native stages/pairs')
 reference_raw=subprocess.check_output(['node','tools/virgl-raw-equality/oracle.mjs'],cwd=ROOT);reference=json.loads(reference_raw);require((output/'retained-equality-oracle.json').read_bytes()==reference_raw,'literal TGSI reference independent of GPU report')
 kernels={e['case']:e for e in fixtures['kernels']};checked=0
 for stage,key in [('vertex','vertexProbes'),('fragment','fragmentProbes')]:
  expected_names=[e['case'] for e in fixtures['kernels'] if e['stage']==stage];require([e['oracle'] for e in p[key]]==expected_names,'every current kernel in both hardware stages')
  for probe in p[key]:
   kernel=kernels[probe['oracle']];vectors=fixtures['finiteVectors'] if kernel['vectorSet']=='finite' else fixtures['vectors'];require([v['name'] for v in probe['vectors']]==[v['name'] for v in vectors],'all independent literal vectors')
   for observed,literal in zip(probe['vectors'],vectors):
    expected=reference[kernel['case']][literal['name']];require(all(same(observed[k],literal[k]) for k in ('a','b','c')) and same(observed['expectedWords'],expected) and same(observed['observedWords'],expected),'whole independently classified GPU words')
    words=observed['upload']['words'];require(type(words) is list and all(type(x) is int and 0<=x<=0xffffffff for x in words),'typed actual raw upload')
    require(same(words[:4],literal['a']) and same(words[172:176],literal['c']),'actual owned full-word upload')
    if len(words)==184:require(same(words[180:184],literal['b']),'actual high-bank operand')
    reconstructed=[0]*4
    if stage=='vertex':
     require([d['selector'] for d in observed['captures']]==[0,8,16,24],'four captured bytes per word')
     for d in observed['captures']:
      raw=bytes(d['rawBytes']);physical=list(struct.unpack('<8I',raw));wanted=[0,0,0,0x3f800000]+[0x3f000000+(((x>>d['selector'])&255)<<15) for x in expected]
      require(same(physical,wanted) and same(d['observedBits'],physical) and sha(raw)==d['bytesSha256'],'exact physical transform feedback bits')
      for i,value in enumerate(physical[4:]):reconstructed[i]|=((value-0x3f000000)>>15)<<d['selector']
    else:
     require([d['selector'] for d in observed['draws']]==list(range(32)),'all32 independent rendered bit planes')
     for d in observed['draws']:
      wanted=[((x>>d['selector'])&1)*255 for x in expected];require(same(d['observedBytes'],wanted) and all(type(v) is int for v in d['observedBytes']),'actual physical fragment pixels')
      for i,value in enumerate(d['observedBytes']):reconstructed[i]|=(value//255)<<d['selector']
    require(same(reconstructed,expected),'full reconstructed uint words');checked+=4
 require(checked==p['checkedWords']==640 and len(p['migratedProbes'])==8,'complete current equality hardware word matrix and eight migrated bodies')
 for record,entry in zip(p['migratedProbes'],migrations['entries']):
  require(all(same(record[k],entry[k]) for k in entry) and record['textSha256']==entry['inputSha256'] and same(record['result'],current[entry['group'].replace('Cases','')+'::'+entry['name']]['result']),'exact unchanged historical migrated body and full current result')
  require(len(record['draws'])==len(fixtures['vectors']),'all migrations actually rendered')
  for d in record['draws']:
   # Independently classify encodings without converting any NaN/subnormal.
   a,b=d['words'][:4],d['words'][180:184];mask=[]
   for x,y in zip(a,b):
    xe,ye=(x>>23)&255,(y>>23)&255;xf,yf=x&0x7fffff,y&0x7fffff
    unordered=(xe==255 and xf!=0) or (ye==255 and yf!=0);zero=xe==ye==xf==yf==0;equal=(not unordered) and (zero or x==y);mask.append(0xffffffff if (equal if 'FSEQ' in entry['name'] else not equal) else 0)
   require(same(d['masks'],mask),'independent migration IEEE classification')
   if entry['stage']=='vertex':
    wanted=[0x3f000000 if x==0 else (0x3f7f8000 if entry['group']=='integerCases' else 0x3f7fffff) for x in mask];require(same(d['observedBits'],wanted) and same(list(struct.unpack('<8I',bytes(d['rawBytes'])))[4:],wanted),'migration physical exact carriers')
   else:require(same(d['observedBytes'],[128 if x==0 else 255 for x in mask]),'migration physical literal pixels')
 return {'words':checked,'migrations':8,'report':binding(output/'retained-equality/report.json',output)}
