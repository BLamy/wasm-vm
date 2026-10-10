/** Fresh critic: a different original mip range, words, swizzle and output mip. */
import {rig,finish,blob,submit,nativeRead} from './standard-float-consumer-rig.mjs';
import {checks} from './standard-instanced-draws.mjs';
import {createVirglStandardTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import * as decoder from '../decoder.mjs';
import * as state from '../state.mjs';

const formats=[91,92,93,94,28,29,30,31];
const description=fmt=>fmt>=91?[16,fmt-90]:[32,fmt-27];
const shrink=(n,l)=>Math.max(1,Math.floor(n/2**l));
const packet=(op,type,words)=>new Uint8Array(new Uint32Array([op|(type<<8)|(words.length<<16),...words]).buffer);
const join=(...arrays)=>{const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length;}return out;};
const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
const meta=(id,target,format,bind,width,height=1,lastLevel=0)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
const view=(fmt,first=2,last=4)=>packet(1,6,[5,6,(2<<24)|fmt,0,first|(last<<8),1|(2<<3)|(5<<6)]);
const surface=(handle,id,fmt,level)=>packet(1,8,[handle,id,fmt,level,0]);
const shader=(handle,stage,text)=>{const ascii=new TextEncoder().encode(text+'\0'),aligned=new Uint8Array(Math.ceil(ascii.length/4)*4);aligned.set(ascii);return join(packet(1,4,[handle,stage,ascii.length,8192,0,...new Uint32Array(aligned.buffer)]));};
const clear=(color,depth=null)=>packet(7,0,[(depth===null?4:5),...color.map(bits),...new Uint32Array(new Float64Array([depth??1]).buffer),0]);
const transfer=(id,level,width,height,offset,stride,direction=1)=>packet(43,0,[id,level,0,stride,stride*height,0,0,0,width,height,1,offset,direction]);
const draw=()=>packet(8,0,[0,6,4,0,1,0,0,0,0,0,0xffffffff,0]);

