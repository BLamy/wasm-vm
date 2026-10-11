#!/usr/bin/env python3
"""Authenticate the legacy recorder's complete import closure and original capture."""
import hashlib,json,subprocess,sys
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def main(directory):
    directory=Path(directory);report=json.loads((directory/'retained-z16-consumer/report.json').read_text())
    assert report['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    served={r['path']:r['sha256'] for r in report['servedFiles']};module='renderer/virgl-command/unorm-depth-images.mjs'
    assert served['/'+module]==sha((ROOT/module).read_bytes())
    files={r['path']:r for r in report['sources']+report['inputs']};closure=[]
    for name,row in sorted(files.items()):
        raw=(ROOT/name).read_bytes();assert sha(raw)==row['sha256'] and len(raw)==row['bytes']
        target=directory/'retained-z16-consumer/source'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
        closure.append(dict(path=name,sha256=sha(raw),bytes=len(raw)))
    configs=[];marker="'renderer/virgl-command/floating-depth-images.mjs'";added=", 'renderer/virgl-command/unorm-depth-images.mjs'"
    for name in subprocess.check_output(['git','ls-files','tools/verify-*.mjs'],cwd=ROOT,text=True).splitlines():
        raw=(ROOT/name).read_bytes();text=raw.decode()
        if marker not in text or "'ls-files','renderer/virgl-command'" in text or '"ls-files", "renderer/virgl-command"' in text:continue
        assert marker+added in text,name
        old=subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT)
        assert text.replace(added,'',1).encode()==old,'recorder logic changed beyond import inventory '+name
        subprocess.run(['node','--check',str(ROOT/name)],check=True)
        target=directory/'recorder-source'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
        configs.append(dict(path=name,sha256=sha(raw),bytes=len(raw),predecessorSha256=sha(old),onlyChange='literal-import-inventory'))
    assert len(configs)==25
    (directory/'recorder-closure.json').write_text(json.dumps(dict(status='passed',originalLegacyRecorder=True,nativeShaderAndTransferLogicUnchanged=True,configs=configs,sourceCopies=closure),indent=2)+'\n')
    print('Legacy Z16 original recorder passed; 25 static import inventories authenticated.')
if __name__=='__main__':main(sys.argv[1])
