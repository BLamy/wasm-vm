// Bounded attacks on the actual Wasm ABI, using the authenticated real Linux source.
import {WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {readCheckpointObject,checkpointHash} from '/session-checkpoints.js';
export async function branchAbiAttacks({store,timeline}){
 const owner=timeline.owner,capture=owner.controller.captureSelectedBranch().capture,config=owner.configuration;
 const kernel=await readCheckpointObject(store,owner.manifest.assets.find(asset=>asset.role==='kernel').content,64*1048576);
 const fresh=replay=>WasmLinux.newExactSession(kernel,config.imageManifest,config.bootargs,()=>{},replay),results=[];
 const refuse=(name,machine,action)=>{
  const before=checkpointHash(machine.exactSessionWitness(false).digest);let message;
  try{action();}catch(error){message=error.message;}
  if(!message)throw Error('ABI accepted '+name);
  if(checkpointHash(machine.exactSessionWitness(false).digest)!==before)throw Error('ABI refusal mutated '+name);
  results.push({name,message,unchangedStateHash:before});
 };
 const machine=fresh(false),queues={pending:capture.pending,output:capture.output};
 try{
  refuse('recording cannot be a branch source',machine,()=>machine.captureExactBranch());
  for(const [name,queue]of [['missing output',{pending:new Uint8Array()}],['wrong output type',{pending:new Uint8Array(),output:new DataView(new ArrayBuffer(1))}],
   ['oversized pending',{pending:new Uint8Array(1048577),output:new Uint8Array()}],['oversized output',{pending:new Uint8Array(),output:new Uint8Array(1048577)}]])
   refuse(name,machine,()=>machine.beginExactBranch(capture.native,queue));
  refuse('native state bound',machine,()=>machine.beginExactBranch(new Uint8Array(512*1048576+1),queues));
  refuse('renderer digest length',machine,()=>machine.beginExactBranch(capture.native,queues,new Uint8Array(31)));
  refuse('software cannot accept GPU branch profile',machine,()=>machine.beginExactBranch(capture.native,queues,new Uint8Array(32)));
  if(globalThis.SharedArrayBuffer){
   for(const [name,action]of [
    ['shared native',()=>machine.beginExactBranch(new Uint8Array(new SharedArrayBuffer(84)),queues)],
    ['shared pending',()=>machine.beginExactBranch(capture.native,{pending:new Uint8Array(new SharedArrayBuffer(1)),output:new Uint8Array()})],
    ['shared output',()=>machine.beginExactBranch(capture.native,{pending:new Uint8Array(),output:new Uint8Array(new SharedArrayBuffer(1))})],
    ['shared renderer digest',()=>machine.beginExactBranch(capture.native,queues,new Uint8Array(new SharedArrayBuffer(32)))]])refuse(name,machine,action);
  }
  const malformed=capture.native.slice();malformed[0]^=1;
  refuse('malformed restore is atomic',machine,()=>machine.beginExactBranch(malformed,queues));
  machine.beginExactBranch(capture.native,queues);
  refuse('restored owner cannot be reused',machine,()=>machine.beginExactBranch(capture.native,queues));
  refuse('historical connections cannot go live',machine,()=>machine.requestExactBranchGoLive());
 }finally{machine.free();}
 const replay=fresh(true);try{refuse('replay cannot become a recording owner',replay,()=>replay.beginExactBranch(capture.native,queues));}finally{replay.free();}
 for(const [name,bytes,image,args]of [['foreign kernel',new Uint8Array([1]),config.imageManifest,config.bootargs],
  ['foreign bootargs',kernel,config.imageManifest,config.bootargs+' quiet'],
  ['foreign image',kernel,JSON.stringify({...JSON.parse(config.imageManifest),chunks:JSON.parse(config.imageManifest).chunks.map(()=> 'ab'.repeat(32))}),config.bootargs]]){
  let message,unexpected;try{unexpected=WasmLinux.newExactSession(bytes,image,args,()=>{},false);}catch(error){message=error.message;}finally{unexpected?.free();}
  if(!message)throw Error('Admitted '+name);results.push({name,message});
 }
 return results;
}
