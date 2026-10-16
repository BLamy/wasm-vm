import hashlib,json,os,pathlib,subprocess
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
command=['clang','-std=gnu11','-g','-O1','-fsanitize=address,undefined','-fno-omit-frame-pointer','-I',str(R/'renderer/virgl-shader'),str(R/'renderer/virgl-shader/raw_bits.c'),str(O/'knowledge_attack.c'),'-o',str(O/'knowledge-attack')]
subprocess.run(command,cwd=R,capture_output=True,check=True)
p=subprocess.run([str(O/'knowledge-attack')],cwd=R,capture_output=True,env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1'))
(O/'knowledge-report.json').write_bytes(p.stdout);(O/'knowledge.stderr').write_bytes(p.stderr)
assert p.returncode==0,p.stderr.decode();stats=json.loads(p.stdout);assert stats['ok'] and all(stats['opcodes'])
report=dict(status='passed',head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip(),commands=[command,[str(O/'knowledge-attack')]],stats=stats,sources={str(p.relative_to(R)):sha(p) for p in [R/'renderer/virgl-shader/raw_bits.c',R/'renderer/virgl-shader/raw_bits.h',O/'knowledge_attack.c',pathlib.Path(__file__)]},records={p.name:sha(p) for p in [O/'knowledge-report.json',O/'knowledge.stderr']},binarySha256=sha(O/'knowledge-attack'))
(O/'knowledge-binding.json').write_text(json.dumps(report,indent=2)+'\n');print(stats)
