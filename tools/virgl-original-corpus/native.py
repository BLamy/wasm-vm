#!/usr/bin/env python3
"""Recorded native complete original API results and hostile-input recovery."""
import argparse,json,os,random,struct,subprocess
from pathlib import Path
from shared import ROOT,MANIFEST,binding,head,inventory,pair_metadata,require,same,sha
SOURCES=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/bridge.h','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/raw_binary32.h','renderer/virgl-shader/checked_upstream.c','renderer/virgl-shader/checked_upstream.h','renderer/virgl-shader/build.sh','renderer/virgl-shader/native_tests/original_corpus.c','tools/virgl-original-corpus/native.py','tools/virgl-original-corpus/shared.py','renderer/virgl-shader/tests/original-corpus.json','renderer/virgl-shader/tests/captured-invalid.json','renderer/virgl-shader/tests/captured-grammar-migrations.json']
def attacks(originals):
    cases=json.loads((ROOT/'renderer/virgl-shader/tests/captured-invalid.json').read_bytes())
    migrations=json.loads((ROOT/'renderer/virgl-shader/tests/captured-grammar-migrations.json').read_bytes())['migrations']
    admitted={e['name']:e for e in migrations};require(len(admitted)==4,'exact four historical grammar migrations')
    result=[]
    for e in cases:
        migration=admitted.get(e['name'])
        if migration:require(e['stage']==migration['stage'] and sha(e['text'].encode())==migration['inputSha256'],'literal grammar migration input')
        result.append(dict(e,kind='grammar',reject=migration is None,**({'admittedMetadata':migration['metadata']} if migration else {})))
    for e in originals:
        result.append(dict(name='wrong-stage-'+e['sha256'],stage='fragment' if e['stage']=='vertex' else 'vertex',text=e['text'],kind='wrong-stage',reject=True))
        for suffix in ('\nBAD_OPCODE TEMP[0], IMM[0]\n','\nDCL CONST[46]\n'):
            result.append(dict(name='suffix-'+e['sha256']+'-'+str(len(suffix)),stage=e['stage'],text=e['text']+suffix,kind='grammar',reject=True))
    for seed in (0x61c80df,0xace509d1,0x37ab48c9):
        rng=random.Random(seed)
        for i in range(64):
            e=originals[rng.randrange(19)];raw=bytearray(e['text'].encode());offset=rng.randrange(len(raw));raw[offset]=rng.randrange(32,127)
            result.append(dict(name=f'mutation-{seed}-{i}',stage=e['stage'],text=raw.decode(),kind='mutation',reject=False,seed=seed,offset=offset))
    return result
def main():
    p=argparse.ArgumentParser();p.add_argument('--binary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
    manifest,originals,pairs=inventory();negative=attacks(originals);stream=bytearray(b'VGC6'+struct.pack('<I',19))
    for e in originals:
        raw=e['text'].encode();stream+=struct.pack('<II',int(e['stage']=='fragment'),len(raw))+raw
    stream+=struct.pack('<I',len(negative))
    for e in negative:
        raw=e['text'].encode();stream+=struct.pack('<II',int(e['stage']=='fragment'),len(raw))+raw
    (out/'input.bin').write_bytes(stream);binary=a.binary.resolve();env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1',LLVM_PROFILE_FILE=str(out/'native.profraw'))
    run=subprocess.run([str(binary)],input=stream,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=240);(out/'native.log').write_bytes(run.stdout)
    require(run.returncode==0,'actual native sanitizer process failed: '+run.stdout[-1500:].decode(errors='replace'))
    seen=dict(ORIGINAL=0,PAIR=0,ATTACK=0);stats=None
    for line in run.stdout.decode().splitlines():
        kind=line.split(' ',1)[0]
        if kind in seen:
            _,index,body=line.split(' ',2);index=int(index);require(index==seen[kind],'complete ordered native outputs');result=json.loads(body)
            e=(originals if kind=='ORIGINAL' else pairs if kind=='PAIR' else negative)[index];e['result']=result;seen[kind]+=1
            require(type(result['ok']) is bool,'typed outcome')
            if kind=='ORIGINAL':require(result['ok'] and same(result['metadata'],e['metadata']),'explicit original metadata and contracts')
            if kind=='PAIR':
                require(result['ok']==e['ok'],'literal original compatibility')
                if e['ok']:
                    v,f=next(x for x in originals if x['sha256']==e['vertex']),next(x for x in originals if x['sha256']==e['fragment'])
                    require(same(result['vertex']['metadata'],pair_metadata(v,f)) and same(result['fragment']['metadata'],f['metadata']),'pair retains complete original contracts and literal consumer interpolation')
                else:require(result['error']['code'] in ('incompatible-interface','unsupported-feature'),'bounded incompatible pair')
            if kind=='ATTACK' and e['reject']:require(not result['ok'],'hostile input accepted '+e['name'])
            if kind=='ATTACK' and 'admittedMetadata' in e:require(result['ok'] and same(result['metadata'],e['admittedMetadata']),'explicit historical admission metadata')
        elif kind=='STATS':stats=json.loads(line.split(' ',1)[1])
    require(seen==dict(ORIGINAL=19,PAIR=88,ATTACK=len(negative)) and stats is not None,'complete native transcript')
    require(stats==dict(originals=19,pairs=88,attacks=len(negative),calls=107+3*len(negative)+8*107,recoveries=2*len(negative)+8*107,rounds=8),'native recovery accounting')
    versions={name:subprocess.check_output(command,text=True).splitlines()[0] for name,command in [('clang',['clang','--version']),('python',['python3','--version'])]}
    report=dict(schema='original-corpus-native-v1',status='passed',gitHead=head(),manifest=binding(MANIFEST),sources=[binding(ROOT/x) for x in SOURCES],originals=originals,pairs=pairs,attacks=negative,stats=stats,tools=versions,binary=binding(binary),input=binding(out/'input.bin',out),log=binding(out/'native.log',out),profile=binding(out/'native.profraw',out))
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(status='passed',stats=stats)))
if __name__=='__main__':main()
