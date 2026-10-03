import hashlib,json,os,pathlib,subprocess
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()
expected='d549500106399ada00fcd48f1439bd107377ebc5'
subprocess.run(['git','merge-base','--is-ancestor',expected,head],cwd=R,check=True)
for file in ['raw_bits.c','raw_bits.h','bridge.h']:
 path='renderer/virgl-shader/'+file
 assert subprocess.check_output(['git','show',expected+':'+path],cwd=R)==(R/path).read_bytes(),path
command=['clang','-std=gnu11','-g','-O1','-fsanitize=address,undefined','-fno-omit-frame-pointer','-I',str(R/'renderer/virgl-shader'),str(R/'renderer/virgl-shader/raw_bits.c'),str(O/'knowledge_attack.c'),'-o',str(O/'knowledge-attack')]
p=subprocess.run(command,cwd=R,capture_output=True,check=True)
assert not p.stdout and not p.stderr
p=subprocess.run([str(O/'knowledge-attack')],cwd=R,capture_output=True,check=True,env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1'))
(O/'knowledge-report.json').write_bytes(p.stdout);(O/'knowledge.stderr').write_bytes(p.stderr)
stats=json.loads(p.stdout);assert stats['ok'] and stats['directOrderedComparisons']==1576064
report=dict(status='passed',head=head,commands=[command,[str(O/'knowledge-attack')]],stats=stats,compiler=subprocess.check_output(['clang','--version'],text=True).strip(),sources={str(p.relative_to(R)):sha(p) for p in [R/'renderer/virgl-shader/raw_bits.c',R/'renderer/virgl-shader/raw_bits.h',R/'renderer/virgl-shader/bridge.h',O/'knowledge_attack.c',pathlib.Path(__file__)]},records={p.name:sha(p) for p in [O/'knowledge-report.json',O/'knowledge.stderr']},binarySha256=sha(O/'knowledge-attack'))
(O/'knowledge-binding.json').write_text(json.dumps(report,indent=2)+'\n')
print({k:stats[k] for k in ['directOrderedComparisons','instructions','assertions','safeOutputAssertions','ok']})
