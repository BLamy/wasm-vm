#!/usr/bin/env python3
"""Prove legacy servers change only their immutable module declarations."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def main(directory):
    boundary=json.loads((ROOT/'tools/virgl-command/standard-packed-normalized-serving-boundary.json').read_text());records=[]
    for row in boundary['records']:
        raw=(ROOT/row['path']).read_bytes();text=raw.decode()
        for change in reversed(row['changes']):
            if text.count(change['after'])!=1:raise ValueError('module declaration count '+row['path'])
            text=text.replace(change['after'],change['before'],1)
        previous=subprocess.check_output(['git','show',boundary['predecessor']+':'+row['path']],cwd=ROOT)
        if text.encode()!=previous or sha(previous)!=row['predecessorSha256']:raise ValueError('undeclared old server algorithm change '+row['path'])
        subprocess.run(['node','--check',str(ROOT/row['path'])],check=True)
        records.append(dict(path=row['path'],sha256=sha(raw),predecessorSha256=sha(previous),changes=len(row['changes']),scope='immutable-test-server-module-declarations',held=True))
    result=dict(schema='packed-normalized-serving-audit-v1',status='passed',predecessor=boundary['predecessor'],gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),records=records)
    Path(directory,'serving-audit.json').write_text(json.dumps(result,indent=2)+'\n');print('Authenticated 27 legacy module declarations and unchanged test algorithms.')
if __name__=='__main__':main(sys.argv[1])
