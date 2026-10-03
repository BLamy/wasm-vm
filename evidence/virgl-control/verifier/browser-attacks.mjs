import { createVirglShaderBridge } from '/renderer/virgl-shader/index.mjs';
import { createVirglControlBridge } from '/renderer/virgl-command/control-bridge.mjs';
import init, { WasmVirglControlProof } from '/target/virgl-control/pkg/wasm_vm_wasm.js';
const addr = n => BigInt(n).toString(16).padStart(16, '0');
const hex = b => [...b].map(n => n.toString(16).padStart(2, '0')).join('');
const word = (b, at, n) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(at, n, true);
const short = (b, at, n) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint16(at, n, true);
const long = (b, at, n) => new DataView(b.buffer, b.byteOffset, b.byteLength).setBigUint64(at, BigInt(n), true);
const read32 = (b, at = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
const read16 = b => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(0, true);
function packet(op, ctx, len) { const b = new Uint8Array(len); word(b, 0, op); word(b, 16, ctx); return b; }
function context(id) { const b = packet(0x200, id, 96); word(b, 24, 3); b.set([0x56, 0x52, 0x46], 32); return b; }
function resource(id, kind = 16, width = 96) { const b = packet(0x204, 0, 72); [id, 0, 64, kind, width, 1, 1, 1, 0, 0, 0, 0].forEach((v,i) => word(b,24+4*i,v)); return b; }
function identity(op, ctx, id) { const b = packet(op,ctx,32); word(b,24,id); return b; }
function backing(id, list) { const b = packet(0x106,0,32+16*list.length); word(b,24,id); word(b,28,list.length); list.forEach(([a,n],i) => {long(b,32+16*i,a); word(b,40+16*i,n);}); return b; }

export async function independentControlAttacks() {
  const wasmExports = await init(); let assertions = 0; const records = [], attacks = [];
  const eq = (a,b,label) => { assertions++; if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
  const yes = (v,label) => eq(Boolean(v),true,label);
  const ok = (r,label) => {eq(r.ok,true,`${label}: ${r.error?.code}`); return r;};
  const gl = document.querySelector('canvas').getContext('webgl2'); yes(gl,'hardware WebGL context');
  const shaderBridge = await createVirglShaderBridge();
  let fail = null; const live = new Map(['Buffer','Texture','Framebuffer','VertexArray','Shader','Program','Sampler'].map(k => [k,new Set()]));
  const wrapped = new Proxy(gl,{get(target,key){const v=Reflect.get(target,key,target); if(typeof v!=='function') return v; return (...args)=>{if(fail===key){fail=null;return null;} const r=v.apply(target,args); for(const [kind,set] of live){if(key===`create${kind}`&&r)set.add(r);if(key===`delete${kind}`)set.delete(args[0]);} return r;};}});
  const counts = () => Object.fromEntries([...live].map(([k,v])=>[k,v.size]));
  class Rig {
    constructor() {
      const made=ok(createVirglControlBridge({gl:wrapped,shaderBridge}),'bridge construction'); this.bridge=made.bridge;this.probes=made.probes;this.events=[];this.rawEvents=[];this.intercept=null;this.next=0;
      this.vm=new WasmVirglControlProof(e=>{this.rawEvents.push(e);this.events.push(structuredClone(e));if(this.intercept){const f=this.intercept;this.intercept=null;return f(e);}return this.bridge.apply(e);},true);
      this.base=BigInt('0x'+this.vm.layout().ramBase); this.D=this.base+0x9100n;this.A=this.base+0xa100n;this.U=this.base+0xb100n;this.Q=this.base+0x11000n;this.R=this.base+0x13000n;this.configure();
    }
    write(a,b){this.vm.writeRam(addr(a),b);} read(a,n){return this.vm.readRam(addr(a),n);}
    configure(){this.next=0;this.write(this.A,new Uint8Array(80));this.write(this.U,new Uint8Array(272));const m=(o,v)=>this.vm.writeMmio(o,v);m(0x70,3);m(0x24,0);m(0x20,1);m(0x24,1);m(0x20,1);m(0x70,11);m(0x70,15);m(0x30,0);m(0x38,32);for(const [reg,a]of[[0x80,this.D],[0x90,this.A],[0xa0,this.U]]){m(reg,Number(a&0xffffffffn));m(reg+4,Number(a>>32n));}m(0x44,1);}
    desc(i,a,n,flags,next=0){const b=new Uint8Array(16);long(b,0,a);word(b,8,n);short(b,12,flags);short(b,14,next);this.write(this.D+BigInt(16*i),b);}
    send(b,code,label,{split=13,capacity=24,response=this.R}={}){
      this.write(this.Q,b); this.desc(0,this.Q,split,1,1);this.desc(1,this.Q+BigInt(split),b.length-split,1,2);
      this.desc(2,response,9,3,3);this.desc(3,response+9n,capacity-9,2);
      const ring=this.next%32, n=new Uint8Array(2);this.write(this.A+4n+BigInt(2*ring),n);this.next=(this.next+1)&65535;short(n,0,this.next);this.write(this.A+2n,n);this.vm.writeMmio(0x50,0);
      const run=this.vm.run1();eq(run.outcome,'MaxInstrs','real guest instruction');eq(read16(this.read(this.U+2n,2)),this.next,'used count');eq(read32(this.read(this.U+4n+BigInt(8*ring),4)),0,'used descriptor');
      const used=read32(this.read(this.U+8n+BigInt(8*ring),4));eq(used,capacity<24?0:24,'full reply capacity before commit');
      const reply=this.read(response,24);if(capacity>=24){const want=packet(code,read32(b,16),24);const fenced=read32(b,4)&1;word(want,4,fenced);if(fenced)want.set(b.subarray(8,16),8);want[20]=b[20];eq(hex(reply),hex(want),label+' literal response');}
      const s=this.vm.inspect(); records.push({label,request:hex(b),response:hex(reply),used,next:this.next,transportDigest:s.digest,canonical:hex(s.canonicalBytes),machineDigest:run.machineDigest,host:this.bridge.inspect(),gl:counts()});return s;
    }
    unchanged(b,code,label,options){const before=hex(this.vm.inspect().canonicalBytes),host=JSON.stringify(this.bridge.inspect()),calls=this.events.length,objects=counts();this.send(b,code,label,options);eq(hex(this.vm.inspect().canonicalBytes),before,label+' transport atomic');eq(JSON.stringify(this.bridge.inspect()),host,label+' owner atomic');eq(this.events.length,calls,label+' no sink invocation');eq(counts(),objects,label+' no allocation');attacks.push(label);}
    reset(){this.vm.writeMmio(0x70,0);this.vm.run1();this.configure();}
    dispose(){ok(this.bridge.dispose(),'dispose owners');this.vm.free();eq(counts(),Object.fromEntries([...live.keys()].map(k=>[k,0])),'all actual GL objects released');}
  }
  for(const seed of [0x19,0x67,0xd3]){
    const r=new Rig();try{
      r.send(context(71),0x1100,'independent context');
      r.send(resource(93),0x1100,'independent vertex allocation');
      r.send(identity(0x202,71,93),0x1100,'attach context resource');
      const owners=r.probes.owners(),lease=ok(owners.store.retainStorage(71,93,'vertex'),'retained actual storage').lease;
      const allocation=ok(owners.bindings.resolve(lease),'resolve actual allocation');yes(gl.isBuffer(allocation.storage.buffer),'real GPU buffer exists');gl.bindBuffer(gl.ARRAY_BUFFER,allocation.storage.buffer);eq(gl.getBufferParameter(gl.ARRAY_BUFFER,gl.BUFFER_SIZE),96,'actual GPU allocated bytes');gl.bindBuffer(gl.ARRAY_BUFFER,null);
      const pattern=Uint8Array.from({length:80},(_,i)=>(seed+i*29)&255);r.write(r.R,pattern);
      r.send(backing(93,[[r.R,31],[r.R+7n,22],[r.R+63n,9]]),0x1100,'reply-overlapping SG alias',{split:47});
      const want=[...pattern.slice(0,31),...pattern.slice(7,29),...pattern.slice(63,72)];eq([...ok(owners.store.readBacking(93,0,62),'initial owned backing').bytes],want,'SG alias pre-response literal bytes');const originalName=r.rawEvents.find(e=>e.type==='createContext').debugName;const originalSegments=r.rawEvents.at(-1).segments.map(s=>s.data);const oldMemory=wasmExports.memory.buffer;wasmExports.memory.grow(1);eq(oldMemory.byteLength,0,'actual Wasm memory growth detaches previous buffer');eq([...originalName],[0x56,0x52,0x46],'raw original name survives Wasm memory growth');eq(originalSegments.flatMap(b=>[...b]),want,'raw original SG arrays survive Wasm memory growth');r.write(r.R,new Uint8Array(80).fill(0xee));eq([...ok(owners.store.readBacking(93,0,62),'later RAM independence').bytes],want,'initial copy is not future DMA');eq(originalSegments.flatMap(b=>[...b]),want,'raw original SG arrays survive guest RAM mutation');
      r.unchanged(identity(0x202,71,93),0x1205,'duplicate membership');r.unchanged(backing(93,[[r.R,1]]),0x1205,'duplicate backing');
      r.send(identity(0x107,0,93),0x1100,'detach initial backing');
      r.unchanged(backing(93,[[r.R+32n,16],[r.base+4194304n-7n,8]]),0x1205,'invalid last RAM segment',{split:33});
      r.unchanged(backing(93,[[0xfffffffffffffffcn,8]]),0x1205,'address wrap rejected');
      r.send(backing(93,[[r.R+32n,3]]),0x1100,'short aggregate accepted');eq(owners.store.inspect().budgets.backingBytes,3,'short backing count');
      const old=structuredClone(r.events.find(e=>e.type==='createResource'));
      r.send(packet(0x201,71,24),0x1100,'destroy context retains public resource');yes(gl.isBuffer(allocation.storage.buffer),'context removal preserves retained allocation');
      r.send(identity(0x102,0,93),0x1100,'unref retained public resource');yes(gl.isBuffer(allocation.storage.buffer),'retained allocation survives unref');
      r.send(resource(93),0x1100,'reuse public number');yes(r.vm.inspect().resources[0].identity.generation!==old.resource.generation,'new transport generation');
      const before=JSON.stringify(r.bridge.inspect());eq(r.bridge.apply({...old,type:'unrefResource',metadata:undefined}).ok,false,'malformed stale identity rejected');eq(JSON.stringify(r.bridge.inspect()),before,'invalid stale event owner atomic');
      const stale={epoch:old.epoch,type:'unrefResource',resource:old.resource};eq(r.bridge.apply(stale).error.code,'invalid-resource-id','stale generation cannot touch reuse');
      ok(owners.store.releaseStorage(lease),'release old storage lease');eq(gl.isBuffer(allocation.storage.buffer),false,'old GL allocation deleted after last lease');
      r.send(identity(0x102,0,93),0x1100,'final resource release');r.unchanged(context(72),0x1205,'23-byte response no mutation',{capacity:23});r.send(context(72),0x1100,'recovery after short response');
      for(const [offset,value]of[[4,1],[20,1],[24,65],[28,1]]){const b=context(73);word(b,offset,value);r.unchanged(b,0x1205,`strict context field ${offset}`);}
      r.send(packet(0x201,72,24),0x1100,'final context release');eq(r.vm.inspect().logicalBytes,0,'transport bytes empty');attacks.push(`independent-alias-lifetime-seed-${seed}`);
    }finally{r.dispose();}
  }
  // P16: callback applies to owners, then throws before transport sees success.
  {const r=new Rig();try{
    const initial=r.vm.inspect().nextGeneration;r.intercept=e=>{ok(r.bridge.apply(e),'apply before throw');throw new Error('verifier after-apply failure');};
    r.send(resource(101),0x1200,'applied callback throws');eq(r.vm.inspect().nextGeneration,initial,'generation uncommitted after throw');eq(r.vm.inspect().poisoned,true,'Rust poison set');eq(r.bridge.inspect().resources.length,1,'host did apply before callback failure');
    const old=structuredClone(r.events.at(-1)),host=r.probes.owners();r.unchanged(resource(102),0x1200,'poison blocks sink');r.reset();eq(host.store.inspect().disposed,true,'old owner disposed');
    r.send(resource(101),0x1100,'same generation retry after reset');const fresh=r.events.at(-1);eq(fresh.resource.generation,old.resource.generation,'uncommitted generation reused');yes(fresh.epoch!==old.epoch,'epoch changed');
    const before=JSON.stringify(r.bridge.inspect());eq(r.bridge.apply(old).error.code,'invalid-parameter','old epoch cannot create again');eq(JSON.stringify(r.bridge.inspect()),before,'old epoch atomic');attacks.push('apply-then-throw-reset-same-generation');
  }finally{r.dispose();}}
  // Independent trusted fault wrappers: context's second owner and actual GPU allocation.
  {const r=new Rig();try{
    const before=JSON.stringify(r.bridge.inspect());fail='createFramebuffer';r.send(context(81),0x1201,'second-owner context failure');eq(JSON.stringify(r.bridge.inspect()),before,'context rollback clears first owner');r.send(context(81),0x1100,'context rollback recovery');
    fail='createBuffer';r.send(resource(111),0x1201,'GPU allocation failure');eq(r.vm.inspect().resources.length,0,'failed allocation leaves no transport name');eq(r.bridge.inspect().resources.length,0,'failed allocation leaves no owner name');r.send(resource(111),0x1100,'GPU allocation retry');attacks.push('actual-allocation-and-context-rollback');
  }finally{r.dispose();}}
  // Trusted host corruption of each independent context owner must poison teardown.
  for (const owner of ['renderer', 'store']) {
    const r=new Rig();try{
      r.send(context(121),0x1100,`prepare externally revoked ${owner}`);
      ok(r.probes.owners()[owner].destroyContext(121),`external ${owner} context revoke`);
      r.send(packet(0x201,121,24),0x1200,`structured ${owner} destroy failure`);
      eq(r.bridge.inspect().poisoned,true,`${owner} split ownership poisons JS`);eq(r.vm.inspect().poisoned,true,`${owner} split ownership poisons Rust`);
      r.unchanged(context(122),0x1200,`${owner} failure blocks next host mutation`);r.reset();r.send(context(121),0x1100,`${owner} recovery after reset`);attacks.push(`trusted-${owner}-revoke-destroy-failure`);
    }finally{r.dispose();}
  }
  {const r=new Rig();try{
    const revoked=Proxy.revocable({},{});revoked.revoke();const before=JSON.stringify(r.bridge.inspect());const result=r.bridge.apply(revoked.proxy);eq(result.error.code,'invalid-parameter','revoked Proxy reflection is structured input failure');eq(JSON.stringify(r.bridge.inspect()),before,'revoked Proxy leaves owners unchanged');r.send(context(123),0x1100,'valid after revoked Proxy');attacks.push('trusted-revoked-proxy-reflection');
  }finally{r.dispose();}}
  {const r=new Rig();try{
    const before=hex(r.vm.inspect().canonicalBytes),calls=r.events.length;
    for(const [label,fn]of[
      ['oversized RAM read',()=>r.vm.readRam(addr(r.base),4194305)],
      ['oversized RAM write',()=>r.vm.writeRam(addr(r.base),new Uint8Array(4194305))],
      ['RAM write outside fixture',()=>r.vm.writeRam(addr(r.base+4194304n),Uint8Array.of(1))],
      ['invalid write address',()=>r.vm.writeRam('00000000800000gg',Uint8Array.of(1))],
      ['outside MMIO read',()=>r.vm.readMmio(4096)],
      ['unaligned MMIO write',()=>r.vm.writeMmio(1,0)],
    ]){let message='';try{fn();}catch(error){message=error.message;}yes(message,label+' rejected');eq(hex(r.vm.inspect().canonicalBytes),before,label+' no transport mutation');eq(r.events.length,calls,label+' no callback');attacks.push(label);}
  }finally{r.dispose();}}
  eq(gl.getError(),gl.NO_ERROR,'zero GL errors');return {status:'passed',assertions,attacks,records};
}
