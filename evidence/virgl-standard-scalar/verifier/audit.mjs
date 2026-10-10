import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {criticModel,criticCompare,rationalWord,criticPackets} from '../../../tools/virgl-command/standard-scalar-adversarial-oracle.mjs';
import {criticModel as compactModel,criticCompare as compactCompare} from '../../../tools/virgl-command/standard-compact-adversarial-oracle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),fresh=process.argv[2]==='--fresh',root=fresh?here:path.join(here,'unpacked');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),hex=b=>Buffer.from(b).toString('hex');
const out={schema:'standard-scalar-independent-audit-v1',status:'running',predictions:'predictions.json',frames:[],faults:[],wire:[],lifetimes:[],rejections:[],ownership:[],pixels:0,retainedPixels:0,sourceReads:0,nativeDraws:0,normalizedBuffers:0};
const families=[[32,4,5125,false,true],[40,4,5124,true,true],[36,4,5125,false,false],[44,4,5124,true,false],[52,2,5123,false,false],[60,2,5122,true,false],[69,1,5121,false,false],[82,1,5120,true,false]];
const clone=v=>JSON.parse(JSON.stringify(v));
for(const [n,w]of [[16777217,0x4b800000],[16777219,0x4b800002],[-16777217,0xcb800000],[-2147483648,0xcf000000],[4294967295,0x4f800000]])assert.equal(rationalWord(n),w,'prior exact tie prediction');
assert.equal(rationalWord(4294967295,4294967295),0x3f800000);
function words(actual,expected,nan=[false,false,false,false]){assert.equal(actual.length,expected.length);actual.forEach((word,lane)=>nan[lane]?assert.ok((word&0x7f800000)===0x7f800000&&(word&0x7fffff)!==0):assert.equal(word,expected[lane],'exact supplied lane '+lane));}
function format(n){const f=families.find(([base])=>n>=base&&n<base+4);return f?{bytes:f[1],components:n-f[0]+1}:null;}
function scalarWire(row){const raw=Buffer.from(row.hex,'hex'),header=raw.readUInt32LE(0);assert.equal(header,0x00050501);assert.equal(raw.readUInt32LE(4),777);const off=raw.readUInt32LE(8),div=raw.readUInt32LE(12),n=raw.readUInt32LE(20),f=format(n),expected=f!==null&&BigInt(off)+BigInt(f.bytes*f.components)<=4294967295n;
 assert.equal(row.standard.ok,expected);assert.equal(row.legacy.ok,false);assert.equal(row.expected,expected);if(row.format!==undefined)assert.equal(row.format,n);if(row.divisor!==undefined)assert.equal(row.divisor,div);return {format:n,offset:off,divisor:div,expected};}
function historicalWire(row){const raw=Buffer.from(row.hex,'hex');let expected=true,legacy=true;for(let at=0;at<raw.length;){const h=raw.readUInt32LE(at),op=h&255,n=h>>>16,w=Array.from({length:n},(_,i)=>raw.readUInt32LE(at+4+i*4));if(op===1){assert.equal(n,5);expected&&=w[4]>=28&&w[4]<=32;legacy&&=w[4]>=28&&w[4]<=31&&w[2]===0;}else if(op===11){assert.equal(n,3);expected&&=[1,2,4].includes(w[1])&&w[2]%w[1]===0;legacy&&=w[1]===2&&w[2]%2===0;}else if(op===8){expected&&=n===12&&[0,4,5].includes(w[2]);legacy&&=n===12&&[4,5].includes(w[2])&&w[4]===1;}else throw Error('unexpected bounded historical matrix opcode');at+=4*(n+1);}assert.equal(row.standard.ok,expected);assert.equal(row.legacy.ok,legacy);assert.equal(row.expected,expected);assert.equal(row.legacyExpected,legacy);}
async function load(directory){const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=report.status==='failed'?report.partial:report.browserResult.result,refs=new Map(result.blobs.map(b=>[b.key,b]));
 const cache=new Map();async function raw(ref){if(cache.has(ref.key))return cache.get(ref.key);const b=refs.get(ref.key);assert.equal(b.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,b.path));assert.equal(sha(packed),b.gzipSha256);const bytes=new Uint8Array(gunzipSync(packed));assert.equal(bytes.length,b.bytes);assert.equal(sha(bytes),b.sha256);cache.set(ref.key,bytes);return bytes;}return {report,result,raw};}
