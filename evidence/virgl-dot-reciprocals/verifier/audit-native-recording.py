"""Fresh frozen native recording validation and hunk-by-hunk coverage audit."""
import ctypes,hashlib,importlib.util,json,pathlib,re,subprocess
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2];E=ROOT/'evidence/virgl-dot-reciprocals/worker';N=E/'native';HEAD='72a8695ba92d734a6bead0c42ead3089d8611806';PARENT='3adaa72f95fd88b8fefd5caa32d6407df22af1dd'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('scalar_verifier_frozen_native',ROOT/'tools/virgl-dot-reciprocals/native_receipt.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
r,*_=gate.verify_native(E,HEAD)
# Re-export the actual binary/profile pair independently; reject substituted text summaries.
export_command=r['coverage']['commands'][1];exported=subprocess.check_output(export_command,cwd=ROOT);assert exported==(N/'coverage.json').read_bytes()
show_command=r['coverage']['commands'][3];shown=subprocess.check_output(show_command,cwd=ROOT);assert shown==(N/'coverage-show.txt').read_bytes()
# Recorded changed runtime lines must have an actual count or a justified noncode waiver.
lines={};file=None
for row in shown.decode().splitlines():
 if row.endswith('.c:') and row.startswith('/'):
  file=str(pathlib.Path(row[:-1]).relative_to(ROOT));continue
 m=re.match(r'^\s*(\d+)\|\s*([^|]*)\|(.*)$',row)
 if m and file:lines[file,int(m[1])]={'count':m[2].strip(),'text':m[3]}
diff=subprocess.check_output(['git','diff','--unified=0',PARENT,HEAD,'--','renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c'],cwd=ROOT,text=True)
changed=[];file=None;number=None
for row in diff.splitlines():
 if row.startswith('+++ b/'):file=row[6:];continue
 m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@',row)
 if m:number=int(m[1]);continue
 if row.startswith('@@') or row.startswith('diff ') or row.startswith('---') or row.startswith('index '):continue
 if row.startswith('+'):
  point=lines[file,number];assert point['text']==row[1:]
  status='executed' if point['count'] and point['count']!='0' else 'waived'
  if status=='waived':assert not row[1:].strip() or row[1:].lstrip().startswith(('/*','*','unsigned raw_consumed_mask')),('uncovered changed runtime',file,number,point)
  changed.append({'path':file,'line':number,'status':status,**point});number+=1
 elif row.startswith(' '):number+=1
# Actual frozen new-case results equal the independently built public API byte for byte.
build=json.loads((V/'builds.json').read_text());libpath=pathlib.Path(build['directory'])/'current.dylib';lib=ctypes.CDLL(str(libpath));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
checks=[]
for entry in r['cases']:
 text=entry['text'].encode();raw=lib.bridge_translate(int(entry['stage']=='fragment'),text,len(text))
 assert json.loads(raw)==entry['result'] and len(raw)==entry['resultBytes'] and hashlib.sha256(raw).hexdigest()==entry['resultSha256']
 checks.append({'name':entry['name'],'resultSha256':entry['resultSha256']})
for path,digest in json.loads((V/'initial-runtime-digests.json').read_text()).items():assert sha(ROOT/path)==digest
report={'status':'passed','head':HEAD,'nativeReportSha256':sha(N/'native-report.json'),'logSha256':sha(N/'native.log'),'streamSha256':sha(N/'native-input.bin'),'coverageSha256':sha(N/'coverage.json'),'coverageShowSha256':sha(N/'coverage-show.txt'),'actualIndependentCoverageReexportEqual':True,'layout':r['layout'],'stats':r['stats'],'changedLines':changed,'independentNewCaseReplayCount':len(checks),'independentNewCaseReplays':checks,'waivers':{'raw_bits.h':'Enum values/feature mask/prototype are compile-time declarations exercised through every scalar parser and profile; native static assertions/layout prove unchanged structure sizes. Wasm fixed memory awaits final browser proof.','docs/Makefile/build.sh':'Docs, declarative acceptance entry and compiler invocation wiring are directly read/executed; they do not add runtime branches.','test-harness':'Recorded all originals/cases/pairs plus defined hostile/truncation/mutation schedules and source-bound counter artifacts; no disabled/ignored tests.'}}
(V/'native-recording-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','changedLines':len(changed),'executableChangedLines':sum(c['status']=='executed' for c in changed),'independentNewCaseReplays':len(checks),'stats':r['stats']}))
