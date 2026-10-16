// Promoted critic attack: nonzero mip coordinates, exact row endpoint and a
// one-byte-short split backing, with actual hardware and original RGB32F words.
import { checker, makeRig, context, idCommand, header, backing, transfer } from './submit-acceptance.mjs';
import { Selected } from './desktop-submit-acceptance.mjs';
import { createVirglStandardShadowTextureShaderBridge } from '../../virgl-shader/standard.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>x instanceof Uint8Array?[...x]:typeof x==='bigint'?x.toString(16):x));
const set32=(v,at,x)=>new DataView(v.buffer,v.byteOffset,v.byteLength).setUint32(at,x,true);
const metadata={id:6,target:2,format:30,bind:10,width:9,height:7,depth:1,arraySize:1,lastLevel:3,nrSamples:0,flags:0};
function create(){const raw=header(0x204,0,72);Object.values(metadata).forEach((v,i)=>set32(raw,24+4*i,v));return raw;}
function dma(read,box,fence){const raw=transfer(1,6,read?2:1,box,5n,0,0,fence);set32(raw,60,1);return raw;}
const words=[0x3e800000,0x3f000000,0x3f400000,0x3f800000,0xbf800000,0xc0000000];
function rows(width,height,start){
  const out=new Uint8Array(width*height*12),v=new DataView(out.buffer);
  for(let i=0;i<out.length/4;i++)v.setUint32(i*4,words[(i+start)%words.length],true);
  return out;
}
export async function runNativeImageCritic({WasmVirglSubmitProof,createVirglStandardDesktopSubmitBridge,seeds=[0x243f6a88]}) {
  const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(gl,'actual hardware WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);c.truth(gpu.includes('Metal'),'actual Metal adapter');
  const nativeCalls=[],ids=new WeakMap();let next=1;
  const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;
    if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(!ids.has(v))ids.set(v,next++);return {object:ids.get(v),type:v.constructor?.name??'object'};};
  const recorded=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);return typeof v!=='function'?v:(...args)=>{
    const before=args.map(describe),value=v.apply(t,args);nativeCalls.push({sequence:nativeCalls.length,name:k,before,after:args.map(describe),result:describe(value)});return value;};}});
  const shaderBridge=await createVirglStandardShadowTextureShaderBridge(),Wasm=Selected(WasmVirglSubmitProof);
  const result={status:'running',gpu,seed:seeds[0],nativeCalls,runs:[],guestExecution:false,productionNegotiation:false};window.__desktopProof=result;
  for(const capacity of [76,77]) {
    const rig=makeRig(Wasm,createVirglStandardDesktopSubmitBridge,recorded,shaderBridge,c,seeds[0]),{q}=rig;
    window.__desktopActive=()=>({native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),records:q.records,exchanges:rig.exchanges});
    await rig.expect('critic context',context(1));await rig.expect('critic RGB32F NPOT chain',create());
    c.equal(q.vm.inspect().logicalBytes,936,'literal78 pixels times12 public bytes');c.equal(q.vm.inspect().gpuBytes,1248,'literal78 pixels times16 owned bytes');
    c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,1248,'same host cost');await rig.expect('critic context membership',idCommand(0x202,1,6));
    const first=q.base+0x210000n,second=q.base+0x220000n;
    let entries;
    const attach=async(size)=>{entries=[[first,13],[second,size-13]];for(const [addr,len] of entries)q.write(addr-8n,new Uint8Array(len+16).fill(0xa3));
      await rig.expect('critic split backing '+size,backing(6,entries));};
    const write=b=>{q.write(first,b.subarray(0,13));q.write(second,b.subarray(13));};
    const read=()=>{const b=new Uint8Array(entries[0][1]+entries[1][1]);b.set(q.read(first,13));b.set(q.read(second,entries[1][1]),13);return b;};
    const guards=()=>entries.map(([addr,len])=>{const prefix=hex(q.read(addr-8n,8)),suffix=hex(q.read(addr+BigInt(len),8));c.equal(prefix,'a3'.repeat(8),'prefix guard');c.equal(suffix,'a3'.repeat(8),'suffix guard');return{address:addr.toString(16),len,prefix,suffix};});
    await attach(149);
    const initial=rows(4,3,1),full=new Uint8Array(149).fill(0xb7);full.set(initial,5);write(full);
    await rig.expect('critic full mip1 baseline upload',dma(false,[0,0,0,4,3,1],0xa001n));
    await rig.expect('critic detach baseline backing',idCommand(0x107,0,6));await attach(capacity);
    const tight=rows(2,2,4),source=new Uint8Array(capacity).fill(0xb7);source.set(tight.subarray(0,24),5);source.set(tight.subarray(24,capacity-53+24),53);write(source);guards();
    const box=[1,1,0,2,2,1],upload=dma(false,box,0xa002n),download=dma(true,box,0xa003n);
    const before={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),events:rig.events.length};
    if(capacity===76) {
      for(const raw of [upload,download]){await rig.expect('critic one-byte-short '+new DataView(raw.buffer).getUint32(0,true),raw,0x1205);
        c.same(q.vm.inspect(),before.native,'one-byte-short native rollback');c.same(rig.host.bridge.inspect(),before.host,'one-byte-short host rollback');c.equal(rig.events.length,before.events,'one-byte-short no callback');c.equal(hex(read()),hex(source),'short DMA untouched');guards();}
      result.runs.push({capacity,before,source:hex(source),records:q.records,events:rig.events,exchanges:rig.exchanges,guards:guards()});rig.dispose();continue;
    }
    const start=rig.exchanges.length,up=q.enqueue('critic exact endpoint subrectangle upload',upload);q.kick();q.run();c.equal(q.usedIndex(),up.number,'upload publication withheld');await rig.drain();q.collect(up);q.vm.writeMmio(0x64,1);
    const input=rig.exchanges.slice(start).find(v=>v.kind==='input');c.equal(input.bytes,hex(tight),'live public default mip rows');c.same(input.args.slice(-3),[24,48,2],'exact native mip row geometry');
    write(new Uint8Array(77).fill(0xc7));const down=q.enqueue('critic exact endpoint subrectangle readback',download);q.kick();q.run();c.equal(q.usedIndex(),down.number,'readback publication withheld');await rig.drain();q.collect(down);q.vm.writeMmio(0x64,1);
    const output=rig.exchanges.slice(start).find(v=>v.kind==='output');c.equal(output.bytes,hex(tight),'actual public RGB32F subrectangle');c.same(output.args.slice(-3),[24,48,2],'readback native mip row geometry');
    const expected=new Uint8Array(77).fill(0xc7);expected.set(tight.subarray(0,24),5);expected.set(tight.subarray(24),53);c.equal(hex(read()),hex(expected),'all77 backing bytes including padding');
    const completeBacking=hex(read()),smallGuards=guards();
    await rig.expect('critic detach small backing',idCommand(0x107,0,6));await attach(149);write(new Uint8Array(149).fill(0xc7));
    await rig.expect('critic whole mip1 after nonzero patch',dma(true,[0,0,0,4,3,1],0xa004n));
    const fullOutput=rig.exchanges.findLast(v=>v.kind==='output'),expectedPlane=initial.slice();
    for(let y=0;y<2;y++)expectedPlane.set(tight.subarray(y*24,(y+1)*24),((y+1)*4+1)*12);
    c.equal(fullOutput.bytes,hex(expectedPlane),'nonzero x,y patch and every untouched hardware texel');
    const fullExpected=new Uint8Array(149).fill(0xc7);fullExpected.set(expectedPlane,5);c.equal(hex(read()),hex(fullExpected),'complete full mip backing');guards();
    result.runs.push({capacity,before,source:hex(source),initialPlane:hex(initial),tight:hex(tight),input,output,completeBacking,smallGuards,expectedPlane:hex(expectedPlane),fullOutput,fullBacking:hex(read()),guards:guards(),
      records:q.records,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,snapshot:rig.trace.snapshot()});rig.dispose();
  }
  window.__desktopActive=null;c.equal(gl.getError(),gl.NO_ERROR,'zero final actual GL error');result.status='passed';result.assertions=c.assertions;result.summary={status:result.status,gpu,capacityCases:[76,77],assertions:c.assertions,nativeCalls:nativeCalls.length};return result;
}
