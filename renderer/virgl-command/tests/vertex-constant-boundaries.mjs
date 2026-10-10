// Fresh critic's independent high-slot swizzle/partial-write and active-prefix oracle.
import {createResourceStore, createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

export const VERTEX = ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',
  'DCL CONST[127]','DCL CONST[93]','DCL CONST[61]','DCL CONST[0]',
  '0: MOV OUT[0], IN[0]','1: MOV OUT[1], CONST[61].wzyx',
  '2: ADD OUT[1].xz, CONST[93].zywx, CONST[61].yxwz',
  '3: MUL OUT[1].yw, CONST[93].wxyz, CONST[61].zyxw','4: END',''].join('\n');
const FRAGMENT = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const VALUES = [
  {61:[0,.25,.5,.75],93:[.125,.25,.375,.5]},
  {61:[.5,.125,.25,.375],93:[.5,.875,.125,.75]},
];
const COLORS = [[159,8,255,72],[64,16,255,12]];
function packet(op,type,words) {
  const b=new Uint8Array((words.length+1)*4),v=new DataView(b.buffer);
  v.setUint32(0,op|(type<<8)|(words.length<<16),true);
  words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;
}
function join(...parts) {
  const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;
  for(const p of parts){b.set(p,at);at+=p.length;}return b;
}
function bits(n) {const b=new DataView(new ArrayBuffer(4));b.setFloat32(0,n,true);return b.getUint32(0,true);}
function shader(id,stage,text) {
  const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);
  b.set(new TextEncoder().encode(text),24);return b;
}
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
function bank(phase) {
  const words=Array(128*4).fill(0);
  for(const[index,lanes]of Object.entries(VALUES[phase]))words.splice(Number(index)*4,4,...lanes.map(bits));
  return words;
}
const constants=words=>packet(12,0,[0,0,...words]);
const setup=()=>join(shader(10,0,VERTEX),shader(2,1,FRAGMENT),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
  packet(1,5,[5,0,0,0,29]),packet(2,5,[5]),packet(6,0,[8,0,3]),
  packet(4,0,[0,...[8,8,.5,8,8,.5].map(bits)]),packet(31,0,[10,0]),packet(31,0,[2,1]),
  packet(43,0,[3,0,0,0,0,0,0,0,32,1,1,0,1]));
const hex=b=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');

