#!/usr/bin/env python3
"""Require the finest V8 counter to execute every changed runtime operand."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE='e1066c663b64df546f9644f1a25508b4e71db636'
SOURCE='renderer/virgl-command/resources.mjs'
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def main(directory):
    directory=Path(directory).resolve()
    source=(ROOT/SOURCE).read_text()
    scripts=[]
    for name in ['hardware-replay','hardware-limits','hardware-historical']+['hardware-lifetime-'+s for s in ['0x501bc239','0x98ef03a7','0xdd31658b']]:
        report=json.loads((directory/name/'report.json').read_text())
        assert report['status']=='passed'
        coverage=json.loads((directory/name/'browser-coverage.json').read_text())
        assert coverage['sourceBody']==source
        rows=[s for s in coverage['scripts'] if s['url'].endswith('/'+SOURCE) and '/predecessor/' not in s['url']]
        assert len(rows)==1
        scripts.append((name,rows[0]))
    diff=subprocess.check_output(['git','diff','--unified=0',BASE,'--',SOURCE],cwd=ROOT,text=True)
    changed=set()
    for line in diff.splitlines():
        match=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',line)
        if match:
            start,count=int(match[1]),int(match[2] or 1)
            changed.update(range(start,start+count))
    offset=0;predictions=[]
    for number,line in enumerate(source.splitlines(keepends=True),1):
        start=offset;offset+=len(line.encode('utf-16-le'))//2
        if number not in changed:
            continue
        if not line.strip() or line.lstrip().startswith(('//','/*','*')) or line.strip()=='}':
            predictions.append(dict(line=number,text=line.rstrip(),verdict='waived',reason='Comment/whitespace/closing delimiter introduces no runtime operand.'))
            continue
        failures=[];citations=[]
        for i,c in enumerate(line):
            if c.isspace() or c in '{};,':
                continue
            at=start+len(line[:i].encode('utf-16-le'))//2
            positive=[]
            for name,script in scripts:
                applicable=[r for f in script['functions'] for r in f['ranges'] if r['startOffset']<=at<r['endOffset']]
                assert applicable,(number,at)
                finest=min(r['endOffset']-r['startOffset'] for r in applicable)
                selected=[r for r in applicable if r['endOffset']-r['startOffset']==finest]
                if all(r['count']>0 for r in selected):
                    positive.append(dict(record=name,offset=at,ranges=selected))
            if not positive:
                failures.append(at)
            elif not citations:
                citations=positive
        predictions.append(dict(line=number,text=line.rstrip(),verdict='executed' if not failures else 'needs-evidence',uncoveredOffsets=failures,citations=citations))
    assert predictions
    result=dict(schema='resource-capacity-coverage-v1',gitHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),predecessor=BASE,source=SOURCE,sha256=sha(source.encode()),predictions=predictions,zero=[r['line'] for r in predictions if r['verdict']=='needs-evidence'])
    (directory/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    assert not result['zero'],result['zero']
    print(f"Finest V8 coverage: {sum(r['verdict']=='executed' for r in predictions)} changed runtime lines executed, {sum(r['verdict']=='waived' for r in predictions)} exact non-runtime waivers")


if __name__=='__main__':main(sys.argv[1])
