#!/usr/bin/env python3
"""Replay all authenticated worker inverses in new scratch; never overwrite originals."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]

def main():
    p=argparse.ArgumentParser();p.add_argument('extraction',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();source=a.extraction.resolve();out=a.output.resolve()
    assert not out.exists(),'new independent scratch required';out.mkdir(parents=True)
    records=[];commands=[]
    def run(cmd):
        commands.append(cmd)
        subprocess.run(cmd,cwd=ROOT,check=True)
    for side in ['hot','cold']:
        for mode in ['hardware-matrix','hardware-functions','hardware-segments','hardware-failures','hardware-limits','hardware-absent',
                     'hardware-boundaries-0xd9453211','hardware-boundaries-0x13579bdf','hardware-boundaries-0x9e3779b9',
                     'fault-order','fault-operation','fault-value-mask','fault-completed-output','fault-completed-stencil','retained-common','retained-assembly']:
            dest=out/side/mode;shutil.copytree(source/side/mode,dest)
            if mode.startswith('hardware-'):
                run(['node','tools/virgl-ordered-stencil/values.mjs',str(dest)])
                run(['python3','tools/virgl-ordered-stencil/physical.py',str(dest)])
                run(['python3','tools/virgl-ordered-stencil/critic-audit.py','native',str(dest),str(dest/'fresh-direct-native-audit.json')])
            elif mode.startswith('fault-'):run(['node','tools/virgl-ordered-stencil/values.mjs',str(dest),'--control'])
            elif mode=='retained-common':run(['python3','tools/virgl-stencil/values.py',str(dest)])
            else:run(['node','tools/virgl-ordered-stencil/retained-assembly-values.mjs',str(dest)])
            records.append(dict(side=side,record=mode,status='passed'))
    scripts=['tools/virgl-ordered-stencil/critic-replay.py','tools/virgl-ordered-stencil/critic-audit.py',
             'tools/virgl-ordered-stencil/values.mjs','tools/virgl-ordered-stencil/physical.py',
             'tools/virgl-unorm-depth/lifetimes.py','tools/virgl-ordered-stencil/retained-assembly-values.mjs','tools/virgl-stencil/values.py']
    result=dict(status='passed',sourceExtract=str(source),records=records,commands=commands,
                auditSourceSha256={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in scripts})
    (out/'replay-result.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
