#!/usr/bin/env python3
"""Recheck every recorded physical word/byte from literal independent inputs."""
import hashlib,json,struct,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def bits(f):return struct.unpack('<I',struct.pack('<f',f))[0]
def main():
 source=Path(sys.argv[1]);raw=source.read_bytes();r=json.loads(raw);a=r['acceptance'];seed=a['seed'];fault=a['fault']
 plan=json.loads(subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-known-arithmetic/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=ROOT))
 require(a['plan']==plan,'literal rational input schedule');require(r['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser diagnostics');require(a['objects']['live']==0,'disposed physical objects')
 failures=[];words=pixels=0
 for i,v in enumerate(a['vertices']):
  require(v['row']==plan[i],'unchanged literal vector');row=plan[i]
  if v['mutation']:require(any(e.get('source')==v['mutation']['served']for e in a['events']),'fault source actually submitted')
  for entry in v['vectors']:
   observed=list(struct.unpack('<20I',bytes(entry['bytes'])));require(observed==entry['observed'],'raw word custody');require(sha(bytes(entry['bytes']))==entry['sha256'],'raw digest')
   wanted=[bits(n)for n in entry['position']]+[(w&0x7fffff)|0x3f000000 for w in row['words']]+[(w>>23)|0x3f000000 for w in row['words']]+row['numeric']+row['words'];require(wanted==entry['expectedWords'],'pre-observation predictions')
   for lane,(x,y)in enumerate(zip(observed,wanted)):
    if x!=y and not(lane>=16 and (x&0x7fffffff)==(y&0x7fffffff)==0):failures.append(dict(vertex=i,lane=lane,expected=y,actual=x))
   words+=20
 for f in a['fragments']:
  row=next(x for x in plan if x['name']==f['row']['name']);require(row==f['row'],'fragment input schedule');w=(row['integers']if f['converted']else row['words'])[f['lane']];wanted=[(w>>s)&255 for s in [0,8,16,24]]
  require(f['expectedBytes']==wanted and f['bytes']==wanted*16,'complete literal bytes');require(sha(bytes(f['bytes']))==f['sha256'],'byte digest');pixels+=16
 for m in a['math']:
  observed=list(struct.unpack('<8f',bytes(m['bytes'])));require(observed==m['observed'],'math raw custody');require(sha(bytes(m['bytes']))==m['sha256'],'math digest');require(observed[:4]==[0,0,0,1],'math position')
  require(all(abs(x-m['expected'])<=m['budget']for x in observed[4:]),'bounded original math consumer');words+=8
 if fault:
  require(r['status']==a['status']=='failed' and failures and 'independent known word mismatch'in a['failure']['message'],'actual fault contradicted literal values');require(len(a['vertices'])==1 and a['vertices'][0]['mutation']['fault']==fault,'bounded actual source fault')
 else:
  require(r['status']==a['status']=='passed'and not failures and len(a['vertices'])==len(plan)and len(a['fragments'])==len(plan)*8,'all scheduled physical cells');require((words,pixels)==(a['checkedWords'],a['checkedPixels']),'complete counts')
 report=dict(schema='virgl-known-arithmetic-capture-check-v1',task='E6-T12g6m1',status='passed',gitHead=r['gitHead'],sourceReportSha256=sha(raw),sourceSha256=sha(Path(__file__).read_bytes()),seed=seed,fault=fault,checkedWords=words,checkedPixels=pixels,physicalFaults=failures)
 Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n');print(f'{words} literal physical words, {pixels} byte pixels; {len(failures)} expected fault contradictions')
if __name__=='__main__':main()
