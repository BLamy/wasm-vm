#!/usr/bin/env python3
"""Independent original-packet interpreter and actual native range/full-pixel oracle."""
from pathlib import Path
import json,hashlib,gzip,struct,re,math,copy,subprocess
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
fw=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
fl=lambda x:struct.unpack('<f',struct.pack('<I',x))[0]
uw=lambda raw:list(struct.unpack('<'+'I'*(len(raw)//4),raw))
def packets(h):
 raw=bytes.fromhex(h);at=0;rows=[]
 while at<len(raw):
  hd=struct.unpack_from('<I',raw,at)[0];end=at+4+4*(hd>>16);assert end<=len(raw);rows.append((hd&255,(hd>>8)&255,uw(raw[at+4:end]),raw[at:end]));at=end
 assert at==len(raw);return rows
def execute(text,inputs,constant):
 imm={int(n):[fw(float(v)) if typ=='FLT32' else int(v)&0xffffffff for v in values.split(',')] for n,typ,values in re.findall(r'^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}',text,re.M)};temps={};out={};addr=0
 def src(o):
  m=re.fullmatch(r'CONST\[(\d+)\]\[(.+)\]',o)
  if m:
   rr=re.fullmatch(r'ADDR\[0\]\.x(?: ([+-]\d+))?',m[2]);return constant(int(m[1]),addr+int(rr[1] or '0') if rr else int(m[2]))
  m=re.fullmatch(r'(IN|IMM|TEMP|OUT)\[(\d+)\](?:\.([xyzw]{4}))?',o);assert m,o
  a={'IN':inputs,'IMM':imm,'TEMP':temps,'OUT':out}[m[1]][int(m[2])];return [a['xyzw'.index(c)] for c in m[3]] if m[3] else list(a)
 for op,args in re.findall(r'^\d+: (\w+)(?: ([^\n]+))?$',text,re.M):
  if op=='END':break
  dest,*sources=[s.strip() for s in args.split(',')];a=src(sources[0]);b=src(sources[1]) if len(sources)>1 else None
  if op=='ARL':assert dest=='ADDR[0].x';addr=math.floor(fl(a[0]));continue
  value=[]
  for k,x in enumerate(a):
   if op=='MOV':v=x
   elif op=='UADD':v=(x+b[k])&0xffffffff
   elif op=='USHR':v=x>>(b[k]&31)
   elif op=='AND':v=x&b[k]
   elif op=='U2F':v=fw(x)
   elif op=='MUL':v=fw(fl(x)*fl(b[k]))
   else:raise AssertionError(op)
   value.append(v)
  m=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',dest);assert m;dst=out if m[1]=='OUT' else temps;row=dst.setdefault(int(m[2]),[0]*4)
  for c in m[3] or 'xyzw':row['xyzw'.index(c)]=value['xyzw'.index(c)]
 return out

def model(frame,uploads):
 public={};contexts={};last=None
 def fresh():return {'objects':{},'shaders':[None,None],'banks':[{},{}],'inline':[[],[]],'elements':[],'buffers':[],'index':None}
 for ordinal,submission in enumerate(frame['history']):
  for c in frame['created']:
   if c['beforeSubmission']==ordinal:public[c['metadata']['id']]=c['generation']
  ctx=contexts.setdefault(submission['ctx'],{'current':0,'subs':{0:fresh()}})
  for op,kind,f,raw in packets(submission['hex']):
   if op==29:ctx['subs'][f[0]]=fresh();continue
   if op==28:ctx['current']=f[0];continue
   if op==30:del ctx['subs'][f[0]];continue
   s=ctx['subs'][ctx['current']]
   if op==1 and kind==4:s['objects'][f[0]]={'stage':f[1],'text':raw[24:].split(b'\0')[0].decode()}
   if op==1 and kind==5:s['objects'][f[0]]={'elements':[dict(zip(['offset','divisor','buffer','format'],f[i:i+4])) for i in range(1,len(f),4)]}
   if op==2 and kind==5:s['elements']=s['objects'][f[0]]['elements']
   if op==31:s['shaders'][f[1]]=s['objects'][f[0]]['text'] if f[0] else None
   if op==6:s['buffers']=[{'stride':f[i],'offset':f[i+1],'id':f[i+2],'generation':public[f[i+2]]} for i in range(0,len(f),3)]
   if op==11:s['index']={'id':f[0],'generation':public[f[0]],'size':f[1],'offset':f[2]}
   if op==27 and f[0]<2 and f[1]<13:
    if f[4]:s['banks'][f[0]][f[1]]={'id':f[4],'generation':public[f[4]],'offset':f[2],'length':f[3]}
    else:s['banks'][f[0]].pop(f[1],None)
   if op==12 and f[0]<2:
    s['banks'][f[0]].pop(f[1],None)
    if f[1]==0:s['inline'][f[0]]=f[2:]
   if op==8:last=copy.deepcopy(s);last['fields']=f
 assert last is not None
 s=last;s['declared']=[{int(a):int(b)+1 for a,b in re.findall(r'^DCL CONST\[(\d+)\]\[0\.\.(\d+)\]',t,re.M)} for t in s['shaders']];s['zeroMask']=sum(1<<st for st in [0,1] if 0 in s['banks'][st] and 0 in s['declared'][st])
 def constant(st):
  def get(slot,i):
   assert slot in s['declared'][st] and 0<=i<s['declared'][st][slot];bank=s['banks'][st].get(slot)
   if bank:
    assert (i+1)*16<=bank['length'];return uw(uploads[bank['generation']][bank['offset']+i*16:bank['offset']+(i+1)*16])
   assert slot==0;return s['inline'][st][i*4:i*4+4]
  return get
 def attrs(index):
  rows=[]
  for e in s['elements']:
   buf=s['buffers'][e['buffer']];raw=uploads[buf['generation']];at=buf['offset']+e['offset']+(buf['stride']*index if buf['stride'] else 0)
   if e['format'] in [31,196,200]:rows.append(uw(raw[at:at+16]));continue
   assert e['format'] in [172,173];n=struct.unpack_from('<I',raw,at)[0];r=[]
   for k in range(4):
    w=2 if k==3 else 10;v=(n>>(k*10))&((1<<w)-1);v=v-(1<<w) if v&(1<<(w-1)) else v;r.append(fw(v if e['format']==172 else max(-1,v/((1<<(w-1))-1))))
   rows.append(r)
  return rows
 f=s['fields']
 if f[3]:
  i=s['index'];raw=uploads[i['generation']];indices=[int.from_bytes(raw[i['offset']+(f[0]+k)*i['size']:i['offset']+(f[0]+k+1)*i['size']],'little') for k in range(f[1])]
 else:indices=list(range(f[0],f[0]+f[1]))
 assert indices==[0,1,2] and f[2]==4 and f[4]==1
 outputs=[execute(s['shaders'][0],attrs(i),constant(0)) for i in indices];assert [[fl(x) for x in o[0]] for o in outputs]==[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]]
 assert all(o.get(1)==outputs[0].get(1) for o in outputs);frag=execute(s['shaders'][1],{0:outputs[0].get(1)},constant(1));s['expected']=[math.floor(max(0,min(1,fl(x)))*255+.5) for x in frag[0]];return s

predqueues={}
summary={'schema':'d17-independent-original-audit-v1','status':'running','runs':[],'frames':0,'pixels':0,'nativeDraws':0,'guestBlocks':0,'regionCustody':[]}
def audit(directory,label,fault=False,predicted=False):
 report=json.loads((directory/'report.json').read_text());assert report['browserErrors']=={'console':[],'page':[],'requests':[]};assert not report['browser']['headless'];assert 'Metal' in report['browserResult'].get('result',report.get('partial'))['gpu']['renderer'];assert not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)',a,re.I) for a in report['browser']['commandLine']);assert report['fixedMemory']['bytes']==16777216
 result=report['partial'] if fault else report['browserResult']['result'];blobs={r['key']:r for r in result['blobs']};cache={}
 def raw(ref):
  assert ref is not None;row=blobs[ref['key']];assert row['sha256']==ref['sha256'];packed=(directory/row['path']).read_bytes();assert sha(packed)==row['gzipSha256'];data=gzip.decompress(packed);assert len(data)==row['bytes'] and sha(data)==row['sha256'];cache[row['key']]=data;return data
 src={r['path']:r['sha256'] for r in report['sources']};variants={r['path']:r['servedSha256'] for r in report.get('criticVariants',[])}
 if report.get('mutation'):variants[report['mutation']['path']]=report['mutation']['servedSha256']
 if report.get('harnessVariant'):variants[report['harnessVariant']['path']]=report['harnessVariant']['servedSha256']
 for served in report['servedFiles']:
  if served['path']=='/':continue
  p=served['path'][1:];assert served['sha256']==variants.get(p,src[p]),p
 coverage=json.loads((directory/report['browserCoverage']['path']).read_text());assert sha((directory/report['browserCoverage']['path']).read_bytes())==report['browserCoverage']['sha256']
 for r in coverage['scripts']:assert r['sha256']==variants.get(r['source'],src[r['source']])
 pairs=[q for run in result.get('runs',[]) for q in run.get('requests',[]) if q['result'].get('ok')]
 frameout=[]
 for f in result['frames']:
  uploads={r['generation']:bytearray(r['metadata']['width']*(1 if r['metadata']['target']==0 else r['metadata']['height']*4)) for r in f['created']}
  for transfer in f['inputs']:
   data=raw(transfer['blob']);assert transfer['layout']['rowCount']==1 and transfer['layout']['rowBytes']==len(data);at=transfer['layout']['offset'];uploads[transfer['resource']['generation']][at:at+len(data)]=data
  s=model(f,uploads);assert f['expected']==s['expected'],f['label']
  if predicted:
   p=predqueues[f['label']].pop(0);assert s['expected']==p['expected'],(f['label'],s['expected'],p['expected']);assert 'bufferZeroMask' not in p or s['zeroMask']==p['bufferZeroMask']
  assert f['history'][-1]['result']['gpuComplete'] is True and f['native'];program=f['dump']['programs'][-1];draw=f['dump']['draws'][-1]['command'];assert [program['vertexTGSI'],program['fragmentTGSI']]==s['shaders'],'complete original shader source identity'
  if not (fault and report.get('fault')=='slot-zero-variant'):assert draw['bufferZeroMask']==s['zeroMask']
  if pairs:
   matches=[q for q in pairs if q['request']['vertexText']==program['vertexTGSI'] and q['request']['fragmentText']==program['fragmentTGSI'] and q['request']['bufferZeroMask']==draw['bufferZeroMask']]
   assert matches,f['label'];assert any(q['result']['vertex']['glsl']==program['vertexESSL300'] and q['result']['fragment']['glsl']==program['fragmentESSL300'] for q in matches),f['label']
  wd=rd=0
  for native in f['native']:
   assert native['name']==('drawElements' if s['fields'][3] else 'drawArrays');assert native['args']==([4,3,5123,0] if s['fields'][3] else [4,0,3]);assert {r['stage']:r['glsl'] for r in native['shaders']}=={35633:program['vertexESSL300'],35632:program['fragmentESSL300']}
   sys=[b for b in native['blocks'] if b['name']=='VirglBlock'];assert len(sys)==1;sys=sys[0];assert [sys['binding'],sys['bytes'],sys['vertex'],sys['fragment']]==[0,656,True,False];expected=bytearray(656);struct.pack_into('<I',expected,640,fw(1));assert raw(sys['storage'])==expected
   assert [[r[k] for k in ['name','type','count','offset','stride']] for r in sys['members']]==[['clipp[0]',35666,8,0,16],['stipple_pattern[0]',5125,32,128,16],['winsys_adjust_y',5126,1,640,0],['alpha_ref_val',5126,1,644,0],['clip_plane_enabled',35670,1,648,0],['drawid_base',5124,1,652,0]]
   for b in native['blocks']:
    if b is sys:continue
    match=re.fullmatch(r'Virgl(VS|FS)Const(\d+)',b['name']);assert match;st=0 if match[1]=='VS' else 1;slot=int(match[2]);n=s['declared'][st][slot];assert b['binding']==1+st*13+slot and b['bytes']==n*16
    used=bool(re.search(r'(?:^|,) CONST\['+str(slot)+r'\]\[',s['shaders'][st],re.M));assert b['fragment' if st==0 else 'vertex'] is False and b['vertex' if st==0 else 'fragment']==used
    assert [[r[k] for k in ['name','type','count','offset','stride','blockIndex']] for r in b['members']]==[[('vs' if st==0 else 'fs')+'const'+str(slot)+'[0]',36296,n,0,16,b['index']]]
    bank=s['banks'][st].get(slot);observed=raw(b['storage'])
    if bank:
     assert [b['resourceId'],b['generation'],b['length']]==[bank['id'],bank['generation'],bank['length']];rd+=b['start']!=bank['offset'];wd+=observed!=uploads[bank['generation']]
    else:assert not used and b['resourceId'] is None and b['start']==0 and b['length']==n*16 and len(observed)==16384 and not any(observed)
    summary['guestBlocks']+=1
   for a in native['attributes']:
    idx=int(a['name'].split('_')[1]);e=s['elements'][idx];buf=s['buffers'][e['buffer']];assert a['enabled']==(buf['stride']!=0);assert a['shaderType']==(35669 if e['format']==200 else 36296 if e['format']==196 else 35666);assert a['integer']==(e['format'] in [196,200] and a['enabled'])
    if a['enabled']:assert [a['resourceId'],a['generation'],a['stride'],a['offset']]==[buf['id'],buf['generation'],buf['stride'],buf['offset']+e['offset']] and raw(a['storage'])==uploads[buf['generation']]
  pixels=raw(f['pixels']);assert len(pixels)==f['width']*f['height']*4;misses=sum(v!=s['expected'][i%4] for i,v in enumerate(pixels));assert (misses>0)==fault,(label,f['label'])
  if not fault:assert wd==rd==0
  else:
   assert 'independent original uniform pixels after completed fence' in report['browserResult']['error']['message']
   if report.get('fault')=='block-word':assert wd>0
   if report.get('fault')=='range-offset':assert rd>0
  frameout.append({'label':f['label'],'expected':s['expected'],'pixelBytes':len(pixels),'pixelSha256':sha(pixels),'wordMismatches':wd,'rangeMismatches':rd,'pixelMismatches':misses});summary['frames']+=1;summary['pixels']+=len(pixels)//4;summary['nativeDraws']+=len(f['native'])
 for run in result.get('runs',[]):
  if 'final' in run:
   for owner in ['renderer','resources']:assert all(v==0 for v in run['final'][owner]['budgets'].values())
   assert run['final']['uniformAccess']['pending']==run['final']['uniformAccess']['submitted']==0
 for suspension in result.get('suspensions',[]):
  action=suspension['action'];good=action in ['unref-reuse','detach','backing'];r=suspension['record'];assert r['result']['ok']==good and len(r['result']['draws'])==(1 if good else 0);point=suspension['point'];assert point['access']['pending']==2 and point['access']['submitted']==0
  if action not in ['resource-dispose'] and not good:assert r['result']['gpuComplete'] is True
 summary['runs'].append({'path':str(directory),'label':label,'reportSha256':sha((directory/'report.json').read_bytes()),'frames':frameout,'blobsAuthenticated':len(cache),'predicted':predicted})
 return result
if __name__=='__main__':
 import sys
 output=Path(sys.argv[1]).resolve()
 for directory in sorted(output.glob('gpu-*')):audit(directory,directory.name)
 audit(output/'sabotage-range', 'sabotage-range',fault=True)
 summary['status']='passed';(output/'independent-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps({k:v for k,v in summary.items() if k!='runs'}))
