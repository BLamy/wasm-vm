import subprocess,hashlib,json
from pathlib import Path
R=Path.cwd();S=R/'renderer/virgl-shader';V=R/'evidence/virgl-components/verifier';B=R/'target/virgl-components-verifier';B.mkdir(parents=True,exist_ok=True)
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
 original=(S/'bridge.c').read_text();anchor='if (consumed & (1u << lane)) needed |= 1u << r.swizzle[lane];'
 assert original.count(anchor)==1
 mutated=original.replace(anchor,'if (consumed & (1u << lane)) needed |= 1u << lane;')
 (B/'bridge-mutated.c').write_text(mutated)
 for variant,source in [('baseline',S/'bridge.c'),('consumed-lane-omission',B/'bridge-mutated.c')]:
  run(common+['-fprofile-instr-generate','-fcoverage-mapping','-c',str(source),'-o',str(B/f'{variant}.o')])
  run(common+['-fprofile-instr-generate',*[str(B/f'dep{i}.o') for i in range(len(sources))],str(B/f'{variant}.o'),'-lm','-o',str(B/variant)])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(V/'native-build.json').write_text(json.dumps({'commands':commands,'compiler':subprocess.check_output(['clang','--version'],text=True),'sources':[{'path':str(p.relative_to(R)),'sha256':sha(p)} for p in [S/'bridge.c',*sources]],'mutation':{'anchor':anchor,'originalSha256':sha(S/'bridge.c'),'mutatedSha256':sha(B/'bridge-mutated.c')},'binaries':{n:sha(B/n) for n in ['baseline','consumed-lane-omission']}},indent=2)+'\n')
print('Native sanitized baseline and consumed-lane omission built.')