async function physical(prefix,suffix,retained=false){
 const file=[prefix,suffix,'report.json'].filter(Boolean).join('/'),{report,result,raw}=await load(path.join(root,prefix,suffix)),fault=report.status==='failed',modelOf=retained?compactModel:criticModel,compare=retained?compactCompare:criticCompare;
 const text=await fs.readFile(path.join(root,file),'utf8');let lineCursor=0;
 for(const frame of result.frames){
  const full=new Map(),native=new Map();for(const b of frame.native.buffers){const bytes=await raw(b.blob);full.set(b.resourceId,new Uint8Array(bytes.length));native.set(b.resourceId,bytes);}
  for(const upload of frame.inputs){const dest=full.get(upload.resource.id),bytes=await raw(upload.blob);assert.ok(dest);assert.equal(upload.direction,'upload');assert.equal(upload.layout.rowCount,1);assert.equal(upload.layout.rowBytes,bytes.length);assert.ok(upload.layout.offset+bytes.length<=dest.length);dest.set(bytes,upload.layout.offset);}
  const wireUploads=[];for(const h of frame.history){const packet=Buffer.from(h.hex,'hex');for(let at=0;at<packet.length;){const head=packet.readUInt32LE(at),op=head&255,n=head>>>16;if(op===43)wireUploads.push({id:packet.readUInt32LE(at+4),offset:packet.readUInt32LE(at+24),width:packet.readUInt32LE(at+36),height:packet.readUInt32LE(at+40),depth:packet.readUInt32LE(at+44),direction:packet.readUInt32LE(at+52)});at+=4*(n+1);}}
  assert.deepEqual(frame.inputs.map(u=>({id:u.resource.id,offset:u.layout.offset,width:u.layout.rowBytes,height:u.layout.rowCount,depth:u.layout.box.depth,direction:u.direction==='upload'?1:2})),wireUploads,'actual owned exchanges match original packet uploads');
  for(const [id,bytes]of full)assert.deepEqual(bytes,native.get(id),'independent original full GPU upload '+frame.label+'/'+id);
  for(const b of frame.native.buffers)for(const upload of frame.inputs.filter(u=>u.resource.id===b.resourceId))assert.equal(upload.resource.generation,b.generation,'native source retains original uploaded generation');
  const m=modelOf(frame.history,full,frame.range),audit=compare(await raw(frame.pixels),m,frame.width,frame.height),d=frame.history.at(-1).result.draws.at(-1),instanced=m.draw.instances>1;
  assert.equal(frame.history.at(-1).result.gpuComplete,true,'actual fence completed');assert.equal(frame.native.calls.length,1);assert.equal(frame.native.state.length,1);
  const call=frame.native.calls[0],state=frame.native.state[0];assert.equal(call.name,(m.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));assert.deepEqual(call.args,m.draw.indexed?[0,m.draw.count,{1:5121,2:5123,4:5125}[m.nativeSize],m.nativeOffset,...(instanced?[m.draw.instances]:[])]:[0,m.draw.start,m.draw.count,...(instanced?[m.draw.instances]:[])]);
  const index=m.draw.indexed?frame.native.buffers.find(b=>b.resourceId===m.state.index.id):null;
  if(index)assert.equal(d.indexResourceGeneration,index.generation,'native original index generation');
  assert.equal(call.indexBuffer,m.normalize?frame.native.normalized[0].nativeBuffer:index?.nativeBuffer??null);assert.deepEqual(state.pointSize,m.pointUniform);
  for(const n of frame.native.normalized)assert.deepEqual(await raw(n.blob),m.normalized,'original restart indices');assert.equal(frame.native.normalized.length,m.normalize?1:0);
  assert.deepEqual([d.actualMinIndex,d.actualMaxIndex,d.validIndexCount,d.restartCount,d.normalizedIndices,d.nativeIndexSize,d.nativeIndexOffset,d.vertexWork],[m.min,m.max,m.valid,m.restarts,m.normalize,m.nativeSize,m.nativeOffset,m.draw.count*m.draw.instances]);
  const run=result.runs?.find(r=>r.history.some(h=>h.label===frame.label))??null;
  if(run)for(const reflected of run.events.filter(e=>e.name==='getActiveAttrib'&&/^in_\d+$/.test(e.result?.name)))assert.ok([5126,35664,35665,35666].includes(reflected.result.type),'actual native floating shader input');
  for(const fetch of m.fetches){const got=d.vertexFetches.find(f=>f.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),b=frame.native.buffers.find(b=>b.resourceId===fetch.resourceId);
   for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(got[key],fetch[key],frame.label+' '+key);
   assert.equal(got.resourceGeneration,b.generation);assert.deepEqual([a.enabled,a.integer,a.divisor],[!fetch.constant,false,fetch.nativeDivisor]);
   if(fetch.constant){if(fault&&['constant-scaled','constant-unpack'].includes(report.mutation.mode)&&fetch.attributeIndex===1){assert.notDeepEqual(got.componentWords,fetch.componentWords);words(got.componentWords,a.genericWords.slice(0,fetch.components));}
    else {words(got.componentWords,fetch.componentWords,fetch.nan);words(a.genericWords,[...fetch.componentWords,...[0,0,0,0x3f800000].slice(fetch.components)],fetch.nan);assert.deepEqual(got.genericValues,clone(fetch.genericValues));}
    if(run){const events=run.events.filter(e=>e.label===frame.label),original=full.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes);
     assert.ok(events.some(e=>e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===hex(original)),'original exact scalar read');assert.ok(events.some(e=>e.name==='copyBufferSubData'&&e.source===b.nativeBuffer&&e.args[2]===fetch.offset&&e.args[3]===0&&e.args[4]===fetch.elementBytes),'actual original native source copy');out.sourceReads++;}
   }else {const mutation=fault&&report.mutation.mode==='native-signedness'&&fetch.nativeType===5124?5125:fetch.nativeType,norm=fault&&report.mutation.mode==='native-normalize'?false:fetch.normalized;
    assert.deepEqual([a.buffer,a.type,a.normalized,a.components,a.stride,a.offset],[b.nativeBuffer,mutation,norm,fetch.components,fetch.stride,fetch.offset],'actual native original source pointer');}
  }
  const labelAt=text.indexOf('"label": "'+frame.label+'"',lineCursor);lineCursor=labelAt+1;const line=text.slice(0,labelAt).split('\n').length;
  const row={record:file,line,recordSha256:sha(Buffer.from(text)),label:frame.label,pixels:frame.width*frame.height,pixelsSha256:frame.pixels.sha256,fetches:m.fetches,ids:m.ids,maxError:audit.maxError,misses:audit.misses,draws:frame.native.calls.length,normalizedBuffers:frame.native.normalized.length,held:audit.held};
  if(fault){assert.equal(audit.held,false,'actual GPU mutation must contradict original pixels');assert.ok(report.browserResult.error.message.includes('pixels'));out.faults.push(row);}
  else {assert.equal(audit.held,true,frame.label);out.frames.push(row);out.nativeDraws++;out.normalizedBuffers+=row.normalizedBuffers;if(retained)out.retainedPixels+=row.pixels;else out.pixels+=row.pixels;}
 }
 if(!fault&&!retained){
  assert.equal(result.frames.length,fresh?92:391);assert.equal(result.rejections.length,fresh?5:10);assert.equal(result.suspensions.length,fresh?3:6);assert.equal(result.ownership.length,1);
  for(const run of result.runs){for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])assert.equal(run.inspection.jobs[k],0,'all owned job storage released');
   const syncs=new Map();for(const event of run.events){if(event.name==='fenceSync'){assert.ok(!syncs.has(event.sync));syncs.set(event.sync,{turn:event.turn,last:event.turn});}
    else if(event.name==='clientWaitSync'){const sync=syncs.get(event.sync);assert.ok(sync);assert.ok(event.turn>sync.turn&&event.turn>sync.last);sync.last=event.turn;}
    else if(event.name==='deleteSync'){assert.ok(syncs.has(event.sync));syncs.delete(event.sync);}}
   assert.equal(syncs.size,0,'every native fence retired');}
  for(const rejected of result.rejections){const label=rejected.record.label,run=result.runs.find(r=>r.history.some(h=>h.label===label)),rec=rejected.record.result;assert.equal(rec.ok,false);assert.equal(rec.gpuComplete,true);assert.deepEqual(rec.draws,[]);assert.deepEqual(run.calls,[]);
   let prediction;if(label.includes('short-compact-staging')){const s=criticPackets([rejected.record]),bytes=s.elements.reduce((n,e)=>n+(s.buffers[e.slot].stride===0?(format(e.format)?.bytes??4)*(format(e.format)?.components??4):0),s.draw.count*s.index.bytes);assert.equal(bytes,22);assert.equal(rec.error.code,'limit-exceeded');assert.ok(!rejected.events.some(e=>e.name==='copyBufferSubData'));prediction='22 required staged bytes exceed supplied limit21 before allocation';}
   else if(label==='scalar-short-work'){const s=criticPackets([rejected.record]);assert.equal(s.draw.count*s.draw.instances,6);assert.equal(rec.error.code,'limit-exceeded');prediction='six original vertices exceed limit5';}
   else {let rejectedByLiteral=false;const original=new Map();for(const exchange of run.exchanges){const bytes=await raw(exchange.blob);let dest=original.get(exchange.resource.id);if(!dest){dest=new Uint8Array(exchange.layout.requiredEnd);original.set(exchange.resource.id,dest);}dest.set(bytes,exchange.layout.offset);}try{criticModel(run.history,original,[1,64]);}catch{rejectedByLiteral=true;}assert.equal(rejectedByLiteral,true,'independent bounds/alignment reject '+label);prediction='literal original byte end or scalar alignment fails';}
   out.rejections.push({record:file,label,prediction,error:rec.error,held:true});}
  for(const suspended of result.suspensions){const {action,record}=suspended,phase=suspended.phase??'waiting-attributes',before=suspended.point?.inspection??suspended.before;assert.equal(before.jobs.status,phase);assert.ok(before.jobs.reads>0);assert.equal(record.result.gpuComplete,true);
   if(action==='reuse'){assert.equal(record.result.ok,true);const frame=result.frames.find(f=>f.label===record.label);assert.ok(frame);const original=frame.native.buffers.find(b=>b.resourceId===(fresh?3:4));assert.ok(original);assert.equal(record.result.draws[0].vertexFetches[1].resourceGeneration,original.generation);}
   else {assert.equal(record.result.ok,false);assert.equal(record.result.error.code,action==='revision'?'stale-storage':'cancelled');assert.deepEqual(record.result.draws,[]);const run=result.runs.find(r=>r.history.some(h=>h.label===record.label));assert.deepEqual(run.calls,[]);}
   out.lifetimes.push({record:file,phase,action,before:before.jobs,held:true});}
  for(const owned of result.ownership){assert.equal(owned.before.jobs.status,'waiting-attributes');assert.ok(owned.before.jobs.reads>0);assert.equal(owned.after.reads,0);assert.equal(owned.after.stagingBytes,0);out.ownership.push({record:file,before:owned.before.jobs,after:owned.after,held:true});}
 }
}
if(fresh){
 await physical('','final-gpu');await physical('','final-sabotage-native');await physical('','final-sabotage-constant');
 const wire=JSON.parse(await fs.readFile(path.join(root,'final-gpu/report.json'))).browserResult.result.wire;assert.equal(wire.length,396);out.wire=wire.map(scalarWire);
 assert.equal(out.pixels,70656);assert.equal(out.faults.length,2);
}else for(const prefix of ['hot','cold']){
 const wire=JSON.parse(await fs.readFile(path.join(root,prefix,'wire/report.json')));assert.equal(wire.wire.records.length,396);assert.equal(wire.wire.legacy.records.length,80);wire.wire.legacy.records.forEach(historicalWire);out.wire.push({prefix,records:wire.wire.records.map(scalarWire),historical:wire.wire.legacy.records.length});
 const list=families.flatMap(([base])=>[base,base+1,base+2,base+3]);for(const mode of ['native','sanitize']){const abi=JSON.parse(await fs.readFile(path.join(root,prefix,'abi/scalar-'+mode+'.json')));assert.deepEqual(abi,{status:'pinned-header',formats:list});}
 await physical(prefix,'hardware');await physical(prefix,'fault-native-signedness');await physical(prefix,'fault-constant-scaled');
 await physical(prefix,'retained-compact/hardware',true);await physical(prefix,'retained-compact/fault-native-normalize',true);await physical(prefix,'retained-compact/fault-constant-unpack',true);await physical(prefix,'retained-compact/critic-hardware',true);
 const critic=JSON.parse(await fs.readFile(path.join(root,prefix,'retained-compact/critic-hardware/report.json'))).browserResult.result;assert.equal(critic.wire.length,297);for(const row of critic.wire){const raw=Buffer.from(row.hex,'hex'),n=raw.readUInt32LE(20),off=raw.readUInt32LE(8),div=raw.readUInt32LE(12),tables=[[28,4],[48,2],[56,2],[64,1],[74,1],[91,2]],table=tables.find(([base])=>n>=base&&n<base+4),newTable=format(n),ok=(table||newTable)&&off+(table?(n-table[0]+1)*table[1]:newTable.bytes*newTable.components)<=4294967295;
  assert.equal(row.standard.ok,Boolean(ok));assert.equal(row.legacy.ok,Boolean(table&&table[0]===28&&div===0&&off%4===0&&ok));}
 // Original-TGSI/native storage and affected admission are both rechecked.
}
if(!fresh){assert.equal(out.pixels,205824);assert.equal(out.retainedPixels,183808);assert.equal(out.faults.length,8);}out.status='passed';
await fs.writeFile(path.join(here,fresh?'fresh-audit.json':'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({status:out.status,frames:out.frames.length,pixels:out.pixels,retainedPixels:out.retainedPixels,faults:out.faults.length,sourceReads:out.sourceReads,nativeDraws:out.nativeDraws,normalizedBuffers:out.normalizedBuffers}));
