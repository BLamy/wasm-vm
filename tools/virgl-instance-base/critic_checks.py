#!/usr/bin/env python3
"""Independent original-word/token and governing-region critic checks."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '2a55ba679abda640781b854d83726d35fca1d98d'
FREEZE = '28e5e7ab42ae52c75713b96ffad37727cceb05d6'
sha = lambda b: hashlib.sha256(b).hexdigest()


def original_words(words, details=False):
    """Read pinned p_shader_tokens.h bit fields, not product/parser helpers."""
    assert (words[0] & 255) + (words[0] >> 8) == len(words)
    at = words[0] & 255
    declarations, sources, all_declarations, instructions, immediates = [], [], [], [], []
    instruction = 0
    while at < len(words):
        w = words[at]; kind = w & 15
        # The original builder starts Instruction.NrTokens at zero and grows it
        # for trailing words; unlike declarations it excludes the first word.
        size = ((w >> 4) & 511) + 1 if kind == 2 else (w >> 4) & (16383 if kind == 1 else 255)
        assert size and at + size <= len(words)
        if kind == 0:
            r = words[at+1]
            semantic_at = at+2 + ((w >> 20) & 1) + ((w >> 22) & 1)
            semantic = words[semantic_at] if (w >> 21) & 1 else None
            d=dict(first=r & 65535,last=r >> 16,file=(w >> 12)&15,mask=(w >> 16)&15,
                   semantic=semantic & 255 if semantic is not None else None,
                   semanticIndex=(semantic >> 8)&65535 if semantic is not None else None,
                   slot=words[at+2]&65535 if (w >> 20)&1 else 0)
            all_declarations.append(d)
            if d['file']==9:
                assert semantic is not None and semantic_at < at+size
                declarations.append({k:d[k] for k in ['first','last','semantic','semanticIndex','mask']})
        if kind==1:
            immediates.append(dict(type=(w>>18)&15,words=words[at+1:at+size]))
        if kind == 2:
            destinations, operands = [], []
            cursor = at+1
            if (w >> 28) & 1: cursor += 1
            if (w >> 29) & 1:
                cursor += 1 + ((words[cursor] >> 8) & 15)
            if (w >> 30) & 1: cursor += 1
            for _ in range((w >> 22) & 3):
                dst = words[cursor]; cursor += 1
                index=(dst>>10)&65535
                if index&32768:index-=65536
                destinations.append(dict(file=dst&15,index=index,mask=(dst>>4)&15))
                if (dst >> 8) & 1: cursor += 1
                if (dst >> 9) & 1:
                    dim = words[cursor]; cursor += 1 + (dim & 1)
            for n in range((w >> 24) & 15):
                src = words[cursor]; cursor += 1
                index = (src >> 6) & 65535
                if index & 32768: index -= 65536
                operand=dict(file=src&15,index=index,negate=src>>31,absolute=(src>>30)&1,
                             swizzle=[(src>>bit)&3 for bit in [22,24,26,28]],slot=0,indirect=(src>>4)&1)
                if src & 15 == 9:
                    sources.append(dict(instruction=instruction, source=n, index=index,
                                        negate=src >> 31, absolute=(src >> 30) & 1,
                                        swizzle=[(src >> bit) & 3 for bit in [22,24,26,28]]))
                if (src >> 4) & 1: cursor += 1
                if (src >> 5) & 1:
                    dim = words[cursor]; cursor += 1 + (dim & 1)
                    slot=(dim>>16)&65535
                    operand['slot']=slot-65536 if slot&32768 else slot
                operands.append(operand)
            assert cursor == at+size, (instruction, cursor, at+size)
            instructions.append(dict(opcode=(w>>13)&255,destinations=destinations,sources=operands))
            instruction += 1
        at += size
    assert at == len(words)
    if details:return dict(declarations=all_declarations,instructions=instructions,immediates=immediates)
    return declarations, sources


def added_lines(names):
    diff = subprocess.check_output(['git','diff','--unified=0',BASE,FREEZE,'--',*names],cwd=ROOT,text=True)
    result, name, line = {}, None, 0
    for row in diff.splitlines():
        if row.startswith('+++ b/'): name = row[6:]
        elif row.startswith('@@'): line = int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and name:
            result.setdefault(name,[]).append(line); line += 1
        elif row.startswith(' '): line += 1
    return result


def finest_coverage(directory):
    sources = ['renderer/virgl-shader/'+n for n in ['bridge.c','standard_emit.c','standard_guard.h','standard.mjs']]
    added = added_lines(sources)
    scopes = {n: [] for n in sources}
    for file in sorted((directory/'coverage').glob('*.json')):
        full = json.loads(file.read_text())
        for unit in full['data']:
            for fn in unit['functions']:
                for n in sources[:-1]:
                    source = (ROOT/n).read_text(); offsets = [0]
                    for line in source.splitlines(keepends=True): offsets.append(offsets[-1]+len(line))
                    regions = []
                    for region in fn['regions']:
                        if region[7] != 0 or not fn['filenames'][region[5]].endswith('/'+n): continue
                        a = offsets[region[0]-1]+region[1]-1; b = offsets[region[2]-1]+region[3]-1
                        if a < b: regions.append(dict(start=a,end=b,count=region[4],original=region))
                    if regions: scopes[n].append(dict(record=file.relative_to(directory).as_posix(),function=fn['name'],regions=regions))
    js = sources[-1]
    for file in sorted(directory.rglob('browser-coverage.json')):
        if 'fault-' in file.as_posix(): continue
        for row in json.loads(file.read_text())['scripts']:
            if row['source'] == js:
                assert row['sha256'] == sha((ROOT/js).read_bytes())
                for fn in row['coverage']['functions']:
                    scopes[js].append(dict(record=file.relative_to(directory).as_posix(),function=fn['functionName'],regions=[dict(start=r['startOffset'],end=r['endOffset'],count=r['count'],original=r) for r in fn['ranges']]))
    for file in sorted((directory/'node-coverage').glob('*.json')):
        for row in json.loads(file.read_text())['result']:
            if row['url'].endswith('/'+js):
                for fn in row['functions']:
                    scopes[js].append(dict(record=file.relative_to(directory).as_posix(),function=fn['functionName'],regions=[dict(start=r['startOffset'],end=r['endOffset'],count=r['count'],original=r) for r in fn['ranges']]))
    rows, waivers = [], []
    for n, lines in added.items():
        source = (ROOT/n).read_text(); offsets = [0]
        for line in source.splitlines(keepends=True): offsets.append(offsets[-1]+len(line.encode('utf-16-le'))//2 if n==js else offsets[-1]+len(line))
        for line in lines:
            a,b = offsets[line-1:line+1]; points={a,b}
            for scope in scopes[n]:
                for r in scope['regions']:
                    for p in [r['start'],r['end']]:
                        if a < p < b: points.add(p)
            points=sorted(points)
            for start,end in zip(points,points[1:]):
                text=source[start:end]
                if n!=js and not text.strip(): continue
                counters=[]
                for scope in scopes[n]:
                    candidates=[r for r in scope['regions'] if r['start']<=start and end<=r['end']]
                    if candidates:
                        smallest=min(r['end']-r['start'] for r in candidates)
                        tied=[r for r in candidates if r['end']-r['start']==smallest]
                        assert len(set(r['count'] for r in tied))==1, (n,line,tied)
                        counters.append(dict(record=scope['record'],function=scope['function'],**tied[0]))
                item=dict(source=n,line=line,start=start,end=end,text=text,counters=counters)
                if not counters:
                    # Exact declaration/signature only; no arbitrary operand waiver.
                    assert n!=js and (text.lstrip().startswith(('bool integer_images,','bool uniform_buffers,','const char *bridge_translate_standard_instance_base','uint32_t packed_signed_inputs,','uint32_t buffer_zero_mask,','const char *fragment_text,','static inline bool standard_has_instance_id','uint32_t signed_inputs,','uint32_t signed_colors,'))), item
                    waivers.append(item)
                else:
                    item['maxCount']=max(c['count'] for c in counters)
                    assert item['maxCount']>0, item
                    rows.append(item)
    result=dict(status='passed',sourceHead=FREEZE,predecessor=BASE,partitions=rows,waivers=waivers,
                javascript=sum(r['source']==js for r in rows),native=sum(r['source']!=js for r in rows),zero=[],fullScopes=scopes)
    assert result['javascript']==33 and result['native']==87 and len(waivers)==11
    return result


def matrix(directory):
    cases=json.loads((directory/'native/cases.json').read_text())['cases']
    native_raw=(directory/'native/native.jsonl').read_bytes()
    assert native_raw==(directory/'native/sanitize.jsonl').read_bytes()
    native=[json.loads(r) for r in native_raw.splitlines()]
    wasm=[json.loads(r) for r in (directory/'native/wasm.jsonl').read_text().splitlines()]
    assert len(native)==len(wasm)==len(cases)==4313
    rows=[]; accepted=historical=stages=operands=0
    semantics={'VERTEXID':11,'INSTANCEID':10,'PCOORD':20}
    for i,(c,n,w) in enumerate(zip(cases,native,wasm)):
        assert n['case']==i and n['result']==w['result']==json.loads(w['response'])
        assert n['result']['ok']==c['okay']
        if c['kind']<22: historical+=1
        if not n['result']['ok']:
            assert set(n['result'])=={'ok','error'} and n['result']['error']['code']==c['code']
            continue
        accepted+=1
        paired=bool(n['result'].get('vertex'))
        for j,record in enumerate(n['originalTokens']):
            text=c['b'] if j else c['a']
            vertex=text.startswith('VERT')
            assert record['rawWords'][1]&15==(1 if vertex else 0)
            declarations,sources=original_words(record['rawWords'])
            assert declarations==record['systemDeclarations'] and sources==record['systemSources']
            expected=[dict(first=int(m[1]),last=int(m[1]),semantic=semantics[m[2]],semanticIndex=0,mask=15) for m in re.finditer(r'^DCL SV\[(\d+)\], (VERTEXID|INSTANCEID|PCOORD)(?:\[0\])?$',text,re.M)]
            assert declarations==expected, (c['name'],declarations,expected)
            body=n['result'][('vertex','fragment')[j]] if paired else n['result']
            if c['kind']>=22:
                have=vertex and any(d['semantic']==10 for d in declarations)
                assert body['metadata']['profile']=='virgl-webgl2-standard-instance-base-gles3-v1'
                assert body['metadata']['instanceUniforms']==([dict(name='wv_instance_base',type='uint',semantic='INSTANCE_BASE',default=0)] if have else [])
                assert ('uniform highp uint wv_instance_base;' in body['glsl'])==have
                for source in sources:
                    d=next(d for d in declarations if d['first']<=source['index']<=d['last'])
                    assert ('uvec4(uint(gl_InstanceID) + wv_instance_base)' if d['semantic']==10 else 'uvec4(uint(gl_VertexID))' if d['semantic']==11 else 'wv_point_coord()') in body['glsl']
                    operands+=1
                rows.append(dict(case=i,name=c['name'],stage='vertex' if vertex else 'fragment',
                                 originalWordsSha256=sha(struct.pack('<'+'I'*len(record['rawWords']),*record['rawWords'])),
                                 declarations=declarations,sources=sources,glslSha256=sha(body['glsl'].encode())))
            else: assert 'instanceUniforms' not in body['metadata']
            stages+=1
    assert accepted==3385 and historical==2586
    allocation=[json.loads(r) for r in (directory/'native/allocations.jsonl').read_text().splitlines()]
    for mode in range(5):
        baseline=next(r for r in allocation if r['kind']=='baseline' and r['mode']==mode)
        for kind,count in [('upstream-fault',baseline['allocations']),('calloc-fault',baseline['callocs'])]:
            faults=[r for r in allocation if r['kind']==kind and r['mode']==mode]
            assert [r['site'] for r in faults]==list(range(1,count+1))
            assert all(set(r['result'])=={'ok','error'} and not r['result']['ok'] for r in faults)
    assert allocation[-1]['faults']==allocation[-1]['recoveries']==165
    facade=json.loads((directory/'native/facade.json').read_text())
    assert len(facade['rejections'])==239 and facade['getters']==0
    assert all(set(r['result'])=={'ok','error'} and not r['result']['ok'] for r in facade['rejections'])
    return dict(status='passed',cases=len(cases),accepted=accepted,historical=historical,
                stages=stages,selectedSystemOperands=operands,records=rows,
                actualAllocationSites=165,strictRefusals=239)


def main(directory):
    directory=Path(directory).resolve()
    m=matrix(directory); c=finest_coverage(directory)
    out=dict(status='passed',matrix=m,coverage=c)
    (directory/'critic-token-coverage.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(dict(status='passed',cases=m['cases'],rawTokenStages=m['stages'],systemOperands=m['selectedSystemOperands'],js=c['javascript'],native=c['native'],zero=[])))


if __name__=='__main__':main(sys.argv[1])
