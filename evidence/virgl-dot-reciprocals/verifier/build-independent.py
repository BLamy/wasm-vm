"""Independent public-API builds outside shared build directories."""
import hashlib,json,pathlib,subprocess,tempfile
V=pathlib.Path(__file__).resolve().parent
ROOT=V.parents[2]; S=ROOT/'renderer/virgl-shader'
T=pathlib.Path(tempfile.mkdtemp(prefix='scalar-verifier-'))
files=['bridge.c','raw_bits.c','raw_bits.h','bridge.h']
identity={str((S/n).relative_to(ROOT)):hashlib.sha256((S/n).read_bytes()).hexdigest() for n in files}
(V/'initial-runtime-digests.json').write_text(json.dumps(identity,indent=2)+'\n')
for label in ['current','parent','sabotage-dot','sabotage-reciprocal']:
 d=T/label;d.mkdir()
 for n in files:
  raw=subprocess.check_output(['git','show','3adaa72f95fd88b8fefd5caa32d6407df22af1dd:renderer/virgl-shader/'+n],cwd=ROOT) if label=='parent' else (S/n).read_bytes()
  if n=='raw_bits.c' and label=='sabotage-dot':
   needle=b'for (unsigned lane = 0; lane < 3; ++lane) {';assert raw.count(needle)==1
   raw=raw.replace(needle,b'for (unsigned lane = 0; lane < 2; ++lane) {')
   raw=raw.replace(b'emit(w, "vec3(");',b'emit(w, "vec2(");')
  if n=='raw_bits.c' and label=='sabotage-reciprocal':
   needle=b'emit(w, op == RAW_RCP ? "1.0 / (" : "inversesqrt(");';assert raw.count(needle)==1
   raw=raw.replace(needle,b'emit(w, op == RAW_RCP ? "1.0 * (" : "sqrt(");')
  (d/n).write_bytes(raw)
common=['-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']
common+=['-I'+str(S/x) for x in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']]
tail=[S/'generated/u_format_table.c',S/'vendor/src/vrend/vrend_shader.c',*sorted((S/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),S/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',S/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',S/'vendor/src/mesa/util/u_debug.c']
commands={}
for label in ['current','parent','sabotage-dot','sabotage-reciprocal']:
 command=['clang',*common,'-g','-O1','-dynamiclib',str(T/label/'bridge.c'),str(T/label/'raw_bits.c'),*map(str,tail),'-lm','-o',str(T/(label+'.dylib'))]
 commands[label]=command
 subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
(V/'builds.json').write_text(json.dumps({'directory':str(T),'commands':commands,'runtimeDigests':identity,'libraries':{n:hashlib.sha256((T/(n+'.dylib')).read_bytes()).hexdigest() for n in commands}},indent=2)+'\n')
print(T)
