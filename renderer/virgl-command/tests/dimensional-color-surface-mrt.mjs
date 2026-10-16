// Sparse mixed original framebuffer slots; every image byte has an independent model.
import {makeRig,context,idCommand,transfer,submission} from './submit-acceptance.mjs';
import {capture,memory,allocation,padded} from './native-dimensional-color-surfaces.mjs';
import {metadata,packet,join,shader,clear,word,surface,VERTEX} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const FRAGMENT='FRAG\nDCL OUT[0], COLOR[0]\nDCL OUT[1], COLOR[2]\nDCL OUT[2], COLOR[3]\nIMM[0] FLT32 {0,1,0,1}\nIMM[1] FLT32 {0,0,1,1}\nIMM[2] FLT32 {1,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: MOV OUT[1], IMM[1]\n2: MOV OUT[2], IMM[2]\n3: END\n';
const colors={0:[0,255,0,255],2:[0,0,255,255],3:[255,0,0,255]};
export async function runMrt(Wasm,createBridge,native,compiler,c,seed,report){
 for(const [caseIndex,targets]of [[3,4,2],[7,2,3],[4,7,3]].entries()){
  const level=caseIndex===2?0:1,models=targets.map((target,i)=>{
   const meta=metadata([6,8,9][i],target,67,10,5,5,target===3?5:1,target===4?6:target===7?5:1,2),slot=[0,2,3][i],planes=Array.from({length:3},(_,mip)=>{
    const width=Math.max(1,Math.floor(5/2**mip)),height=width,layers=target===3?Math.max(1,Math.floor(5/2**mip)):meta.arraySize,bytes=new Uint8Array(width*height*layers*4);
    for(let at=0;at<bytes.length;at++)bytes[at]=(seed+slot*67+mip*31+at*13)&255;
    return {level:mip,width,height,layers,bytes};
   });return {meta,slot,planes,layer:planes[level].layers-1};
  });
  const selected=models[0].planes[level],points=[[0,0],[selected.width-1,selected.height-1]],pos=[];
  for(const [x,y]of points)pos.push((2*x+1)/selected.width-1,(2*y+1)/selected.height-1,0,1);
  const positions=new Uint8Array(new Float32Array(pos).buffer),row={name:'mixed-mrt/'+targets.join('-'),seed,level,points,models:copy(models),outputs:[]},control={armed:false,hits:0},trace=capture(native,row,control),Selected=class{constructor(cb){return Wasm.standardDimensionalDepth(cb);}},rig=makeRig(Selected,createBridge,trace.gl,compiler,c,seed,true,false,true),memories=new Map();report.rows.push(row);
  try{
   await rig.expect('original MRT context',context(1));
   const metas=[...models.map(m=>m.meta),metadata(3,0,64,16,positions.length,1)];
   for(const [i,meta]of metas.entries()){await rig.expect('original MRT allocation',allocation(meta));const ram=memory(rig,meta.id,i,c);memories.set(meta.id,ram);await rig.expect('original MRT backing',ram.attach);await rig.expect('original MRT membership',idCommand(0x202,1,meta.id));}
   row.uploads=[];
   const request=(meta,p,direction)=>{const stride=p.width*4+7,ls=stride*p.height+11,wire=transfer(1,meta.id,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,meta.target===2?0:ls,0xffffffffffffffffn);put(wire,60,p.level);return {wire,stride,ls};};
   for(const model of models)for(const p of model.planes){const r=request(model.meta,p,1),ram=memories.get(model.meta.id),body=padded(p,p.bytes,r.stride,r.ls,0x8d);ram.write(body);const at=rig.exchanges.length,record=await rig.expect('original MRT upload',r.wire);c.equal(rig.exchanges[at].bytes,hex(p.bytes),'every original MRT upload byte');row.uploads.push({id:model.meta.id,level:p.level,input:hex(p.bytes),record,guards:ram.guards()});}
   const body=new Uint8Array(4096).fill(0x9b);body.set(positions,5);memories.get(3).write(body);await rig.expect('original MRT points',transfer(1,3,1,[0,0,0,positions.length,1,1],5n));
   const handles=[20,22,23],state=join(shader(10,0,VERTEX),shader(11,1,FRAGMENT),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),...models.map((m,i)=>surface(handles[i],m.meta.id,level,m.layer)),packet(5,0,[4,0,20,0,22,23]),packet(4,0,[0,...[selected.width/2,selected.height/2,.5,selected.width/2,selected.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));
   await rig.expect('original sparse MRT state',submission(1,state));const clr=clear([1,0,1,0]);put(clr,4,4|16|32);
   row.operation=await rig.expect('original sparse MRT clear and draw',submission(1,join(clr,packet(8,0,[0,2,0,0,1,0,0,0,0,0,0xffffffff,0])),0x20000000000001n));
   for(const model of models)for(const p of model.planes){
    const wanted=p.bytes.slice();if(p.level===level){for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)wanted.set([255,0,255,0],((model.layer*p.height+y)*p.width+x)*4);for(const [x,y]of points)wanted.set(colors[model.slot],((model.layer*p.height+y)*p.width+x)*4);}
    const r=request(model.meta,p,2),ram=memories.get(model.meta.id);ram.write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('original all MRT image planes',r.wire),actual=ram.read(),expectBacking=padded(p,wanted,r.stride,r.ls,0x4e);
    row.outputs.push({resource:model.meta.id,slot:model.slot,level:p.level,width:p.width,height:p.height,layers:p.layers,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(wanted),backingActual:hex(actual),backingExpected:hex(expectBacking),guards:ram.guards()});c.equal(rig.exchanges[at].bytes,hex(wanted),'all changed and untouched original MRT pixels');c.equal(hex(actual),hex(expectBacking),'all MRT SG padding bytes');
   }
   c.truth(trace.states.some(s=>trace.calls[s.sequence].name.startsWith('draw')),'actual original sparse MRT draw');
   for(const s of trace.states){c.equal(s.state.attachments[1].type,native.NONE,'null original MRT slot stays detached');for(const m of models){const a=s.state.attachments[m.slot];c.equal(a.type,native.TEXTURE,'MRT original texture attachment');c.equal(a.level,level,'MRT original mip');c.equal(m.meta.target===4?a.face-native.TEXTURE_CUBE_MAP_POSITIVE_X:a.layer,m.layer,'MRT original layer or face');}}
   c.equal(native.getError(),native.NO_ERROR,'zero MRT hardware errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
  finally{row.calls=trace.calls;row.attachmentStates=trace.states;row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'all MRT owners retire');c.equal(rig.trace.syncs.size,0,'all MRT syncs retire');const index=report.rows.length-1;if(window.__recordDimensionalColorSurfaceRun)report.rows[index]=await window.__recordDimensionalColorSurfaceRun(index,JSON.stringify(row));}
 }
}
