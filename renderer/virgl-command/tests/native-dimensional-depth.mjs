// Original VirtIO and VirGL packets through real Wasm, fresh RAM and native GPU.
import {createVirglStandardDimensionalTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {shapes,formats,pixelBytes,plane,whole,publicLayout,scatter,gather,patch,cleared,wire,hex} from '../../../tools/virgl-dimensional-depth/fixtures.mjs';
import {runDirect} from './dimensional-depth-direct.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const unhex=s=>Uint8Array.from(s.match(/../g)??[],v=>parseInt(v,16));
const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
const put32=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const metadata=(shape,format,bind=9)=>({id:6,target:shape.target,format,bind,width:shape.width,height:shape.height,depth:shape.depth,arraySize:shape.arraySize,lastLevel:shape.lastLevel,nrSamples:0,flags:0});
function resource(meta){const raw=header(0x204,0,72);keys.forEach((key,i)=>put32(raw,24+i*4,meta[key]));return raw;}
function backingRam(rig,id,length,c,offset){
 const q=rig.q,cuts=[7,17,53,101,length-178],entries=cuts.map((n,i)=>[q.base+offset+BigInt(i*0x4000),n]);
 entries.forEach(([at,n])=>q.write(at-8n,new Uint8Array(n+16).fill(0xa3)));
 const write=bytes=>{c.equal(bytes.length,length,'complete live backing');let p=0;for(const[at,n]of entries){q.write(at,bytes.subarray(p,p+n));p+=n;}};
 const read=()=>{const out=new Uint8Array(length);let p=0;for(const[at,n]of entries){out.set(q.read(at,n),p);p+=n;}return out;};
 const guards=()=>entries.map(([at,n])=>{const prefix=hex(q.read(at-8n,8)),suffix=hex(q.read(at+BigInt(n),8));c.equal(prefix,'a3'.repeat(8),'SG prefix');c.equal(suffix,'a3'.repeat(8),'SG suffix');return{address:at.toString(16),length:n,prefix,suffix};});
 return{entries,write,read,guards,attach:backing(id,entries)};
}
function originalOuter(level,box,fields,direction=1){
 const raw=transfer(1,6,direction,[box.x,box.y,box.z,box.width,box.height,box.depth],BigInt(fields.offset),fields.stride,fields.layerStride,0xffffffffffffffffn);put32(raw,60,level);return raw;
}
function assertPublic(c,fmt,expected,actual,label){
 c.equal(actual.length,expected.length,label+' complete public byte count');
 const size=pixelBytes(fmt),e=new DataView(expected.buffer,expected.byteOffset,expected.byteLength),a=new DataView(actual.buffer,actual.byteOffset,actual.byteLength);
 for(let at=0;at<expected.length;at+=size){
  if(fmt===16)c.equal(a.getUint16(at,true),e.getUint16(at,true),label+' exact UN16 pixel '+at/size);
  else if(fmt===20||fmt===21)c.equal(a.getUint32(at,true),fmt===20?e.getUint32(at,true):e.getUint32(at,true)&0xffffff,label+' exact packed pixel '+at/size);
  else{
   const bits=e.getUint32(at,true),word=a.getUint32(at,true),exponent=bits>>>23&255;
   if(exponent!==255){const value=e.getFloat32(at,true);let choices;
    if((bits&0x7fffffff)===0||bits>>>31)choices=[0,0x80000000];
    else if(exponent===0)choices=[bits,0,0x80000000];else choices=[value>1?0x3f800000:bits];
    c.truth(choices.includes(word),label+' original FLOAT pixel '+at/size+' observed '+word+' expected '+choices);
   }
   if(fmt===126)c.same([...actual.subarray(at+4,at+8)],[expected[at+4],0,0,0],label+' exact stencil and canonical X24 pixel '+at/size);
  }
 }
}
function assertBacking(c,fmt,expected,actual,original,box,layout,label){
 const covered=new Set();for(let layer=0;layer<box.depth;layer++)for(let row=0;row<box.height;row++)for(let byte=0;byte<layout.rowBytes;byte++)covered.add(layout.offset+layer*layout.layerStride+row*layout.rowStride+byte);
 c.equal(actual.length,original.length,label+' complete RAM');for(let i=0;i<actual.length;i++)if(!covered.has(i))c.equal(actual[i],original[i],label+' padding byte '+i);
 assertPublic(c,fmt,expected,gather(actual,box,layout),label+' selected RAM fields');
}
function recordedContext(gl){
 const calls=[],objects=new WeakMap(),extensions=new WeakMap(),live=new Set();let next=1,budgets=()=>null,armed=null;
 const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;if(ArrayBuffer.isView(v))return{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(!objects.has(v))objects.set(v,next++);return{object:objects.get(v),type:v.constructor?.name??'object'};};
 const invoke=(receiver,name,fn,args)=>{
  const before=args.map(describe),effective=[...args];let fault=null;
  if(armed?.method===name){if(armed.skip>0)armed.skip--;else{fault=copy(armed);effective[armed.index]=armed.value;armed=null;}}
  const result=fn.apply(receiver,effective);if(/^create(?:Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&result)live.add(result);if(/^delete(?:Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader|Sync)$/.test(name))live.delete(args[0]);if(name==='fenceSync'&&result)live.add(result);
  calls.push({sequence:calls.length,name,before,effective:effective.map(describe),fault,after:args.map(describe),result:describe(result),budgets:copy(budgets())});return result;
 };
 const proxy=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
  const result=invoke(target,key,value,args);
  if(key==='getExtension'&&result&&!extensions.has(result))extensions.set(result,new Proxy(result,{get(ext,name){const method=Reflect.get(ext,name,ext);return typeof method==='function'?(...a)=>invoke(ext,args[0]+'.'+String(name),method,a):method;}}));
  return key==='getExtension'&&result?extensions.get(result):result;
 };}});
 return{gl:proxy,calls,live,describe,setBudgets(fn){budgets=fn;},arm(fault){if(armed)throw Error('unconsumed native fault');armed={skip:0,...fault};},assertConsumed(c){c.equal(armed,null,'fault reached the real native call');}};
}
function clearNative(recorded,c,texture,shape,fmt,level,values){
 const gl=recorded.gl,stencil=fmt===20||fmt===126;
 const capture=()=>({read:recorded.describe(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)),draw:recorded.describe(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),scissor:gl.isEnabled(gl.SCISSOR_TEST),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),frontMask:gl.getParameter(gl.STENCIL_WRITEMASK),backMask:gl.getParameter(gl.STENCIL_BACK_WRITEMASK)});
 const before=capture(),read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),framebuffer=gl.createFramebuffer(),nativeStart=recorded.calls.length;
 c.truth(framebuffer,'independent native clear framebuffer');
 try{
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.drawBuffers([gl.NONE]);gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.stencilMask(255);
  for(let layer=0;layer<values.length;layer++){
   const attachment=stencil?gl.DEPTH_STENCIL_ATTACHMENT:gl.DEPTH_ATTACHMENT;
   if(shape.target===4)gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,attachment,gl.TEXTURE_CUBE_MAP_POSITIVE_X+layer,texture,level);
   else gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER,attachment,texture,level,layer);
   c.equal(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent clear native level/layer complete');
   if(stencil)gl.clearBufferfi(gl.DEPTH_STENCIL,0,values[layer][0],values[layer][1]);else gl.clearBufferfv(gl.DEPTH,0,new Float32Array([values[layer][0]]));
  }
 }finally{
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);gl.deleteFramebuffer(framebuffer);
  gl[before.scissor?'enable':'disable'](gl.SCISSOR_TEST);gl.depthMask(before.depthMask);gl.stencilMaskSeparate(gl.FRONT,before.frontMask);gl.stencilMaskSeparate(gl.BACK,before.backMask);
 }
 const after=capture();c.same(after,before,'independent GPU clear restores caller state');c.equal(gl.getError(),gl.NO_ERROR,'independent GPU clear native error');
 return{level,values,before,after,nativeCallsStart:nativeStart,nativeCallsEnd:recorded.calls.length};
}
async function runOne(Wasm,factory,recorded,compiler,c,shape,fmt,seed,bind=9,exceptional=false){
 const Selected=class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}},rig=makeRig(Selected,factory,recorded.gl,compiler,c,seed,true,false,true),q=rig.q;
 const meta=metadata(shape,fmt,bind),result={seed,shape,metadata:meta,exceptional,levels:[],records:q.records,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,nativeCallsStart:recorded.calls.length};
 window.__dimensionalDepthReport.runs.push(result);window.__desktopActive=()=>({current:result,native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),trace:rig.trace.events});
 recorded.setBudgets(()=>rig.host.bridge.inspect().store.budgets);
 await rig.expect('original depth context',context(1));await rig.expect('original dimensional depth allocation',resource(meta));
 const gpuTexture=recorded.gl.getParameter(shape.target===4?recorded.gl.TEXTURE_BINDING_CUBE_MAP:recorded.gl.TEXTURE_BINDING_2D_ARRAY);
 c.truth(gpuTexture,'actual allocated depth texture');result.gpuTexture=recorded.describe(gpuTexture);
 const publicCost=shape.levels.reduce((v,[w,h,d])=>v+w*h*d*pixelBytes(fmt),0),gpuCost=fmt===126?publicCost*2:publicCost;
 c.equal(q.vm.inspect().logicalBytes,publicCost,'complete original public chain');c.equal(q.vm.inspect().gpuBytes,gpuCost,'complete native charged chain');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,gpuCost,'matching host charged chain');
 result.allocation={publicCost,gpuCost,native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect())};
 const ram=backingRam(rig,6,4096,c,0x210000n),staging=backingRam(rig,200,4096,c,0x250000n);
 await rig.expect('original layered SG backing',ram.attach);await rig.expect('original depth member',idCommand(0x202,1,6));
 const stageMeta={id:200,target:0,format:64,bind:524288,width:4096,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
 await rig.expect('original staging resource',resource(stageMeta));await rig.expect('original staging SG',staging.attach);await rig.expect('original staging member',idCommand(0x202,1,200));
 async function issue(label,raw){
  const first=rig.exchanges.length,nativeStart=recorded.calls.length,sequencing=rig.trace.snapshot(),entry=q.enqueue(label,raw);q.kick();q.run();c.equal(q.usedIndex(),entry.number,label+' completion withheld');
  await rig.drain();const record=q.collect(entry);q.vm.writeMmio(0x64,1);ram.guards();staging.guards();
  return{label,record,exchanges:copy(rig.exchanges.slice(first)),nativeCallsStart:nativeStart,nativeCallsEnd:recorded.calls.length,before:sequencing,after:rig.trace.snapshot(),budgets:copy(rig.host.bridge.inspect().store.budgets)};
 }
 async function inverse(label,raw,wanted,box,layout,memory,sentinel){
  memory.write(sentinel);const read=await issue(label,raw);c.equal(read.exchanges.length,1,label+' one layered exchange');c.equal(read.exchanges[0].kind,'layered-output',label+' authoritative output');
  const bytes=unhex(read.exchanges[0].bytes);read.output=hex(bytes);read.backing=hex(memory.read());
  assertPublic(c,fmt,wanted,bytes,label);assertBacking(c,fmt,wanted,memory.read(),sentinel,box,layout,label);
  c.equal(read.after.collections-read.before.collections,1,label+' one fenced CPU collection');c.equal(read.after.fences-read.before.fences,1,label+' one layered readback fence');
  c.equal(read.budgets.scratchBytes,0,label+' CPU scratch retired');c.equal(read.budgets.tickets,0,label+' transfer tickets retired');c.equal(read.after.liveSyncs,0,label+' native readback fence retired');c.equal(read.budgets.gpuBytes,gpuCost,label+' GPU conversions retired');return read;
 }
 // Each original mip executes outer/inline/staging uploads and all inverse forms.
 for(let level=0;level<shape.levels.length;level++){
  const extent=shape.levels[level],box=whole(extent),size=pixelBytes(fmt),fields={offset:5,stride:extent[0]*size+7,layerStride:(extent[0]*size+7)*extent[1]+11},layout=publicLayout(extent,box,fmt,fields);
  const row={level,extent,box,fields,layout,phases:[]};result.levels.push(row);
  let wanted=plane(seed,fmt,shape.target,level,extent,0,exceptional),source=scatter(wanted,box,layout,new Uint8Array(4096).fill(0x8d));ram.write(source);
  const uploaded=await issue('outer depth upload mip'+level,originalOuter(level,box,fields));c.equal(uploaded.exchanges[0].bytes,hex(wanted),'complete live outer depth gather');
  const read=await inverse('inner43 depth inverse mip'+level,submission(1,wire(6,level,box,{...fields,direction:2})),wanted,box,layout,ram,new Uint8Array(4096).fill(0xc7));row.phases.push({kind:'outer',input:hex(wanted),source:hex(source),uploaded,read});
  wanted=plane(seed,fmt,shape.target,level,extent,11,exceptional);const inlineLayout={...layout,offset:0},inline=scatter(wanted,box,inlineLayout,new Uint8Array(inlineLayout.footprintBytes).fill(0x59));
  const inlined=await issue('inline9 depth upload mip'+level,submission(1,wire(6,level,box,{opcode:9,...fields,data:inline})));c.equal(inlined.exchanges.length,0,'original inline words are already copied');
  const inlineRead=await inverse('outer206 inline depth inverse mip'+level,originalOuter(level,box,fields,2),wanted,box,layout,ram,new Uint8Array(4096).fill(0xd3));row.phases.push({kind:'inline',input:hex(wanted),source:hex(inline),uploaded:inlined,read:inlineRead});
  wanted=plane(seed,fmt,shape.target,level,extent,23,exceptional);source=scatter(wanted,box,layout,new Uint8Array(4096).fill(0xb9));staging.write(source);
  const staged=await issue('staging45 depth upload mip'+level,submission(1,wire(6,level,box,{opcode:45,...fields,flags:1})));c.equal(staged.exchanges[0].bytes,hex(wanted),'complete live staging gather');
  const stageRead=await inverse('staging45 depth inverse mip'+level,submission(1,wire(6,level,box,{opcode:45,...fields,flags:3})),wanted,box,layout,staging,new Uint8Array(4096).fill(0xa7));row.phases.push({kind:'staging',input:hex(wanted),source:hex(source),uploaded:staged,read:stageRead});
 }
 for(const row of result.levels){
  const {level,extent}=row,size=pixelBytes(fmt),x=extent[0]>2?1:0,y=extent[1]>2?1:0;
  const box={x,y,z:extent[2]-2,width:Math.min(2,extent[0]-x),height:Math.min(2,extent[1]-y),depth:2};
  const fields={offset:0,stride:box.width*size+7,layerStride:(box.width*size+7)*box.height+11},layout=publicLayout(extent,box,fmt,fields);
  const input=plane(seed,fmt,shape.target,level,[box.width,box.height,box.depth],91,exceptional),inline=scatter(input,box,layout,new Uint8Array(layout.footprintBytes).fill(0x6d));
  const uploaded=await issue('nonzero original inline depth mip'+level,submission(1,wire(6,level,box,{opcode:9,...fields,data:inline})));
  const wanted=patch(unhex(row.phases.at(-1).input),extent,box,input,fmt),full=whole(extent),fullFields={offset:5,stride:0,layerStride:0},fullLayout=publicLayout(extent,full,fmt,fullFields);
  const read=await inverse('full patched original depth mip'+level,originalOuter(level,full,fullFields,2),wanted,full,fullLayout,ram,new Uint8Array(4096).fill(0xe7));
  row.partial={box,fields,layout,input:hex(input),inline:hex(inline),expectedFull:hex(wanted),uploaded,read};
 }
 // Only fixed-function native clears update this image; guest RAM is poisoned.
 for(const row of result.levels){
  const {level,extent}=row,depths=[16,20,21].includes(fmt)?[0,1]:[.25,.5,.75,1];
  const values=Array.from({length:extent[2]},(_,layer)=>[depths[(layer+level+seed)%depths.length],(seed+layer*73+level*29)&255]);
  const clear=clearNative(recorded,c,gpuTexture,shape,fmt,level,values),wanted=cleared(fmt,extent,values),box=whole(extent);
  const fields={offset:13,stride:extent[0]*pixelBytes(fmt)+5,layerStride:(extent[0]*pixelBytes(fmt)+5)*extent[1]+9},layout=publicLayout(extent,box,fmt,fields);
  const read=await inverse('GPU-only authoritative depth mip'+level,submission(1,wire(6,level,box,{...fields,direction:2})),wanted,box,layout,ram,new Uint8Array(4096).fill(0xec));
  row.gpuOverwrite={clear,fields,layout,input:hex(wanted),read};
 }
 await rig.expect('retire original staging',idCommand(0x102,0,200));
 const extent=shape.levels[0],box=whole(extent),fields={offset:5,stride:0,layerStride:0},layout=publicLayout(extent,box,fmt,fields);
 const replacement=backingRam(rig,6,4096,c,0x290000n),wanted=plane(seed,fmt,shape.target,0,extent,103,exceptional),source=scatter(wanted,box,layout,new Uint8Array(4096).fill(0xe9));replacement.write(source);
 const generation=q.vm.inspect().resources.find(v=>v.identity.id===6).backingGeneration,first=rig.exchanges.length;
 const queued=[q.enqueue('old depth read before detach',originalOuter(0,box,fields,2)),q.enqueue('ordered depth backing detach',idCommand(0x107,0,6)),q.enqueue('ordered depth replacement backing',replacement.attach),q.enqueue('ordered replacement depth upload',originalOuter(0,box,fields)),q.enqueue('ordered replacement depth read',originalOuter(0,box,fields,2))];
 q.kick();q.run();c.equal(q.usedIndex(),queued[0].number,'reattach waits behind admitted old GPU read');await rig.drain();const records=queued.map(v=>q.collect(v));q.vm.writeMmio(0x64,1);
 const exchanges=copy(rig.exchanges.slice(first));c.equal(exchanges.length,3,'ordered old read/new upload/new read');
 assertPublic(c,fmt,unhex(result.levels[0].gpuOverwrite.input),unhex(exchanges[0].bytes),'old read retains original allocation pixels');
 c.equal(exchanges[1].bytes,hex(wanted),'reattached RAM supplies fresh depth upload');assertPublic(c,fmt,wanted,unhex(exchanges[2].bytes),'new GPU depth read');
 assertBacking(c,fmt,wanted,replacement.read(),source,box,layout,'replacement backing output');replacement.guards();
 c.truth(q.vm.inspect().resources.find(v=>v.identity.id===6).backingGeneration!==generation,'depth reattachment changes generation');c.truth(exchanges[0].args[5]!==exchanges[1].args[5],'depth exchange carries new backing generation');
 result.lifecycle={records,exchanges,oldBacking:hex(ram.read()),newBacking:hex(replacement.read()),guards:replacement.guards()};
 const epoch=q.vm.inspect().epoch,stale=rig.exchanges.findLast(v=>v.kind==='layered-output'),poison=new Uint8Array(4096).fill(0x69);replacement.write(poison);
 const pending=q.enqueue('reset physical pending depth inverse',originalOuter(0,box,fields,2));q.kick();q.run();let steps=0;
 while(rig.trace.syncs.size===0){c.truth(++steps<10,'reset target has real layered fence');await rig.step();}
 c.equal(q.usedIndex(),pending.number,'real pending depth read withholds completion');const pendingState={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),physical:rig.trace.snapshot()};q.reset();
 c.equal(q.vm.inspect().resources.length,0,'depth reset clears native owners');c.equal(rig.host.bridge.inspect().resources.length,0,'depth reset clears host owners');
 c.throws(()=>q.vm.gatherLayeredInput(...stale.args),'depth reset revokes old gather');c.throws(()=>q.vm.scatterLayeredOutput(...stale.args,new Uint8Array(wanted.length)),'depth reset revokes old scatter');c.equal(hex(replacement.read()),hex(poison),'reset publishes no pending pixels');
 const reused={...meta,format:fmt===126?16:126};await rig.expect('reuse original depth ID after reset',resource(reused));c.truth(q.vm.inspect().epoch!==epoch,'reset reused ID has new epoch');await rig.expect('retire reset replacement',idCommand(0x102,0,6));
 result.reset={pending:pendingState,reused,after:copy(q.vm.inspect()),guards:replacement.guards()};
 result.final={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),guestTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest(),guards:ram.guards(),stagingGuards:staging.guards(),sequencing:rig.trace.snapshot()};
 c.equal(result.final.native.gpuBytes,0,'terminal native depth budgets');c.equal(result.final.host.store.budgets.gpuBytes,0,'terminal host depth budgets');
 recorded.setBudgets(()=>null);rig.dispose();c.equal(recorded.live.size,0,'all actual native owners retired');result.nativeCallsEnd=recorded.calls.length;window.__desktopActive=null;return result;
}
async function failedFence(Wasm,factory,recorded,compiler,c,shape,fmt,seed){
 const Selected=class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}},rig=makeRig(Selected,factory,recorded.gl,compiler,c,seed,true,false,true),q=rig.q;
 const meta=metadata(shape,fmt),result={seed,metadata:meta,nativeCallsStart:recorded.calls.length};window.__desktopActive=()=>({current:result,native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),trace:rig.trace.events});recorded.setBudgets(()=>rig.host.bridge.inspect().store.budgets);
 await rig.expect('failed fence context',context(1));await rig.expect('failed fence depth allocation',resource(meta));const ram=backingRam(rig,6,4096,c,0x210000n);await rig.expect('failed fence backing',ram.attach);await rig.expect('failed fence member',idCommand(0x202,1,6));
 const extent=shape.levels[0],box=whole(extent),fields={offset:5,stride:0,layerStride:0},layout=publicLayout(extent,box,fmt,fields),input=plane(seed,fmt,shape.target,0,extent,41);ram.write(scatter(input,box,layout,new Uint8Array(4096).fill(0x8d)));await rig.expect('failed fence prior physical upload',originalOuter(0,box,fields));
 ram.write(new Uint8Array(4096).fill(0xe7));const before=hex(ram.read()),collections=rig.trace.snapshot().collections,entry=q.enqueue('physical depth WAIT_FAILED',originalOuter(0,box,fields,2),0x1200);q.kick();q.run();let steps=0;
 while(rig.trace.syncs.size===0){c.truth(++steps<10,'failed depth read owns a real fence');await rig.step();}
 c.equal(rig.trace.syncs.size,1,'one physical failed layered fence');c.equal(q.usedIndex(),entry.number,'failed read completion withheld');rig.trace.control.waitFailed=true;await rig.step();q.run();const record=q.collect(entry);
 c.truth(q.vm.inspect().poisoned,'failed depth read poisons native owner');c.truth(rig.host.bridge.inspect().poisoned,'failed depth read poisons host owner');c.equal(hex(ram.read()),before,'WAIT_FAILED publishes no depth bytes');c.equal(rig.trace.snapshot().collections,collections,'WAIT_FAILED never collects native PBO');c.equal(rig.trace.syncs.size,0,'failed depth fence deleted');ram.guards();
 Object.assign(result,{record,records:q.records,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,physical:rig.trace.events,before,after:hex(ram.read()),host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect()),guestTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest()});
 q.reset();await rig.expect('depth WAIT_FAILED reset recovery',resource(meta));await rig.expect('depth WAIT_FAILED recovery release',idCommand(0x102,0,6));recorded.setBudgets(()=>null);rig.dispose();c.equal(recorded.live.size,0,'failed fence native objects retired');result.nativeCallsEnd=recorded.calls.length;window.__desktopActive=null;return result;
}
async function boundaryProof(Wasm,factory,recorded,compiler,c){
 const Selected=class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}},rig=makeRig(Selected,factory,recorded.gl,compiler,c,3,true,false,true),q=rig.q,result={metadata:[],transfers:[],budgets:[],nativeCallsStart:recorded.calls.length};
 recorded.setBudgets(()=>rig.host.bridge.inspect().store.budgets);window.__desktopActive=()=>({current:result,native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
 for(const shape of shapes)for(const fmt of formats){
  const valid=metadata(shape,fmt),mutations=[{target:3,depth:6,arraySize:1},{target:8},{format:19},{bind:0},{bind:2},{bind:16},{bind:0x80000009},{width:0},{width:16385},{height:0},{height:16385},{depth:0},{depth:2},{arraySize:0},{arraySize:2049},{lastLevel:3},{lastLevel:32},{lastLevel:0xffffffff},{nrSamples:1},{flags:1},...(shape.target===4?[{width:6},{arraySize:5},{arraySize:7}]:[])];
  for(const mutation of mutations){const meta={...valid,...mutation},before={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),events:rig.events.length,objects:recorded.live.size},start=recorded.calls.length,record=await rig.expect('native depth metadata refusal '+result.metadata.length,resource(meta),0x1205);
   c.same(q.vm.inspect(),before.native,'native depth metadata rollback');c.same(rig.host.bridge.inspect(),before.host,'host depth metadata rollback');c.equal(rig.events.length,before.events,'invalid depth metadata before callbacks');c.equal(recorded.live.size,before.objects,'invalid depth metadata before GPU publication');result.metadata.push({meta,before,record,nativeCallsStart:start,nativeCallsEnd:recorded.calls.length});}
  await rig.expect('boundary depth context',context(1));await rig.expect('boundary depth allocation',resource(valid));const ram=backingRam(rig,6,4096,c,0x210000n);await rig.expect('boundary depth backing',ram.attach);await rig.expect('boundary depth member',idCommand(0x202,1,6));
  const extent=shape.levels[0],full=whole(extent),size=pixelBytes(fmt),bad=[
   [3,{x:0,y:0,z:0,width:1,height:1,depth:1},0n,0,0],
   [1,{x:shape.levels[1][0],y:0,z:0,width:1,height:1,depth:1},0n,0,0],
   [0,{...full,z:shape.arraySize},0n,0,0],[0,{...full,width:0},0n,0,0],[0,{...full,depth:0},0n,0,0],
   [0,full,0n,extent[0]*size-1,0],[0,full,0n,extent[0]*size,extent[0]*extent[1]*size-1],
   [0,full,4096n,0,0],[0,full,0xffffffffffffffffn,0,0],[0,full,0n,0xffffffff,0],[0,full,0n,0,0xffffffff],
  ];
  for(const[level,box,offset,stride,layerStride]of bad){const raw=originalOuter(level,box,{offset:0,stride,layerStride});new DataView(raw.buffer).setBigUint64(48,offset,true);
   const before={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),submit:copy(q.vm.submitState()),events:rig.events.length,ram:hex(ram.read())},record=await rig.expect('native depth span refusal '+result.transfers.length,raw,0x1205);
   c.same(q.vm.inspect(),before.native,'invalid depth span preserves owner');c.same(q.vm.submitState(),before.submit,'invalid depth span preserves scheduler');c.same(rig.host.bridge.inspect(),before.host,'invalid depth span preserves host');c.equal(rig.events.length,before.events,'invalid depth span before callback');c.equal(hex(ram.read()),before.ram,'invalid depth span leaves RAM');result.transfers.push({metadata:valid,level,box,offset:offset.toString(),stride,layerStride,before,record});}
  const length=5+extent[0]*extent[1]*extent[2]*size;
  await rig.expect('detach depth edge backing',idCommand(0x107,0,6));await rig.expect('one short depth backing',backing(6,[[q.base+0x210000n,length-1]]));await rig.expect('one short depth footprint',originalOuter(0,full,{offset:5,stride:0,layerStride:0}),0x1205);
  await rig.expect('detach short depth backing',idCommand(0x107,0,6));await rig.expect('exact depth backing',backing(6,[[q.base+0x210000n,length]]));await rig.expect('exact depth footprint',originalOuter(0,full,{offset:5,stride:0,layerStride:0}));
  await rig.expect('retire boundary depth allocation',idCommand(0x102,0,6));await rig.expect('retire boundary depth context',header(0x201,1,24));
 }
 const exact={id:1,target:7,format:126,bind:9,width:512,height:512,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
 for(let id=1;id<=8;id++)await rig.expect('exact aggregate dimensional depth '+id,resource({...exact,id}));c.equal(q.vm.inspect().gpuBytes,33554432,'exact native depth32MiB');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,33554432,'exact host depth32MiB');
 const before=copy(q.vm.inspect()),record=await rig.expect('aggregate depth plus one allocation',resource({...exact,id:9}),0x1201);c.same(q.vm.inspect(),before,'aggregate depth refuses before publication');result.budgets.push({metadata:exact,before,record});q.reset();
 for(const mutation of [{width:513},{arraySize:2},{lastLevel:1},{format:16,width:2048,height:2048}]){const meta={...exact,...mutation},start=recorded.calls.length,record=await rig.expect('whole-chain depth byte neighbor',resource(meta),0x1201);c.equal(q.vm.inspect().gpuBytes,0,'failed whole chain has zero native cost');c.equal(recorded.calls.length,start,'byte budget refused before GL');result.budgets.push({meta,record,nativeCallsStart:start,nativeCallsEnd:recorded.calls.length});}
 Object.assign(result,{records:q.records,events:rig.events,exchanges:rig.exchanges,guestTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest(),final:{native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect())}});recorded.setBudgets(()=>null);rig.dispose();c.equal(recorded.live.size,0,'native boundary objects retired');result.nativeCallsEnd=recorded.calls.length;window.__desktopActive=null;return result;
}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,seeds=[27449,84131,176129],smoke=false,boundaries=false}){
 const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(gl,'hardware depth WebGL2');
 const recorded=recordedContext(gl),compiler=await createVirglStandardDimensionalTextureShaderBridge();
 const report={status:'running',runs:[],nativeCalls:recorded.calls,actualLinuxGuest:false,productionAuthority:false,seeds};window.__dimensionalDepthReport=report;
 let exportedNativeCalls=0;
 async function record(row){
  if(typeof window.__recordDimensionalDepthRun!=='function')return;
  row.nativeCalls=recorded.calls;row.nativeBaseSequence=exportedNativeCalls;
  const count=recorded.calls.length,pin=await window.__recordDimensionalDepthRun(report.runs.length-1,JSON.stringify(row));
  report.runs[report.runs.length-1]={seed:row.seed,metadata:row.metadata,exceptional:row.exceptional,nativeCallCount:count,nativeBaseSequence:exportedNativeCalls,recording:pin};
  exportedNativeCalls+=count;recorded.calls.length=0;
 }
 if(!boundaries)for(let i=0;i<seeds.length;i++)for(const shape of shapes)for(const fmt of formats){
  const row=await runOne(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,recorded,compiler,c,shape,fmt,seeds[i],smoke?9:[1,8,9][i%3]);
  await record(row);
 }
 if(!smoke&&!boundaries)for(let i=0;i<seeds.length;i++)for(const shape of shapes)for(const fmt of [18,126]){
  const row=await runOne(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,recorded,compiler,c,shape,fmt,seeds[i],[1,8,9][i%3],true);
  await record(row);
 }
 report.direct=await runDirect({recorded,c,seed:seeds[0],assertPublic,assertBacking});
 report.failedFences=[];for(const seed of seeds)for(const shape of shapes)for(const fmt of formats)report.failedFences.push(await failedFence(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,recorded,compiler,c,shape,fmt,seed));
 report.boundaries=await boundaryProof(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,recorded,compiler,c);
 c.equal(gl.getError(),gl.NO_ERROR,'terminal native error');report.status='passed';report.assertions=c.assertions;report.nativeBaseSequence=exportedNativeCalls;report.summary={status:'passed',runs:report.runs.length,directRuns:report.direct.rows.length,formats:formats.length,targets:shapes.length,nativeCalls:exportedNativeCalls+recorded.calls.length,assertions:c.assertions};return report;
}
