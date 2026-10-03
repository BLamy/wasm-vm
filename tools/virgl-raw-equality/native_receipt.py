#!/usr/bin/env python3
"""Audit the recorded stream, typed counters and explicit eight-result migrations."""
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[2]
def load(name,relative):
 s=importlib.util.spec_from_file_location(name,ROOT/relative);m=importlib.util.module_from_spec(s);saved=sys.path[:]
 try:s.loader.exec_module(m)
 finally:sys.path[:]=saved
 return m
producer=load('equality_producer','tools/virgl-raw-equality/native.py')
held=load('e9_native_primitives','tools/virgl-bounded-loops/native_receipt.py')
require,sha,exact=producer.require,producer.sha,producer.exact

def verify(directory,head):
 directory=Path(directory).resolve();r=json.loads((directory/'native-report.json').read_bytes())
 require(r['schema']=='wasm-vm-raw-equality-native-v1' and r['status']=='passed','complete raw equality native run')
 expected,groups=producer.workload();stream,cases,pairs=producer.serialize(expected,groups)
 require((directory/'native-input.bin').read_bytes()==stream and sha(stream)==r['streamSha256'],'all actual source-bound serialized inputs')
 by_kind={'ORIGINAL':r['originals'],'CASE':[e for label,_,_,_ in producer.GROUPS for e in r[label+'Cases']]+r['cases'],'PAIR':[e for label,_,_,_ in producer.GROUPS for e in r[label+'Pairs']]+r['pairs']}
 authored={'ORIGINAL':expected['originals'],'CASE':[e for _,e in cases],'PAIR':[e for _,_,e in pairs]}
 require(all(len(by_kind[k])==len(v) for k,v in authored.items()),'complete stage/pair counts')
 for kind,entries in by_kind.items():
  for actual,wanted in zip(entries,authored[kind]):
   if 'result' in wanted:require(exact(actual,wanted),'unchanged complete retained result')
   else:require(exact({k:v for k,v in actual.items() if k not in ('result','resultBytes','resultSha256')},wanted),'exact new or migrated input identity')
   producer.expectations(actual['result'],actual)
   held.integer(actual['resultBytes'],'actual serialized result bytes')
   require(type(actual['result']['ok']) is bool,'boolean result status')
   if actual['result']['ok']:
    for stage in ([actual['result']['vertex'],actual['result']['fragment']] if 'vertex' in actual['result'] else [actual['result']]):
     md=stage['metadata'];profile=md['profile'];conditional=profile.endswith(('-v7','-v9','-v11','-v12'));indirect=profile.endswith(('-v10','-v11','-v12'));loop=profile.endswith('-v12')
     require(set(md)=={'profile','stage','inputs','outputs','attributes','uniforms','samplers','uniformBlocks'}|({'constantDomains'} if conditional else set())|({'constantAccesses'} if indirect else set())|({'constantConstraints'} if loop else set()),'closed profile obligations including unconditional13')
     require(type(stage['glsl']) is str and len(stage['glsl'].encode())<=65536,'bounded stage GLSL')
 counts={k:0 for k in by_kind};seeds=[];faults=[];layout=flow=stats=None
 log=(directory/'native.log').read_bytes();require(sha(log)==r['logSha256'],'complete native transcript digest')
 for line in log.decode().splitlines():
  m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) (\d+) (.+)',line)
  if m:
   kind,index,raw=m[1],int(m[2]),m[3].encode();require(index==counts[kind],'native transcript sequential indexes');entry=by_kind[kind][index];require(exact(json.loads(raw),entry['result']) and len(raw)==entry['resultBytes'] and sha(raw)==entry['resultSha256'],'entire serialized native result');counts[kind]+=1
  elif line.startswith('FAULT '):
   _,n,value=line.split(' ',2);require(int(n)==len(faults),'allocation fault indexes');faults.append(json.loads(value))
  elif line.startswith('LAYOUT '):require(layout is None,'one layout');layout=json.loads(line[7:])
  elif line.startswith('FLOW '):require(flow is None,'one flow');flow=json.loads(line[5:])
  elif line.startswith('STATS '):require(stats is None,'one stats');stats=json.loads(line[6:])
  else:
   m=re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=28672 pair_recoveries=26624 passed',line);require(m is not None,'closed complete native transcript grammar');seeds.append(m[1])
 require(counts=={k:len(v) for k,v in by_kind.items()} and seeds==producer.SEEDS and exact(faults,r['allocationFaults']),'all recorded results and independent schedules')
 require(exact((layout,flow,stats),(r['layout'],r['flow'],r['stats'])),'typed transcript observations')
 for name,values in [('layout',layout),('flow',flow),('stats',stats)]:held.integer_fields(values,name)
 require(layout['rawIrBytes']==26352 and layout['profileBytes']==7616 and flow=={'arenaBytes':52644,'arenaBoundBytes':53248,'depthLimit':8},'unchanged measured runtime bounds')
 require(stats['cases']==len(cases) and stats['pairs']==len(pairs) and stats['acceptedOriginals']==12 and stats['allocationFaults']==16 and stats['mutations']==4096 and stats['hostileCases']==324,'full native schedule')
 expected_recoveries=stats['cases']+stats['hostileCases']+stats['truncations']+4096+16
 require(stats['standaloneRecoveries']==expected_recoveries*28 and stats['pairRecoveries']==expected_recoveries*26,'every failure recovered through all14 profiles')
 require(stats['calls']==19+len(cases)+len(pairs)+28+324+stats['truncations']+4096+16+stats['standaloneRecoveries']+stats['pairRecoveries'],'actual total API calls')
 require(len(faults)==16 and all(f['attempts']==f['failAt'] and f['result']['ok'] is False for f in faults),'actual owned allocation failures')
 for item in r['sources']:
  path=ROOT/item['path'];require(exact(producer.describe(path),item) and subprocess.check_output(['git','show',f'{head}:{item["path"]}'],cwd=ROOT)==path.read_bytes(),'exact committed compiler/harness source')
 held.verify_records(directory,r['coverage']);exported=json.loads((directory/'coverage.json').read_bytes());held.coverage_primitives(r['coverage'],exported)
 require(any(f['name']=='raw_bits.c:equal_float_mask' and f['count']>0 for f in exported['data'][0]['functions']),'new compile-time known-fact predicate executed')
 return r
