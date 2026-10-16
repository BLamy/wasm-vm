// Pinned wire literals, actual GPU-buffer snapshots and independent lane predictions.
import {decodeSubmission} from '../decoder.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer,createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

const VS='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
const FS='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const WFS='FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0].wwww\n1: END\n';
const COUNTS={28:1,29:2,30:3,31:4};
const colorA=[.125,.375,.625,.25],colorB=[.875,.25,.5,.75];
function checks(){const rows=[];const same=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(observed));};
  const ok=(r,label)=>{same(r?.ok,true,label+' ('+(r?.error?.message??'')+')');return r;};const bad=(r,label,code)=>{same(r?.ok,false,label+' rejects');if(code)same(r.error.code,code,label+' code');return r;};return{rows,same,ok,bad};}
export function packet(op,type,words){const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
const word=f=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,f,true);return v.getUint32(0,true);};
const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
const shader=(id,stage,text)=>{const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;};
const ve=(id,fmt,offset=0,positionOffset=0,inactive=false)=>packet(1,5,[id,positionOffset,0,0,31,offset,0,1,fmt,...(inactive?[0,0,15,31]:[])]);
const draw=t=>packet(8,0,[t.indexed?0:t.start,4,5,Number(t.indexed),1,0,0,0,0,0,t.hint??0xffffffff,0]);
const transfer=(id,length)=>packet(43,0,[id,0,0,0,0,0,0,0,length,1,1,0,1]);
const clear=()=>{const b=packet(7,0,[4,0,0,0,0,0,0,0]);new DataView(b.buffer).setFloat64(24,1,true);return b;};
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});

export function runFloatVertexWireAcceptance(){const c=checks();let admitted=0,rejected=0;
  for(let fmt=0;fmt<256;fmt++){const r=decodeSubmission(packet(1,5,[777,0,0,15,fmt]));c.same(r.ok,Object.hasOwn(COUNTS,fmt),'independent format '+fmt);if(r.ok){admitted++;c.same(r.commands[0].fields.elements[0].sourceFormat,fmt,'owned format '+fmt);}else{rejected++;c.same([r.error.opcode,r.error.byteOffset],[1,0],'format provenance '+fmt);}}
  for(const[fmt,n]of Object.entries(COUNTS)){const format=Number(fmt),last=Math.floor((0xffffffff-n*4)/4)*4;
    for(const offset of [0,4,last])c.ok(decodeSubmission(packet(1,5,[777,offset,0,15,format])),'aligned exact width '+fmt+'/'+offset);
    for(const offset of [1,2,3,5,6,7,last+4,0xffffffff])c.bad(decodeSubmission(packet(1,5,[777,offset,0,15,format])),'alignment/overflow '+fmt+'/'+offset,'invalid-value');
    for(const divisor of [1,2,0xffffffff])c.bad(decodeSubmission(packet(1,5,[777,0,divisor,0,format])),'closed instance divisor '+fmt+'/'+divisor,'unsupported-feature');
    for(const index of [16,0xffffffff])c.bad(decodeSubmission(packet(1,5,[777,0,0,index,format])),'buffer slot '+fmt+'/'+index,'limit-exceeded');
  }
  c.bad(decodeSubmission(packet(1,5,[777,...Array(17).fill([0,0,0,28]).flat()])),'element-count bound','limit-exceeded');
  return{status:'passed',admitted,rejected,assertions:c.rows};
}

