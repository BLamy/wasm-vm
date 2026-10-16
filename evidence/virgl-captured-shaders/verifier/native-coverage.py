#!/usr/bin/env python3
"""Verifier-only ASan/UBSan + LLVM coverage with independent mutation seeds."""
import hashlib,json,os,pathlib,struct,subprocess
root=pathlib.Path.cwd(); out=root/'evidence/virgl-captured-shaders/verifier'; build=root/'target/virgl-captured-verifier';build.mkdir(parents=True,exist_ok=True)
shader=root/'renderer/virgl-shader'
source=(shader/'native_tests/captured.c').read_text()
old=['18a9e24d','4c907fb3','c31e7d82','9b4260a5']; seeds=['61706c65','7ea053bd','2468ace1','dd00f123']
for a,b in zip(old,seeds): source=source.replace(a,b)
harness=build/'captured-independent.c';harness.write_text(source)
driver=build/'stream.c';driver.write_text('''#include "bridge.h"
#include <stdio.h>
#include <stdlib.h>
int main(void) { int stage; size_t len; char text[BRIDGE_MAX_TEXT+1]; while(scanf("%d %zu\\n", &stage,&len)==2){ if(len>BRIDGE_MAX_TEXT||fread(text,1,len,stdin)!=len)return 2; puts(bridge_translate(stage,text,len)); } return 0; }
''')
sources=['bridge.c','generated/u_format_table.c','vendor/src/vrend/vrend_shader.c',*sorted(str(p.relative_to(shader)) for p in (shader/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c','vendor/src/gallium/auxiliary/cso_cache/cso_cache.c','vendor/src/mesa/util/u_debug.c']
flags=['clang','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1',*['-I'+p for p in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']],'-g','-O1','-fno-omit-frame-pointer','-fsanitize=address,undefined','-fprofile-instr-generate','-fcoverage-mapping']
commands=[]
for name,src in [('captured',harness),('stream',driver)]:
 cmd=[*flags,*sources,str(src),'-lm','-o',str(build/name)];commands.append(cmd);subprocess.run(cmd,cwd=shader,check=True)
cases=json.loads((shader/'tests/captured-invalid.json').read_text());stream=bytearray(b'VGC1'+struct.pack('<I',len(cases)))
for case in cases:
 name,text=case['name'].encode(),case['text'].encode();stream+=struct.pack('<III',int(case['stage']=='fragment'),len(name),len(text))+name+text
hashes=['e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33','80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808']
paths=[root/'evidence/virgl-corpus/captures/textured-scene/shaders'/f'{h}.tgsi' for h in hashes]
for p,h in zip(paths,hashes):assert hashlib.sha256(p.read_bytes()).hexdigest()==h
env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1',LLVM_PROFILE_FILE=str(build/'captured.profraw'))
cmd=[str(build/'captured'),*map(str,paths)];commands.append(cmd)
p=subprocess.run(cmd,input=stream,capture_output=True,env=env,timeout=180);(out/'native-independent.log').write_bytes(p.stdout+p.stderr);assert p.returncode==0,(p.returncode,p.stderr)
report={'frozenHead':'8759a30622e6604b8cd3d5c35d110260c6fd1943','seeds':seeds,'mutations':8192,'negativeCases':len(cases),'sourceSha256':hashlib.sha256((shader/'bridge.c').read_bytes()).hexdigest(),'harnessOriginalSha256':hashlib.sha256((shader/'native_tests/captured.c').read_bytes()).hexdigest(),'harnessReseededSha256':hashlib.sha256(source.encode()).hexdigest(),'commands':commands,'sanitizers':['address','undefined'],'logSha256':hashlib.sha256(p.stdout+p.stderr).hexdigest(),'status':'passed'}
(out/'native-independent.json').write_text(json.dumps(report,indent=2)+'\n');print(p.stdout.decode().splitlines()[-6:])