export async function runVertexConstantBoundaries(gl) {
  const assertions=[],frames=[],uploads=[],allocations=new Map();let draws=0;
  const same=(actual,expected,label)=>{
    const held=JSON.stringify(actual)===JSON.stringify(expected);assertions.push({label,expected,actual,held});
    if(!held)throw new Error(label+': predicted '+JSON.stringify(expected)+', observed '+JSON.stringify(actual));
  };
  const ok=(r,label)=>{same(r.ok,true,label+' '+(r.error?JSON.stringify(r.error):''));return r;};
  const traced=new Proxy(gl,{get(t,k){if(typeof t[k]!=='function')return Reflect.get(t,k,t);return(...args)=>{
    if(k==='drawArrays'||k==='drawElements')draws++;
    if(k==='uniform4uiv')uploads.push([...args[1]]);return t[k].apply(t,args);
  };}});
  const bridge=await createVirglShaderBridge(),translated=ok(bridge.translatePair({vertexText:VERTEX,fragmentText:FRAGMENT}),'partial pair');
  same(translated.vertex.metadata.profile,'virgl-webgl2-straight-line-v6','ordinary profile only');
  same(translated.vertex.metadata.uniforms[0].count,129,'declared unused inaccessible suffix');
  const backend=ok(createWebGL2TransferBackend(traced),'transfer backend').backend;
  const owned=ok(createResourceStore({backend:{...backend,allocate(m){const r=backend.allocate(m);allocations.set(m.id,r);return r;}}}),'resource store');
  const renderer=ok(createVirglDrawRenderer({gl:traced,resources:owned.store,bindings:owned.bindings,shaderBridge:bridge,
    limits:{programs:2,uniformBytes:1312},cacheLimits:{translations:2,states:4}}),'renderer').renderer;
  const reader=gl.createFramebuffer();
  function pixels(expected,label) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,reader);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,allocations.get(1).texture,0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    for(const p of[gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
    const raw=new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,raw);
    const bad=[];for(let i=0;i<256;i++)if(JSON.stringify([...raw.subarray(i*4,i*4+4)])!==JSON.stringify(expected))bad.push({i,actual:[...raw.subarray(i*4,i*4+4)]});
    same(bad.slice(0,3),[],label+' literal pixels');return raw;
  }
  const execute=(ctx,b,label)=>{
    const r=renderer.executeSubmission(ctx,b);
    if(!r.ok)throw new Error(label+' '+JSON.stringify({error:r.error,reflection:renderer.inspect().contexts.map(c=>c.subContexts[0].programs.map(p=>p.reflection))}));
    return ok(r,label);
  };
  try {
    for(const ctx of[1,2]){ok(owned.store.createContext(ctx),'resource context');ok(renderer.createContext(ctx),'draw context');}
    for(const m of[{id:1,target:2,format:67,bind:2,width:16,height:16},{id:3,target:0,format:64,bind:16,width:32,height:1}]){
      ok(owned.store.createResource({...m,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'resource');
      for(const ctx of[1,2])ok(owned.store.attachContext(ctx,m.id),'context resource');
    }
    const geometry=new Uint8Array(32);new Float32Array(geometry.buffer).set([-1,-1,-1,1,1,-1,1,1]);ok(owned.store.attachBacking(3,[geometry]),'geometry');
    for(const ctx of[1,2])execute(ctx,setup(),'setup');
    for(const[ctx,phase]of[[1,0],[2,1],[1,0],[1,1],[2,0],[1,1]]) {
      const words=bank(phase),bytes=join(constants(words),draw());execute(ctx,bytes,'context high prefix');
      const raw=pixels(COLORS[phase],'high swizzle phase'+phase);
      same(uploads.at(-1),words,'complete owned active words');
      const reflection=renderer.inspect().contexts.find(c=>c.id===ctx).subContexts[0].programs[0].reflection.uniforms[0];
      same(reflection.count,129,'declared prefix');same(reflection.activeCount,129,'driver retains unused declaration suffix');same(reflection.uploadCount,128,'inaccessible suffix never grants guest128');
      frames.push({ctx,phase,expected:COLORS[phase],packetHex:hex(bytes),words,raw:[...raw],reflection});
    }
    for(const[words,code,label]of[
      [bank(0).slice(0,94*4),'incomplete-draw','referenced prefix alone is incomplete'],
      [bank(0).slice(0,127*4),'incomplete-draw','missing driver-active vector127'],
      [bank(0).map((w,i)=>i===127*4+3?0x7fc00001:w),'invalid-value','unconsumed high lane NaN'],
      [bank(0).map((w,i)=>i===62*4?0x7f800000:w),'invalid-value','inactive hole infinity'],
    ]) {
      const before=draws,r=renderer.executeSubmission(1,join(constants(words),draw()));same(r.ok,false,label+' rejects');same(r.error.code,code,label+' typed error');same(draws,before,label+' zero draws');
    }
    execute(1,join(constants(bank(0)),draw()),'recovery');pixels(COLORS[0],'recovery');
    same(gl.getError(),gl.NO_ERROR,'physical GL success');
  } finally {
    gl.deleteFramebuffer(reader);ok(renderer.dispose(),'renderer disposal');ok(owned.store.dispose(),'resource disposal');
    for(const owner of[renderer,owned.store])for(const[k,v]of Object.entries(ok(owner.inspect(),'final accounting').budgets))same(v,0,'released '+k);
  }
  return {status:'passed',assertions,frames,draws,shader:VERTEX};
}
