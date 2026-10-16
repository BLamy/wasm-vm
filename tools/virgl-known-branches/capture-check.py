#!/usr/bin/env python3
"""Recheck complete physical captures against pre-observation integer/literal predictions."""
import hashlib,json,math,struct,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def bits(f):return struct.unpack('<I',struct.pack('<f',f))[0]
def main():
 source=Path(sys.argv[1]);raw=source.read_bytes();r=json.loads(raw);a=r['acceptance'];seed=a['seed'];fault=a['fault']
 wanted=json.loads(subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan,specialPlan,physicalLoops}}from'./tools/virgl-known-branches/cases.mjs';process.stdout.write(JSON.stringify({{plan:physicalPlan({seed}),special:specialPlan(),loops:physicalLoops()}}));"],cwd=ROOT))
 plan=wanted['plan'];require(a['plan']==plan,'literal input schedule');require(r['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser diagnostics');require(a['objects']['live']==0,'disposed physical objects')
 failures=[];words=pixels=0
 for row in plan:
  if row['source'].startswith('IMM'):truth=row['predicate'][{'x':0,'y':1}[row['source'].split('.')[1][0]]]!=0
  elif row['name'].startswith('masked'):truth=row['predicate'][1]!=0
  else:truth=row['name']=='partial-one'
  require(truth==row['truth'],'integer UIF prediction')
  ints=[math.trunc(struct.unpack('<f',struct.pack('<I',w))[0])for w in row['words']]
  require([v&0xffffffff for v in ints]==row['integers'] and [bits(v)for v in ints]==row['numeric'],'independent literal signed conversion')
 for i,v in enumerate(a['vertices']):
  require(v['row']==plan[i],'unchanged literal vector');row=plan[i]
  if v['mutation']:
   m=v['mutation'];require(m['served']==m['original'].replace(m['needle'],m['replacement'],1),'actual source mutation');require(any(e.get('source')==m['served']for e in a['events']),'fault source submitted')
  for entry in v['vectors']:
   observed=list(struct.unpack('<16I',bytes(entry['bytes'])));require(observed==entry['observed'],'raw word custody');require(sha(bytes(entry['bytes']))==entry['sha256'],'raw digest')
   predicted=[bits(n)for n in entry['position']]+[(w&0x7fffff)|0x3f000000 for w in row['words']]+[(w>>23)|0x3f000000 for w in row['words']]+row['numeric'];require(predicted==entry['expectedWords'],'pre-observation predictions')
   for lane,(x,y)in enumerate(zip(observed,predicted)):
    if x!=y:failures.append(dict(vertex=i,lane=lane,expected=y,actual=x))
   words+=16
 for f in a['fragments']:
  row=next(x for x in plan if x['name']==f['row']['name']);require(row==f['row'],'fragment schedule');w=(row['integers']if f['converted']else row['words'])[f['lane']];predicted=[(w>>s)&255 for s in [0,8,16,24]]
  require(f['expectedBytes']==predicted and f['bytes']==predicted*16,'complete literal bytes');require(sha(bytes(f['bytes']))==f['sha256'],'byte digest');pixels+=16
 for i,f in enumerate(a['special']):
  row=wanted['special'][i];require(row==f['row'],'special complete source')
  predicted=[]
  for pixel in range(16):predicted+=row['clear']if row['mode']=='discard'or row['mode']=='negative-x'and pixel%4<2 else row['expectedColor']
  require(f['expectedBytes']==predicted and f['bytes']==predicted and sha(bytes(f['bytes']))==f['sha256'],'complete discard/raster cells');pixels+=16
  if row.get('bank'):require(f['bank']['words'][:4]==[bits(n)for n in [.25,.5,.75,1]]==f['bank']['observed'],'actual selected bank')
 for i,v in enumerate(a['loops']):
  require(v['row']==wanted['loops'][i],'complete certified loop source');observed=list(struct.unpack('<8I',bytes(v['bytes'])));predicted=[bits(n)for n in [.25,-.5,.125,1]*2]
  require(v['expectedWords']==observed==predicted and observed==v['observed'] and sha(bytes(v['bytes']))==v['sha256'],'live/dead full loop words');words+=8
 if fault:
  require(r['status']==a['status']=='failed' and failures and 'independent branch word mismatch'in a['failure']['message'],'fault contradicts literal words');require(len(a['vertices'])==1 and a['vertices'][0]['mutation']['fault']==fault,'bounded source fault')
 else:
  require(r['status']==a['status']=='passed'and not failures and len(a['vertices'])==len(plan)and len(a['fragments'])==len(plan)*8 and len(a['special'])==len(wanted['special'])and len(a['loops'])==len(wanted['loops']),'all scheduled physical cells');require((words,pixels)==(a['checkedWords'],a['checkedPixels']),'complete counts')
 report=dict(schema='virgl-known-branches-capture-check-v1',task='E6-T12g6m2',status='passed',gitHead=r['gitHead'],sourceReportSha256=sha(raw),sourceSha256=sha(Path(__file__).read_bytes()),seed=seed,fault=fault,checkedWords=words,checkedPixels=pixels,physicalFaults=failures)
 Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n');print(f'{words} literal physical words, {pixels} pixels; {len(failures)} expected fault contradictions')
if __name__=='__main__':main()
