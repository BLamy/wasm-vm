#!/usr/bin/env python3
"""Check public metadata against separately parsed pinned TGSI records."""
from pathlib import Path
import json, re, sys

def main(directory):
    abi=json.loads((directory.parent/'abi/native.json').read_text())
    cases=json.loads((directory/'cases.json').read_text())['cases']
    rows=[json.loads(l) for l in (directory/'native.jsonl').read_text().splitlines()]
    checked=0
    assert len(cases)==len(rows)
    for case,row in zip(cases,rows):
        assert row['case']==checked
        checked+=1
        result=row['result'];assert result['ok']==case['okay'],case['name']
        if not result['ok']:
            assert set(result)=={'ok','error'}
            if case['code']: assert result['error']['code']==case['code'],case['name']
            continue
        if case['kind']>=3:continue
        pair=case['kind']==2
        fragments={}
        if pair:
            for d in row['oracle'][1]['declarations']:
                if d['file']==abi['TGSI_FILE_INPUT'] and d['semantic']==abi['TGSI_SEMANTIC_GENERIC']:
                    fragments[d['sid']]=d['interpolate']==abi['TGSI_INTERPOLATE_CONSTANT']
        for at,oracle in enumerate(row['oracle']):
            metadata=(result['vertex'] if at==0 else result['fragment'])['metadata'] if pair else result['metadata']
            stage='vertex' if oracle['stage']==abi['TGSI_PROCESSOR_VERTEX'] else 'fragment'
            assert oracle['stage']==abi['TGSI_PROCESSOR_'+stage.upper()]
            assert metadata['stage']==stage
            expected={'inputs':[],'outputs':[],'systemValues':[]}
            constants=0
            for d in oracle['declarations']:
                if d['file']==abi['TGSI_FILE_CONSTANT']:constants=max(constants,d['last']+1)
                field=next((key for key,file in [('inputs','INPUT'),('outputs','OUTPUT'),('systemValues','SYSTEM_VALUE')] if d['file']==abi['TGSI_FILE_'+file]),None)
                if field is None:continue
                assert d['first']==d['last']
                index=d['first'];semantic=next((s for s in ['POSITION','GENERIC','COLOR','VERTEXID','INSTANCEID','PSIZE','PCOORD'] if d['hasSemantic'] and d['semantic']==abi['TGSI_SEMANTIC_'+s]),'ATTRIBUTE')
                flat=semantic=='GENERIC' and ((d['interpolate']==abi['TGSI_INTERPOLATE_CONSTANT']) if field=='inputs' else fragments.get(d['sid'],False))
                name={'ATTRIBUTE':f'in_{index}','POSITION':'gl_Position' if stage=='vertex' else 'gl_FragCoord','GENERIC':f'vso_g{d["sid"]}','COLOR':f'fsout_c{d["sid"]}','VERTEXID':'gl_VertexID','INSTANCEID':'gl_InstanceID','PSIZE':'gl_PointSize','PCOORD':'gl_PointCoord'}[semantic]
                item=dict(index=index,name=name,type='float' if semantic=='PSIZE' else 'int' if field=='systemValues' and semantic!='PCOORD' else 'uvec4' if flat else 'vec4',semantic=semantic,semanticIndex=d['sid'],componentMask=d['mask'])
                if field=='outputs':item['syntacticWriteMask']=oracle['outputWrites'][index]
                if semantic=='GENERIC':item['interpolation']='flat' if flat else 'smooth'
                if semantic=='POSITION' and stage=='fragment':item['interpolation']='linear'
                if semantic=='PCOORD' and field=='inputs':item['interpolation']='linear'
                expected[field].append(item)
            for field in expected:
                expected[field]=sorted(expected[field],key=lambda d:d['index'])
                assert metadata[field]==expected[field],(case['name'],field)
            assert metadata['attributes']==(expected['inputs'] if stage=='vertex' else [])
            raster=[dict(name='wv_point_size',type='vec2',semantic='POINT_SIZE')] if stage=='vertex' else [dict(name='wv_point_coord_y',type='float',semantic='POINT_COORD_Y')] if any(d['semantic']=='PCOORD' for d in expected['inputs']+expected['systemValues']) else []
            assert metadata['rasterUniforms']==raster,(case['name'],'rasterUniforms')
            assert metadata['uniforms']==([dict(name=('vs' if stage=='vertex' else 'fs')+'const0',type='uvec4[]',count=constants,encoding='raw-32bit-words')] if constants else [])
            assert [r['index'] for r in metadata['samplers']]==[i for i in range(16) if oracle['samplersUsed']&(1<<i)]
            source=case['a'] if at==0 else case['b']
            assert oracle['instructions']==len(re.findall(r'^\s*\d+:',source,re.M))
            assert oracle['immediates']==len(re.findall(r'^\s*IMM',source,re.M))
            assert oracle['properties']==len(re.findall(r'^\s*PROPERTY',source,re.M))
            assert metadata['broadcastColor0']==bool(re.search(r'PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\s',source))
            assert metadata['standardSemantics']['exactAuthority'] is False
    report=dict(status='passed',cases=checked,accepted=sum(r['result']['ok'] for r in rows),independentPinnedTgsi=True)
    (directory/'metadata.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Public standard metadata matches independently parsed pinned TGSI declarations and writes.')

if __name__=='__main__':main(Path(sys.argv[1]))
