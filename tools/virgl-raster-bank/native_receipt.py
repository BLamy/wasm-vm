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
producer=load('equality_producer','tools/virgl-raster-bank/native.py')
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
 paths={ROOT/'renderer/virgl-shader/bridge.c',ROOT/'renderer/virgl-shader/raw_bits.c',ROOT/'renderer/virgl-shader/checked_upstream.c'}
 files=exported['data'][0]['files']
 require(len(files)==3 and {Path(e['filename']).resolve() for e in files}==paths,'LLVM filenames bind exactly all three implementation sources')
 expected=[dict(producer.describe(Path(e['filename']).resolve()),summary=e['summary']) for e in files]
 require(exact(coverage['sources'],expected),'complete exact LLVM source bytes/digests and exported summaries')

def verify(directory,head):
 directory=Path(directory).resolve();r=json.loads((directory/'native-report.json').read_bytes())
 require(r['schema']=='wasm-vm-raster-bank-native-v1' and r['status']=='passed','complete radial native run')
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
     md=stage['metadata'];raster=md['profile']=='virgl-webgl2-raw-bits-v27';profile=md['rasterBaseProfile'] if raster else md['profile'];conditional=profile.endswith(('-v7','-v9','-v11','-v12','-v14','-v15','-v16','-v18','-v20','-v22','-v23','-v24','-v25','-v26'));indirect=profile.endswith(('-v10','-v11','-v12','-v15','-v16','-v21','-v22','-v23','-v25','-v26'));loop=profile.endswith(('-v12','-v16','-v23','-v26'));radial=profile.endswith(('-v14','-v15','-v16','-v24','-v25','-v26'))
     require(set(md)=={'profile','stage','inputs','outputs','attributes','uniforms','samplers','uniformBlocks'}|({'constantDomains'} if conditional else set())|({'constantAccesses'} if indirect else set())|({'constantConstraints'} if loop else set())|({'constantRadialDomains'} if radial else set())|({'preciseWordContract'} if profile in producer.PROFILES[17:27] else set())|({'rasterBaseProfile','constantRasterDomains'} if raster else set()),'closed profile obligations including unconditional13')
     require(type(stage['glsl']) is str and len(stage['glsl'].encode())<=65536,'bounded stage GLSL')
 counts={k:0 for k in by_kind};seeds=[];faults=[];upstream=[];layout=flow=stats=None
 log=(directory/'native.log').read_bytes();require(sha(log)==r['logSha256'],'complete native transcript digest')
 for line in log.decode().splitlines():
  m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) (\d+) (.+)',line)
  if m:
   kind,index,raw=m[1],int(m[2]),m[3].encode();require(index==counts[kind],'native transcript sequential indexes');entry=by_kind[kind][index];require(exact(json.loads(raw),entry['result']) and len(raw)==entry['resultBytes'] and sha(raw)==entry['resultSha256'],'entire serialized native result');counts[kind]+=1
  elif line.startswith('FAULT '):
   _,n,value=line.split(' ',2);require(int(n)==len(faults),'allocation fault indexes');faults.append(json.loads(value))
  elif line.startswith('UPSTREAM '):
   _,n,value=line.split(' ',2);require(int(n)==len(upstream),'upstream calibration indexes');upstream.append(json.loads(value))
  elif line.startswith('LAYOUT '):require(layout is None,'one layout');layout=json.loads(line[7:])
  elif line.startswith('FLOW '):require(flow is None,'one flow');flow=json.loads(line[5:])
  elif line.startswith('STATS '):require(stats is None,'one stats');stats=json.loads(line[6:])
  else:
   m=re.fullmatch(r'SEED ([0-9a-f]{8}) mutations=1024 standalone_recoveries=61440 pair_recoveries=59392 passed',line);require(m is not None,'closed complete native transcript grammar');seeds.append(m[1])
 require(counts=={k:len(v) for k,v in by_kind.items()} and seeds==producer.SEEDS and exact(faults,r['allocationFaults']) and exact(upstream,r['upstreamCalibrations']),'all recorded results and independent schedules')
 require(exact((layout,flow,stats),(r['layout'],r['flow'],r['stats'])),'typed transcript observations')
 for name,values in [('layout',layout),('flow',flow),('stats',stats)]:held.integer_fields(values,name)
 require(layout['rawIrBytes']==26480 and layout['profileBytes']==7616 and flow=={'arenaBytes':52644,'arenaBoundBytes':53248,'depthLimit':8},'unchanged measured runtime bounds')
 require(stats['cases']==len(cases) and stats['pairs']==len(pairs) and stats['acceptedOriginals']==18 and stats['allocationFaults']==len(faults) and len(faults)>62 and stats['mutations']==4096 and stats['hostileCases']==324,'full native schedule')
 expected_recoveries=stats['cases']+stats['hostileCases']+stats['truncations']+4096+len(faults)
 require(stats['standaloneRecoveries']==expected_recoveries*60 and stats['pairRecoveries']==expected_recoveries*58,'every failure recovered through all28 profiles')
 require(stats['calls']==19+len(cases)+len(pairs)+60+28+8+8+324+stats['truncations']+4096+len(faults)+stats['standaloneRecoveries']+stats['pairRecoveries'],'actual total API calls')
 owned=[f for f in faults if 'upstream' not in f];raster_faults=[f for f in owned if f['kind'].startswith('raster-')];legacy_owned=[f for f in owned if not f['kind'].startswith('raster-')];actual_upstream=[f for f in faults if f.get('upstream') is True]
 require(len(legacy_owned)==209 and all(f['attempts']==f['failAt'] and f['result']['ok'] is False for f in owned),'actual owned allocation failures')
 for name in ['copy-xyzw-direct-vertex','copy-xyzw-direct-fragment','gpu-copy-xyzw-direct-vertex-pair','gpu-copy-xyzw-direct-fragment-pair']:
  failures=[f for f in raster_faults if f['case']==name];require(failures and [f['failAt'] for f in failures]==list(range(1,failures[0]['sites']+1)) and all(type(f['requestedBytes']) is int and f['requestedBytes']>0 for f in failures),'every actual new allocation failed and recovered')
 require(len(raster_faults)==15 and any(f['requestedBytes']==16516 for f in raster_faults),'measured new analysis arena within32KiB')
 names=['pass-vertex','pass-fragment','profile-26-vertex-mixed-pair','profile-26-fragment-mixed-pair'];names=['precise::'+name for name in names]
 require(len(upstream)==4 and stats['upstreamAllocationFaults']==len(actual_upstream) and len(owned)+len(actual_upstream)==len(faults),'complete upstream allocation schedule')
 for i,(calibration,name) in enumerate(zip(upstream,names)):
  kind='single' if i<2 else 'pair';entries=by_kind['CASE' if i<2 else 'PAIR'];entry=next(e for e in entries if e['name']==name.split('::',1)[1])
  require(set(calibration)=={'kind','case','allocations','result'} and calibration['kind']==kind and calibration['case']==name and exact(calibration['result'],entry['result']),'exact healthy upstream calibration')
  held.integer(calibration['allocations'],'actual nonzero upstream allocation count');require(4<calibration['allocations']<128,'bounded actual upstream allocations')
  failures=[f for f in actual_upstream if f['case']==name]
  require([f['failAt'] for f in failures]==list(range(1,calibration['allocations']+1)),'every actual upstream allocation failed once')
  for f in failures:
   require(set(f)=={'kind','case','upstream','failAt','attempts','requestedBytes','allocator','result'} and f['kind']=='upstream-'+kind and f['upstream'] is True and f['allocator'] in ('malloc','realloc'),'closed real upstream allocator failure')
   for key in ('failAt','attempts','requestedBytes'):held.integer(f[key],'upstream.'+key)
   require(f['attempts']>=f['failAt'] and f['requestedBytes']>0 and set(f['result'])=={'ok','error'} and f['result']['ok'] is False and f['result']['error']['code']==('translation-error' if i<2 else 'unsupported-feature'),'failed upstream conversion cannot publish any partial shader')
 verify_maxima(r,by_kind)
 verify_sources(r,head)
 held.verify_records(directory,r['coverage']);exported=json.loads((directory/'coverage.json').read_bytes());held.coverage_primitives(r['coverage'],exported)
 verify_coverage_sources(r['coverage'],exported)
 require(all(any(f['name']==name and f['count']>0 for f in exported['data'][0]['functions']) for name in ('bridge.c:demand_graph','bridge.c:demand_join','bridge.c:demand_retry','bridge.c:radial_recognize','bridge.c:radial_retry','raw_bits.c:checked_source','raw_bits.c:precise_source','bridge.c:precise_profile','bridge.c:precise_contract','raw_certify_raster_outputs','raw_bits.c:raster_graph','raw_bits.c:raster_query','raw_bits.c:raster_source','bridge.c:raster_contract')), 'actual graph, predecessor and guarded-source checks executed')
 require(all(any(f['name']==name and f['count']>0 for f in exported['data'][0]['functions']) for name in ('bridge_upstream_allocation_begin','bridge_upstream_allocation_failed','checked_upstream.c:checked_malloc','checked_upstream.c:checked_realloc','checked_upstream.c:checked_strbuf_alloc','checked_upstream.c:checked_strbuf_empty','checked_upstream.c:checked_strbuf_ready')), 'actual reset, failure and safe-buffer paths executed')
 return r
