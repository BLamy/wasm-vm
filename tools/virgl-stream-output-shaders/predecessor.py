"""Authenticate direct held proof and archive original source for ABI comparison."""
import hashlib,importlib.util,json,subprocess,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
base='6f43010dfa7b3e08bfe62f62543b7ee0468e1a21'
spec=importlib.util.spec_from_file_location('custody',repo/'tools/virgl-dimensional-depth-surfaces/custody.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
seals=[]
for role,digest in [('worker','71593ab497a192777ed4970ed58537157f217f9de901b9a91f470754d28e7f74'),('verifier','fbac9176df4d3071f2d03759c34b9f9e3166ea8dc2927557e7cd31ebe8375bb2')]:
    directory=repo/'evidence/virgl-dimensional-depth-surfaces'/role;auth,_=module.reopen(directory,digest);seals.append(dict(path=str(directory.relative_to(repo)),**auth))
assert 'status: verified' in subprocess.check_output(['git','show',base+':tasks/epic-6-transcendence/E6-T11d64-dimensional-depth-surfaces.md'],cwd=repo,text=True)
for boundary in ['crates','renderer/virgl-command','tools/guest']:
    assert not subprocess.check_output(['git','diff','--name-only',base,'HEAD','--',boundary],cwd=repo),boundary
body=subprocess.check_output(['git','archive',base,'renderer/virgl-shader'],cwd=repo);(out/'source.tar').write_bytes(body)
with tarfile.open(out/'source.tar') as archive:archive.extractall(out/'baseline',filter='data')
report=dict(status='passed',base=base,held=seals,originalSourceArchiveSha256=module.sha(body),unchangedBoundaries=['crates','renderer/virgl-command','tools/guest'])
(out/'authentication.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
