from pathlib import Path
import hashlib, json, re, subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
PREVIOUS = 'bef7040804a1c71ad37112e35adcfebefbc4be21'
FROZEN = 'ef30bcccb02f006a72da6c4796134b9c780a828d'
sha = lambda b: hashlib.sha256(b).hexdigest()
paths = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']
coverage = []
for base in [OUT/'unpacked/hot', OUT/'unpacked/cold', OUT/'final-promoted']:
    for p in base.rglob('browser-coverage.json'):
        report = json.loads(p.read_bytes())
        for script in report['scripts']:
            if script['source'] not in paths: continue
            digest = sha((ROOT/script['source']).read_bytes())
            if script['sha256'] != digest: continue  # served sabotage is not clean hunk evidence
            coverage.append({'path':p.relative_to(OUT).as_posix(),'sha256':sha(p.read_bytes()),'script':script})

def hit(row, offset):
    candidates = [r for f in row['script']['coverage']['functions'] for r in f['ranges'] if r['startOffset'] <= offset < r['endOffset']]
    if not candidates: return 0
    # Nested functions/branches take authority over their enclosing ranges.
    span = min(r['endOffset']-r['startOffset'] for r in candidates)
    return max(r['count'] for r in candidates if r['endOffset']-r['startOffset'] == span)

files = []; hunks = []; gaps = []
for name in paths:
    raw = (ROOT/name).read_bytes(); text = raw.decode(); lines = text.splitlines(keepends=True)
    starts = [0]
    for line in lines: starts.append(starts[-1]+len(line.encode('utf-16-le'))//2)
    patch = subprocess.check_output(['git','diff','--unified=0',PREVIOUS,FROZEN,'--',name],cwd=ROOT,text=True)
    current = None; line_number = 0; rows = []
    for item in patch.splitlines():
        header = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(.*)',item)
        if header:
            current = {'file':name,'start':int(header.group(1)),'count':int(header.group(2) or 1),'context':header.group(3).strip(),'added':[]}
            hunks.append(current); line_number = current['start']; continue
        if current is None or item.startswith(('+++','---')): continue
        if item.startswith('+'):
            code = item[1:]; tokens = [m for m in re.finditer(r'[A-Za-z_$][\w$]*|\d+',code) if not code.lstrip().startswith('//')]
            if not tokens:
                row = {'line':line_number,'code':code,'classification':'waived','reason':'structural delimiter/blank/comment; no executable token'}
            else:
                tokens = tokens[:]
                applicable = [r for r in coverage if r['script']['source'] == name]
                witnesses = []
                for token in tokens:
                    prefix = code[:token.start()]; offset = starts[line_number-1] + len(prefix.encode('utf-16-le'))//2
                    seen = [(hit(c,offset),c) for c in applicable]
                    best_count, best = max(seen,key=lambda x:x[0])
                    witnesses.append({'token':token.group(),'offset':offset,'count':best_count,'record':best['path'],'recordSha256':best['sha256']})
                positive = [w for w in witnesses if w['count'] > 0]
                zero = [w for w in witnesses if not w['count']]
                if positive:
                    row = {'line':line_number,'code':code,'classification':'executed','witness':max(positive,key=lambda x:x['count']),'zeroTokens':zero}
                else:
                    row = {'line':line_number,'code':code,'classification':'needs-evidence','tokens':witnesses}; gaps.append({'file':name,**row})
            current['added'].append(row); rows.append(row); line_number += 1
        elif item.startswith(' '): line_number += 1
    files.append({'file':name,'sha256':sha(raw),'addedLines':len(rows),'executedLines':sum(r['classification']=='executed'for r in rows),'waivedLines':sum(r['classification']=='waived'for r in rows)})
result = {'schema':'standard-restart-fresh-runtime-coverage-v1','status':'passed'if not gaps else 'needs-evidence',
          'runtimeHead':FROZEN,'coverageRecords':[{k:r[k]for k in ['path','sha256']}for r in coverage],
          'files':files,'hunks':hunks,'semanticCoverageGaps':gaps}
(OUT/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'files':files,'hunks':len(hunks),'gaps':gaps}))