function specimen(fmt,stage,seed){
 const [precision,components]=description(fmt),unit=precision/8,planes=[];let length=13;
 const pool=precision===16?[0xbc00,0x3800,0x3c00,0xc200,0x4200,0x3000,0xb400,0x4400]:[0xbfabc123,0x3f800417,0x40aeff42,0xc0412146,0x3e904561,0x40b42178,0xbefdd314,0x3f298763];
 for(let level=0;level<=5;level++){
  const width=shrink(33,level),height=shrink(19,level),input=new Uint8Array(width*height*components*unit),data=new DataView(input.buffer);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let k=0;k<components;k++){const at=((y*width+x)*components+k)*unit,word=pool[(x*5+y*3+k*7+level*3+(seed>>>0))%pool.length];precision===16?data.setUint16(at,word,true):data.setUint32(at,word,true);}
  const stride=width*components*unit+9,offset=length;length+=(height-1)*stride+width*components*unit+17;planes.push({level,width,height,stride,offset,input});
 }
 const backing=new Uint8Array(length).fill(0xc3);for(const p of planes)for(let y=0;y<p.height;y++){const size=p.width*components*unit;backing.set(p.input.subarray(y*size,(y+1)*size),p.offset+y*p.stride);}
 const code=['DCL TEMP[0]', 'DCL SAMP[2]','DCL SVIEW[2], 2D, FLOAT','IMM[0] FLT32 {0.4375,0.3125,0,0.5}'];
 const vertex=stage==='vertex'?['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...code,'0: MOV OUT[0], IN[0]','1: TXL TEMP[0], IMM[0], SAMP[2], 2D','2: MOV OUT[1], TEMP[0]','3: END',''].join('\n'):'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
 const fragment=stage==='fragment'?['FRAG','DCL OUT[0], COLOR',...code,'0: TXL TEMP[0], IMM[0], SAMP[2], 2D','1: MOV OUT[0], TEMP[0]','2: END',''].join('\n'):'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
 return {name:`independent-${fmt}-${stage}-${seed.toString(16)}`,stage,opcode:'TXL',slot:2,firstLevel:2,lastLevel:4,swizzle:[1,2,5,0],parameters:{s:2,t:2,r:2,min:Number(stage==='fragment'),mip:1,mag:Number(stage==='fragment'),minLod:-3,maxLod:3},vertex,fragment,source:{metadata:meta(6,2,fmt,10,33,19,5),planes,backing},width:3,height:2,outputFormat:31,outputLevel:2,outputLastLevel:3,targetWidth:15,targetHeight:11,clearColor:[-2.25,3.5,-.125,-4],positions:new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer)};
}
function setup(f){return join(transfer(3,0,f.positions.length,1,0,0),...f.source.planes.map(p=>transfer(6,p.level,p.width,p.height,p.offset,p.stride)),shader(1,0,f.vertex),shader(2,1,f.fragment),packet(1,5,[3,0,0,0,f.vertexFormat??31]),packet(2,5,[3]),packet(6,0,[16,0,3]),surface(4,1,31,f.outputLevel),packet(5,0,[1,0,4]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(bits)]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear(f.clearColor));}
function views(f,format=f.source.metadata.format){const p=f.parameters,flags=p.s|(p.t<<3)|(p.r<<6)|(p.min<<9)|(p.mip<<11)|(p.mag<<13);return join(packet(1,7,[8,flags,0,bits(p.minLod),bits(p.maxLod),0,0,0,0]),view(format),packet(10,0,[f.stage==='vertex'?0:1,2,5]),packet(18,0,[f.stage==='vertex'?0:1,2,8]));}
function wordValue(precision,word){if(precision===32)return new Float32Array(new Uint32Array([word]).buffer)[0];const s=word&32768?-1:1,e=word>>10&31,m=word&1023;return s*(e?2**(e-15)*(1+m/1024):m*2**-24);}
function prediction(f){
 const [precision,components]=description(f.source.metadata.format),unit=precision/8;
 const texel=(local,x,y)=>{const p=f.source.planes[2+local],d=new DataView(p.input.buffer);return[0,1,2,3].map(k=>k<components?wordValue(precision,precision===16?d.getUint16(((y*p.width+x)*components+k)*unit,true):d.getUint32(((y*p.width+x)*components+k)*unit,true)):k===3?1:0);};
 const sample=local=>{const p=f.source.planes[2+local],u=.4375*p.width,v=.3125*p.height;if(!f.parameters.min)return texel(local,Math.floor(u),Math.floor(v));const x=u-.5,y=v-.5,a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b,corners=[[0,0],[1,0],[0,1],[1,1]].map(([dx,dy])=>texel(local,Math.max(0,Math.min(p.width-1,a+dx)),Math.max(0,Math.min(p.height-1,b+dy))));return[0,1,2,3].map(k=>(1-fy)*((1-fx)*corners[0][k]+fx*corners[1][k])+fy*((1-fx)*corners[2][k]+fx*corners[3][k]));};
 const a=sample(0),b=sample(1),color=a.map((n,k)=>(n+b[k])/2);return f.swizzle.map(k=>Math.fround(k===5?1:k===4?0:color[k]));
}
const misses=(raw,color)=>{const values=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);return[...values].flatMap((n,i)=>!Number.isFinite(n)||Math.abs(n-color[i%4])>2e-6*Math.max(1,Math.abs(color[i%4]))?[{at:i,observed:n,expected:color[i%4]}]:[]);};
export function runWireAcceptance(){
 const c=checks(),records=[],prior=[decoder.decodeSubmission,decoder.decodeStandardSubmission,decoder.decodeStandardUniformSubmission,decoder.decodeStandardTextureSubmission,decoder.decodeStandardImageSubmission,decoder.decodeStandardColorSubmission];
 for(const fmt of formats){const wire=view(fmt),selected=decoder.decodeStandardFloatImageSubmission(wire);c.ok(selected,'independent selected full range');for(const old of prior)c.same(old(wire).ok,false,'independent original float view keeps historical admission closed');records.push({kind:'selected-range',format:fmt,hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),selected});}
 for(const old of [...prior,decoder.decodeStandardFloatImageSubmission])for(const wire of [surface(4,1,16,0),surface(4,1,67,0)]){const selected=old(wire);c.ok(selected,'unchanged historical nonfloating surface');records.push({kind:'historical-surface',hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),selected});}
 for(const wire of [view(31,4,2),view(31,2,15),packet(1,6,[5,6,(3<<24)|31,0,1026,337]),view(124),surface(4,1,31,15)]){const selected=decoder.decodeStandardFloatImageSubmission(wire);c.same(selected.ok,false,'independent bad floating packet stays closed');records.push({kind:'invalid-range-format',hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),selected});}
 return{status:'passed',records,predictions:c.rows};
}
export async function runAcceptance({fault=null,seed=0x71f4362b}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info'),bridge=await createVirglStandardTextureShaderBridge(),report={status:'running',gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,guestExecution:false,productionNegotiation:false,independentExperiment:true,frames:[],runs:[],blobs:[],predictions:c.rows};window.__standardFloatConsumerEvidence=report;
 const cases=formats.flatMap(fmt=>['vertex','fragment'].map(stage=>specimen(fmt,stage,seed)));
 const typed=specimen(31,'fragment',seed);cases.push({...typed,name:typed.name+'/original-integer-position',vertexFormat:200,vertex:typed.vertex.replace('MOV OUT[0], IN[0]','I2F OUT[0], IN[0]'),positions:new Uint8Array(new Int32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer)});
 if(fault)c.same(fault,'linear-filter','one bounded actual filter sabotage');
 for(const f of (fault?cases.filter(f=>f.stage==='fragment'&&f.source.metadata.format===31&&!f.vertexFormat):cases)){
  const clearCalls=[],physicalCalls=[],ownedObjects=[];
  const actual=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(['clearBufferfv','clear','clearColor','clearDepth','colorMask','depthMask','samplerParameteri','samplerParameterf'].includes(key))physicalCalls.push({name:key,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:v)});if(key==='clearBufferfv')clearCalls.push({name:key,args:[args[0],args[1],[...args[2]]]});const answer=value.apply(target,args);if(/^create/.test(key)&&answer)ownedObjects.push({object:answer,name:key,deleted:0});if(/^delete/.test(key)){const object=ownedObjects.find(o=>o.object===args[0]);if(object)object.deleted++;}return answer;};}});
  const r=rig(actual,bridge,c,f,{delay:1,step:1,fault});r.blobs=report.blobs;r.add(meta(3,0,64,16,f.positions.length),f.positions);r.add(f.source.metadata,f.source.backing);c.ok(r.store.detachBacking(6),'independent backing detach');c.ok(r.store.attachBacking(6,[f.source.backing.subarray(0,11),f.source.backing.subarray(11)]),'independent odd segment ownership');
  const row={name:f.name,stage:f.stage,opcode:f.opcode,slot:f.slot,range:[2,4],swizzle:f.swizzle,parameters:f.parameters,source:f.source.metadata,target:r.allocations[0].metadata,width:3,height:2,outputLevel:2,clearColor:f.clearColor,vertex:f.vertex,fragment:f.fragment,vertexFormat:f.vertexFormat??31,positions:await blob(report,f.positions),backing:await blob(report,f.source.backing),planes:[],frames:[],predictedBeforeNative:prediction(f)};for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});report.runs.push(row);
  async function capture(kind,record){
   c.ok(record.result,'independent original submission');c.same(record.result.gpuComplete,true,'independent consumed physical fence');const target=r.allocations[0].storage.texture,pixels=nativeRead(gl,target,31,3,2,2),color=kind==='clear'?f.clearColor:row.predictedBeforeNative,miss=misses(pixels,color),frame={run:report.runs.length-1,label:record.label,kind,historyIndex:r.history.length-1,dump:record.dump,pixels:await blob(report,pixels),expectedColor:color,mask:15,blend:false,previous:null,bindings:[],outputs:[]};report.frames.push(frame);row.frames.push(report.frames.length-1);
   if(fault&&kind==='draw'){c.same(miss.length>0,true,'independent original inverse rejects actual wrong filtering');report.sabotage={fault,physicalFenceConsumed:true,mismatches:miss};}else c.same(miss,[],'independent original full native output');
   for(let level=0;level<=3;level++){const width=shrink(15,level),height=shrink(11,level);frame.outputs.push({level,width,height,native:await blob(report,nativeRead(gl,target,31,width,height,level))});}
   const out=await submit(r,1,packet(43,0,[1,2,0,51,0,0,0,0,3,2,1,5,2]),record.label+'/public-read');c.ok(out.result,'independent original public transfer');c.same(out.result.gpuComplete,true,'independent native PBO fence');frame.publicHistory=r.history.length-1;frame.outputBacking=await blob(report,c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'independent full public backing').bytes);
   if(kind==='draw'){gl.activeTexture(gl.TEXTURE0+(f.stage==='vertex'?18:2));const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(a=>a.storage.texture===texture),planes=[];c.same(Boolean(allocation),true,'independent actual captured native view');for(let local=0;local<=2;local++){const p=f.source.planes[2+local];planes.push({local,original:2+local,width:p.width,height:p.height,native:await blob(report,nativeRead(gl,texture,f.source.metadata.format,p.width,p.height,local))});}frame.bindings.push({stage:f.stage,slot:2,range:[2,4],metadata:allocation.metadata,nativeTexture:r.trace.id(texture),planes});gl.activeTexture(gl.TEXTURE0);}
   c.same(gl.getError(),gl.NO_ERROR,'independent real native path has no error');
  }
  try{
   if(report.runs.length===1&&!fault){
    const factories=['createVirglStateRenderer','createVirglDrawRenderer','createVirglAsyncRenderer','createVirglStandardAsyncRenderer','createVirglStandardUniformAsyncRenderer','createVirglStandardBufferAsyncRenderer','createVirglStandardImageAsyncRenderer','createVirglStandardColorAsyncRenderer','createVirglStandardTextureAsyncRenderer'];row.historicalProfiles=[];
    for(const [index,name]of factories.entries()){const config={gl:actual,resources:r.store,bindings:r.bindings,shaderBridge:bridge,...(index>=2?{asyncAccess:r.asyncAccess}:{}),...(index>=3?{primitiveAssembly:'lists'}:{}),...(index>=4?{uniformAccess:r.uniformAccess}:{}),...(index>=6?{imageAccess:r.imageAccess}:{})},selected=c.ok(state[name](config),'actual historical renderer construction').renderer;row.historicalProfiles.push({name,inspect:selected.inspect()});c.ok(selected.dispose(),'actual historical renderer disposal');}
   }
   const record=await submit(r,1,setup(f),'independent-setup-'+report.runs.length);await capture('clear',record);
   const mismatch=await submit(r,1,view(f.source.metadata.format===31?28:f.source.metadata.format===94?91:f.source.metadata.format+1),'independent-format-reinterpret');c.same(mismatch.result.error.code,'incompatible-resource','original view format cannot reinterpret owned storage');row.formatRefusal=mismatch;
   c.ok((await submit(r,1,views(f),'independent-view-'+report.runs.length)).result,'independent original floating range');await capture('draw',await submit(r,1,draw(),'independent-draw-'+report.runs.length));
   c.same(clearCalls.some(call=>call.args[0]===gl.COLOR&&call.args[1]===0&&JSON.stringify(call.args[2])===JSON.stringify(f.clearColor)),true,'actual unbounded floating clear arguments reach native GL');
  }finally{await finish(r,report,row);row.actualNativeCalls=physicalCalls;row.actualObjects=ownedObjects.map(({object,...o})=>o);for(const o of row.actualObjects)c.same(o.deleted,1,'independently observed native object cleanup');}
 }
 if(!fault){
  // The selected color clear and the inherited depth clear must coexist on the
  // same actual framebuffer. A real LESS draw discriminates both depth values.
  const f={...specimen(31,'fragment',seed),outputLevel:0,outputLastLevel:0,targetWidth:3,targetHeight:2},calls=[];
  const native=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(['clearBufferfv','clear','clearDepth','depthMask'].includes(key))calls.push({name:key,args:args.map(n=>ArrayBuffer.isView(n)?[...n]:n)});return value.apply(target,args);};}});
  const r=rig(native,bridge,c,f,{delay:2,step:1});r.blobs=report.blobs;r.add(meta(3,0,64,16,f.positions.length),f.positions);r.add(f.source.metadata,f.source.backing);r.add(meta(7,2,16,1,3,2),new Uint8Array(12));
  const row={kind:'combined-float-depth-clear',name:'combined-float-depth-clear',literalPrograms:{vertex:f.vertex,fragment:f.fragment},originalSource:{metadata:f.source.metadata,backing:await blob(report,f.source.backing)},captures:[],positions:await blob(report,f.positions)};report.runs.push(row);
  try{
   c.ok((await submit(r,1,setup(f),'independent-depth-setup')).result,'independent original color setup');c.ok((await submit(r,1,views(f),'independent-depth-view')).result,'independent source view');
   const attach=join(surface(40,7,16,0),packet(5,0,[1,40,4]),packet(1,3,[41,5,0,0,0]),packet(2,3,[41]));c.ok((await submit(r,1,attach,'independent-depth-attach')).result,'actual Z16 attachment and original LESS state');
   for(const depth of [.375,.75]){const record=await submit(r,1,join(clear(f.clearColor,depth),draw()),'independent-combined-clear-'+depth);c.ok(record.result,'combined floating and Z16 clear');c.same(record.result.gpuComplete,true,'combined clear consumed actual physical fence');const pixels=nativeRead(gl,r.allocations[0].storage.texture,31,3,2,0),expected=depth===.375?f.clearColor:prediction(f);c.same(misses(pixels,expected),[],'actual LESS draw distinguishes depth clear alongside float clear');row.captures.push({depth,original:record,pixels:await blob(report,pixels),expectedColor:expected});}
   c.same(calls.filter(e=>e.name==='clear'&&e.args[0]===gl.DEPTH_BUFFER_BIT).length,2,'actual separate inherited depth clears execute twice');c.same(gl.getError(),gl.NO_ERROR,'combined float/depth clear native error state');
  }finally{await finish(r,report,row);row.actualNativeCalls=calls;}
  const limited=rig(gl,bridge,c,f,{jobLimits:{submissionBytes:setup(f).length-1}});limited.blobs=report.blobs;const before=limited.nativeObjects.length,boundary={kind:'exact-original-byte-budget',name:'original-byte-budget-minus-one'};report.runs.push(boundary);try{boundary.record=await submit(limited,1,setup(f),'independent-original-byte-budget');c.same(boundary.record.result.error.code,'limit-exceeded','one byte under original complete packet budget refuses');c.same(limited.nativeObjects.length,before,'bounded original submission refuses before consumer native allocation');}finally{await finish(limited,report,boundary);}
 }
 report.status='passed';return report;
}
