#!/usr/bin/env python3
"""Audit the recorded stream, typed counters and unchanged complete F2 outcomes."""
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
producer=load('equality_producer','tools/virgl-radial-domain/native.py')
held=load('e9_native_primitives','tools/virgl-bounded-loops/native_receipt.py')
require,sha,exact=producer.require,producer.sha,producer.exact

def verify_maxima(report,by_kind):
 """Derive sizes from the transcript-checked results, never the claimed maxima."""
 claimed=report['recordedMaxima'];held.integer_fields(claimed,'native.recordedMaxima')
 maxima={
  'singleResultBytes':max(e['resultBytes'] for e in by_kind['ORIGINAL']+by_kind['CASE']),
  'pairResultBytes':max(e['resultBytes'] for e in by_kind['PAIR']),
  'stageGlslBytes':max(len(stage['glsl'].encode()) for entries in by_kind.values() for e in entries if e['result']['ok']
   for stage in ([e['result']['vertex'],e['result']['fragment']] if 'vertex' in e['result'] else [e['result']]))}
 require(exact(claimed,maxima) and maxima['singleResultBytes']<=report['stats']['maxSingleResultBytes']<147456
  and maxima['pairResultBytes']<=report['stats']['maxPairResultBytes']<295936 and maxima['stageGlslBytes']<=65536,'exact reconstructed bounded native maxima')

def verify_sources(report,head):
 paths=sorted(p for pattern in ('*.c','*.h') for p in (ROOT/'renderer/virgl-shader').glob(pattern))+[ROOT/p for p in producer.SOURCES]
 require(exact(report['sources'],[producer.describe(p) for p in paths]),'complete ordered compiler/harness source inventory')
 for item in report['sources']:
  path=ROOT/item['path'];require(subprocess.check_output(['git','show',f'{head}:{item["path"]}'],cwd=ROOT)==path.read_bytes(),'exact committed compiler/harness source')

def verify_coverage_sources(coverage,exported):
 paths={ROOT/'renderer/virgl-shader/bridge.c',ROOT/'renderer/virgl-shader/raw_bits.c'}
 files=exported['data'][0]['files']
 require(len(files)==2 and {Path(e['filename']).resolve() for e in files}==paths,'LLVM filenames bind exactly both implementation sources')
 expected=[dict(producer.describe(Path(e['filename']).resolve()),summary=e['summary']) for e in files]
 require(exact(coverage['sources'],expected),'complete exact LLVM source bytes/digests and exported summaries')

def verify(directory,head):
 directory=Path(directory).resolve();r=json.loads((directory/'native-report.json').read_bytes())
 require(r['schema']=='wasm-vm-radial-domain-native-v1' and r['status']=='passed','complete radial native run')
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
     md=stage['metadata'];profile=md['profile'];conditional=profile.endswith(('-v7','-v9','-v11','-v12','-v14','-v15','-v16'));indirect=profile.endswith(('-v10','-v11','-v12','-v15','-v16'));loop=profile.endswith(('-v12','-v16'));radial=profile.endswith(('-v14','-v15','-v16'))
     require(set(md)=={'profile','stage','inputs','outputs','attributes','uniforms','samplers','uniformBlocks'}|({'constantDomains'} if conditional else set())|({'constantAccesses'} if indirect else set())|({'constantConstraints'} if loop else set())|({'constantRadialDomains'} if radial else set()),'closed profile obligations including unconditional13')
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
   m=re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=38912 pair_recoveries=36864 passed',line);require(m is not None,'closed complete native transcript grammar');seeds.append(m[1])
 require(counts=={k:len(v) for k,v in by_kind.items()} and seeds==producer.SEEDS and exact(faults,r['allocationFaults']),'all recorded results and independent schedules')
 require(exact((layout,flow,stats),(r['layout'],r['flow'],r['stats'])),'typed transcript observations')
 for name,values in [('layout',layout),('flow',flow),('stats',stats)]:held.integer_fields(values,name)
 require(layout['rawIrBytes']==26480 and layout['profileBytes']==7616 and flow=={'arenaBytes':52644,'arenaBoundBytes':53248,'depthLimit':8},'unchanged measured runtime bounds')
 require(stats['cases']==len(cases) and stats['pairs']==len(pairs) and stats['acceptedOriginals']==12 and stats['allocationFaults']==len(faults) and len(faults)>62 and stats['mutations']==4096 and stats['hostileCases']==324,'full native schedule')
 expected_recoveries=stats['cases']+stats['hostileCases']+stats['truncations']+4096+len(faults)
 require(stats['standaloneRecoveries']==expected_recoveries*38 and stats['pairRecoveries']==expected_recoveries*36,'every failure recovered through all17 profiles')
 require(stats['calls']==19+len(cases)+len(pairs)+38+8+324+stats['truncations']+4096+len(faults)+stats['standaloneRecoveries']+stats['pairRecoveries'],'actual total API calls')
 require(len(faults)>62 and all(f['attempts']==f['failAt'] and f['result']['ok'] is False for f in faults),'actual owned allocation failures')
 verify_maxima(r,by_kind)
 verify_sources(r,head)
 held.verify_records(directory,r['coverage']);exported=json.loads((directory/'coverage.json').read_bytes());held.coverage_primitives(r['coverage'],exported)
 verify_coverage_sources(r['coverage'],exported)
 require(all(any(f['name']==name and f['count']>0 for f in exported['data'][0]['functions']) for name in ('bridge.c:demand_graph','bridge.c:demand_join','bridge.c:demand_retry','bridge.c:radial_recognize','bridge.c:radial_retry','raw_bits.c:checked_source')), 'actual graph, predecessor and guarded-source checks executed')
 return r
