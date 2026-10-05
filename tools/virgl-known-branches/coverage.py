#!/usr/bin/env python3
"""Inspect original LLVM and V8 regions at predeclared changed control/data sites."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='97dc44d2fbc9284705ad81630998bb533186c9a1'
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def location(source,anchor,token=None):
 a=source.index(anchor);require(source.find(anchor,a+1)<0,'unique source anchor '+anchor)
 a+=anchor.index(token)if token else 0
 prefix=source[:a];return(prefix.count('\n')+1,a-prefix.rfind('\n'))
def main():
 directory=Path(sys.argv[1]).resolve();raw=(directory/'native/coverage.json').read_bytes();c=json.loads(raw)
 functions=[f for d in c['data']for f in d['functions']]
 sites=[
 ('raw_bits.c','raw_uif_truth','if (value.zero & value.one) return -1;','return -1'),
 ('raw_bits.c','raw_uif_truth','if (value.one) return 1;','return 1'),
 ('raw_bits.c','raw_uif_truth','return value.zero == UINT32_MAX ? 0 : -1;',None),
 ('bridge.c','bridge.c:source','if (dead) s->dead_indirect = true;','s->dead_indirect'),
 ('bridge.c','bridge.c:source','if (s->raw_flags & RAW_BRANCH_RETRY) {',None),
 ('bridge.c','bridge.c:control','if (pruning && !s->live) raw.flags |= RAW_DEAD;','raw.flags'),
 ('bridge.c','bridge.c:control','raw.flags |= truth ? RAW_UIF_TRUE : RAW_UIF_FALSE;','RAW_UIF_TRUE'),
 ('bridge.c','bridge.c:control','raw.flags |= truth ? RAW_UIF_TRUE : RAW_UIF_FALSE;','RAW_UIF_FALSE'),
 ('bridge.c','bridge.c:control','if (truth) frame->entry_live = false;','frame->entry_live'),
 ('bridge.c','bridge.c:control','if (truth) frame->entry_live = false;\n               else s->live = false;','s->live'),
 ('bridge.c','bridge.c:control','else s->live = false;\n         }\n         --flow->depth;','s->live'),
 ('bridge.c','bridge.c:control','if (!dead_loop) { flow_snapshot(s, frame, true); s->live = true; raw.flags &= ~RAW_DEAD; }','raw.flags'),
 ('bridge.c','bridge.c:control','flow_snapshot(s, frame, false); frame->exit_live = true;','frame->exit_live'),
 ('bridge.c','bridge.c:discard_instruction','if ((s->raw_flags & RAW_BRANCH_RETRY) && !s->live) {',None),
 ('bridge.c','bridge.c:instruction','if (!s->syntax_only && (s->raw_flags & RAW_BRANCH_RETRY) && !s->live) {',None),
 ('bridge.c','bridge.c:check_input_attempt','if (profile->raw && (retry_flags & RAW_BRANCH_RETRY) && !loop_candidate) {',None),
 ('bridge.c','bridge.c:check_input_attempt','if (!validate(checked, profile)) return numeric_rejection();\n      demand_reset(profile, profile->stage, profile->raw, profile->raw_flags);','demand_reset'),
 ('bridge.c','bridge.c:check_input','response_used = 0; response_overflow = false;\n         return NULL;',None),
 ('bridge.c','bridge.c:check_input','response_used = 0; response_overflow = false;\n      return NULL;',None),
 ('bridge.c','bridge.c:live_loop','return ir->loop.checked && !(ir->instructions[ir->loop.begin].flags & RAW_DEAD);',None),
 ('bridge.c','bridge.c:precise_contract','if (instruction->flags & RAW_DEAD) continue;','continue'),
 ('bridge.c','bridge.c:stage_result','if (branch) branch_contract(', 'branch_contract'),
 ('raw_bits.c','raw_bits.c:raster_graph','if (flags & RAW_UIF_FALSE) {\n               a->next[open][0] = a->next[open][1];','a->next'),
 ('raw_bits.c','raw_bits.c:raster_graph','else if (flags & RAW_UIF_TRUE) a->next[open][1] = RASTER_NONE;','a->next'),
 ('raw_bits.c','raw_emit','emit(&w, " /* proved raw UIF */ if (%s) {\\n", instruction->flags & RAW_UIF_TRUE ? "true" : "false");',None),
 ]
 points=[]
 for filename,function,anchor,token in sites:
  source=(ROOT/'renderer/virgl-shader'/filename).read_text();f=next(f for f in functions if f['name']==function)
  # Locate within this original function, so repeated syntax in other helpers
  # cannot be mislabeled as evidence for this exact changed path.
  bounds=[r for r in f['regions']if r[7]==0 and f['filenames'][r[5]].endswith('/'+filename)]
  start=min(r[0]for r in bounds);end=max(r[2]for r in bounds);lines=source.splitlines(True);section=''.join(lines[start-1:end])
  line,column=location(section,anchor,token);line+=start-1
  regions=[r for r in bounds if (r[0],r[1])<=(line,column)<(r[2],r[3])]
  require(regions,'mapped original region '+anchor);r=min(regions,key=lambda r:(r[2]-r[0])*10000+r[3]-r[1]);require(r[4]>0,'unexecuted exact native site '+anchor)
  points.append(dict(file=filename,function=function,anchor=anchor,token=token,point=[line,column],region=r))
 sourcePath=ROOT/'renderer/virgl-command/constant-domain.mjs';source=sourcePath.read_text();url=sourcePath.as_uri()
 files=sorted((directory/'node-v8').glob('*.json'));require(len(files)==1,'one original Node process profile')
 script=next(s for s in json.loads(files[0].read_text())['result']if s['url']==url);ranges=[r for f in script['functions']for r in f['ranges']];js=[]
 for needle in ['const branch = value.profile === BRANCH_PROFILE;','const policy = record(value.branchContract,','return checked.ok ? Object.freeze({ ...checked, branchLiveness: Object.freeze(policy) }) : checked;',': checked;\n    }\n    const knownArithmetic']:
  offset=source.index(needle);require(source.find(needle,offset+1)<0,'unique V8 site');offset+=needle.index(': checked')if needle.startswith(': checked')else 0
  applicable=[r for r in ranges if r['startOffset']<=offset<r['endOffset']];require(applicable,'mapped V8 site');r=min(applicable,key=lambda r:r['endOffset']-r['startOffset']);require(r['count']>0,'unexecuted V8 site '+needle);js.append(dict(needle=needle,offset=offset,range=r))
 browsers=[]
 for seed in [608135816,2242054355,320440878]:
  report=json.loads((directory/f'gpu-{seed}/report.json').read_bytes());coverage=directory/f'gpu-{seed}'/report['browserCoverage']['path'];require(sha(coverage.read_bytes())==report['browserCoverage']['sha256'],'original browser coverage')
  scripts=json.loads(coverage.read_text());require(any(s['url'].endswith('/renderer/virgl-command/constant-domain.mjs')for s in scripts),'actual browser consumer source')
  browsers.append(dict(seed=seed,path=str(coverage.relative_to(directory)),sha256=sha(coverage.read_bytes()),scripts=len(scripts)))
 # Source-level inventory names every changed runtime hunk. The region points
 # above are the control decisions; assertions below are reached by the whole
 # recorded request set. Existing certificate failure guards cannot be reached
 # after complete syntax/graph validation and do not grant new admissions.
 inventory={
  'source/dead reads':'Declarations and full grammar execute first; original dead TEMP/address initialization bypass and live missing reads are recorded.',
  'control/joins/loops':'Both raw truth edges, unknown controls, nested dead parents, live and fully dead certified loops; old certificates are independently retained.',
  'discard/data publication':'Dead KILL/KILL_IF/TEX/PRECISE/data reads preserve original slots and publish no facts; live output obligations reject missing versions.',
  'whole-source retries':'Initial successes, known-only successes, branch successes and both original parse/unsupported rejections execute from fresh state.',
  'raster graph':'Both exact false and true graph edges execute for selected bank outputs. Unknown graph edges retain old handling.',
  'emission/metadata':'Literal controls, omitted dead data, dead/live loop forms and strict branch/precision/sampler/loop metadata execute in native/Wasm and actual hardware.',
  'defensive certificates':'The old exact loop PC/end certificate guards remain after the complete syntax/recognition pass. Their corruption-only failure arms add no public behavior; their new dead-loop operands are exercised for both values.',
  'types/layout':'Feature/flag definitions and the bool use existing padding; original native layout is [111744,112,32448].',
 }
 patch=subprocess.check_output(['git','diff',BASE,'--','renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-command/constant-domain.mjs'],cwd=ROOT)
 result=dict(schema='virgl-known-branches-coverage-v1',task='E6-T12g6m2',status='passed',gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),nativeSha256=sha(raw),patchSha256=sha(patch),nativePoints=points,nodePoints=js,nodeProfile=dict(path=str(files[0].relative_to(directory)),sha256=sha(files[0].read_bytes())),browserProfiles=browsers,hunkInventory=inventory)
 (directory/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(f'{len(points)} native sites, {len(js)} original V8 sites and three original browser profiles passed')
if __name__=='__main__':main()