function test(name,format=28,options={}){return{name,format,start:0,indexed:false,w:2,color:colorA,colorStride:COUNTS[format]*4+4,colorOffset:0,sourceOffset:0,positionStride:20,positionOffset:0,positionSourceOffset:0,tail:16,...options};}
function geometry(t){const first=t.indexed?1:t.start,max=first+3,count=max+1,n=COUNTS[t.format],po=t.positionOffset+t.positionSourceOffset,co=t.colorOffset+t.sourceOffset;
  const position=new Uint8Array(po+max*t.positionStride+16+t.tail),color=new Uint8Array(co+max*t.colorStride+n*4+t.tail);
  for(const b of [position,color]){const v=new DataView(b.buffer);for(let at=0;at+4<=b.length;at+=4)v.setFloat32(at,.375,true);}
  const points=[[-1,-1],[-1,1],[1,-1],[1,1]],pv=new DataView(position.buffer),cv=new DataView(color.buffer);
  for(let i=0;i<count;i++){const xy=points[Math.max(0,i-first)%4];[xy[0]*t.w,xy[1]*t.w,0,t.w].forEach((v,l)=>pv.setFloat32(po+i*t.positionStride+l*4,v,true));for(let l=0;l<n;l++)cv.setFloat32(co+i*t.colorStride+l*4,t.color[l],true);}
  const index=new Uint8Array(10),iv=new DataView(index.buffer);[0xbeef,1,2,3,4].forEach((v,i)=>iv.setUint16(i*2,v,true));return{position,color,index};
}
function rig(gl,bridge,c,{asynchronous=false,delay=0}={}){
  const allocations=[],calls=[],history=[],contexts=new Map(),records=[],live=new Map(['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'].map(k=>[k,new Set()])),control={remaining:0};let waits=0,fences=0;
  const identity=buffer=>allocations.find(a=>a.native.buffer===buffer);
  const bytesOf=buffer=>{const item=identity(buffer);if(!item)return null;const old=gl.getParameter(gl.COPY_READ_BUFFER_BINDING),b=new Uint8Array(item.metadata.width);gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,b);gl.bindBuffer(gl.COPY_READ_BUFFER,old);return{resourceId:item.metadata.id,generation:item.generation,bufferHex:hex(b),byteLength:b.length};};
  const methods=new Map(),traced=new Proxy(gl,{get(t,k){if(typeof t[k]!=='function')return Reflect.get(t,k,t);if(methods.has(k))return methods.get(k);const fn=(...args)=>{
    if(k==='clientWaitSync'){waits++;if(control.remaining>0){control.remaining--;return gl.TIMEOUT_EXPIRED;}}
    if(k==='drawArrays'||k==='drawElements'){const program=gl.getParameter(gl.CURRENT_PROGRAM),attributes=[];
      for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){const a=gl.getActiveAttrib(program,i),location=gl.getAttribLocation(program,a.name);attributes.push({name:a.name,location,enabled:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),defaults:[...gl.getVertexAttrib(location,gl.CURRENT_VERTEX_ATTRIB)],...bytesOf(gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING))});}
      calls.push({op:k,args:[...args],attributes:attributes.sort((a,b)=>a.name.localeCompare(b.name)),index:bytesOf(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING))});}
    const out=t[k].apply(t,args);if(k.startsWith('create')){const kind=k.slice(6);if(live.has(kind)&&out)live.get(kind).add(out);}if(k.startsWith('delete')){const kind=k.slice(6);if(live.has(kind))live.get(kind).delete(args[0]);}
    if(k==='fenceSync'){fences++;control.remaining=delay;live.get('Sync').add(out);}return out;};methods.set(k,fn);return fn;}});
  const native=c.ok(createWebGL2TransferBackend(traced),'actual float-fetch backend').backend;
  const owner=c.ok(createResourceStore({backend:{...native,allocate(m){const out=native.allocate(m);allocations.push({metadata:m,native:out});return out;}}}),'owned float-fetch store');
  const renderer=c.ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,shaderBridge:bridge,resources:owner.store,bindings:owner.bindings,
    limits:{programs:2},cacheLimits:{states:2,translations:3},...(asynchronous?{asyncAccess:owner.asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'float-fetch renderer').renderer;
  for(const ctx of [1,2]){c.ok(owner.store.createContext(ctx),'owned context '+ctx);c.ok(renderer.createContext(ctx),'renderer context '+ctx);}
  const reader=gl.createFramebuffer();return{...owner,renderer,gl,allocations,calls,history,contexts,records,live,reader,frame:0,asynchronous,waits:()=>waits,fences:()=>fences};
}
function add(r,c,m,backing=null){const made=c.ok(r.store.createResource(m),'resource '+m.id);const allocation=r.allocations.at(-1);allocation.generation=made.resource.generation;
  for(const ctx of [1,2])c.ok(r.store.attachContext(ctx,m.id),'resource membership '+ctx+'/'+m.id);if(backing)c.ok(r.store.attachBacking(m.id,[backing]),'owned bytes '+m.id);return made.resource;}
function resources(r,c,t,base=0){const g=geometry(t),ids={rt:1+base,pos:3+base,col:4+base,index:5+base};add(r,c,meta(ids.rt,2,67,2,16,16));
  add(r,c,meta(ids.pos,0,64,16,g.position.length),g.position);add(r,c,meta(ids.col,0,64,16,g.color.length),g.color);add(r,c,meta(ids.index,0,64,32,g.index.length),g.index);return{ids,g};}
