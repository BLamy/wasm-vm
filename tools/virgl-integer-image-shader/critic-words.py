import gzip,hashlib,json,math,re,struct,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__import__('sys').argv[1]).resolve();OUT.mkdir(parents=True,exist_ok=True);W=OUT/'worker';SRC=W/'source';BASE='d8d510a689cfb5440cc8b3b65fd94adb9baee109';HEAD='3c0a3e348048c0ff293a6b67638a96fb5c3561cb'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def need(v,why):
 if not v:raise AssertionError(why)
def load(p):return json.loads(p.read_text())
def enums(name,header):
 m=re.search(r'enum\s+'+name+r'\s*\{(.*?)\}',header,re.S);need(m,'original enum '+name);body=re.sub(r'/\*.*?\*/|//[^\n]*','',m[1],flags=re.S);v=-1;d={}
 for item in body.split(','):
  token=item.strip()
  if not token:continue
  parts=token.split('=');v=int(parts[1].strip(),0) if len(parts)==2 else v+1;d[parts[0].strip()]=v
 return d
HEADER=(SRC/'renderer/virgl-shader/vendor/src/gallium/include/pipe/p_shader_tokens.h').read_text();TYPES=enums('tgsi_return_type',HEADER);OPS=enums('tgsi_opcode',HEADER);TEX=enums('tgsi_texture_type',HEADER);FILES=enums('tgsi_file_type',HEADER)
HW=(SRC/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_text();formats={}
for m in re.finditer(r'VIRGL_FORMAT_((?:[RGBA](?:8|16|32))+)_([US])INT\s*=\s*(\d+)',HW):
 channels=re.findall(r'([RGBA])(8|16|32)',m[1]);name=m[1]+'_'+m[2]+'INT'
 if ''.join(c for c,b in channels) not in ['R','RG','RGB','RGBA']:continue
 need(len({b for c,b in channels})==1,'homogeneous literal bits');formats[int(m[3])]={'name':name,'components':len(channels),'bits':int(channels[0][1]),'signed':m[2]=='S'}
need(len(formats)==24,'original24 formats')
SAMPLER_TYPE={'FLOAT':('sampler2D',0x8b5e),'SINT':('isampler2D',0x8dca),'UINT':('usampler2D',0x8dd2)}
def views(text):
 d={};rows=[]
 for m in re.finditer(r'^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], 2D, ([A-Z]+)(?:, [A-Z]+)*$',text,re.M):
  first,last,typ=int(m[1]),int(m[2] or m[1]),m[3];rows.append({'first':first,'last':last,'target':TEX['TGSI_TEXTURE_2D'],'returnTypes':[TYPES['TGSI_RETURN_TYPE_'+typ]]*4})
  for slot in range(first,last+1):d[slot]=typ
 return d,rows
def immediates(text,words=False):
 d={}
 for m in re.finditer(r'^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$',text,re.M):
  values=[]
  for value in m[3].split(','):
   if m[2]=='FLT32':v=struct.unpack('<I' if words else '<f',struct.pack('<f',float(value)))[0]
   else:v=int(value,0)&0xffffffff if words else int(value,0)
   values.append(v)
  d[int(m[1])]=values
 return d
TEXTURE_RE=re.compile(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ)(_SAT)?(_PRECISE)? (TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?, (.*), SAMP\[(\d+)\], 2D$',re.M)

def original_operand(text):
 m=re.fullmatch(r'(-)?(\|)?(IMM|IN|TEMP|CONST|SAMP|SV)\[(\d+)\](?:\[(\d+)\])?(?:\.([xyzw]+))?(\|)?',text.strip());need(m,'literal original operand '+text);need(bool(m[2])==bool(m[7]),'balanced source modifier');file={'IMM':'IMMEDIATE','IN':'INPUT','TEMP':'TEMPORARY','CONST':'CONSTANT','SAMP':'SAMPLER','SV':'SYSTEM_VALUE'}[m[3]];swizzle=m[6] or 'xyzw';need(len(swizzle) in [1,4],'original swizzle arity');swizzle=swizzle*4 if len(swizzle)==1 else swizzle
 return {'file':FILES['TGSI_FILE_'+file],'index':int(m[5] or m[4]),'slot':int(m[4]) if m[5] else 0,'negate':int(bool(m[1])),'absolute':int(bool(m[2])),'swizzle':['xyzw'.index(l) for l in swizzle],'indirect':0}

def words(raw,f,pixel):
 width=f['bits']//8;lanes=f['components'];result=[0,0,0,1]
 for lane in range(lanes):
  at=(pixel*lanes+lane)*width;result[lane]=int.from_bytes(raw[at:at+width],'little',signed=f['signed'])&0xffffffff
 return result
def expected(frame,original,x,y):
 text=frame['vertexText'] if frame['stage']=='vertex' else frame['fragmentText'];m=TEXTURE_RE.search(text);need(m,'literal instruction '+frame['name']);imm=immediates(text);mask=m[6] or 'xyzw';op=m[1];width,height,levels=frame['width'],frame['height'],len(original)
 if op=='TXQ':
  level=imm[0][0];need(isinstance(level,int) and 0<=level<levels and 'z' not in mask,'defined query lanes');r=[max(1,width>>level),max(1,height>>level),None,levels]
 else:
  if op=='TXF':level,tx,ty=imm[0][3],imm[0][0],imm[0][1]
  else:
   if op=='TEX':level=0
   elif op=='TXD':
    dx,dy=imm[2],imm[3];rho=max(math.hypot(width*dx[0],height*dx[1]),math.hypot(width*dy[0],height*dy[1]));level=math.floor(math.log2(rho)+.5)
   elif op=='TXB':level=math.floor(math.log2(max(width/frame['frameWidth'],height/frame['frameHeight']))+imm[0][3]+.5)
   else:level=math.floor(imm[0][3]+.5)
   level=min(levels-1,max(0,level));u,v=((x+.5)/frame['frameWidth'],(y+.5)/frame['frameHeight']) if op=='TXB' else imm[0][:2];tx=math.floor(u*max(1,width>>level));ty=math.floor(v*max(1,height>>level));tx=min(max(1,width>>level)-1,max(0,tx));ty=min(max(1,height>>level)-1,max(0,ty))
  need(isinstance(level,int) and level in original,'bounded original level');w,h,raw=original[level];need(0<=tx<w and 0<=ty<h,'defined original fetch');r=words(raw,formats[frame['format']],ty*w+tx)
  if m[2]:
   floats=[struct.unpack('<f',struct.pack('<I',v))[0] for v in r];need(all(math.isfinite(v) and v==0 or math.isfinite(v) and abs(v)>=2**-126 for v in floats),'finite normal SAT input');r=[struct.unpack('<I',struct.pack('<f',min(1.,max(0.,v))))[0] for v in floats]
 r=[r[i] if lane in mask else imm[1][i]&0xffffffff for i,lane in enumerate('xyzw')];need(all(v is not None for v in r),'no undefined word claim')
 if 'MOV TEMP[0], -|TEMP[0].zyxw|' in text:r=[((r[i]&0x7fffffff)^0x80000000) for i in [2,1,0,3]]
 return r

def native_capture(directory,fault=False,input_directory=None,expected_head=HEAD,require_custody=False):
 report=load(directory/'report.json');a=report['acceptance'];need(report['status']==('failed' if fault else 'passed'),'capture status');need(report['gitHead']==expected_head,'capture exact source');need(not report['trackedChanges'],'clean captured compiler and instrumentation source');need(report['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors');b=report['browser'];need(not b['launch']['headless'] and b['gpu']['featureStatus'][b['webglFeature']]=='enabled','headed hardware');need('Apple M4 Max' in a['gl']['renderer'] and 'Metal' in a['gl']['renderer'],'renderer');need(not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',arg,re.I) for arg in b['actualCommandLine']),'native flags')
 blobs={};blob_sources={}
 for item in a['blobs']:
  zipped=(directory/item['path']).read_bytes();raw=gzip.decompress(zipped);need(sha(zipped)==item['gzipSha256'] and sha(raw)==item['sha256'] and len(raw)==item['bytes'],'full blob digest');need(item['key'] not in blobs,'unique blob key');blobs[item['key']]=raw;blob_sources[item['key']]=item['path']
 normal=not fault;need(len(a['frames'])==(542 if normal else 1),'frame matrix');mismatches=[];source_words=original_bytes=output_words=planes=0;observations=[];op_counts={};signed_extremes=uint_high=False
 input_directory=input_directory or directory.parent/'native';native=[json.loads(row) for row in (input_directory/'native.jsonl').read_text().splitlines()];cases=load(input_directory/'cases.json')['cases']
 for i,f in enumerate(a['frames']):
  if require_custody:
   row=a['nativeFenceCustody'][i];need(row['id']==f['nativeFenceId'] and row['frame']==i and row['nativeClass']=='WebGLSync' and row['created'] and row['retired'],'actual unique native fence identity');need(row['condition']==0x9117 and row['flags']==0,'native commands-complete fence arguments');need(len(row['polls'])==f['gpuComplete']['waits'] and row['polls'][-1]['status']==f['gpuComplete']['status'],'full native polling history');need(all(p['flags']==0 and p['timeout']==0 and p['status'] in [0x911a,0x911b,0x911c] for p in row['polls']),'actual poll arguments/states');need(row['createdAt']<row['polls'][0]['event']<=row['polls'][-1]['event']<row['retiredAt'],'native fence event order');need(len(row['reads'])==len(f['planes'])+len(f['outputs']) and all(r['event']>row['retiredAt'] and r['afterCompletedFence']==row['id'] for r in row['reads']),'all whole plane reads follow successful native completion');need(row['imageState']=={'unit':(16 if f['stage']=='vertex' else 0)+f['slot'],'base':1 if directory.name=='fault-wrong-level' else 0,'max':f['levels']-1,'immutableLevels':f['levels']},'native original image dimensions/level state');need(row['outputs']==[{'location':o['location'],'actualLocation':o['location']} for o in f['outputs']],'actual native COLOR locations');need(row['queries']==[{'name':q['name'],'type':0x1404,'actualLevels':f['levels']} for q in f['queries']],'actual native query reflection/level');need(row['samplers']==[{'name':sampler['name'],'active':sampler['active'],'unit':sampler['unit'] if sampler['active'] else None,'type':sampler['nativeType'] if sampler['active'] else None,'size':1 if sampler['active'] else None} for sampler in f['samplers']],'actual native sampler reflection/unit state')
  fmt=formats[f['format']];need(all(fmt[k]==f[k] for k in ['components','bits','signed']),'literal format fields');need(f['gpuComplete']['submitted'] and f['gpuComplete']['fenced'] and f['gpuComplete']['status'] in [0x911a,0x911c] and f['gpuComplete']['waits']>0 and f['cleaned'],'completed actual native fence');need(f['pair']==native[f['nativeIndex']]['result'],'native/browser entire response');c=cases[f['nativeIndex']];need(c['a']==f['vertexText'] and c['b']==f['fragmentText'] and c['selectors']==f['selectors'],'original texts and host selectors')
  for sampler in f['samplers']:
   text=f['vertexText'] if sampler['stage']==0 else f['fragmentText'];decl,_=views(text);kind,native_type=SAMPLER_TYPE[decl[sampler['index']]];need(sampler['type']==kind and sampler['expected']==native_type,'original/native sampler type');need(not sampler['active'] or sampler['nativeType']==native_type,'actual active sampler reflection');need(sampler['unit']==(16 if f['stage']=='vertex' else 0)+int(TEXTURE_RE.search(f['vertexText'] if f['stage']=='vertex' else f['fragmentText'])[8]),'actual selected sampler unit')
  for q in f['queries']:need(q['actual']==q['expected']==f['levels'],'actual query-level uniform')
  original={}
  for p in f['planes']:
   raw=blobs[p['original']];w,h,level=p['width'],p['height'],p['level'];need(w==max(1,f['width']>>level) and h==max(1,f['height']>>level),'NPOT dimension');need(len(raw)==w*h*fmt['components']*fmt['bits']//8,'full original bytes');original[level]=(w,h,raw);wanted=b''.join(struct.pack('<4I',*words(raw,fmt,pixel)) for pixel in range(w*h));actual=blobs[p['native']];need(len(wanted)==len(actual),'complete native source plane')
   if actual!=wanted:mismatches.append({'frame':i,'plane':level,'kind':'source','expected':sha(wanted),'actual':sha(actual)})
   stride=fmt['components']*fmt['bits']//8;expanded=b''.join(raw[px*stride:(px+1)*stride]+((1).to_bytes(fmt['bits']//8,'little') if fmt['components']==3 else b'') for px in range(w*h));need(blobs[p['uploaded']]==expanded,'independent exact signed-width/native RGB expansion')
   values=struct.unpack('<'+'I'*(len(wanted)//4),wanted);signed_extremes|=fmt['signed'] and (-(2**(fmt['bits']-1))&0xffffffff) in values;uint_high|=not fmt['signed'] and fmt['bits']==32 and any(v>=0x80000000 for v in values);source_words+=len(actual)//4;planes+=1;original_bytes+=len(raw)
  need(len(original)==f['lastLevel']-f['firstLevel']+1==f['levels'],'full/truncated original view extents')
  for output in f['outputs']:
   loc,kind=output['location'],output['kind'];mask=f['selectors']['signedColorMask'] if kind=='sint' else f['selectors']['unsignedColorMask'] if kind=='uint' else 0;need(kind=='float' or mask&(1<<loc),'host COLOR semantic mask');need(output['internal']=={'sint':0x8d82,'uint':0x8d70,'float':0x8814}[kind],'actual color format');wanted=b''.join(struct.pack('<4I',*expected(f,original,x,y)) for y in range(f['frameHeight']) for x in range(f['frameWidth']));actual=blobs[output['native']];need(len(wanted)==len(actual),'whole output size')
   if kind=='float':need(all(math.isfinite(v) and (v==0 or abs(v)>=2**-126) for v in struct.unpack('<'+'f'*(len(wanted)//4),wanted)),'finite normal float truth')
   if actual!=wanted:mismatches.append({'frame':i,'location':loc,'kind':'output','expected':sha(wanted),'actual':sha(actual),'file':blob_sources[output['native']]})
   output_words+=len(actual)//4
  for attr in f['attributes']:need(blobs[attr['original']]==blobs[attr['native']],'actual original attribute bytes')
  op_counts[f['stage']+'/'+f['opcode']]=op_counts.get(f['stage']+'/'+f['opcode'],0)+1
  observations.append({'frame':i,'name':f['name'],'originalFormat':fmt['name'],'fence':f['gpuComplete'],'nativeIndex':f['nativeIndex'],'queryUniforms':f['queries'],'sourcePlaneCount':len(f['planes']),'outputPlaneCount':len(f['outputs'])})
 if require_custody:need(len(a['nativeFenceCustody'])==len(a['frames'])==len({r['id'] for r in a['nativeFenceCustody']}),'complete unique physical native fence records')
 if normal:
  need(not mismatches,'original inverse failures '+str(mismatches[:3]));need(signed_extremes and uint_high,'original signed minima/UINT high values');need(all(c['okay'] for c in a['compiles']),'all admitted native compiles');need(len(a['typeControls'])==1 and not a['typeControls'][0]['okay'] and a['typeControls'][0]['original']!=a['typeControls'][0]['mutated'],'separate native type refusal')
 else:need(any(m['kind']=='output' for m in mismatches),'actual physical wrong-pixel detection')
 return {'path':directory.relative_to(OUT).as_posix(),'reportSha256':sha((directory/'report.json').read_bytes()),'status':'HELD','frames':len(observations),'originalBytes':original_bytes,'nativeSourceWords':source_words,'planes':planes,'outputWords':output_words,'opCounts':op_counts,'mismatches':mismatches,'observations':observations}

def compiler(directory):
 cases=load(directory/'cases.json')['cases'];native_raw=(directory/'native.jsonl').read_bytes();need(native_raw==(directory/'sanitize.jsonl').read_bytes(),'entire native/sanitized original response bytes');native=[json.loads(row) for row in native_raw.splitlines()];wasm=[json.loads(row) for row in (directory/'wasm.jsonl').read_text().splitlines()];need(len(cases)==len(native)==len(wasm)==2586,'matrix count');accepted=0;views_count=0
 for index,(c,n,w) in enumerate(zip(cases,native,wasm)):
  r=n['result'];need(n['case']==index and r==w['result'] and c['name']==w['name'],'complete native/Wasm response');need(r['ok']==c['okay'],'admission '+c['name'])
  if not r['ok']:need(set(r)=={'ok','error'} and r['error']['code']==c['code'],'closed refusal');continue
  accepted+=1;paired='vertex' in r;stages=['vertex','fragment'] if paired else ['vertex' if c['kind'] in [0,7,12,15] else 'fragment'];need(len(n['originalTokens'])==len(stages),'original parser stage extent')
  for i,stage in enumerate(stages):
   body=r[stage] if paired else r;text=c['a'] if i==0 else c['b'];tokens=n['originalTokens'][i];decl,wanted=views(text);need(tokens['samplerViews']==wanted,'original sampler four fields '+c['name']);views_count+=len(wanted)
   for im in tokens['immediates']:need(im['words']==immediates(text,True)[im['index']],'literal original immediate words')
   ops=list(TEXTURE_RE.finditer(text));need(len(ops)==len(tokens['textureInstructions']),'original texture op extent')
   for m,t in zip(ops,tokens['textureInstructions']):
    need(t['opcode']==OPS['TGSI_OPCODE_'+m[1]] and t['target']==TEX['TGSI_TEXTURE_2D'],'literal original opcode target');need(t['writeMask']==sum(1<<'xyzw'.index(l) for l in m[6] or 'xyzw') and bool(t['saturate'])==bool(m[2]) and bool(t['precise'])==bool(m[3]),'original instruction modifiers/mask');need(t['sources']==[original_operand(term) for term in m[7].split(',')]+[original_operand('SAMP['+m[8]+']')],'complete literal source files/indices/slots/swizzles/modifiers');need(t['instruction']==int(re.match(r'^(\d+):',m[0])[1]) and t['offsets']==0,'literal original instruction number/offsets')
   if c['kind']>=15:
    used=sorted({int(m[8]) for m in ops});wanted_samplers=[{'index':s,'name':('vs' if stage=='vertex' else 'fs')+'samp'+str(s),'type':SAMPLER_TYPE[decl[s]][0]} for s in used];need(body['metadata']['samplers']==wanted_samplers,'owned original sampler metadata')
    for sampler in wanted_samplers:need('uniform highp '+sampler['type']+' '+sampler['name']+';' in body['glsl'],'native owned sampler declaration')
    masks=c['selectors'];need(body['metadata']['colorOutputMasks']=={'signedMask':masks['signedColorMask'] if stage=='fragment' else 0,'unsignedMask':masks['unsignedColorMask'] if stage=='fragment' else 0},'bounded host output metadata')
    for o in body['metadata']['outputs']:
     if o['semantic']!='COLOR':continue
     loc=o['semanticIndex'];typ='ivec4' if masks['signedColorMask']&(1<<loc) else 'uvec4' if masks['unsignedColorMask']&(1<<loc) else 'vec4';need(o['type']==typ and f'layout(location={loc}) out {typ} fsout_c{loc};' in body['glsl'],'output COLOR semantic format')
 history=[json.loads(row) for row in (directory/'historical-abi.jsonl').read_text().splitlines()];need(len(history)==957 and all(r['originalResponse']==r['currentResponse'] for r in history),'historical entire bytes');alloc=[json.loads(row) for row in (directory/'allocations.jsonl').read_text().splitlines()];need(alloc[-1]['faults']==alloc[-1]['recoveries']==165,'genuine allocation count');need(sum(r['kind'] in ['upstream-fault','calloc-fault'] for r in alloc)==165,'recorded faults')
 for r in alloc:
  if r['kind'] in ['upstream-fault','calloc-fault']:need(set(r['result'])=={'ok','error'} and not r['result']['ok'],'no allocation partial success')
 facade=load(directory/'facade.json');need(facade['getters']==0 and facade['ownedSnapshots'] and facade['peerIsolation'] and facade['pressure']['bytes']==16777216 and facade['pressure']['recovered'],'facade actual ownership heap boundary');need(accepted==1975,'accepted count')
 return {'cases':len(cases),'accepted':accepted,'refused':len(cases)-accepted,'originalSamplerViews':views_count,'historicalBytesCompared':len(history),'allocationFaults':165,'nativeSha256':sha(native_raw),'facadeRejections':len(facade['rejections'])}

def main():
 captures=[];compilers=[]
 for prefix in ['hot','cold']:
  directory=W/prefix;compilers.append({'prefix':prefix,**compiler(directory/'native')})
  captures += [native_capture(directory/name,name!='hardware') for name in ['hardware','fault-wrong-level','fault-wrong-words']]
 retained=[]
 for prefix in ['hot','cold']:
  directory=W/prefix/'retained-texture';need((ROOT/'tools/virgl-standard-texture/pixels.py').read_bytes()==(SRC/'tools/virgl-standard-texture/pixels.py').read_bytes(),'unchanged independently verified historical FLOAT oracle');subprocess.run([sys.executable,str(ROOT/'tools/virgl-standard-texture/pixels.py'),str(directory)],check=True);physical=load(directory/'physical-audit.json');facade=load(directory/'native/facade.json');need(facade['historical']['cases']==932 and facade['historical']['allResponseBytesIdentical'] and facade['pressure']['bytes']==16777216 and facade['pressure']['recovered'],'affected historical FLOAT facade extent');retained.append({'prefix':prefix,'facadeSha256':sha((directory/'native/facade.json').read_bytes()),'physicalAuditSha256':sha((directory/'physical-audit.json').read_bytes()),'nativeDraws':physical['nativeDraws'],'checkedWords':physical['checkedWords'],'physicalFaults':physical['faults']})
 if (OUT/'complete-custody/hardware/report.json').is_file():
  current=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();captures += [native_capture(OUT/'complete-custody'/name,name!='hardware',W/'hot/native',current,True) for name in ['hardware','fault-wrong-level','fault-wrong-words']]
 result={'schema':'d32-independent-original-header-byte-word-audit-v1','status':'HELD','literalHeaderTypes':TYPES,'literalFormats':formats,'compiler':compilers,'captures':captures,'retainedFloat':retained}
 (OUT/'original-word-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'HELD','compiler':compilers,'captures':[{k:v for k,v in c.items() if k not in ['observations','opCounts']} for c in captures]}))
if __name__=='__main__':main()
