import subprocess,hashlib,json
from pathlib import Path
R=Path.cwd();S=R/'renderer/virgl-shader';V=R/'evidence/virgl-banks/verifier';B=R/'target/virgl-banks-verifier';B.mkdir(parents=True,exist_ok=True)
sources=[S/'generated/u_format_table.c',S/'vendor/src/vrend/vrend_shader.c',*sorted((S/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),S/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',S/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',S/'vendor/src/mesa/util/u_debug.c',V/'batch.c']
common=['clang','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1','-g','-O1','-fno-omit-frame-pointer','-fsanitize=address,undefined']
common += ['-I'+str(S/p) for p in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']]
commands=[]
def run(cmd):
 commands.append(cmd);subprocess.run(cmd,check=True)
with (V/'native-build.log').open('w') as log:
 import contextlib
 # Compiler diagnostics are recorded by outer command too; do not disable vendor assertions.
 for i,p in enumerate(sources):run(common+['-c',str(p),'-o',str(B/f'dep{i}.o')])
 run(common+['-fprofile-instr-generate','-fcoverage-mapping','-c',str(S/'bridge.c'),'-o',str(B/'baseline.o')])
 run(common+['-fprofile-instr-generate',*[str(B/f'dep{i}.o') for i in range(len(sources))],str(B/'baseline.o'),'-lm','-o',str(B/'baseline')])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(V/'native-build.json').write_text(json.dumps({'commands':commands,'compiler':subprocess.check_output(['clang','--version'],text=True),'sources':[{'path':str(p.relative_to(R)),'sha256':sha(p)} for p in [S/'bridge.c',*sources]],'binaries':{n:sha(B/n) for n in ['baseline']}},indent=2)+'\n')
print('Independent bank baseline with sanitizers and source coverage built.')
