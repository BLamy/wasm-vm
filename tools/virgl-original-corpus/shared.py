"""Exact original and source identities for the integration acceptance."""
import copy
import hashlib
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'renderer/virgl-shader/tests/original-corpus.json'
def require(value, label):
    if not value: raise ValueError(label)
def sha(value): return hashlib.sha256(value).hexdigest()
def read(path): return json.loads(Path(path).read_bytes())
def same(a, b): return json.dumps(a, sort_keys=True, allow_nan=False) == json.dumps(b, sort_keys=True, allow_nan=False)
def binding(path, base=ROOT):
    path=Path(path);raw=path.read_bytes()
    return dict(path=str(path.relative_to(base)),bytes=len(raw),sha256=sha(raw))
def head(): return subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
def source(item, frozen):
    path=ROOT/item['path']; require(same(binding(path),item),'current source '+item['path'])
    if not item['path'].startswith('renderer/virgl-shader/build/'):
        require(path.read_bytes()==subprocess.check_output(['git','show',f'{frozen}:{item["path"]}'],cwd=ROOT),'frozen source '+item['path'])
def pair_metadata(vertex, fragment):
    metadata=copy.deepcopy(vertex['metadata'])
    for output in metadata['outputs']:
        for incoming in fragment['metadata']['inputs']:
            if output['semantic']=='GENERIC' and output['semanticIndex']==incoming['semanticIndex']:
                output['interpolation']=incoming['interpolation']
    return metadata
def inventory():
    manifest=read(MANIFEST);require(manifest['schema']=='unchanged-original-shader-corpus-v1','manifest schema')
    originals=sorted(manifest['originals'],key=lambda e:(e['stage']!='vertex',e['sha256']))
    require(len(originals)==19 and len({e['sha256'] for e in originals})==19,'nineteen unique originals')
    for e in originals:
        require(same(binding(ROOT/e['path']),{k:e[k] for k in ('path','bytes','sha256')}),'original bytes and identity')
        e['text']=(ROOT/e['path']).read_text()
    vs=[e for e in originals if e['stage']=='vertex'];fs=[e for e in originals if e['stage']=='fragment']
    require((len(vs),len(fs))==(8,11),'complete stage inventory')
    pairs=[]
    for v in vs:
        for f in fs:
            outputs={e['semanticIndex']:e['writtenMask'] for e in v['metadata']['outputs'] if e['semantic']=='GENERIC'}
            compatible=all(i['semanticIndex'] in outputs and outputs[i['semanticIndex']]&i['componentMask']==i['componentMask'] for i in f['metadata']['inputs'])
            pairs.append(dict(vertex=v['sha256'],fragment=f['sha256'],ok=compatible))
    require(sum(e['ok'] for e in pairs)==57 and len(pairs)==88,'literal declared-interface partition')
    return manifest, originals, pairs
