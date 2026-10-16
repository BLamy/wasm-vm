// Literal retained generations, private depth-range refresh and pending owner reset.
import {idCommand,context,transfer,submission} from './submit-acceptance.mjs';
import {memory,allocation} from './native-dimensional-color-surfaces.mjs';
import {request,padded} from './native-dimensional-depth-surfaces.mjs';
import {surface,metadata,bytesPerPixel,setDepth,stencilOffset,packet,join,shader,word,clear,dsa,face,viewport} from '../../../tools/virgl-dimensional-depth-surfaces/fixtures.mjs';
import {sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {pairTexts} from '../../../tools/virgl-dimensional-shaders/fixtures.mjs';
import {witness} from '../../../tools/virgl-dimensional-color-surfaces/witness.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const pointDraw=n=>packet(8,0,[0,n,0,0,1,0,0,0,0,0,0xffffffff,0]);
function sampled(f,w,model){
 const out=new Uint32Array(w.width*w.height*4),size=bytesPerPixel(f.format);
 for(const [i,t]of w.texels.entries()){
  const p=model.find(p=>p.level===t.level),at=((t.layer*p.height+t.y)*p.width+t.x)*size,v=new DataView(p.bytes.buffer,p.bytes.byteOffset,p.bytes.byteLength);
  const depth=f.format===16?v.getUint16(at,true)/65535:f.format===20?(v.getUint32(at,true)>>>8)/0xffffff:f.format===21?(v.getUint32(at,true)&0xffffff)/0xffffff:v.getFloat32(at,true);
  if(depth!==0&&depth!==1)throw Error('The independent refresh witness requires endpoint depths.');
  out.set([depth?0x3f800000:0,0,0,0x3f800000],i*4);
 }
 return new Uint8Array(out.buffer);
}
export async function runLifecycle({rig,native,trace,c,f,row,ram,model,uploadVertices,retention=false}){
 const life={mode:retention?'retained-name-reset':'private-refresh-aspect',samples:[],clears:[],replacementOutputs:[]};row.lifecycle=life;
 const w=witness(f,{first:1,last:2,firstLayer:f.target===7?1:0,lastLayer:f.target===7?4:5}),pair=pairTexts('fragment',{target:f.target===4?'CUBE':'2D_ARRAY',type:'FLOAT',opcode:'TXL',slot:7});life.witness=copy(w);
 for(const [i,m]of [metadata(2,2,196,2,w.width,w.height),metadata(4,0,64,16,w.positions.length,1),metadata(5,0,64,16,w.coordinates.length,1)].entries()){
  await rig.expect('original depth witness allocation '+m.id,allocation(m));const mem=memory(rig,m.id,i+3,c);ram.set(m.id,mem);await rig.expect('original depth witness backing '+m.id,mem.attach);await rig.expect('original depth witness membership '+m.id,idCommand(0x202,1,m.id));
 }
 const upload=async(id,bytes,label)=>{const m=ram.get(id),body=new Uint8Array(4096).fill(0x9b);body.set(bytes,5);m.write(body);const at=rig.exchanges.length,record=await rig.expect(label,transfer(1,id,1,[0,0,0,bytes.length,1,1],5n));c.equal(rig.exchanges[at].bytes,hex(bytes),'actual original witness vertex input');m.guards();return record;};
 await upload(4,w.positions,'original depth sampler positions');await upload(5,w.coordinates,'original depth sampler coordinates');
 const view=handle=>packet(1,6,[handle,6,f.format|f.target<<24,w.firstLayer|w.lastLayer<<16,w.first|w.last<<8,0x688]);
 await rig.expect('original retained depth witness objects',submission(1,join(shader(61,0,pair.vertexText),shader(62,1,pair.fragmentText),packet(1,5,[63,0,0,0,31,0,0,1,31,0,0,2,31,0,0,3,31]),surface(23,2,0,0,196),sampler(64,{mip:0,min:0,mag:0}),view(65),packet(10,0,[1,7,65]),packet(18,0,[1,7,64]),dsa(66,face({enabled:false}),face({enabled:false})))));
 const base=rig.host.bridge.inspect().store.budgets.gpuBytes,privateCost=f.levels.filter(p=>p.level===1||p.level===2).reduce((n,p)=>n+p.width*p.height*(w.lastLayer-w.firstLayer+1)*(f.format===126?16:bytesPerPixel(f.format)),0);
 c.equal(base,row.cost+w.width*w.height*16+w.positions.length+w.coordinates.length+privateCost,'exact original private depth-range native charges');
 life.privateCost=privateCost;life.beforeWarm=copy(rig.host.bridge.inspect());
 const sample=async label=>{
  await rig.expect(label+'/original sampling state',submission(1,join(packet(31,0,[0,1]),packet(5,0,[1,0,23]),viewport(w.width,w.height),packet(2,5,[63]),packet(6,0,[16,0,4,16,0,5,16,0,5,16,0,5]),packet(2,3,[66]),packet(31,0,[61,0]),packet(31,0,[62,1]))));
  const start=trace.calls.length,operation=await rig.expect(label+'/original native sample draw',submission(1,join(clear(4,0,0,[0,0,0,0]),pointDraw(w.texels.length)),0x20000000000005n));
  const p={level:0,width:w.width,height:w.height,layers:1},r=request(2,p,16,2),wanted=sampled(f,w,model),body=padded(p,wanted,16,r.stride,r.layerStride,0xc7);ram.get(2).write(new Uint8Array(4096).fill(0xc7));const at=rig.exchanges.length,record=await rig.expect(label+'/original sampler output206',r.wire);
  const result={label,operation,record,width:w.width,height:w.height,layers:1,level:0,denseActual:rig.exchanges[at].bytes,denseExpected:hex(wanted),backingActual:hex(ram.get(2).read()),backingExpected:hex(body),guards:ram.get(2).guards(),host:copy(rig.host.bridge.inspect()),states:trace.states.filter(s=>s.sequence>=start)};life.samples.push(result);
  c.equal(result.denseActual,result.denseExpected,'complete original depth sample and untouched output pixels');c.equal(result.backingActual,result.backingExpected,'complete depth sample SG padding');return result;
 };
 await sample('warm-original-private-depth-range');const links=rig.host.bridge.inspect().renderer.work.programLinks;
 const plain=async()=>{await uploadVertices(f.positions,'original retained depth positions');await rig.expect('original old depth surface restore',submission(1,join(packet(31,0,[0,1]),packet(5,0,[1,21,20]),viewport(f.width,f.height),packet(2,5,[12]),packet(6,0,[16,0,3]),packet(2,3,[30]),packet(31,0,[10,0]),packet(31,0,[11,1]))));};
 if(!retention){
  const alternate=metadata(8,2,stencilOffset(f.format)===null?126:16,1,f.width,f.height);await rig.expect('original opposite-aspect 2D allocation',allocation(alternate));const aspectRam=memory(rig,8,6,c);ram.set(8,aspectRam);await rig.expect('original opposite-aspect backing',aspectRam.attach);await rig.expect('original opposite-aspect membership',idCommand(0x202,1,8));
  await plain();life.aspect=await rig.expect('original dimensional versus 2D depth aspect rebind',submission(1,join(surface(22,8,0,0,alternate.format),packet(5,0,[1,22,20]),clear(stencilOffset(alternate.format)===null?1:3,117,1,[0,0,0,0]),packet(5,0,[1,21,20]))));
  const extent={level:0,width:f.width,height:f.height,layers:1},size=bytesPerPixel(alternate.format),bytes=new Uint8Array(f.width*f.height*size),offset=stencilOffset(alternate.format);
  for(let i=0;i<f.width*f.height;i++){setDepth(alternate.format,bytes,i,1);if(offset!==null)bytes[i*size+offset]=117;}
  const inverse=request(8,extent,size,2),wanted=padded(extent,bytes,size,inverse.stride,inverse.layerStride,0x4e);aspectRam.write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('original opposite-aspect complete inverse206',inverse.wire);
  life.aspectOutput={...extent,format:alternate.format,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(bytes),backingActual:hex(aspectRam.read()),backingExpected:hex(wanted),guards:aspectRam.guards()};c.equal(life.aspectOutput.denseActual,life.aspectOutput.denseExpected,'actual re-bound opposite depth stencil aspect pixels');c.equal(life.aspectOutput.backingActual,life.aspectOutput.backingExpected,'complete opposite-aspect original SG inverse');
 }else{
  const before=copy(rig.host.bridge.inspect()),old=before.store.resources.find(v=>v.public&&v.id===6);await rig.expect('original public depth name unref',idCommand(0x102,0,6));const retired=copy(rig.host.bridge.inspect());c.equal(retired.store.budgets.gpuBytes,before.store.budgets.gpuBytes,'old depth surface and private view retain complete native allocations');
  const replacement={...f.source,target:f.target===4?7:4,arraySize:f.target===4?5:6,height:5,format:f.format===126?16:126};await rig.expect('different target and format public depth name reuse',allocation(replacement));const mem=memory(rig,6,7,c);ram.set(6,mem);await rig.expect('replacement original depth backing',mem.attach);await rig.expect('replacement original membership',idCommand(0x202,1,6));
  const after=copy(rig.host.bridge.inspect()),fresh=after.store.resources.find(v=>v.public&&v.id===6);c.truth(fresh.generation!==old.generation,'different-target name has a distinct retained generation');life.retention={before,retired,after,oldGeneration:old.generation,newGeneration:fresh.generation,replacement};
  life.replacementPlanes=[];
  for(let level=0;level<=2;level++){const width=Math.max(1,5>>level),height=width,layers=replacement.arraySize,p={level,width,height,layers,bytes:new Uint8Array(width*height*layers*bytesPerPixel(replacement.format))},r=request(6,p,bytesPerPixel(replacement.format),1),body=padded(p,p.bytes,bytesPerPixel(replacement.format),r.stride,r.layerStride,0x73);mem.write(body);const record=await rig.expect('original different-target replacement zero upload mip'+level,r.wire);life.replacementPlanes.push({...p,bytes:hex(p.bytes),record});}
 }
 await plain();ram.get(6).write(new Uint8Array(4096).fill(0xbd));const uploads=trace.calls.filter(x=>/^texSubImage/.test(x.name)).length;
 const start=trace.calls.length,record=await rig.expect('old dimensional depth surface GPU-only clear',submission(1,clear(stencilOffset(f.format)===null?1:3,55,0,[0,0,0,0]),0x20000000000007n));
 const p=model[f.level],size=bytesPerPixel(f.format),offset=stencilOffset(f.format);for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const pixel=(f.layer*p.height+y)*p.width+x;setDepth(f.format,p.bytes,pixel,0);if(offset!==null)p.bytes[pixel*size+offset]=55;}
 life.clears.push({record,level:f.level,layer:f.layer,depth:0,stencil:55,nativeStart:start,nativeEnd:trace.calls.length});
 await sample('same-original-view-after-native-depth-write');c.equal(rig.host.bridge.inspect().renderer.work.programLinks,links,'private depth refresh reuses the original checked native program');c.equal(trace.calls.filter(x=>/^texSubImage/.test(x.name)).length,uploads,'native source refresh needs no CPU texture upload');c.equal(hex(ram.get(6).read()),'bd'.repeat(4096),'native old depth clear and sampler refresh preserve guest backing');
 if(retention){
  for(const p of life.replacementPlanes){const r=request(6,p,bytesPerPixel(life.retention.replacement.format),2),wanted=new Uint8Array(p.width*p.height*p.layers*bytesPerPixel(life.retention.replacement.format)),body=padded(p,wanted,bytesPerPixel(life.retention.replacement.format),r.stride,r.layerStride,0x4e);ram.get(6).write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('different-target replacement stays untouched mip'+p.level,r.wire);const result={...p,format:life.retention.replacement.format,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(wanted),backingActual:hex(ram.get(6).read()),backingExpected:hex(body),guards:ram.get(6).guards()};life.replacementOutputs.push(result);c.equal(result.denseActual,result.denseExpected,'retained old depth draw never touches same-name different-target image');c.equal(result.backingActual,result.backingExpected,'replacement inverse preserves complete SG bytes');}
  await plain();const q=rig.q,entry=q.enqueue('cancel original pending retained dimensional depth draw',submission(1,clear(stencilOffset(f.format)===null?1:3,81,1,[0,0,0,0]),0x20000000000009n),f.waitFailed?0x1200:0x1100);q.kick();q.run();let turns=0;while(rig.trace.syncs.size===0){c.truth(++turns<50,'original retained depth clear reaches a real pending fence');await rig.step();}
  c.equal(q.usedIndex(),entry.number,'pending depth work withholds original used publication');const pending={entry:copy(entry),host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect()),response:hex(q.read(entry.responseAddress,64)),syncs:rig.trace.syncs.size,completions:rig.completions.length,guestTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest(),owners:copy([...rig.trace.objects.values()])};
  if(f.waitFailed){rig.trace.control.waitFailed=true;await rig.step();q.run();const record=q.collect(entry);c.truth(q.vm.inspect().poisoned,'failed real depth fence poisons the native owner');c.truth(rig.host.bridge.inspect().poisoned,'failed real depth fence poisons the host owner');life.waitFailure={record,host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect())};}
  const responseBeforeReset=hex(q.read(entry.responseAddress,64));q.reset();
  c.equal(rig.trace.syncs.size,0,'reset cancels every native dimensional depth fence');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,0,'reset retires public and retained dimensional depth charges');c.equal(rig.host.bridge.inspect().store.budgets.backingBytes,0,'reset retires all original depth SG owners');const completions=rig.completions.length;for(let i=0;i<8;i++){await rig.step();q.run();}c.equal(q.usedIndex(),0,'late turns cannot publish cancelled depth work');c.equal(rig.completions.length,completions,'late turns cannot complete cancelled depth work');c.equal(hex(q.read(entry.responseAddress,64)),responseBeforeReset,'reset and late turns preserve the original response');life.reset={pending,responseBeforeReset,after:copy(rig.host.bridge.inspect()),completions,usedIndex:q.usedIndex(),response:hex(q.read(entry.responseAddress,64))};
  await rig.expect('fresh original context after depth reset',context(2));await rig.expect('fresh reused original depth name after reset',allocation(f.source));await rig.expect('retire fresh reused depth allocation',idCommand(0x102,0,6));
 }else{
  life.refreshedPlanes=[];for(const p of model){const r=request(6,p,size,2),body=padded(p,p.bytes,size,r.stride,r.layerStride,0x4e);ram.get(6).write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('original GPU-cleared complete depth plane mip'+p.level,r.wire),result={level:p.level,width:p.width,height:p.height,layers:p.layers,format:f.format,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(p.bytes),backingActual:hex(ram.get(6).read()),backingExpected:hex(body),guards:ram.get(6).guards()};life.refreshedPlanes.push(result);c.equal(result.denseActual,result.denseExpected,'every original changed and untouched refreshed depth field');c.equal(result.backingActual,result.backingExpected,'complete refreshed depth SG bytes');}
 }
 life.costAfterWarm=base;life.final=copy(rig.host.bridge.inspect());c.equal(native.getError(),native.NO_ERROR,'zero lifecycle dimensional depth hardware error');
}