const buffers=(t,ids)=>packet(6,0,[t.positionStride,t.positionOffset,ids.pos,t.colorStride,t.colorOffset,ids.col]);
function setup(t,ids){return join(shader(1,0,VS),shader(2,1,FS),shader(3,1,WFS),packet(1,8,[4,ids.rt,67,0,0]),packet(5,0,[1,0,4]),
  ve(5,t.format,t.sourceOffset,t.positionSourceOffset,t.inactive),packet(2,5,[5]),buffers(t,ids),packet(11,0,[ids.index,2,2]),
  packet(1,2,[6,2|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[6]),packet(4,0,[0,...[8,8,.5,8,8,.5].map(word)]),
  packet(31,0,[1,0]),packet(31,0,[t.coordinates?3:2,1]));}
async function execute(r,c,ctx,bytes,label){const saved=bytes.slice();c.ok(r.renderer.beginFrame(++r.frame),label+' begin capture');let result,polls=0;
  if(!r.asynchronous)result=r.renderer.executeSubmission(ctx,bytes);
  else{const job=c.ok(r.renderer.beginSubmission(ctx,bytes),label+' begin owned job').job;bytes.fill(255);
    for(;polls<5000;polls++){const step=c.ok(r.renderer.step(job),label+' step');if(step.status==='needs-input'){
      const layout=step.request.layout,rows=[];for(let i=0;i<layout.rowCount;i++)rows.push(c.ok(r.store.readBacking(step.request.resource.id,layout.offset+i*layout.rowStride,layout.rowBytes),label+' actual owned input').bytes);
      c.ok(r.renderer.provideInput(job,step.request.token,join(...rows)),label+' copy owned input');
    }else if(step.status==='done'){result=step.result;break;}await new Promise(resolve=>setTimeout(resolve,polls%3));}c.same(Boolean(result),true,label+' bounded completion');}
  const dump=c.ok(r.renderer.endFrame(r.frame),label+' complete capture').dump;r.history.push({contextId:ctx,packetHex:hex(saved),result});return{result,dump,packetHex:hex(saved),polls};
}
function read(r,c,id){const gl=r.gl,allocation=[...r.allocations].reverse().find(a=>a.metadata.id===id);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,r.reader);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,allocation.native.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);const bytes=new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,bytes);c.same(gl.getError(),gl.NO_ERROR,'physical float-fetch read');return bytes;}
function inspectFrame(r,c,t,run,ids,evidence,raw){const n=COUNTS[t.format],color=t.coordinates?Array(4).fill(1/t.w):[...t.color.slice(0,n),...[0,0,0,1].slice(n)],expected=color.map(v=>Math.round(Math.min(1,Math.max(0,v))*255)),pixels=read(r,c,ids.rt),native=r.calls.at(-1),mismatches=[];
  for(let i=0;i<256;i++){const actual=[...pixels.slice(i*4,i*4+4)];if(actual.some((v,l)=>Math.abs(v-expected[l])>1))mismatches.push({pixel:i,actual,expected});}
  const record={...t,contextId:run.contextId??1,ids,expected,packetHex:run.packetHex,history:r.history.map(row=>({...row})),native,dump:run.dump,pixels:[...pixels]};evidence.frames.push(record);c.same(mismatches.slice(0,3),[],t.name+' independent physical pixels');
  c.ok(run.result,t.name+' complete draw');const actual=run.result.draws.at(-1);c.same(native.op,t.indexed?'drawElements':'drawArrays',t.name+' actual native method');c.same(native.args,t.indexed?[5,4,5123,2]:[5,t.start,4],t.name+' native draw range');
  c.same([actual.actualMinIndex,actual.actualMaxIndex],t.indexed?[1,4]:[t.start,t.start+3],t.name+' actual index range');
  for(const a of native.attributes){const index=Number(a.name.slice(3)),size=index===0?4:n,stride=index===0?t.positionStride:t.colorStride,offset=index===0?t.positionOffset+t.positionSourceOffset:t.colorOffset+t.sourceOffset;
    c.same([a.enabled,a.components,a.type,a.stride,a.offset,a.defaults],[true,size,5126,stride,offset,[0,0,0,1]],t.name+' native input '+index);
    const f=actual.vertexFetches.find(f=>f.attributeIndex===index);c.same([f.resourceId,f.resourceGeneration,f.components,f.stride,f.offset,f.firstByte,f.requiredEnd],[a.resourceId,a.generation,size,stride,offset,offset+actual.actualMinIndex*stride,offset+actual.actualMaxIndex*stride+size*4],t.name+' exact fetch '+index);}
  c.same(t.coordinates?[1,2].includes(native.attributes.length):native.attributes.length===2,true,t.name+' active input count');
  c.same(native.attributes.some(a=>a.name==='in_0'),true,t.name+' active position');raw.push(pixels);
}
function poison(gl){gl.useProgram(null);gl.bindVertexArray(null);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.enable(gl.BLEND);gl.colorMask(false,false,false,false);}
function dispose(r,c){r.gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),'renderer disposal');c.ok(r.store.dispose(),'resource disposal');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),'final accounting').budgets))c.same(v,0,'final budget '+k);for(const[k,v]of r.live)c.same(v.size,0,'native cleanup '+k);c.same(r.gl.getError(),r.gl.NO_ERROR,'final native errors');}

