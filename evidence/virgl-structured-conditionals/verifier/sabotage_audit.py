#!/usr/bin/env python3
import ctypes,hashlib,json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;COMP=ROOT/'renderer/virgl-shader'
summary=json.loads((OUT/'independent-summary.json').read_bytes());command=summary['buildCommand'][:]
source=(COMP/'bridge.c').read_text();before='s->written[file][index] &= saved_written[index];';after='s->written[file][index] |= saved_written[index];';assert source.count(before)==1
scratch=Path(tempfile.mkdtemp(prefix='e7-verifier-union-'));changed=source.replace(before,after);(scratch/'bridge.c').write_text(changed)
command[command.index('bridge.c')]=str(scratch/'bridge.c');command[-1]=str(OUT/'audit-union.dylib')
with (OUT/'sabotage-build.log').open('w') as log:subprocess.run(command,cwd=COMP,stdout=log,stderr=subprocess.STDOUT,check=True)
def load(path):
 lib=ctypes.CDLL(str(path));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p;return lib
clean=load(OUT/'audit-current.dylib');fault=load(OUT/'audit-union.dylib')
header='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0]\nIMM[0] FLT32 {0.125, 0.25, 0.5, 1}\nMOV OUT[0], IMM[0]\n'
rows=[]
for name,body in [('true-only',['UIF IN[0]','MOV TEMP[0].x, IMM[0]','ENDIF']),('false-only',['UIF IN[0]','ELSE','MOV TEMP[0].x, IMM[0]','ENDIF']),('nested-true-only',['UIF IN[0]','UIF IN[0]','MOV TEMP[0].x, IMM[0]','ENDIF','ELSE','MOV TEMP[0].x, IMM[0]','ENDIF'])]:
 text=header+'\n'.join(body+['UIF TEMP[0].xxxx','MOV OUT[0], IMM[0]','ENDIF','END'])+'\n';raw=text.encode();good=json.loads(clean.bridge_translate(1,raw,len(raw)));bad=json.loads(fault.bridge_translate(1,raw,len(raw)));assert good['ok']is False and bad['ok']is True,(name,good,bad)
 rows.append({'name':name,'text':text,'prediction':'reject uninitialized predicate on a reachable predecessor','healthy':good,'sabotaged':bad,'oracle':'deterministic rejected-vs-accepted admission'})
report={'status':'sabotage-detected','sourceHead':summary['sourceHead'],'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'mutation':{'before':before,'after':after,'mutatedSha256':hashlib.sha256(changed.encode()).hexdigest()},'buildCommand':command,'binarySha256':hashlib.sha256((OUT/'audit-union.dylib').read_bytes()).hexdigest(),'cases':rows}
(OUT/'sabotage-results.json').write_text(json.dumps(report,indent=2)+'\n');print('Independent union sabotage detected by3 one-sided-predicate rejection witnesses.')
