#!/usr/bin/env python3
"""Record frozen changed-line hits and branch outcomes from verifier profiles."""
import json,pathlib,re,subprocess
root=pathlib.Path.cwd();out=root/'evidence/virgl-captured-shaders/verifier';build=root/'target/virgl-captured-verifier'
subprocess.run(['xcrun','llvm-profdata','merge','-sparse',str(build/'captured.profraw'),str(build/'stream.profraw'),'-o',str(build/'merged.profdata')],check=True)
common=[str(build/'captured'),'-object',str(build/'stream'),'-instr-profile',str(build/'merged.profdata'),'renderer/virgl-shader/bridge.c']
coverage=subprocess.check_output(['xcrun','llvm-cov','show',*common,'-show-branches=count'],text=True);(out/'bridge-coverage.txt').write_text(coverage)
export=json.loads(subprocess.check_output(['xcrun','llvm-cov','export',*common],text=True))
diff=subprocess.check_output(['git','diff','--unified=0','d0a5b1fc..8759a306','--','renderer/virgl-shader/bridge.c'],text=True)
added=set();line=0
for row in diff.splitlines():
 if row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
 elif row.startswith('+') and not row.startswith('+++'):added.add(line);line+=1
 elif row.startswith(' '):line+=1
rows=[];branches=[]
for row in coverage.splitlines():
 m=re.match(r'\s*(\d+)\|\s*([^|]*)\|(.*)',row)
 if m and int(m[1]) in added:rows.append({'line':int(m[1]),'count':m[2].strip(),'source':m[3]})
 m=re.search(r'Branch \((\d+):(\d+)\): (.*)',row)
 if m and int(m[1]) in added:branches.append({'line':int(m[1]),'column':int(m[2]),'counts':m[3]})
report={'runtime':'8759a30622e6604b8cd3d5c35d110260c6fd1943','summary':export['data'][0]['files'][0]['summary'],'addedLines':len(added),'instrumentedAddedLines':sum(bool(r['count']) for r in rows),'changedLines':rows,'changedLineBranches':branches,'zeroCountChangedLines':[r for r in rows if r['count']=='0'],'branchWaivers':{'195:11':'Clang isfinite macro contains compile-time folded branches; dynamic finite/nonfinite outcome both hit.','223:42':'Declaration register parser only permits default xyzw (15) or explicit xy (3), so r.mask != 3 after r.mask != 15 is structurally unreachable defensive redundancy.'}}
assert not report['zeroCountChangedLines']
(out/'changed-coverage.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['addedLines','instrumentedAddedLines','zeroCountChangedLines','branchWaivers']}))