export async function runBrowserFloatVertexAcceptance(){const c=checks(),wire=runFloatVertexWireAcceptance(),evidence={frames:[],rejections:[],jobs:[]};window.__floatVertexEvidence=evidence;
  const gl=document.querySelector('#gpu').getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});c.same(Boolean(gl),true,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu.renderer),false,'physical hardware GPU');
  const bridge=await createVirglShaderBridge(),raw=[],cases=[test('clip-w2',28,{coordinates:true,w:2}),test('clip-w4',31,{coordinates:true,w:4}),test('clip-w8',29,{coordinates:true,w:8}),test('scalar-format28',28),test('rg-format29',29),test('rgb-format30',30),test('rgba-format31',31)];
  for(const fmt of [28,29,30,31])for(const start of [0,1])for(const indexed of [false,true])for(const offsets of [false,true])cases.push(test('matrix-'+fmt+'-'+start+'-'+indexed+'-'+offsets,fmt,{start,indexed,w:4,color:colorB,hint:0,tail:0,...(offsets?{sourceOffset:8,colorOffset:4,positionOffset:4,positionSourceOffset:8}:{}),inactive:true}));
  for(const fmt of [28,29,30,31])cases.push(test('stride252-'+fmt,fmt,{colorStride:252,sourceOffset:8,colorOffset:4,tail:0}));
  cases.push(test('overlapping-rgba',31,{colorStride:4,color:[.25,.25,.25,.25],tail:0}));
  for(const t of cases){const r=rig(gl,bridge,c),{ids,g}=resources(r,c,t);const initial=await execute(r,c,1,join(setup(t,ids),transfer(ids.pos,g.position.length),transfer(ids.col,g.color.length),transfer(ids.index,g.index.length)),t.name+' setup');c.ok(initial.result,t.name+' setup');poison(gl);
    const run=await execute(r,c,1,join(clear(),draw(t)),t.name);inspectFrame(r,c,t,run,ids,evidence,raw);dispose(r,c);}
  // State-only A/B/A, public ID reuse and transfer revisions use retained real buffers.
  const a=test('owner-A',28,{sourceOffset:4,colorOffset:4}),b=test('owner-B',31,{color:colorB,colorStride:20,indexed:true,w:4}),r=rig(gl,bridge,c),ra=resources(r,c,a),rb=resources(r,c,b,8);
  for(const[ctx,t,res]of [[1,a,ra],[2,b,rb]])c.ok((await execute(r,c,ctx,join(setup(t,res.ids),transfer(res.ids.pos,res.g.position.length),transfer(res.ids.col,res.g.color.length),transfer(res.ids.index,res.g.index.length)),t.name+' setup')).result,t.name+' setup');
  for(const ctx of [1,2,1]){const t={...(ctx===1?a:b),name:'restore-'+ctx+'-'+evidence.frames.length},res=ctx===1?ra:rb;poison(gl);const run=await execute(r,c,ctx,join(clear(),draw(t)),t.name);run.contextId=ctx;inspectFrame(r,c,t,run,res.ids,evidence,raw);}
  const oldGeneration=r.allocations.find(a=>a.metadata.id===ra.ids.col).generation;c.ok(r.store.unref(ra.ids.col),'unref bound color');const replacement=geometry({...a,color:colorB}).color;add(r,c,meta(ra.ids.col,0,64,16,replacement.length),replacement);
  c.ok((await execute(r,c,1,transfer(ra.ids.col,replacement.length),'upload replacement public color')).result,'replacement transfer');
  const retained={...a,name:'bound-old-generation'};let run=await execute(r,c,1,join(clear(),draw(retained)),retained.name);inspectFrame(r,c,retained,run,ra.ids,evidence,raw);c.same(r.calls.at(-1).attributes.find(a=>a.name==='in_1').generation,oldGeneration,'native binding holds old generation');
  const fresh={...a,name:'rebind-new-generation',color:colorB};run=await execute(r,c,1,join(buffers(fresh,ra.ids),clear(),draw(fresh)),fresh.name);inspectFrame(r,c,fresh,run,ra.ids,evidence,raw);
  const revision={...fresh,name:'transfer-current-generation',color:[.5,.125,.75,.625]};c.ok(r.store.writeBacking(ra.ids.col,0,geometry(revision).color),'change CPU color bytes');run=await execute(r,c,1,join(transfer(ra.ids.col,replacement.length),clear(),draw(revision)),revision.name);inspectFrame(r,c,revision,run,ra.ids,evidence,raw);dispose(r,c);
  // One-byte-short last fetch rejects before issuing a native draw, then exact recovery.
  for(const fmt of [28,29,30,31]){const t=test('short-fetch-recovery-'+fmt,fmt,{tail:0,indexed:true,hint:0}),s=rig(gl,bridge,c),res=resources(s,c,t);c.ok((await execute(s,c,1,join(setup(t,res.ids),transfer(res.ids.pos,res.g.position.length),transfer(res.ids.col,res.g.color.length),transfer(res.ids.index,res.g.index.length)),'short setup')).result,'short setup');
    add(s,c,meta(6,0,64,16,res.g.color.length-1));const before=s.calls.length,negative=await execute(s,c,1,join(buffers(t,{...res.ids,col:6}),draw(t)),'one-byte-short '+fmt);c.bad(negative.result,'one-byte-short '+fmt,'out-of-bounds');c.same(s.calls.length,before,'short fetch issues no native draw');evidence.rejections.push({name:'one-byte-short '+fmt,format:fmt,packetHex:negative.packetHex,result:negative.result,dump:negative.dump});
    const recovered=await execute(s,c,1,join(buffers(t,res.ids),clear(),draw(t)),t.name);inspectFrame(s,c,t,recovered,res.ids,evidence,raw);
    for(const bytes of [ve(80,fmt,2),buffers({...t,colorOffset:2},res.ids),buffers({...t,colorStride:256},res.ids),join(buffers({...t,colorStride:0},res.ids),draw(t))]){const count=s.calls.length,bad=await execute(s,c,1,bytes,'invalid fetch layout '+fmt);c.bad(bad.result,'invalid fetch layout '+fmt);c.same(s.calls.length,count,'invalid layout no draw');evidence.rejections.push({name:'invalid layout '+fmt,packetHex:bad.packetHex,result:bad.result,dump:bad.dump});}
    c.ok((await execute(s,c,1,buffers(t,res.ids),'restore valid buffers')).result,'restore buffers');dispose(s,c);}
  for(const delay of [0,1,3]){const t=test('async-'+delay,31,{indexed:true,tail:0,w:4,sourceOffset:8,colorOffset:4,positionOffset:4}),s=rig(gl,bridge,c,{asynchronous:true,delay}),res=resources(s,c,t);
    c.ok((await execute(s,c,1,join(setup(t,res.ids),transfer(res.ids.pos,res.g.position.length),transfer(res.ids.col,res.g.color.length),transfer(res.ids.index,res.g.index.length)),t.name+' setup')).result,t.name+' setup');const start=s.fences(),run=await execute(s,c,1,join(clear(),draw(t)),t.name);inspectFrame(s,c,t,run,res.ids,evidence,raw);c.same(run.result.gpuComplete,true,'actual async GPU completion');c.same(s.fences()-start,2,'actual index-read and completion fences');evidence.jobs.push({delay,polls:run.polls,waits:s.waits(),fences:s.fences(),gpuComplete:run.result.gpuComplete});
    add(s,c,meta(6,0,64,16,res.g.color.length-1));const before=s.calls.length,negative=await execute(s,c,1,join(buffers(t,{...res.ids,col:6}),draw(t)),'async short '+delay);c.bad(negative.result,'async short '+delay,'out-of-bounds');c.same(s.calls.length,before,'async short no native draw');evidence.rejections.push({name:'async short '+delay,packetHex:negative.packetHex,result:negative.result,dump:negative.dump});dispose(s,c);}
  const all=join(...raw),binary=[];for(let at=0;at<all.length;at+=16384)binary.push(String.fromCharCode(...all.subarray(at,at+16384)));for(const frame of evidence.frames)delete frame.pixels;
  return{status:'passed',guestExecution:false,productionNegotiation:false,gpu,wire,assertions:c.rows,records:evidence.frames,rejections:evidence.rejections,jobs:evidence.jobs,rawPixelsBase64:btoa(binary.join('')),rawBytes:all.length,frames:evidence.frames.length,quantizationBudget:1};
}
