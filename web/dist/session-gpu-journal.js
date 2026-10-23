// Durable exact GPU results. Every external body is a direct event reference; RAM
// deltas use the existing authenticated parent/frame/page graph and publication rule.
import init,{sessionCanonicalImage,sessionValidateManifest,sessionIndexEventChunk} from './session-pkg/wasm_vm_session.js';
import {SessionDiskRoots} from './session-disk-roots.js';
import {SessionWitnessPages,witnessCommitment,witnessExtension,WITNESS_PAGE_ROWS,WITNESS_MAX_PAGES} from './session-witness-pages.js';
import {SessionCheckpoints,checkpointChunks,checkpointHash,checkpointReference,readCheckpointObject,fetchCheckpointAsset} from './session-checkpoints.js';
import {decodeKeyframeDescriptor,encodeKeyframeDescriptor,inspectRamDeltaChunk,KEYFRAME_MAX_DEPTH} from './session-keyframes.js';
import {decodeInputEventRecord} from './session-inputs.js';
import {encodeCheckpointData} from './renderer/virgl-command/checkpoint-codec.mjs';
import {validateBranchOrigin} from './session-branch-format.js';
import {GPU_EXACT_INPUTS,GPU_FRAME_LIMIT,gpuNeed as need,gpuHex,gpuHashBytes,gpuPosition as pos,gpuSamePosition as same,gpuCompare as compare,ownGpuReceipt,gpuEventParts,validateGpuConfiguration,encodeGpuExactFrame,decodeGpuExactFrame} from './session-gpu-replay-format.js';
await init();
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const json=value=>encoder.encode(JSON.stringify(value)),canonical=value=>sessionValidateManifest(json(value));
const witness=value=>({...pos(value),digest:[...value.digest]});
const sameData=(a,b)=>{const x=encodeCheckpointData(a),y=encodeCheckpointData(b);return x.length===y.length&&x.every((value,index)=>value===y[index]);};
const sameRef=(a,b)=>a?.sha256===b?.sha256&&a?.length===b?.length;
function emptyDisk(manifest,base){const value=JSON.parse(manifest),bytes=new Uint8Array(61),view=new DataView(bytes.buffer);bytes.set(encoder.encode('WVOD1'));view.setUint32(5,4096,true);view.setBigUint64(9,BigInt(value.image_len),true);bytes.set(gpuHashBytes(base),17);return bytes;}
function executable(row){return [17,18,23].includes(row.channel)?{...row,kind:'observation',sourceKind:Number(row.outcome[1]),status:Number(row.outcome[0]),requested:Number(row.outcome[2])}:{...row,kind:'host'};}
function gpuManifest(id,config,vm,base,begin){
  return {version:{major:1,minor:0},id,
    machine:{vm_build:vm.sha256,wasm_build:config.wasm.sha256,base_image:base.sha256,kernel:config.kernel.sha256,initramfs:null,
      ram_bytes:'1073741824',harts:1,devices:config.devices,gpu:{renderer_build:config.renderer.sha256,profile:checkpointHash(encodeCheckpointData(config.profile))}},
    policy:{mode:'exact-replay',profile:'rv64-linux-gpu-v1',event_version:{major:1,minor:0},checkpoint_version:{major:1,minor:0},boundary_version:1,clock:config.clock,required_inputs:[...GPU_EXACT_INPUTS]},
    assets:[{role:'vm',content:vm},{role:'wasm',content:{sha256:config.wasm.sha256,length:config.wasm.length}},
      {role:'kernel',content:{sha256:config.kernel.sha256,length:config.kernel.length}},{role:'base',content:base},{role:'gpu-renderer',content:{sha256:config.renderer.sha256,length:config.renderer.length}}],
    begin:pos(begin),end:pos(begin),events:[],checkpoints:[],extensions:[]};
}
export class SessionGpuJournal {
  #store;#writer;#manifest;#config;#pending=[];#bodies=new Map();#intervalBodies=new Map();#committedRows=0;#committedSmall=0;#busy=false;#complete=false;#witnesses=null;
  constructor(store,writer,manifest,config){this.#store=store;this.#writer=writer;this.#manifest=manifest;this.#config=config;const committed=witnessCommitment(manifest);if(committed){this.#witnesses=new SessionWitnessPages(committed);this.#complete=committed.finished;}}
  static async create(store,writer,input,machine,renderer,{witnessPages=false}={}){
    need(!await store.openSession(writer.id),'session ID already exists');
    const config=validateGpuConfiguration(input),configBytes=json(config),vm=checkpointReference(configBytes),image=sessionCanonicalImage(config.imageManifest),base=checkpointReference(image);
    need(JSON.stringify(JSON.parse(machine.exactGpuSessionTopology()))===JSON.stringify(config.devices),'installed GPU topology differs');
    need(JSON.stringify(machine.sessionSourcePolicy())===JSON.stringify(config.timeEntropyPolicy),'installed GPU source policy differs');
    need(config.branchOrigin===undefined,'use the private continuation constructor');
    const manifest=gpuManifest(writer.id,config,vm,base,machine.inputPosition());
    need(manifest.begin.transition==='0'&&manifest.begin.sequence==='0','fresh GPU recording required');
    await writer.put(vm,checkpointChunks(configBytes));await writer.put(base,checkpointChunks(image));
    for(const role of ['kernel','wasm','renderer']){const bytes=await fetchCheckpointAsset(config[role].url,config[role].sha256,role==='renderer'?1048576:64*1048576);
      need(String(bytes.length)===config[role].length,'asset length');
      if(role==='renderer')need(decoder.decode(bytes).includes(`GPU_CHECKPOINT_BUILD_ID="${config.renderer.buildId}"`),'renderer build asset');
      await writer.put({sha256:config[role].sha256,length:config[role].length},checkpointChunks(bytes));}
    const journal=new SessionGpuJournal(store,writer,manifest,config);
    if(witnessPages)journal.#witnesses=new SessionWitnessPages();
    await journal.captureKeyframe(machine,renderer,'gpu-start',{full:true,initial:true});return journal;
  }
  // The private worker has paused after a real full keyframe. Publication remains
  // on the page, where the source-selection authorizer runs in the store transaction.
  static async createBranchExact(store,writer,input,prepared,assets,authorize){
    const config=validateGpuConfiguration(input),origin=validateBranchOrigin(config.branchOrigin);
    need(writer.id!==origin.parentId&&typeof authorize==='function','private branch owner/authorizer');
    const own=(value,limit)=>{need(value instanceof Uint8Array&&value.buffer instanceof ArrayBuffer&&value.length<=limit,'owned branch object');return value.slice();};
    const frameBytes=own(prepared.frame,GPU_FRAME_LIMIT),rendererBytes=own(prepared.renderer,256*1048576),disk=own(prepared.disk,64*1048576);
    const retained={};
    for(const role of ['kernel','wasm','renderer']){
      const bytes=own(assets?.[role],role==='renderer'?1048576:64*1048576),ref=checkpointReference(bytes);
      need(ref.sha256===config[role].sha256&&ref.length===config[role].length,'local branch '+role+' identity');retained[role]={bytes,ref};
    }
    need(decoder.decode(retained.renderer.bytes).includes(`GPU_CHECKPOINT_BUILD_ID="${config.renderer.buildId}"`),'branch renderer build');
    const configBytes=json(config);need(configBytes.length<=1048576,'branch configuration bound');
    const vm=checkpointReference(configBytes),image=sessionCanonicalImage(config.imageManifest),base=checkpointReference(image);
    const frame=decodeGpuExactFrame(frameBytes),rendererRef=checkpointReference(rendererBytes),frameRef=checkpointReference(frameBytes);
    need(frame.meta.full&&frame.meta.runtime===vm.sha256&&same(frame.meta.position,origin.sourcePosition)
      &&frame.meta.rendererSha256===rendererRef.sha256,'branch initial GPU frame binding');
    need(disk.length>=61&&gpuHex(frame.native.subarray(44,76))===gpuHex(disk.subarray(17,49))
      &&new DataView(frame.native.buffer,frame.native.byteOffset).getBigUint64(76,true)===new DataView(disk.buffer).getBigUint64(49,true),'branch disk generation/base binding');
    authorize();need(!await store.openSession(writer.id),'session ID already exists');authorize();
    await writer.put(vm,checkpointChunks(configBytes));await writer.put(base,checkpointChunks(image));
    for(const {bytes,ref}of Object.values(retained)){await writer.put(ref,checkpointChunks(bytes));authorize();}
    const root=await new SessionDiskRoots(store).capture(writer,disk,config.imageManifest);authorize();
    await writer.put(rendererRef,checkpointChunks(rendererBytes));await writer.put(frameRef,checkpointChunks(frameBytes));
    const manifest=gpuManifest(writer.id,config,vm,base,frame.meta.position);
    manifest.checkpoints=[{id:'gpu-start',position:pos(frame.meta.position),next_sequence:(BigInt(frame.meta.position.sequence)+1n).toString(),machine:frameRef,disk_root:root.content.sha256,gpu:rendererRef}];
    manifest.extensions=[{kind:'e9-exact-initial-witness-v1',required:false,bytes:[...json([{...pos(frame.meta.position),digest:[...gpuHashBytes(frame.meta.stateSha256)]}])]}];
    await writer.publish(canonical(manifest),null,authorize);
    return new SessionGpuJournal(store,writer,manifest,config);
  }
  get end(){return {...this.#manifest.end};}
  get pending(){return this.#pending.length;}
  // These fixed admission budgets apply until the next durable checkpoint.
  // Ordinary flushes never reset them; the store separately bounds all history.
  get intervalWindow(){return Object.freeze({rows:this.#committedRows+this.#pending.length,
    bytes:this.#committedSmall+this.#pending.reduce((sum,row)=>sum+row.bytes.length,0),
    rowLimit:4096,byteLimit:64*1048576});}
  get checkpoints(){return structuredClone(this.#manifest.checkpoints);}
  get initialWitness(){const [value]=JSON.parse(decoder.decode(Uint8Array.from(this.#manifest.extensions[0].bytes)));return {...pos(value),digest:Uint8Array.from(value.digest)};}
  stage(batch){
    need(!this.#busy&&!this.#complete&&Array.isArray(batch?.events)&&Array.isArray(batch?.payloads)&&this.#pending.length+batch.events.length<=256,'GPU batch ownership/bound');
    need(this.#committedRows+this.#pending.length+batch.events.length<=4096,'GPU event inspection window');
    const bodies=new Map(this.#bodies);let total=[...bodies.values()].reduce((n,b)=>n+b.bytes.length,0);
    for(const body of batch.payloads){need(body?.bytes instanceof Uint8Array&&body.bytes.buffer instanceof ArrayBuffer&&body.bytes.length>0&&body.bytes.length<=32*1048576
      &&body.sha256 instanceof Uint8Array&&body.sha256.length===32&&body.length===body.bytes.length,'owned GPU body');
      const ref=checkpointReference(body.bytes);need(ref.sha256===gpuHex(body.sha256),'GPU body hash');
      const prior=bodies.get(ref.sha256);need(!prior||prior.ref.length===ref.length,'conflicting GPU body length');
      if(!prior){total+=body.bytes.length;need(total<=64*1048576&&bodies.size<256,'GPU resident body window');bodies.set(ref.sha256,{ref,bytes:body.bytes.slice()});}}
    let previous=this.#pending.at(-1)??this.#manifest.end;const rows=[];let smallBytes=this.#pending.reduce((n,row)=>n+row.bytes.length,0);
    for(const original of batch.events){const row=ownGpuReceipt(original,previous);need(typeof row.ticket==='string','GPU exact ticket');const parts=gpuEventParts(row);
      if(parts.body)need(sameRef(bodies.get(parts.body.sha256)?.ref,parts.body),'missing GPU result body');
      smallBytes+=row.bytes.length;need(smallBytes<=4*1048576&&this.#committedSmall+smallBytes<=64*1048576,'GPU receipt batch/history budget');rows.push(row);previous=row;}
    const used=new Set([...this.#pending,...rows].flatMap(row=>{const body=gpuEventParts(row).body;return body?[body.sha256]:[];}));
    need([...bodies.keys()].every(key=>used.has(key)),'unreferenced GPU body');
    const interval=new Map(this.#intervalBodies);for(const {ref}of bodies.values()){
      const previous=interval.get(ref.sha256);need(!previous||sameRef(previous,ref),'conflicting interval body length');interval.set(ref.sha256,ref);}
    need(interval.size<=256&&[...interval.values()].reduce((sum,ref)=>sum+Number(ref.length),0)<=64*1048576,'GPU checkpoint interval body budget');
    this.#pending.push(...rows);this.#bodies=bodies;
  }
  async flush(){
    need(!this.#busy&&!this.#complete,'GPU writer is busy or complete');if(!this.#pending.length)return this.end;this.#busy=true;
    try{
      const manifest=structuredClone(this.#manifest),objects=new Map(),records=[];
      const add=(ref,bytes)=>{const old=objects.get(ref.sha256);need(!old||old.ref.length===ref.length,'conflicting result length');objects.set(ref.sha256,{ref,bytes});};
      for(const row of this.#pending){const parts=gpuEventParts(row);if(parts.object)add(...parts.object);if(parts.body){const body=this.#bodies.get(parts.body.sha256);add(body.ref,body.bytes);}
        records.push(JSON.stringify({version:{major:1,minor:0},kind:parts.kind,required:true,...pos(row),device:parts.device,intent:parts.intent,status:parts.status,payload:parts.payload}));manifest.end=pos(row);}
      let group=[],length=2;const seal=()=>{if(!group.length)return;const bytes=encoder.encode('['+group.join(',')+']'),index=JSON.parse(decoder.decode(sessionIndexEventChunk(bytes)));manifest.events.push(index);add(index.content,bytes);group=[];length=2;};
      for(const record of records){const size=encoder.encode(record).length;need(size+2<=4194304,'GPU event index budget');if(length+size+Number(group.length>0)>4194304)seal();group.push(record);length+=size+Number(group.length>1);}seal();
      const bytes=canonical(manifest);for(const {ref,bytes} of objects.values())await this.#writer.put(ref,checkpointChunks(bytes));
      await this.#writer.publish(bytes);this.#manifest=manifest;
      this.#committedRows+=this.#pending.length;this.#committedSmall+=this.#pending.reduce((sum,row)=>sum+row.bytes.length,0);
      for(const {ref}of this.#bodies.values())this.#intervalBodies.set(ref.sha256,ref);
      this.#pending=[];this.#bodies.clear();return this.end;
    }finally{this.#busy=false;}
  }
  async captureKeyframe(machine,renderer,id,{full=false,initial=false}={}){
    need(!this.#busy&&!this.#complete&&this.#pending.length===0,'GPU keyframe requires flushed history');
    need(this.#manifest.checkpoints.length<(this.#witnesses?WITNESS_MAX_PAGES:63),'GPU state witness/keyframe bound');
    need(typeof id==='string'&&/^[A-Za-z0-9_.:/-]{1,64}$/.test(id)&&!this.#manifest.checkpoints.some(value=>value.id===id),'GPU checkpoint ID');
    this.#busy=true;let frozen=false;
    try{
      const before=pos(machine.inputPosition());need(before.phase==='before'&&before.sequence===this.#manifest.end.sequence&&compare(before,this.#manifest.end)>=0,'GPU checkpoint boundary');
      const saved=await renderer.saveCheckpoint();need(same(before,machine.inputPosition()),'guest changed during physical capture');
      need(saved.epoch===machine.exactGpuSessionEpoch(),'native/renderer epoch differs');
      const rendererRef=checkpointReference(saved.bytes);need(rendererRef.sha256===saved.sha256,'renderer object hash');
      const previous=this.#manifest.checkpoints.at(-1);let depth=0;
      if(previous){let prefix;for await(const part of this.#store.stream(previous.machine)){prefix=part.subarray(0,8);break;}
        if(decoder.decode(prefix)==='WVKEYF01')depth=decodeKeyframeDescriptor(await readCheckpointObject(this.#store,previous.machine,1048576)).depth;}
      full=full||!previous||depth===KEYFRAME_MAX_DEPTH;
      const frame=machine.captureExactGpuKeyframe(gpuHashBytes(saved.sha256),full);frozen=true;
      need(same(before,frame),'native checkpoint position changed');
      const meta={version:1,runtime:this.#manifest.machine.vm_build,position:pos(frame),rendererSha256:saved.sha256,rendererEpoch:saved.epoch,
        ramSha256:gpuHex(frame.ramDigest),stateSha256:gpuHex(frame.digest),full};
      const bytes=encodeGpuExactFrame(meta,frame.native,frame.pending,frame.output),frameRef=checkpointReference(bytes);
      const manifest=structuredClone(this.#manifest);await this.#writer.put(rendererRef,checkpointChunks(saved.bytes));await this.#writer.put(frameRef,checkpointChunks(bytes));
      let machineRef=frameRef;const chunks=[];let pages=0,last=-1,maxChunkBytes=0;
      if(!full){const dirty=machine.pendingSoftwareRamPages();let cursor=0;
        for(;;){const next=machine.nextSoftwareRamDeltaChunk(cursor);if(next===null)break;need(next.next>cursor&&chunks.length<512,'GPU RAM chunk cursor/bound');cursor=next.next;
          const shape=inspectRamDeltaChunk(next.bytes,'1073741824',last);last=shape.last;pages+=shape.count;maxChunkBytes=Math.max(maxChunkBytes,next.bytes.length);
          const ref=checkpointReference(next.bytes);chunks.push(ref);await this.#writer.put(ref,checkpointChunks(next.bytes));}
        need(pages===dirty,'GPU RAM page count');
        const descriptor=encodeKeyframeDescriptor({version:1,depth:depth+1,parent:previous.machine,frame:frameRef,chunks,ramBytes:'1073741824',ramSha256:meta.ramSha256,dirtyPages:pages});
        machineRef=checkpointReference(descriptor);await this.#writer.put(machineRef,checkpointChunks(descriptor));}
      if(initial){manifest.begin=pos(frame);manifest.extensions=[{kind:'e9-exact-initial-witness-v1',required:false,bytes:[...json([witness(frame)])]}];}
      manifest.end=pos(frame);manifest.checkpoints.push({id,position:pos(frame),next_sequence:(BigInt(frame.sequence)+1n).toString(),machine:machineRef,
        disk_root:previous?.disk_root??this.#manifest.initialDiskRoot,gpu:rendererRef});
      if(!previous){const root=await new SessionDiskRoots(this.#store).capture(this.#writer,emptyDisk(this.#config.imageManifest,manifest.machine.base_image),this.#config.imageManifest);manifest.checkpoints[0].disk_root=root.content.sha256;}
      const commitment=this.#witnesses?await this.#witnesses.prepare(this.#writer,{extra:[frame]}):null;
      if(commitment)manifest.extensions=[manifest.extensions[0],witnessExtension(commitment)];
      await this.#writer.publish(canonical(manifest),()=>{need(same(frame,machine.inputPosition())&&saved.epoch===machine.exactGpuSessionEpoch(),'GPU owner changed before publication');});
      this.#manifest=manifest;if(commitment)this.#witnesses.accept(commitment);this.#intervalBodies.clear();machine.finishSoftwareRamEpoch(true);frozen=false;
      // Publication and epoch acknowledgement both succeeded. The full ordered
      // history stays in the authenticated manifest/CAS; only this bounded
      // checkpoint interval's admission counters start over.
      this.#committedRows=0;this.#committedSmall=0;
      return {...pos(frame),digest:frame.digest,ramDigest:frame.ramDigest,full,frameBytes:bytes.length,dirtyPages:pages,maxChunkBytes,rendererBytes:saved.bytes.length};
    }finally{if(frozen)machine.finishSoftwareRamEpoch(false);this.#busy=false;}
  }
  // Each supplied witness comes from the real native owner while its receipts are flushed.
  // The page buffer is never a replacement for the bounded native replay-plan window.
  get witnessWindow(){return this.#witnesses?Object.freeze({pending:this.#witnesses.pending,peakRows:this.#witnesses.peakRows,rowLimit:WITNESS_PAGE_ROWS,commitment:this.#witnesses.committed}):null;}
  async observeExactWitness(value){
    need(this.#witnesses&&!this.#busy&&!this.#complete&&this.#pending.length===0,'paged witness requires flushed history');
    need(value.phase==='before'&&value.sequence===this.#manifest.end.sequence&&compare(value,this.#manifest.end)>=0,'paged witness boundary');
    this.#witnesses.stage(value);
    if(this.#witnesses.pending===WITNESS_PAGE_ROWS)await this.flushWitnesses();
  }
  async flushWitnesses({finished=false,end=null,authorize=undefined}={}){
    need(this.#witnesses&&!this.#busy&&!this.#complete&&this.#pending.length===0,'paged witness writer is busy or complete');
    if(!this.#witnesses.pending&&!finished)return this.end;
    const last=this.#witnesses.last;need(last&&last.sequence===this.#manifest.end.sequence&&compare(last,this.#manifest.end)>=0,'paged witness publication boundary');
    if(end)need(same(end,last),'paged final witness endpoint');
    this.#busy=true;
    try{
      const commitment=await this.#witnesses.prepare(this.#writer,{finished}),manifest=structuredClone(this.#manifest);
      manifest.end=pos(last);manifest.extensions=[manifest.extensions[0],witnessExtension(commitment)];
      await this.#writer.publish(canonical(manifest),null,authorize);
      this.#manifest=manifest;this.#witnesses.accept(commitment);this.#complete=finished;return this.end;
    }finally{this.#busy=false;}
  }
  async completeExactPaged(end,authorize=undefined){
    need(this.#witnesses&&!this.#busy&&!this.#complete&&this.#pending.length===0,'paged completion boundary');
    await this.observeExactWitness(end);return this.flushWitnesses({finished:true,end,authorize});
  }
  async completeExact(end,witnesses,authorize=undefined){
    need(!this.#witnesses&&!this.#busy&&!this.#complete&&this.#pending.length===0&&Array.isArray(witnesses)&&witnesses.length>=2&&witnesses.length<=64,'GPU completion witnesses/bound');
    need(end.phase==='before'&&end.sequence===this.#manifest.end.sequence&&compare(end,this.#manifest.end)>=0,'GPU recording end');
    const values=witnesses.map(value=>{need(value.digest instanceof Uint8Array&&value.digest.length===32,'GPU witness digest');return witness(value);});
    need(this.#manifest.checkpoints.every(point=>values.some(value=>same(value,point.position))),'GPU keyframe witness missing');
    need(same(values[0],this.#manifest.begin)&&same(values.at(-1),end)&&values.slice(1).every((value,index)=>compare(value,values[index])>0),'GPU witness order/endpoints');
    need(decoder.decode(Uint8Array.from(this.#manifest.extensions[0].bytes))===JSON.stringify([values[0]]),'GPU initial witness changed');
    const manifest=structuredClone(this.#manifest);manifest.end=pos(end);manifest.extensions.push({kind:'e9-exact-state-witnesses-v1',required:false,bytes:[...json(values)]});
    this.#busy=true;
    try{await this.#writer.publish(canonical(manifest),null,authorize);this.#manifest=manifest;this.#complete=true;return this.end;}
    finally{this.#busy=false;}
  }
  static async readExact(store,id,{configuration}={}){
    const config=validateGpuConfiguration(configuration),opened=await store.openSession(id);need(opened,'GPU recording unavailable');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    need(manifest.policy.mode==='exact-replay'&&manifest.policy.profile==='rv64-linux-gpu-v1'&&manifest.machine.gpu!==null
      &&manifest.machine.vm_build===checkpointHash(json(config))&&manifest.machine.wasm_build===config.wasm.sha256&&manifest.machine.kernel===config.kernel.sha256
      &&manifest.machine.base_image===checkpointHash(sessionCanonicalImage(config.imageManifest))&&manifest.machine.ram_bytes==='1073741824'
      &&manifest.machine.gpu.renderer_build===config.renderer.sha256&&manifest.machine.gpu.profile===checkpointHash(encodeCheckpointData(config.profile))
      &&sameData(manifest.machine.devices,config.devices)&&sameData(manifest.policy.clock,config.clock)
      &&JSON.stringify(manifest.policy.required_inputs)===JSON.stringify(GPU_EXACT_INPUTS),'GPU runtime/provider identity mismatch');
    if(config.branchOrigin)need(id!==config.branchOrigin.parentId&&same(manifest.begin,config.branchOrigin.sourcePosition),'GPU branch origin/position');
    else need(['transition','sequence','retired'].every(key=>manifest.begin[key]==='0')&&manifest.begin.phase==='before'&&manifest.begin.ordinal===0,'ordinary GPU origin');
    need(!witnessCommitment(manifest),'paged GPU playback requires the bounded reader');
    const extension=manifest.extensions.find(value=>value.kind==='e9-exact-state-witnesses-v1');need(extension?.required===false,'finish this GPU recording before replay');
    const witnesses=JSON.parse(decoder.decode(Uint8Array.from(extension.bytes))).map(value=>({...pos(value),digest:Uint8Array.from(value.digest)}));
    need(witnesses.length>=2&&witnesses.length<=64&&same(witnesses[0],manifest.begin)&&same(witnesses.at(-1),manifest.end),'GPU witness endpoints');
    const receipts=[];let previous=manifest.begin,total=0;
    for(const chunk of manifest.events){const records=JSON.parse(decoder.decode(await readCheckpointObject(store,chunk.content,4194304)));
      for(const record of records){let row;
        if(record.kind==='gpu'){
          const intent=JSON.parse(decoder.decode(Uint8Array.from(record.intent)));
          need(keysGpuIntent(intent),'GPU event adapter version');
          row=ownGpuReceipt({...pos(record),channel:intent.channel,outcome:intent.outcome,ticket:intent.ticket,bytes:Uint8Array.from(intent.header)},previous);
          const parts=gpuEventParts(row);need(record.required===true&&record.device===parts.device&&record.status===parts.status
            &&JSON.stringify(record.payload)===JSON.stringify(parts.payload),'GPU body/envelope identity');
          if(parts.body)row.body=parts.body;
        }else row=await decodeInputEventRecord(store,record,previous,{exactMode:true});
        total+=row.bytes.length;need(total<=64*1048576&&receipts.length<4096,'GPU event inspection window');receipts.push(executable(row));previous=row;}}
    return {manifest,receipts,witnesses,configuration:config,admitted:true};
  }
}
function keysGpuIntent(intent){return intent?.version===1&&Object.keys(intent).sort().join(',')==='channel,header,outcome,ticket,version'&&[22,23].includes(intent.channel);}
