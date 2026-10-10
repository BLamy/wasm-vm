#!/usr/bin/env python3
"""Independent bounded input matrix and literal standard shader predictions."""
from pathlib import Path
import hashlib,json,re,struct,sys
ROOT=Path(__file__).resolve().parents[2]
VS='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n'
FS='FRAG\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: MOV OUT[0], CONST[0]\n1: END\n'

def program(stage,decl,body):
    return ('VERT' if stage==0 else 'FRAG')+'\n'+decl+'\n'+''.join(f'{i}: {line}\n' for i,line in enumerate(body+['END']))
def sha(b):return hashlib.sha256(b).hexdigest()

def main(out):
    out.mkdir(parents=True,exist_ok=True);cases=[]
    def add(name,a,okay=True,b='',kind=0,code=None):
        cases.append(dict(name=name,kind=kind,a=a,b=b,okay=okay,code=code))
    originals={}
    for fixture in ['renderer/virgl-shader/tests/original-corpus.json','renderer/virgl-shader/tests/gears-originals.json']:
        for item in json.loads((ROOT/fixture).read_text())['originals']:
            digest=item['sha256'];raw=(ROOT/item['path']).read_bytes();assert sha(raw)==digest
            originals[digest]=dict(path=item['path'],sha256=digest,bytes=len(raw),stage=item['stage'],text=raw.decode())
    assert len(originals)==25
    for digest,item in sorted(originals.items()):add('original-'+digest,item['text'],kind=0 if item['stage']=='vertex' else 1)
    def generics(text, direction):
        result={}
        for m in re.finditer(r'DCL '+direction+r'\[\d+\](?:\.([xyzw]+))?, GENERIC\[(\d+)\]',text):
            result[int(m[2])]=sum(1<<'xyzw'.index(c) for c in (m[1] or 'xyzw'))
        return result
    for vd,v in sorted(originals.items()):
        if v['stage']!='vertex':continue
        outputs=generics(v['text'],'OUT')
        for fd,f in sorted(originals.items()):
            if f['stage']!='fragment':continue
            inputs=generics(f['text'],'IN');okay=all(sid in outputs and (mask&outputs[sid])==mask for sid,mask in inputs.items())
            add('original-pair-'+vd+'--'+fd,v['text'],okay,b=f['text'],kind=2,code=None if okay else 'incompatible-interface')
    # Closed operation expectations are handwritten; arities are independently
    # decoded from the pinned TGSI table, never from the structural guard.
    simple='MOV RCP RSQ MUL ADD DP2 DP3 DP4 MIN MAX MAD SUB LRP SQRT FRC FLR ROUND EX2 LG2 POW ABS COS SIN SSG DIV TRUNC CEIL FSEQ FSNE FSLT FSGE I2F U2F F2I F2U UADD UMUL INEG IMIN IMAX UMIN UMAX AND OR XOR NOT SHL ISHR USHR SEQ SNE SLT SGE USEQ USNE USLT USGE ISLT ISGE UCMP DDX DDY'.split()
    table=(ROOT/'renderer/virgl-shader/vendor/src/gallium/auxiliary/tgsi/tgsi_info.c').read_text()
    arities={m[1]:(int(m[2]),int(m[3])) for m in re.finditer(r'\[TGSI_OPCODE_([A-Z0-9_]+)\] = \{ (\d+), (\d+),',table)}
    for op in simple:
        nd,ns=arities[op];assert nd==1
        decl='DCL CONST[0..2]\nDCL OUT[0], COLOR\nDCL TEMP[0]'
        body=[f'{op} TEMP[0], '+', '.join(f'CONST[{i}]' for i in range(ns)),'MOV OUT[0], TEMP[0]']
        add('op-'+op,program(1,decl,body),kind=1)
    for qualifier in ['', '_SAT', '_PRECISE','_SAT_PRECISE']:
        add('suffix'+qualifier,program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',[f'MOV{qualifier} OUT[0], -|CONST[0].wzyx|']),kind=1)
    for mask in ['x','y','z','w','xy','xz','xw','yz','yw','zw','xyz','xyw','xzw','yzw','xyzw']:
        add('mask-'+mask,program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',[f'MOV OUT[0].{mask}, CONST[0].wzyx']),kind=1)
    for typ,values in [('FLT32','0x3f800000, 0x00000000, 0x00000001, 0x80000000'),('FLT32','-1.25, 0.0, 1e2, 3.5e-1'),('UINT32','4294967295, 2147483648, 0, 1'),('INT32','-2147483647, 2147483647, 0, -1')]:
        add('literal-'+typ+values,program(1,f'DCL OUT[0], COLOR\nIMM[0] {typ} {{{values}}}',['MOV OUT[0], IMM[0]']),kind=1)
    add('fragment-system-coordinates',program(1,'PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']),kind=1)
    for prop in [0,1]:add('broadcast-'+str(prop),program(1,f'PROPERTY FS_COLOR0_WRITES_ALL_CBUFS {prop}\nDCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]']),kind=1)
    for stage in [0,1]:
        decl='DCL CONST[0..511]\nDCL TEMP[0..511]\nDCL '+('OUT[0], POSITION' if stage==0 else 'OUT[0], COLOR')
        add('last-registers-'+str(stage),program(stage,decl,['MOV TEMP[511], CONST[511]','MOV OUT[0], TEMP[511]']),kind=stage)
    vs16=program(0,'\n'.join([f'DCL IN[{i}]' for i in range(16)]+['DCL OUT[0], POSITION']+[f'DCL OUT[{i+1}], GENERIC[{i}]' for i in range(16)]),['MOV OUT[0], IN[0]']+[f'MOV OUT[{i+1}], IN[{i}]' for i in range(16)])
    fs16=program(1,'\n'.join([f'DCL IN[{i}], GENERIC[{i}], '+('CONSTANT' if i%2 else 'PERSPECTIVE') for i in range(16)]+['DCL OUT[0], COLOR']),['MOV OUT[0], IN[15]'])
    add('max-generic-pair',vs16,b=fs16,kind=2)
    for sid in range(4):add('color-output-'+str(sid),program(1,f'DCL CONST[0]\nDCL OUT[31], COLOR[{sid}]',['MOV OUT[31], CONST[0]']),kind=1)
    for semantic in ['VERTEXID','INSTANCEID']:
        add('system-'+semantic,program(0,f'DCL SV[0], {semantic}\nDCL OUT[0], POSITION\nDCL TEMP[0]',['I2F TEMP[0], SV[0]','MOV OUT[0], TEMP[0]']))
    for stage in [0,1]:
        add('texture-high-sampler-'+str(stage),program(stage,'DCL '+('IN[0]' if stage==0 else 'IN[0], GENERIC[0], PERSPECTIVE')+'\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nDCL OUT[0], '+('POSITION' if stage==0 else 'COLOR'),['TEX OUT[0], IN[0], SAMP[15], 2D']),kind=stage)
    for address in ['UARL','ARL']:
        add('indirect-'+address,program(1,'DCL CONST[0..3]\nDCL ADDR[0]\nDCL OUT[0], COLOR',[f'{address} ADDR[0].x, CONST[0]','MOV OUT[0], CONST[ADDR[0].x]']),kind=1)
    add('flow-all',program(1,'DCL CONST[0]\nDCL OUT[0], COLOR\nDCL TEMP[0]',[
        'MOV TEMP[0], CONST[0]','BGNLOOP :8','IF CONST[0].xxxx :4','BRK','ELSE :6','BRK','ENDIF','BRK','ENDLOOP :1','UIF CONST[0].yyyy :11','MOV OUT[0], TEMP[0]','ELSE :13','MOV OUT[0], CONST[0]','ENDIF']),kind=1)
    for label,body in [('if-target',['IF CONST[0] :1','MOV OUT[0], CONST[0]','ENDIF']),('else-target',['IF CONST[0] :2','MOV OUT[0], CONST[0]','ELSE :3','MOV OUT[0], CONST[0]','ENDIF']),('loop-target',['BGNLOOP :3','BRK','ENDLOOP :0']),('loop-back',['MOV OUT[0], CONST[0]','BGNLOOP :3','BRK','ENDLOOP :2'])]:
        add('invalid-'+label,program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',body),False,kind=1)
    for op in ['UADD','I2F','UIF']:
        body=[op+' '+('TEMP[0], |CONST[0]|'+(', CONST[0]' if op=='UADD' else '') if op!='UIF' else '|CONST[0]|'),'MOV OUT[0], CONST[0]']+(['ENDIF'] if op=='UIF' else [])
        add('invalid-integer-absolute-'+op,program(1,'DCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR',body),False,kind=1)
    for n in [32,33]:
        a=program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',['UIF CONST[0].xxxx']*n+['MOV OUT[0], CONST[0]']+['ENDIF']*n)
        add('flow-depth-'+str(n),a,n==32,kind=1)
    for n in [767,768]:add('instruction-count-'+str(n+1),program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]']*n),n==767,kind=1)
    for n in [669,670]:
        add('standard-output-bound-'+str(n),program(1,'DCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR',['UCMP_SAT TEMP[0], CONST[0], -|CONST[0]|, -|CONST[0]|']*n+['MOV OUT[0], TEMP[0]']),n==669,kind=1,code=None if n==669 else 'translation-error')
    imm=program(1,'DCL OUT[0], COLOR\n'+'\n'.join(f'IMM[{i}] UINT32 {{0,1,2,3}}' for i in range(32)),['MOV OUT[0], IMM[31]'])
    add('immediate32',imm,kind=1);add('immediate33',imm.replace('0: MOV','IMM[32] UINT32 {0,1,2,3}\n0: MOV'),False,kind=1)
    add('end-only-declared',program(0,'DCL OUT[0], POSITION',[]))
    add('CRLF-owned',VS.replace('\n','\r\n'))
    add('kill',program(1,'DCL OUT[0], COLOR',['KILL']),kind=1)
    add('kill-if',program(1,'DCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]','KILL_IF CONST[0]']),kind=1)
    for body in ['MOV OUT[0], IN[16]','MOV OUT[0], TEMP[512]','MOV OUT[0], CONST[512]','MOV OUT[0], IMM[32]','MOV OUT[0], IN[-1]','MOV OUT[0], IN[4294967295]','MOV OUT[0], IN[000]','MOV OUT[0], IN[0][0]','MOV OUT[0], IN[0].xxxxx','MOV OUT[0].xx, IN[0]','MOV OUT[0], IN[0].x','MOV OUT[0], CONST[ADDR[0].x+1]','MOV OUT[0], TEMP[ADDR[0].x]','MOV ADDR[0].x, IN[0]','MOV IN[0], IN[0]','MOV OUT[0], OUT[0]','MOV OUT[0], SAMP[0]','MOV OUT[0], SVIEW[0]','MUL OUT[0], IN[0]','MUL OUT[0], IN[0], IN[0], IN[0]','SIN_BAD OUT[0], IN[0]','LOAD OUT[0], IN[0]','CAL :0','RET','ATOMUADD OUT[0], IN[0], IN[0]','KILL','DDX OUT[0], IN[0]','ELSE','ENDIF','ENDLOOP','BRK','CONT','END_SAT','UARL OUT[0].x, IN[0]','MOV OUT[0], |IN[0]','MOV OUT[0], IN[0] junk']:
        add('invalid-operand-'+body,program(0,'DCL IN[0]\nDCL OUT[0], POSITION\nDCL CONST[0]\nDCL ADDR[0]',[body]),False)
    for decl in ['DCL TEMP[512]','DCL TEMP[0..4294967295]','DCL TEMP[3..2]','DCL CONST[0][0..511]','DCL CONST[512]','DCL IN[16]','DCL OUT[32], POSITION','DCL SV[2], VERTEXID','DCL SV[0], FACE','DCL OUT[1], GENERIC[16]','DCL IN[0]\nDCL IN[0]','DCL OUT[1], POSITION','DCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[0]','DCL TEMP[0], ARRAY(99999)','DCL SAMP[16]','DCL SVIEW[0], CUBE, FLOAT','DCL SVIEW[0], 2D, UINT','DCL ADDR[1]','DCL IMAGE[0]','DCL BUFFER[0]','IMM[1] UINT32 {0,0,0,0}','IMM[0] UINT32 {4294967296,0,0,0}','IMM[0] INT32 {-2147483648,0,0,0}','IMM[0] FLT32 {1e999999,0,0,0}','IMM[0] FLT32 {0x123456789,0,0,0}','IMM[0] FLT32 {nan,0,0,0}','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1','PROPERTY VS_UNKNOWN 1']:
        add('invalid-declaration-'+decl,program(0,'DCL OUT[0], POSITION\n'+decl,['MOV OUT[0], CONST[0]']),False)
    for prop in ['FS_COORD_ORIGIN UPPER_LEFT','FS_COORD_PIXEL_CENTER INTEGER','FS_COLOR0_WRITES_ALL_CBUFS 2','FS_UNKNOWN 1','FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT']:
        add('invalid-property-'+prop,FS.replace('DCL CONST','PROPERTY '+prop+'\nDCL CONST'),False,kind=1)
    for a,code in [(VS.replace('VERT','FRAG'),'unsupported-stage'),(VS+'3: END\n','unsupported-feature'),(VS.replace('1: END','2: END'),'unsupported-feature'),(VS.replace('1: END',''),'unsupported-feature'),(VS+'\0','invalid-input'),(VS+'\u007f','invalid-input'),(VS+' '*513,'input-too-large'),(VS+'\n'*1533,'input-too-large'),(VS+'\n'*(49153-len(VS)),'input-too-large')]:add('malformed-'+str(len(cases)),a,False,code=code)
    add('line512',VS+' '*512)
    add('line-count1536',VS+'\n'*(1536-len(VS.splitlines())))
    remaining=49152-len(VS);fill=''
    while remaining>512:fill+=' '*512+'\n';remaining-=513
    add('text-exact49152',VS+fill+' '*remaining)
    fsgen=program(1,'DCL IN[0].xy, GENERIC[0], CONSTANT\nDCL OUT[0], COLOR',['MOV OUT[0].xy, IN[0].xyyy'])
    vsgen=program(0,'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[31].xy, GENERIC[0]',['MOV OUT[0], IN[0]','MOV OUT[31].xy, IN[0].wzyx'])
    add('partial-flat-pair',vsgen,b=fsgen,kind=2)
    add('mismatched-pair',VS,False,b=fsgen,kind=2,code='incompatible-interface')
    add('component-mismatch-pair',vsgen.replace('.xy, GENERIC','.x, GENERIC').replace('OUT[31].xy,','OUT[31].x,'),False,b=fsgen,kind=2,code='incompatible-interface')
    # Independent seeded range/number mutation: every candidate is outside the
    # structural extent, including u32 wrapping and negative forms.
    seeds=[0x54a10b23,0xc37a0915,0x9e3779b9]
    for seed in seeds:
        n=seed
        for i in range(80):
            n^=(n<<13)&0xffffffff;n^=n>>17;n^=(n<<5)&0xffffffff;n&=0xffffffff
            add(f'seed-{seed}-{i}',VS.replace('IN[0]',f'IN[{512+n}]'),False)
    # Legacy anchors run through the unchanged public facet, exact bytes are
    # compared native/Wasm and against the authenticated earlier corpus record.
    for item in json.loads((ROOT/'renderer/virgl-shader/tests/original-corpus.json').read_text())['originals']:
        if item.get('probe')=='ordinary':add('legacy-'+item['sha256'],(ROOT/item['path']).read_text(),kind=3 if item['stage']=='vertex' else 4)
    for digest in ['92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba','c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f']:
        add('legacy-still-rejects-'+digest,originals[digest]['text'],False,kind=4)
    # Legal declaration order must not change the maximum bank extent. The
    # upstream Last==0 increment once contradicted these independent maxima.
    orders={
        'zero-last':'DCL CONST[511]\nDCL CONST[0]',
        'intervening-temp':'DCL CONST[10..511]\nDCL TEMP[0]\nDCL CONST[0]',
        'zero-first':'DCL CONST[0]\nDCL CONST[511]',
        'descending-ranges':'DCL CONST[256..511]\nDCL CONST[1..255]\nDCL CONST[0]',
        'descending-all':'\n'.join(f'DCL CONST[{i}]' for i in reversed(range(512))),
        'ascending-all':'\n'.join(f'DCL CONST[{i}]' for i in range(512)),
        'sparse-middle-zero':'DCL CONST[17]\nDCL CONST[0]\nDCL CONST[511]',
        'no-zero':'DCL CONST[1..511]',
        'only-zero':'DCL CONST[0]',
    }
    for stage in [0,1]:
        output='POSITION' if stage==0 else 'COLOR'
        for name,decl in orders.items():
            index=0 if name=='only-zero' else 511
            add(f'constant-order-{stage}-{name}',program(stage,decl+'\nDCL OUT[0], '+output,[f'MOV OUT[0], CONST[{index}]']),kind=stage)
        for name,decl,index in [('duplicate-zero','DCL CONST[511]\nDCL CONST[0]\nDCL CONST[0]',511),('undeclared-hole','DCL CONST[511]\nDCL CONST[0]',1)]:
            add(f'constant-order-reject-{stage}-{name}',program(stage,decl+'\nDCL OUT[0], '+output,[f'MOV OUT[0], CONST[{index}]']),False,kind=stage,code='unsupported-feature')
    add('constant-order-both-stages',program(0,'DCL IN[0]\nDCL CONST[511]\nDCL CONST[0]\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[15]',
        ['MOV OUT[0], IN[0]','ADD OUT[31], CONST[0], CONST[511]']),
        b=program(1,'DCL CONST[511]\nDCL IN[31], GENERIC[15], PERSPECTIVE\nDCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR',
        ['ADD TEMP[0], IN[31], CONST[511]','ADD OUT[0], TEMP[0], CONST[0]']),kind=2)
    # The pinned upstream field counts declarations, not texture reads. Public
    # metadata must still list only the independently decoded TEX read mask.
    for stage in [0,1]:
        output='POSITION' if stage==0 else 'COLOR'
        for sid in [0,15]:
            decl=f'DCL SAMP[{sid}]\nDCL SVIEW[{sid}], 2D, FLOAT\nDCL OUT[0], {output}\nIMM[0] FLT32 {{0,0,0,1}}'
            add(f'unused-sampler-{stage}-{sid}',program(stage,decl,['MOV OUT[0], IMM[0]']),kind=stage)
            other=15-sid
            decl=f'DCL SAMP[{sid}]\nDCL SVIEW[{sid}], 2D, FLOAT\nDCL SAMP[{other}]\nDCL SVIEW[{other}], 2D, FLOAT\nDCL OUT[0], {output}\nIMM[0] FLT32 {{0,0,0,1}}'
            add(f'mixed-used-unused-sampler-{stage}-{sid}',program(stage,decl,[f'TEX OUT[0], IMM[0], SAMP[{sid}], 2D']),kind=stage)
        for missing in ['SAMP','SVIEW']:
            decl=('DCL SVIEW[0], 2D, FLOAT' if missing=='SAMP' else 'DCL SAMP[0]')+f'\nDCL OUT[0], {output}\nIMM[0] FLT32 {{0,0,0,1}}'
            add(f'missing-texture-declaration-{stage}-{missing}',program(stage,decl,['TEX OUT[0], IMM[0], SAMP[0], 2D']),False,kind=stage,code='unsupported-feature')
    report={'schema':'virgl-standard-shader-cases-v1','cases':cases,'originals':list(originals.values()),'seeds':seeds}
    (out/'cases.json').write_text(json.dumps(report,indent=2)+'\n')
    parts=[struct.pack('<I',len(cases))]
    for c in cases:
        parts.append(struct.pack('<I',c['kind']))
        for field in ['a','b']:
            data=c[field].encode();parts.extend([struct.pack('<I',len(data)),data])
    (out/'cases.bin').write_bytes(b''.join(parts))
    print(f'{len(cases)} independent standard/legacy inputs, {len(originals)} complete originals')
if __name__=='__main__':main(Path(sys.argv[1]))
