#!/usr/bin/env python3
"""Fresh critic: derive scalar TGSI equations from source before carrier decoding.
The unchanged pinned converter's componentwise discrepancy stays explicit. No
compiled shader, stored oracle or observed result constructs an expectation.
"""
import argparse,hashlib,json,re,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/virgl-exponent-logarithm'))
from reference import predict,accepts
sha=lambda b:hashlib.sha256(b).hexdigest()
LANES='xyzw'
def execute(text,bank,backend):
 registers={('CONST',i):bank[4*i:4*i+4] for i in range(len(bank)//4)};stack=[];active=True
 def source(token):
  m=re.fullmatch(r'(-?)(IMM|TEMP|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',token.strip());assert m,token
  neg,file,index,sw=m.groups();v=registers[(file,int(index))];assert len(v)==4
  values=[v[LANES.index(c)] for c in sw or LANES]
  if neg:assert all(isinstance(w,int) for w in values);values=[w^0x80000000 for w in values]
  return values
 for raw in text.splitlines():
  line=re.sub(r'^\d+:\s*','',raw.strip())
  if not line or line in ['VERT','FRAG','END'] or line.startswith('DCL '):continue
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}',line);assert m,line
   registers[('IMM',int(m[1]))]=[int(w.strip()) for w in m[2].split(',')];continue
  if line.startswith('UIF '):stack.append((active,source(line[4:])[0]!=0));active=active and stack[-1][1];continue
  if line=='ELSE':active=stack[-1][0] and not stack[-1][1];continue
  if line=='ENDIF':active=stack.pop()[0];continue
  # The next instruction begins the diagnostic carrier, after all test behavior.
  if line.startswith(('AND TEMP[1], TEMP[0]','USHR TEMP[1], TEMP[0]')):break
  if not active:continue
  op,args=line.split(' ',1);parts=[s.strip() for s in args.split(',')]
  m=re.fullmatch(r'TEMP\[(\d+)\](?:\.([xyzw]+))?',parts[0]);assert m,line
  index,mask=int(m[1]),m[2] or LANES;src=[source(s) for s in parts[1:]]
  if op=='MOV':result=src[0].copy()
  elif op in ['EX2','LG2']:
   assert len(src)==1 and all(isinstance(v,int) for v in src[0])
   result=[(op,src[0][i if backend=='mesa' else 0]) for i in range(4)]
  elif op in ['AND','OR','UADD']:
   assert all(isinstance(v,int) for s in src for v in s)
   result=[(a&b if op=='AND' else a|b if op=='OR' else (a+b)&0xffffffff) for a,b in zip(*src)]
  else:raise AssertionError('unexpected operand producer '+op)
  previous=registers.get(('TEMP',index),[None]*4).copy()
  for c in mask:previous[LANES.index(c)]=result[LANES.index(c)]
  registers[('TEMP',index)]=previous
 assert not stack and all(x is not None for x in registers[('TEMP',0)])
 return [predict(*v) if isinstance(v,tuple) else {'exact':v} for v in registers[('TEMP',0)]]
def allowed(r,w):return r['exact']==w if 'exact'in r else accepts(r,w)
def bank(v,x=None):
 if x is not None and x['bankUpload']:return x['bankUpload']['words']
 if x is None and v['bankUpload']:return v['bankUpload']['words']
 return []
def inspect(path):
 raw=path.read_bytes();j=json.loads(raw);a=j['acceptance']
 assert j['browserErrors']=={'console':[],'page':[],'requests':[]}
 assert j['browser']['launch']['headless'] is False and j['browser']['gpu']['featureStatus'][j['browser']['webglFeature']]=='enabled'
 assert not re.search(r'software|swiftshader|llvmpipe|softpipe',a['renderer']['renderer'],re.I)
 assert a['objects']['live']==0 and a['guestExecution'] is False and a['productionNegotiation'] is False
 summary={'path':str(path),'sha256':sha(raw),'renderer':a['renderer'],'words':0,'pixels':0,'byBackend':{},'points':[],'captures':[],'deviations':[],'consumers':[]};sources=[]
 for vi,v in enumerate(a['vertices']):
  assert sha(v['text'].encode())==v['textSha256'];assert v['mutation'] is None or v['mutation']['served']==v['mutation']['original'].replace(v['mutation']['needle'],v['mutation']['replacement'],1)
  shader=v['mutation']['served'] if v['mutation'] else v['primary']['glsl'] if v['backend']=='mesa' else v['pair']['vertex']['glsl'];sources.extend([shader,v['pair']['fragment']['glsl']])
  assert [(r['name'],r['type'],r['size'])for r in v['reflection']]==[('gl_Position',35666,1),('vso_g0',35666,1),('vso_g1',35666,1)]
  if v['backend']=='mesa':assert all(o['sourceType']==o['destinationType']==4 and o['outputMode']==2 for o in v['primary']['exponentInstructions'])
  for xi,x in enumerate(v['vectors']):
   truth=execute(v['text'],bank(v,x),v['backend']);b=bytes(x['bytes']);actual=list(struct.unpack('<12I',b))
   assert sha(b)==x['sha256'] and actual==x['observed'];assert actual[:4]==[struct.unpack('<I',struct.pack('<f',w))[0] for w in x['position']]==x['attributeWords']
   reconstructed=[((actual[8+i]&511)<<23)|(actual[4+i]&0x7fffff) for i in range(4)]
   assert reconstructed==x['reconstructed'];assert all(actual[4+i]==(w&0x7fffff)|0x3f000000 and actual[8+i]==(w>>23)|0x3f000000 for i,w in enumerate(reconstructed))
   assert all(allowed(r,w)for r,w in zip(truth,reconstructed)),('vertex',vi,'vector',xi,'source',v['textSha256'],'point',x['sha256'],'observed',reconstructed,'expected',truth)
   assert truth==x['oracles'],'stored oracle must agree with independent source equations'
   if v['backend']=='mesa':
    scalar=execute(v['text'],bank(v,x),'owned')
    if scalar!=truth and not all(allowed(r,w)for r,w in zip(scalar,reconstructed)):
     summary['deviations'].append({'vertex':vi,'vector':xi,'sourceSha256':v['textSha256'],'captureSha256':x['sha256'],'observed':reconstructed,'specified':scalar})
   if x['bankUpload']:
    u=x['bankUpload'];w=u['words'];assert w[:4]==u['observedA']==v['input']['a'] and w[172]==x['condition'] and all(n==0xdeadbeef for n in u['callerAfter'])
    if u['observedB'] is not None:assert w[180:184]==u['observedB']==v['input']['b']
   summary['words']+=12;summary['byBackend'].setdefault(v['backend'],{'words':0,'pixels':0})['words']+=12
   if vi<4 or v.get('capture'):summary['points'].append({'vertex':vi,'vector':xi,'sha256':x['sha256'],'observed':actual,'reconstructed':reconstructed})
  if v.get('capture'):
   c=v['capture'];p=ROOT/c['path'];assert sha(p.read_bytes())==c['sha256'];literal=p.read_text().splitlines()[c['line']-1].split(':',1)[1].strip();assert literal==c['statement'] and c['statement']in v['text']
   assert execute(v['text'],bank(v,v['vectors'][0]),'owned')==execute(v['text'],bank(v,v['vectors'][0]),'mesa'),'literal captured broadcast must satisfy scalar equations'
   summary['captures'].append({'vertex':vi,'backend':v['backend'],**c})
 for fi,f in enumerate(a['fragments']):
  assert sha(f['text'].encode())==f['textSha256'];sources.extend([f['pair']['vertex']['glsl'],f['primary']['glsl'] if f['backend']=='mesa' else f['pair']['fragment']['glsl']])
  truth=execute(f['text'],bank(f),f['backend'])[f['lane']];b=bytes(f['rgbaBytes']);actual=list(struct.unpack('<16I',b))
  assert sha(b)==f['sha256'] and actual==f['reconstructed'] and len(actual)==16
  assert all(allowed(truth,w)for w in actual),('fragment',fi,'capture',f['sha256'],'observed',actual,'expected',truth)
  assert truth==f['oracle'];summary['pixels']+=16;summary['byBackend'].setdefault(f['backend'],{'words':0,'pixels':0})['pixels']+=16
 for ci,c in enumerate(a['consumers']):
  assert len(c['captures'])==6 and len(c['submissions'])==5;assert all(x==0 for x in c['finalBudgets'].values())and all(x==0 for x in c['finalResourceBudgets'].values())
  assert all(all(b==255 for b in s['after'])for s in c['submissions']);assert all(s['result']['ok']is True for s in c['submissions'][:-1]);r=c['rejection'];assert r['before']==r['after'] and r['result']['ok']is False and r['result']['appliedCommands']==0
  banks=[]
  for cap in c['captures']:
   w=cap['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];assert len(w)==2 and w[0]==w[1] and len(w[0])==184;banks.append(w[0]);assert cap['native']
   assert {u['name']for u in cap['native']}=={'vsconst0','fsconst0'};assert all(u['words']==w[0][4*u['index']:4*u['index']+4] for u in cap['native'])
  assert banks[0]==banks[1]==banks[4]==banks[5] and banks[2]==banks[3] and banks[0]!=banks[2]
  summary['consumers'].append({'index':ci,'op':c['op'],'asynchronous':c['asynchronous'],'A':banks[0][:4],'B':banks[2][:4],'disposed':True})
 emitted=[e['source']for e in a['events']if e['call']=='shaderSource'];assert emitted[:len(sources)]==sources
 tail=emitted[len(sources):];assert len(tail)==8
 for c,vs,fs in zip(a['consumers'],tail[::2],tail[1::2]):assert ('/* exponent:'+c['op']+' */')in vs and ('/* exponent:'+c['op']+' */')in fs and 'raw_saturate'in vs and 'raw_saturate'in fs
 assert all(e['status']is True for e in a['events']if e['call']in ['compileShader','linkProgram'])
 summary['sourceSequence']={'probeShaders':len(sources),'consumerShaders':len(tail),'sha256':sha(json.dumps(emitted,separators=(',',':')).encode())}
 assert len(summary['captures'])==36 and len({(c['path'],c['line'])for c in summary['captures']})==18
 assert j['status']==a['status']=='passed' and summary['words']==a['checkedWords'] and summary['pixels']==a['checkedPixels']
 return summary
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--report',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
 r={'schema':'virgl-exponent-logarithm-critic-capture-guards-v1','task':'E6-T12g6i','status':'running','testSha256':sha(Path(__file__).read_bytes()),'reportSha256':sha(a.report.read_bytes())}
 try:r['physical']=inspect(a.report.resolve());r['status']='passed'
 except Exception as e:r['status']='failed';r['failure']={'message':str(e)};raise
 finally:a.output.write_text(json.dumps(r,indent=2)+'\n')
 print(r['physical']['words'],'physical words /',r['physical']['pixels'],'pixels predicted from actual TGSI')
if __name__=='__main__':main()
