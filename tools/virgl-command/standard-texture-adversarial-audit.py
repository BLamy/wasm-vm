#!/usr/bin/env python3
"""Independent literal original-word oracle for seeded native mip retention proof."""
from pathlib import Path
import argparse,gzip,hashlib,json,struct
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(v,m):
 if not v:raise ValueError(m)
def chain(m):return [dict(level=l,width=max(1,m['width']//2**l),height=max(1,m['height']//2**l))for l in range(m['lastLevel']+1)]
def canon(fmt,raw):
 b=bytearray(raw)
 if fmt==2:b[3::4]=bytes([255])*(len(b)//4)
 if fmt==233:
  for i in range(3,len(b),4):b[i]|=192
 return b
def native(fmt,raw):
 if fmt==2:return b''.join(bytes([raw[i+2],raw[i+1],raw[i],255])for i in range(0,len(raw),4))
 if fmt==233:return b''.join(struct.pack('<I',w//1048576%1024+w//1024%1024*1024+w%1024*1048576+3221225472)for(w,)in struct.iter_unpack('<I',raw))
 return bytes(raw)
def source(fmt,w,h,level,seed,p):
 b=bytearray()
 for y in range(h):
  for x in range(w):
   r=(seed+19*x+71*y+29*level+13*p)&0xffffffff;g=(seed+43*x+17*y+61*level+37*p)&0xffffffff;blue=(seed+89*x+53*y+11*level+41*p)&0xffffffff;a=(seed+7*x+31*y+97*level+59*p)&0xffffffff
   b+=struct.pack('<I',blue%1024+g%1024*1024+r%1024*1048576+a%4*1073741824)if fmt==233 else bytes([blue%256,g%256,r%256,a%256]if fmt==2 else[r%256,g%256,blue%256,a%256])
 return b
def parse(raw):
 b=bytes.fromhex(raw);head=struct.unpack_from('<I',b)[0];op=head%256;n=head//65536;need(len(b)==4*(n+1)and op in[9,43,45],'complete original wire');w=struct.unpack_from('<'+'I'*n,b,4)
 return dict(op=op,level=w[1],stride=w[3],x=w[5],y=w[6],width=w[8],height=w[9],offset=0 if op==9 else w[11]if op==43 else w[12],upload=op==9 or(w[12]==1 if op==43 else w[13]==1),inline=b[48:]if op==9 else None)
def padded(raw,w,h,offset,stride,size):
 b=bytearray([0x5d])*size
 for y in range(h):b[offset+y*stride:offset+y*stride+w*4]=raw[y*w*4:(y+1)*w*4]
 return b
def audit(directory,expect_fault=False):
 directory=Path(directory);report=json.loads((directory/'report.json').read_text());need(report['status']==('failed'if expect_fault else'passed'),'expected actual proof status');e=report.get('partial',report['browserResult'].get('result'));need(not report['browser']['headless']and'M4'in e['gpu']['renderer']and'Metal'in e['gpu']['renderer'],'actual headed M4 Metal');need(report['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser errors')
 served={r['path']:r for r in report['servedFiles']}
 for s in report['sources']:
  actual=(directory/'attack.mjs').read_bytes()if s['name']=='attack.mjs'else(directory/'sources'/s['name']).read_bytes();need(sha(actual)==s['sha256']and len(actual)==s['bytes'],'snapshot identity '+s['name']);need(served['/'+s['name']]['sha256']==s['sha256'],'served source identity '+s['name'])
 coverage=json.loads((directory/report['browserCoverage']['path']).read_text())
 for s in coverage['scripts']:need(s['sha256']==served['/'+s['source']]['sha256'],'V8 source identity')
 for k in['screenshot','browserCoverage']:need(sha((directory/report[k]['path']).read_bytes())==report[k]['sha256'],k+' digest')
 need(sha((directory/'run_attack.mjs').read_bytes())==report['runner']['sha256'],'runner source identity')
 blobs={}
 for b in e['blobs']:
  gz=(directory/b['path']).read_bytes();raw=gzip.decompress(gz);need(sha(gz)==b['gzipSha256']and sha(raw)==b['sha256']and len(raw)==b['bytes'],'native/full original blob custody');need(b['key']not in blobs,'unique blob keys');blobs[b['key']]=raw
 rows=[];operations=[]
 for ri,run in enumerate(e['runs']):
  m=run['originalMetadata'];ch=chain(m);state=[canon(m['format'],bytes(l['width']*l['height']*4))for l in ch];versions=[[bytes(b)for b in state]];gpuCount=next((p['operationCount']for p in run['observations']if p['label']=='GPU-only-actual'),None)
  for oi,o in enumerate(run['operations']):
   w=parse(o['wire']);l=(chain(run['replacementMetadata'])if o.get('disposedBeforeFence')else ch)[w['level']];stride=w['stride']or l['width']*4;foot=(w['height']-1)*stride+w['width']*4
   need([o['layout']['level'],o['layout']['levelWidth'],o['layout']['levelHeight']]==[w['level'],l['width'],l['height']],'original selected mip layout')
   if not o.get('rejected')and not o.get('disposedBeforeFence'):
    if w['upload']:
     original=source(m['format'],w['width'],w['height'],w['level'],run['seed'],o['pass']);raw=blobs[o['input']];expected=original if o['asynchronous']and w['op']!=9 else padded(original,w['width'],w['height'],w['offset'],stride,w['offset']+foot)
     need(raw==expected,'literal original source words and full padding')
     if w['op']==9:need(w['inline'][:len(expected)]==expected and len(w['inline'])==4*((len(expected)+3)//4),'literal original inline aligned wire')
     for y in range(w['height']):
      start=((w['y']+y)*l['width']+w['x'])*4;state[w['level']][start:start+w['width']*4]=canon(m['format'],original[y*w['width']*4:(y+1)*w['width']*4])
    elif o.get('output'):
     tight=b''.join(state[w['level']][((w['y']+y)*l['width']+w['x'])*4:((w['y']+y)*l['width']+w['x']+w['width'])*4]for y in range(w['height']));expected=tight if o['asynchronous']else padded(tight,w['width'],w['height'],w['offset'],stride,o['fullBackingBytes']);need(blobs[o['output']]==expected,'complete original native inverse/padding')
     if o['asynchronous']:need(o['fenceCompleted']and o['polls']>=1,'completed original native fence')
   if o.get('revokedAfterReuse'):need(o['discardCompleted']and o['fenceCompleted']and'output'not in o,'revoked old PBO completes discard without publishing')
   operations.append(dict(record=directory.name,run=ri,operation=oi,level=w['level'],opcode=w['op'],asynchronous=o['asynchronous'],fenceCompleted=o.get('fenceCompleted',False),revokedAfterReuse=o.get('revokedAfterReuse',False),disposedBeforeFence=o.get('disposedBeforeFence',False),nativeFault=o.get('nativeFault'),inputSha256=sha(blobs[o['input']])if'input'in o else None,outputSha256=sha(blobs[o['output']])if'output'in o else None,held=True))
   if oi+1==gpuCount:
    l=ch[run['gpuOnly']['level']];need(run['gpuOnly']['rgba']==([17/1023,503/1023,811/1023,1]if m['format']==233 else[47/255,149/255,223/255,83/255]),'literal GPU-only native clear words');pix=struct.pack('<I',811+503*1024+17*1048576+3221225472)if m['format']==233 else bytes([223,149,47,255]if m['format']==2 else[47,149,223,83]);state[l['level']][:]=pix*(l['width']*l['height'])
   versions.append([bytes(b)for b in state])
  for pi,p in enumerate(run['observations']):
   replacement=p['label']=='replacement-independent-zero';l=(chain(run['replacementMetadata'])if replacement else ch)[p['level']];expected=canon(m['format'],bytes(l['width']*l['height']*4))if replacement else versions[p['operationCount']][p['level']];need(blobs[p['expectedGuest']]==expected,'recorded expected bytes independently original-derived');need(p['fenceCompleted']and p['fenceStatuses'][-1]in[37146,37148]and all(x in[37146,37147,37148]for x in p['fenceStatuses']),'actual completed native physical fence statuses');actual=blobs[p['native']];held=actual==native(m['format'],expected);sabotage=p['label']=='native-retained-level-sabotage';need(held==p['held']==(not sabotage),'unchanged original oracle detects actual native corruption')
   rows.append(dict(record=directory.name,jsonPoint=f"/{'partial'if expect_fault else'browserResult/result'}/runs/{ri}/observations/{pi}",run=ri,observation=pi,label=p['label'],level=p['level'],width=l['width'],height=l['height'],texels=l['width']*l['height'],nativeSha256=sha(actual),expectedGuestSha256=sha(expected),nativeFirstWord=struct.unpack_from('<I',actual)[0],expectedNativeFirstWord=struct.unpack_from('<I',native(m['format'],expected))[0],fenceStatus=p['fenceStatuses'][-1],held=held,sabotage=sabotage))
  for retain in run['retention']:
   old=sum(x['width']*x['height']*4 for x in ch);new=sum(x['width']*x['height']*4 for x in chain(run['replacementMetadata']));need(retain['oldTotal']==old and retain['newTotal']==new and retain['newGeneration']>retain['oldGeneration']and retain['oldTextureId']!=retain['newTextureId'],'exact distinct retained original native generations');need(retain['budgets']['gpuBytes']==old+new+ch[0]['width']*ch[0]['height']*4+ch[1]['width']*ch[1]['height']*4,'complete retained chains plus two pending original PBO charges')
  for neg in run['negative']:need(neg['nativeCallsBefore']==neg['nativeCallsAfter'],'all metadata/selected layout negatives reject before native work')
  need(all(v==0 for v in run['final']['budgets'].values()),'all complete resource terminal budgets zero');need(all(o['deleted']==1 for o in run['objects']),'all actual native textures/PBOs/fences/helpers delete once')
  need(any(o.get('nativeFault')=='negative-width-readPixels'for o in run['operations']),'real native readback fault exercised')
  if not expect_fault:need(any(o.get('disposedBeforeFence')for o in run['operations']),'real pending mip disposal and tombstone exercised')
 need(any(c['op']=='readPixels'and c['args'][2]==-1 and c.get('originalArgs')for c in e['nativeCalls']),'actual driver readPixels error provenance')
 if expect_fault:need(e['sabotage']['originalOracleUnchanged']and e['sabotage']['fenceCompleted']and not e['sabotage']['held']and'independent retained-generation original oracle after completed native fence'in report['browserResult']['error']['message'],'unchanged original oracle sabotage after completed native fence')
 (directory/'independent-native-audit.jsonl').write_text(''.join(json.dumps(r)+'\n'for r in rows));(directory/'independent-operation-audit.jsonl').write_text(''.join(json.dumps(r)+'\n'for r in operations))
 return dict(status='passed',record=directory.name,seed=report['seed'],runs=len(e['runs']),nativeObservations=len(rows),texels=sum(r['texels']for r in rows),operations=len(operations),originalFencedReads=sum(bool(r['fenceCompleted'])for r in operations),sabotage=expect_fault,reportSha256=sha((directory/'report.json').read_bytes()),nativeAuditSha256=sha((directory/'independent-native-audit.jsonl').read_bytes()),operationAuditSha256=sha((directory/'independent-operation-audit.jsonl').read_bytes()))
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);parser.add_argument('--fault',action='store_true');args=parser.parse_args();result=audit(args.directory,args.fault);(args.directory/'independent-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
