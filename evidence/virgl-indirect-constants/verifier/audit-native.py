#!/usr/bin/env python3
"""Independent complete-set and predecessor attacks via public C bridge API."""
import ctypes, hashlib, json, os, pathlib, random, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
SRC=ROOT/'renderer/virgl-shader'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def build(mode):
    local=OUT/(mode+'-source'); local.mkdir(exist_ok=True)
    changes=[]
    for name in ('bridge.c','raw_bits.c','bridge.h','raw_bits.h'):
        content=(SRC/name).read_text()
        if mode=='join-fault' and name=='bridge.c':
            old='raw_join(s->raw->address, frame->address) : (struct raw_lane){0};'
            assert content.count(old)==1
            content=content.replace(old,'s->raw->address : (struct raw_lane){0};')
            changes.append({'path':name,'before':old,'after':'s->raw->address : (struct raw_lane){0};'})
        (local/name).write_text(content)
    common=['clang','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1','-g','-O0','-dynamiclib','-fprofile-instr-generate','-fcoverage-mapping']
    includes=['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']
    common += ['-I'+str(local)] + ['-I'+str(SRC/p) for p in includes]
    sources=[local/'bridge.c',local/'raw_bits.c',SRC/'generated/u_format_table.c',SRC/'vendor/src/vrend/vrend_shader.c',*sorted((SRC/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),SRC/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',SRC/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',SRC/'vendor/src/mesa/util/u_debug.c']
    binary=OUT/(mode+'.dylib'); command=common+list(map(str,sources))+['-lm','-o',str(binary)]
    run=subprocess.run(command,cwd=SRC,capture_output=True,text=True)
    (OUT/(mode+'-build.log')).write_text(run.stdout+run.stderr); assert run.returncode==0
    return binary, {'sources':[{'path':str(p.relative_to(ROOT)), 'sha256':sha(p)} for p in sources], 'binarySha256':sha(binary), 'command':command, 'changes':changes}

def shader(stage,body,decl='DCL CONST[0..45]', imm=(0,1,23,45), suffix=None):
    head=['VERT' if stage==0 else 'FRAG','DCL IN[0]'+('' if stage==0 else ', GENERIC[0], PERSPECTIVE'), 'DCL OUT[0], '+('POSITION' if stage==0 else 'COLOR'),'DCL TEMP[0..3]',decl,'DCL ADDR[0]',f'IMM[0] UINT32 {{{", ".join(map(str,imm))}}}','IMM[1] UINT32 {8388607, 1056964608, 0, 1}']
    tail=['MOV TEMP[0], CONST[ADDR[0].x]','AND TEMP[0], TEMP[0], IMM[1].xxxx','OR TEMP[0], TEMP[0], IMM[1].yyyy','MOV OUT[0], TEMP[0]','END'] if suffix is None else suffix
    return '\n'.join(head+body+tail)+'\n'

def expected_cube(a,b):
    mask=a^b; fixed=a&b
    return [i for i in range(64) if i&~mask==fixed]

def cases():
    for stage in (0,1):
        for mask in range(64):
            for bias in range(64):
                # Complete enumeration independent of compiler known-bit helper.
                indices=sorted({(i&mask)|bias for i in range(64)})
                yield f'mask-{stage}-{mask}-{bias}',stage,shader(stage,['AND TEMP[1].x, IN[0].xxxx, IMM[0].xxxx','OR TEMP[1].x, TEMP[1].xxxx, IMM[0].yyyy','UARL ADDR[0].x, TEMP[1].xxxx'],imm=(mask,bias,23,45)),indices if max(indices)<46 else None
        randomizer=random.Random(0xBE19E8+stage)
        for n in range(384):
            a,b=randomizer.randrange(64),randomizer.randrange(64)
            indices=expected_cube(a,b)
            body=['UIF IN[0].xxxx','UARL ADDR[0].x, IMM[0].xxxx','ELSE','UARL ADDR[0].x, IMM[0].yyyy','ENDIF']
            yield f'join-{stage}-{n}-{a}-{b}',stage,shader(stage,body,imm=(a,b,23,45)),indices if max(indices)<46 else None
        for literal in (0,1,23,45,46,47,63,64,0x80000000,0xfffffffe,0xffffffff):
            for component in range(4):
                words=[0xffffffff]*4;words[component]=literal
                yield f'literal-{stage}-{literal}-{component}',stage,shader(stage,['UARL ADDR[0].x, IMM[0].'+'xyzw'[component]*4],imm=words),[literal] if literal<46 else None
        for missing in (0,1,4,5):
            decl='\n'.join(f'DCL CONST[{i}]' for i in (0,1,4,5) if i!=missing)
            body=['AND TEMP[1].x, IN[0].xxxx, IMM[0].xxxx','UARL ADDR[0].x, TEMP[1].xxxx']
            yield f'declaration-hole-{stage}-{missing}',stage,shader(stage,body,decl=decl,imm=(5,1,23,45)),None
        for bad in ('UARL ADDR[0].x, IN[0].xxxx','UARL ADDR[0].x, CONST[ADDR[0].x].xxxx'):
            yield f'stale-{stage}-{bad}',stage,shader(stage,['UARL ADDR[0].x, IMM[0].xxxx',bad]),None
        for name,body in [
          ('unwritten',[]),('one-sided',['UIF IN[0]','UARL ADDR[0].x, IMM[0].xxxx','ENDIF']),
          ('else-unwritten',['UIF IN[0]','MOV TEMP[0], IMM[0]','ELSE','UARL ADDR[0].x, IMM[0].xxxx','ENDIF']),
          ('nested-leak',['UARL ADDR[0].x, IMM[0].wwww','UIF IN[0]','UIF IN[0]','UARL ADDR[0].x, IMM[0].xxxx','ENDIF','ELSE','UARL ADDR[0].x, IMM[0].yyyy','ENDIF'])]:
            indices=expected_cube(0,45|1) if name=='nested-leak' else None
            yield f'{name}-{stage}',stage,shader(stage,body),indices
        for text in ('CONST[1][ADDR[0].x]','CONST[ADDR[0].y]','CONST[ADDR[1].x]','CONST[ADDR[0].x+1]','CONST[ADDR[0].x][0]'):
            s=shader(stage,['UARL ADDR[0].x, IMM[0].xxxx']).replace('CONST[ADDR[0].x]',text)
            yield f'wrong-form-{stage}-{text}',stage,s,None
        # Partial CONST declarations are outside the inherited declaration profile.
        # They reject regardless of which source lane an indirect read consumes.
        for selector in 'xyzw':
            tail=[f'AND TEMP[0], CONST[ADDR[0].x].{selector*4}, IMM[1].xxxx','OR TEMP[0], TEMP[0], IMM[1].yyyy','MOV OUT[0], TEMP[0]','END']
            yield f'lane-hole-{stage}-{selector}',stage,shader(stage,['UARL ADDR[0].x, IMM[0].xxxx'],decl='DCL CONST[0].z',suffix=tail),None
        # A sole indirect UARL must read the prior address even though its new
        # address is unknown and never used afterwards.
        tail=['UARL ADDR[0].x, CONST[ADDR[0].x].xxxx','MOV OUT[0], IN[0]','END']
        yield f'indirect-uarL-last-{stage}',stage,shader(stage,['UARL ADDR[0].x, IMM[0].zzzz'],suffix=tail),[23]

def main():
    mode=sys.argv[1] if len(sys.argv)>1 else 'current'
    binary,binding=build(mode)
    os.environ['LLVM_PROFILE_FILE']=str(OUT/(mode+'.profraw'))
    lib=ctypes.CDLL(str(binary));fn=lib.bridge_translate;fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];fn.restype=ctypes.c_char_p
    accepted=rejected=0; failures=[]; rows=[]
    for name,stage,text,indices in cases():
        raw=text.encode();result=json.loads(fn(stage,raw,len(raw)))
        valid=result['ok'] is (indices is not None)
        if result['ok'] and indices is not None:
            valid=valid and result['metadata']['constantAccesses'][0]['indices']==indices
            valid=valid and result['metadata']['profile']=='virgl-webgl2-raw-bits-v10'
        if indices is not None: accepted+=1
        else:rejected+=1
        row={'name':name,'stage':stage,'input':text,'inputSha256':hashlib.sha256(raw).hexdigest(),'expectedIndices':indices,'result':result,'held':valid}
        rows.append(row)
        if not valid:failures.append(row)
    report={'schema':1,'mode':mode,'binding':binding,'cases':len(rows),'accepted':accepted,'rejected':rejected,'failures':failures}
    (OUT/(mode+'-attack-report.json')).write_text(json.dumps(report,indent=2)+'\n')
    with (OUT/(mode+'-attack-cases.jsonl')).open('w') as f:
        for row in rows:f.write(json.dumps(row,separators=(',',':'))+'\n')
    print(json.dumps({k:report[k] for k in ('mode','cases','accepted','rejected')}),f'failures={len(failures)}')
    for row in failures[:8]:print(row['name'],row['expectedIndices'],json.dumps(row['result'])[:240])
    if mode=='current':assert not failures
    else:assert failures,'Sabotage escaped independent oracle'
if __name__=='__main__':main()
