"""Rebuild verifier-only parent/current/sabotaged public API compilers on this Mac."""
import hashlib,json,pathlib,subprocess
V=pathlib.Path(__file__).resolve().parent
ROOT=V.parents[2]
SOURCE=ROOT/'renderer/virgl-shader'
PARENT='67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de'
for name,digest in json.loads((V/'initial-runtime-digests.json').read_text()).items():
    assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
parent=V/'parent-source';parent.mkdir(exist_ok=True)
for name in ['bridge.c','raw_bits.c','raw_bits.h','bridge.h']:
    (parent/name).write_bytes(subprocess.check_output(['git','show',PARENT+':renderer/virgl-shader/'+name],cwd=ROOT))
sabotage=V/'sabotage-source';sabotage.mkdir(exist_ok=True)
original=(SOURCE/'raw_bits.c').read_text();needle='if (negate) emit(w, "-(");'
assert original.count(needle)==1
(sabotage/'raw_bits.c').write_text(original.replace(needle,'if (negate) emit(w, "(");'))
common=['-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']
includes=['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']
common+=['-I'+str(SOURCE/x) for x in includes]
tail=[SOURCE/'generated/u_format_table.c',SOURCE/'vendor/src/vrend/vrend_shader.c',*sorted((SOURCE/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),SOURCE/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',SOURCE/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',SOURCE/'vendor/src/mesa/util/u_debug.c']
for label,bridge,raw in [('current',SOURCE/'bridge.c',SOURCE/'raw_bits.c'),('parent',parent/'bridge.c',parent/'raw_bits.c'),('sabotage',SOURCE/'bridge.c',sabotage/'raw_bits.c')]:
    subprocess.run(['clang',*common,'-g','-O1','-dynamiclib',str(bridge),str(raw),*map(str,tail),'-lm','-o',str(V/f'audit-{label}.dylib')],check=True,cwd=ROOT)
