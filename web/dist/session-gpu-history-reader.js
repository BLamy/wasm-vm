// Complete, bounded, storage-authenticated GPU history. A cursor owns a single
// session read lease; this API never creates a VM, native plan or renderer owner.
import initMetadata,{SessionSha256,sessionCanonicalImage,sessionEventReferences,sessionValidateDiskRoot,sessionAdmitDiskRoot,sessionValidateWitnessPage} from './session-pkg/wasm_vm_session.js';
import initMachine,{sessionExactGpuIdentity} from './pkg/wasm_vm_wasm.js';
import {SessionStore} from './session-store.js';
import {inventoryWitnessGraph} from './session-witness-graph.js';
import {witnessCommitment,WITNESS_PAGE_BYTES,WITNESS_PAGE_ROWS} from './session-witness-pages.js';
import {checkpointHash,checkpointReference,readCheckpointObject} from './session-checkpoints.js';
import {decodeKeyframeDescriptor,isKeyframeDescriptorPrefix} from './session-keyframes.js';
import {decodeInputEventRecord} from './session-inputs.js';
import {encodeCheckpointData} from './renderer/virgl-command/checkpoint-codec.mjs';
import {qualifyVirglHost} from './renderer/virgl-command/production.mjs';
import {selectCheckpointProfile} from './renderer/virgl-command/checkpoint-profile.mjs';
import {inspectGpuFrame,inspectGpuRenderer} from './session-gpu-frame-inspection.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256,SOFTWARE_CHECKPOINT_WASM_BYTES} from './gpu-checkpoint-build.js';
import {GPU_EXACT_INPUTS,validateGpuConfiguration,ownGpuReceipt,gpuEventParts,gpuPosition as pos,gpuSamePosition as same,gpuCompare as compare,gpuHex,gpuHashBytes} from './session-gpu-replay-format.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const json=value=>encoder.encode(JSON.stringify(value)),parsed=bytes=>JSON.parse(decoder.decode(bytes));
const sameRef=(a,b)=>a?.sha256===b?.sha256&&a?.length===b?.length;
const sameData=(a,b)=>checkpointHash(encodeCheckpointData(a))===checkpointHash(encodeCheckpointData(b));
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const MAX_ROWS=4096,MAX_BYTES=64*1048576,MAX_BODY=32*1048576,MAX_BODIES=256,MAX_U64=0xffffffffffffffffn;
const canonicalTicket=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<MAX_U64;
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export class SessionGpuHistoryError extends Error {
  constructor(code,anchor,detail){super(`GPU history ${code} at ${JSON.stringify(anchor)}: ${detail}`);this.name='SessionGpuHistoryError';this.code=code;this.anchor=freeze(structuredClone(anchor));}
}
const need=(ok,code,anchor,detail=code)=>{if(!ok)throw new SessionGpuHistoryError(code,anchor,detail);};
function receiptHash(){const hash=new SessionSha256();hash.update(encoder.encode('wasm-vm-gpu-receipts-v1\0'));return hash;}
function hashRow(hash,row){
  const header=json({...pos(row),kind:row.kind,channel:row.channel,ticket:row.ticket,outcome:row.outcome,body:row.body??null,byteLength:row.bytes.length});
  const prefix=new Uint8Array(8),v=new DataView(prefix.buffer);v.setUint32(0,header.length,true);v.setUint32(4,row.bytes.length,true);hash.update(prefix);hash.update(header);hash.update(row.bytes);
}
function executable(row){return [17,18,23].includes(row.channel)?{...row,kind:'observation',sourceKind:Number(row.outcome[1]),status:Number(row.outcome[0]),requested:Number(row.outcome[2])}:{...row,kind:'host'};}

export class SessionGpuHistoryReader {
  #store;#source;#authorize;#signal;#closed=false;#ready=false;#busy=false;#manifest;#manifestBytes;#configuration;#origin;#session;#plans=[];#pages=[];#events=null;#eventToken=null;#witnessToken=null;#eventIndex=0;#witnessIndex=0;#witnessRows=0;#witnessPrevious=null;#metadata;#anchor={stage:'open'};
  #metrics={storeChunkBytes:0,clockSectionBytes:0,eventChunkBytes:0,rendererArtifactBytes:0,rendererDecodedFrameBytes:0,receiptWindowRows:0,receiptWindowBytes:0,maxReceiptBytes:0,gpuBodyWindowCount:0,gpuBodyWindowBytes:0,witnessPageRows:0,witnessPageBytes:0,preflightWindowRows:0,preflightWindowBytes:0,ticketCount:0,ticketTextBytes:0,windowMetadataBytes:0,referenceMetadataBytes:0,manifestBytes:0,configurationBytes:0};
  constructor(key,store,authorize,signal){need(key===privateKey,'PrivateConstructor',{},'use withOpen');this.#store=store;this.#authorize=authorize;this.#signal=signal;
    this.#source={stream:ref=>this.#stream(ref),objectReference:async hash=>{this.#live();const ref=await store.objectReference(hash);this.#live();return ref;}};
  }
  #live(){need(!this.#closed,'ReaderRevoked',this.#anchor);this.#authorize();}
  #active(){this.#live();need(this.#ready,'ReaderNotReady',this.#anchor);}
  async *#stream(ref){this.#live();for await(const part of this.#store.stream(ref,{signal:this.#signal})){this.#live();this.#metrics.storeChunkBytes=Math.max(this.#metrics.storeChunkBytes,part.length);yield part;this.#live();}this.#live();}
  #failure(error){this.#closed=true;const anchor={...this.#anchor,...(error.reference?.sha256?{object:error.reference.sha256}:{} )};return error instanceof SessionGpuHistoryError?error:new SessionGpuHistoryError('Authentication',anchor,String(error.message??error));}
  static async withOpen(store,id,{signal}={},callback){
    need(store instanceof SessionStore&&typeof callback==='function','ReaderArguments',{id});
    await initMetadata();await initMachine();
    return store.withSessionReadLease(id,{signal},async authorize=>{
      const reader=new SessionGpuHistoryReader(privateKey,store,authorize,signal);
      try{await reader.#prepare(id,signal);reader.#active();return await callback(reader);}
      catch(error){throw reader.#failure(error);}
      finally{reader.#closed=true;reader.#eventToken=null;reader.#witnessToken=null;await reader.#events?.return?.();}
    });
  }
  get metadata(){this.#active();return this.#metadata;}
  get resident(){this.#active();const m=this.#metrics;return freeze({...structuredClone(m),measurement:{
    kind:'Explicit owned window maxima and conservative buffer upper bound; not RSS or JavaScript heap usage',
    retainedMetadataEncodedBytes:m.manifestBytes+m.configurationBytes+m.referenceMetadataBytes+m.windowMetadataBytes+m.ticketTextBytes,
    dataBufferUpperBoundBytes:Math.max(m.receiptWindowBytes+m.gpuBodyWindowBytes+m.eventChunkBytes+2*m.storeChunkBytes+2*m.maxReceiptBytes,
      (m.rendererBufferUpperBoundBytes??0)+2*m.storeChunkBytes,3*m.clockSectionBytes+2*m.storeChunkBytes+16400),
    excludes:'Caller-retained windows, JavaScript object/string overhead and Wasm allocator reserved memory',
    receiptRowLimit:MAX_ROWS,receiptByteLimit:MAX_BYTES,gpuBodyByteLimit:MAX_BYTES,gpuBodyCountLimit:MAX_BODIES,
  }});}
  get initialEventCursor(){this.#active();return this.#eventIndex===0?this.#eventToken:null;}
  get initialWitnessCursor(){this.#active();return this.#witnessIndex===0?this.#witnessToken:null;}
  #token(){return Object.freeze(Object.create(null));}
  #windowIdentity(stream,index,range,predecessor,receiptDigest,referencedBodies){
    const identity={domain:'wasm-vm-gpu-history-window-v1',session:this.#session,stream,index,range,predecessor,receiptDigest,referencedBodies};return checkpointHash(json(identity));
  }
  async #prepare(id,signal){
    this.#anchor={stage:'open',id};this.#live();const opened=await this.#store.openSession(id,{signal});this.#live();need(opened,'MissingSession',{id});
    this.#manifestBytes=opened.manifest;this.#metrics.manifestBytes=opened.manifest.length;
    this.#anchor={stage:'closure',id,manifestSha256:checkpointHash(opened.manifest)};
    const graph=await inventoryWitnessGraph(this.#source,opened.manifest,{signal});this.#live();
    const manifest=this.#manifest=graph.manifest,commitment=witnessCommitment(manifest,{finished:true});
    need(commitment?.finished,'UnfinishedWitness',this.#anchor);
    this.#pages=graph.witness.refs.toReversed();
    this.#metrics.referenceMetadataBytes=json(graph.refs).length;
    const asset=role=>{const entries=manifest.assets.filter(v=>v.role===role);need(entries.length===1,'Asset',this.#anchor,role);return entries[0].content;};
    this.#anchor={stage:'runtime',id,object:asset('vm').sha256};
    const bytes=await readCheckpointObject(this.#source,asset('vm'),8*1048576);this.#live();this.#metrics.configurationBytes=bytes.length;
    const config=this.#configuration=validateGpuConfiguration(parsed(bytes)),installed=JSON.parse(sessionExactGpuIdentity());
    need(manifest.version.major===1&&manifest.version.minor===0&&manifest.policy.event_version.major===1&&manifest.policy.event_version.minor===0
      &&manifest.policy.checkpoint_version.major===1&&manifest.policy.checkpoint_version.minor===0&&manifest.policy.boundary_version===1
      &&manifest.policy.mode==='exact-replay'&&manifest.policy.profile==='rv64-linux-gpu-v1'&&manifest.machine.initramfs===null&&manifest.machine.harts===1
      &&manifest.machine.ram_bytes==='1073741824'&&manifest.machine.gpu!==null&&manifest.assets.length===5,'Compatibility',this.#anchor);
    need(config.wasm.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256&&config.wasm.length===String(SOFTWARE_CHECKPOINT_WASM_BYTES)
      &&manifest.machine.wasm_build===SOFTWARE_CHECKPOINT_WASM_SHA256&&sameRef(asset('wasm'),config.wasm)
      &&config.renderer.buildId===GPU_CHECKPOINT_BUILD_ID&&sameRef(asset('gpu-renderer'),config.renderer)
      &&sameRef(asset('kernel'),config.kernel)&&Number(config.kernel.length)<=64*1048576
      &&sameRef(asset('base'),checkpointReference(sessionCanonicalImage(config.imageManifest)))
      &&manifest.machine.vm_build===checkpointHash(json(config))&&manifest.machine.kernel===config.kernel.sha256&&manifest.machine.base_image===asset('base').sha256
      &&manifest.machine.gpu.renderer_build===config.renderer.sha256&&manifest.machine.gpu.profile===checkpointHash(encodeCheckpointData(config.profile))
      &&sameData(manifest.machine.devices,config.devices)&&sameData(config.devices,installed.devices)&&sameData(manifest.policy.clock,config.clock)
      &&sameData(manifest.policy.required_inputs,GPU_EXACT_INPUTS),'InstalledIdentity',this.#anchor);
    const expected=encoder.encode('// Generated from actual worker/Wasm runtime bytes; never hand edit.\nexport const GPU_CHECKPOINT_BUILD_ID='+JSON.stringify(GPU_CHECKPOINT_BUILD_ID)+';\nexport const SOFTWARE_CHECKPOINT_WASM_SHA256='+JSON.stringify(SOFTWARE_CHECKPOINT_WASM_SHA256)+';\nexport const SOFTWARE_CHECKPOINT_WASM_BYTES='+SOFTWARE_CHECKPOINT_WASM_BYTES+';\n');
    need(sameRef(asset('gpu-renderer'),checkpointReference(expected)),'InstalledRendererStamp',this.#anchor);
    need(equal(await readCheckpointObject(this.#source,asset('gpu-renderer'),1048576),expected),'InstalledRendererStamp',this.#anchor);this.#live();
    if(config.branchOrigin)need(id!==config.branchOrigin.parentId&&same(manifest.begin,config.branchOrigin.sourcePosition),'BranchOrigin',this.#anchor);
    else need(['transition','sequence','retired'].every(key=>manifest.begin[key]==='0')&&manifest.begin.phase==='before'&&manifest.begin.ordinal===0,'Origin',this.#anchor);
    const canvas=new OffscreenCanvas(1,1),gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});
    try{const hardware=await qualifyVirglHost(gl);this.#live();selectCheckpointProfile(hardware,config.profile);}
    finally{gl?.getExtension('WEBGL_lose_context')?.loseContext();}
    const roots=new Map(),renderers=new Map();let previous=null;
    for(const point of manifest.checkpoints){
      this.#anchor={stage:'checkpoint',id,checkpoint:point.id,object:point.machine.sha256,position:pos(point.position)};
      let root=roots.get(point.disk_root);
      if(!root){const ref=await this.#source.objectReference(point.disk_root),bytes=await readCheckpointObject(this.#source,ref,12*1048576);root=parsed(sessionValidateDiskRoot(bytes));
        need(root.blocks.length===0&&equal(bytes,sessionAdmitDiskRoot(bytes,config.imageManifest,root.generation)),'DiskRoot',this.#anchor);roots.set(point.disk_root,root);}
      let frame=point.machine,full=true,prefix;
      for await(const part of this.#source.stream(frame)){prefix=part.subarray(0,8);break;}
      if(isKeyframeDescriptorPrefix(prefix)){const delta=decodeKeyframeDescriptor(await readCheckpointObject(this.#source,frame,1048576));frame=delta.frame;full=false;}
      const checked=await inspectGpuFrame(this.#source,frame,{point,manifest,root,coreHash:installed.coreHash,full,active:()=>this.#live(),metrics:this.#metrics});this.#live();
      if(!previous){need(full&&same(point.position,manifest.begin),'InitialFrame',this.#anchor);this.#origin=checked.origin;this.#session=freeze({id,manifestSha256:checkpointHash(opened.manifest),revision:opened.revision,generation:root.generation});}
      let renderer=renderers.get(point.gpu.sha256);
      if(!renderer){renderer=await inspectGpuRenderer(this.#source,point.gpu,config.profile,manifest.machine.gpu.profile,{active:()=>this.#live(),metrics:this.#metrics});renderers.set(point.gpu.sha256,renderer);}
      need(renderer.epoch===checked.meta.rendererEpoch,'RendererEpoch',this.#anchor);previous=point;
    }
    need(this.#origin&&same(this.#origin.position,manifest.begin),'Origin',this.#anchor);
    const summary=await this.#plan();this.#live();
    this.#metadata=freeze({version:1,session:structuredClone(this.#session),begin:pos(manifest.begin),end:pos(manifest.end),configuration:structuredClone(config),origin:structuredClone(this.#origin),
      receipts:summary.count,receiptDigest:summary.digest,receiptWindows:this.#plans.length,witnesses:commitment.count,witnessPages:this.#pages.length,
      commitment:structuredClone(commitment),checkpoints:structuredClone(manifest.checkpoints),storageAuthenticated:true,nativeAdmitted:false});
    this.#events=this.#rows()[Symbol.asyncIterator]();this.#eventToken=this.#plans.length?this.#token():null;this.#witnessToken=this.#pages.length?this.#token():null;this.#ready=true;
  }
  async *#rows(){
    let previous=pos(this.#manifest.begin);
    for(const chunk of this.#manifest.events){
      this.#anchor={stage:'event-chunk',object:chunk.content.sha256,firstSequence:chunk.first.sequence,lastSequence:chunk.last.sequence};
      const bytes=await readCheckpointObject(this.#source,chunk.content,4*1048576);this.#live();this.#metrics.eventChunkBytes=Math.max(this.#metrics.eventChunkBytes,bytes.length);
      sessionEventReferences(this.#manifestBytes,bytes);
      for(const record of parsed(bytes)){
        this.#anchor={stage:'receipt',object:chunk.content.sha256,sequence:record.sequence,position:pos(record)};let row;
        if(record.kind==='gpu'){
          const intent=parsed(Uint8Array.from(record.intent));need(intent?.version===1&&Object.keys(intent).sort().join(',')==='channel,header,outcome,ticket,version'&&[22,23].includes(intent.channel),'Adapter',this.#anchor);
          row=ownGpuReceipt({...pos(record),channel:intent.channel,outcome:intent.outcome,ticket:intent.ticket,bytes:Uint8Array.from(intent.header)},previous);
        }else row=await decodeInputEventRecord(this.#source,record,previous,{exactMode:true});
        this.#live();this.#metrics.maxReceiptBytes=Math.max(this.#metrics.maxReceiptBytes,row.bytes.length);const parts=gpuEventParts(row);
        need(record.required===true&&record.kind===parts.kind&&record.device===parts.device&&record.status===parts.status&&equal(record.intent,parts.intent)
          &&sameData(record.payload,parts.payload),'AdapterIdentity',this.#anchor);
        need(compare(row,previous)>0&&(row.transition!==previous.transition||row.retired===previous.retired)
          &&compare(row,this.#manifest.end)<=0,'Range',this.#anchor);
        if(parts.body)row.body={...parts.body};previous=pos(row);yield executable(row);this.#live();
      }
    }
    need(previous.sequence===this.#manifest.end.sequence&&BigInt(previous.retired)<=BigInt(this.#manifest.end.retired)
      &&(previous.transition!==this.#manifest.end.transition||previous.retired===this.#manifest.end.retired),'EndCoverage',{stage:'end',position:pos(previous)});
  }
  async #plan(){
    const tickets=new Set(),pending=new Map(this.#origin.pending.map(row=>[row.ticket,row]));let prior=null,count=0,current=null,after=pos(this.#manifest.begin);
    const all=receiptHash();
    const start=()=>({after:pos(after),first:null,last:null,count:0,bytes:0,bodies:new Map(),bodyBytes:0,hash:receiptHash()});
    const seal=()=>{if(!current?.count)return;const index=this.#plans.length,pre=this.#plans.at(-1),range={afterPosition:current.after,firstPosition:current.first,lastPosition:current.last,firstSequence:current.first.sequence,lastSequence:current.last.sequence,count:current.count,ownedReceiptBytes:current.bytes};
      const predecessor={windowIndex:pre?index-1:null,windowDigest:pre?.windowDigest??null,lastPosition:current.after,lastSequence:current.after.sequence};
      const referencedBodies=[...current.bodies.values()],receiptDigest=current.hash.finish();current.hash.free();
      const plan=freeze({index,range,predecessor,referencedBodies,receiptDigest,windowDigest:this.#windowIdentity('receipts',index,range,predecessor,receiptDigest,referencedBodies)});this.#plans.push(plan);
      this.#metrics.preflightWindowRows=Math.max(this.#metrics.preflightWindowRows,current.count);this.#metrics.preflightWindowBytes=Math.max(this.#metrics.preflightWindowBytes,current.bytes);this.#metrics.windowMetadataBytes+=json(plan).length;after=pos(current.last);current=null;
    };
    try{
      for await(const row of this.#rows()){
        need(canonicalTicket(row.ticket)&&!tickets.has(row.ticket),'Ticket',this.#anchor,'noncanonical, exhausted or duplicate ticket');
        if(BigInt(row.ticket)<BigInt(this.#origin.nextTicket)){
          const fact=pending.get(row.ticket);need(fact&&fact.transition===row.transition&&fact.effect.kind==='host'&&row.phase==='before'&&fact.effect.channel===row.channel
            &&fact.effect.length===String(row.bytes.length)&&fact.effect.sha256===checkpointHash(row.bytes),'OriginTicket',this.#anchor);
        }
        if(prior?.phase==='before'&&row.phase==='before'&&prior.transition===row.transition)need(BigInt(row.ticket)>BigInt(prior.ticket),'TicketOrder',this.#anchor);
        // Native scope commit leaves Observe; a new scope requires a reset of
        // transition or ordinal. Consecutive Observe ordinals at one T are one scope.
        if(prior?.phase==='observe'&&row.phase==='observe'&&prior.transition===row.transition)need(BigInt(row.ticket)===BigInt(prior.ticket)+1n,'ObservationTicketOrder',this.#anchor);
        tickets.add(row.ticket);this.#metrics.ticketTextBytes+=row.ticket.length;this.#metrics.ticketCount++;
        if(!current)current=start();
        const sameObserve=current.count&&current.last.phase==='observe'&&row.phase==='observe'&&row.transition===current.last.transition;
        const phaseCut=current.count&&((row.phase==='observe'&&!sameObserve)||(current.last.phase==='observe'&&!sameObserve));
        const newBody=row.body&&!current.bodies.has(row.body.sha256),extraBody=newBody?Number(row.body.length):0;
        if(row.body)need(Number(row.body.length)>0&&Number(row.body.length)<=MAX_BODY,'BodyBound',this.#anchor);
        const over=current.count+1>MAX_ROWS||current.bytes+row.bytes.length>MAX_BYTES||current.bodyBytes+extraBody>MAX_BYTES||current.bodies.size+Number(!!newBody)>MAX_BODIES;
        need(!sameObserve||!over,'ObservationScopeBound',this.#anchor,'atomic observation scope exceeds existing plan bounds');
        if(current.count&&(phaseCut||over)){seal();current=start();}
        current.first??=pos(row);current.last=pos(row);current.count++;current.bytes+=row.bytes.length;
        if(row.body&&!current.bodies.has(row.body.sha256)){current.bodies.set(row.body.sha256,{...row.body});current.bodyBytes+=Number(row.body.length);}
        hashRow(current.hash,row);hashRow(all,row);prior={...pos(row),ticket:row.ticket};count++;
      }
      seal();return {count,digest:all.finish()};
    }finally{current?.hash.free();all.free();}
  }
  #enter(cursor,stream){this.#active();need(!this.#busy,'ReaderBusy',{stream});need(cursor!==null&&cursor===(stream==='receipts'?this.#eventToken:this.#witnessToken),'StaleCursor',{stream,index:stream==='receipts'?this.#eventIndex:this.#witnessIndex});this.#busy=true;}
  async nextReceiptWindow(cursor){
    this.#enter(cursor,'receipts');const plan=this.#plans[this.#eventIndex];
    try{
      const receipts=[],payloads=[],hash=receiptHash();let bytes=0,bodyBytes=0;
      try{
        for(let index=0;index<plan.range.count;index++){const next=await this.#events.next();this.#active();need(!next.done,'EndCoverage',{window:plan.index,index});const row=next.value;receipts.push(row);bytes+=row.bytes.length;hashRow(hash,row);}
        need(bytes===plan.range.ownedReceiptBytes&&hash.finish()===plan.receiptDigest&&same(receipts[0],plan.range.firstPosition)&&same(receipts.at(-1),plan.range.lastPosition),'WindowIdentity',{window:plan.index});
      }finally{hash.free();}
      this.#metrics.receiptWindowRows=Math.max(this.#metrics.receiptWindowRows,receipts.length);this.#metrics.receiptWindowBytes=Math.max(this.#metrics.receiptWindowBytes,bytes);
      for(const ref of plan.referencedBodies){this.#anchor={stage:'window-body',window:plan.index,object:ref.sha256};const body=await readCheckpointObject(this.#source,ref,MAX_BODY);this.#active();bodyBytes+=body.length;payloads.push({sha256:gpuHashBytes(ref.sha256),length:body.length,bytes:body});}
      this.#metrics.gpuBodyWindowCount=Math.max(this.#metrics.gpuBodyWindowCount,payloads.length);this.#metrics.gpuBodyWindowBytes=Math.max(this.#metrics.gpuBodyWindowBytes,bodyBytes);
      if(plan.index===this.#plans.length-1){const end=await this.#events.next();this.#active();need(end.done,'EndCoverage',{window:plan.index});}
      this.#active();this.#eventIndex++;const nextCursor=this.#eventIndex<this.#plans.length?this.#token():null;this.#eventToken=nextCursor;
      return {...structuredClone(plan),version:1,session:structuredClone(this.#session),stream:'receipts',receipts,payloads,nextCursor,nativeAdmitted:false};
    }catch(error){throw this.#failure(error);}finally{this.#busy=false;}
  }
  async nextWitnessWindow(cursor){
    this.#enter(cursor,'witnesses');const index=this.#witnessIndex,ref=this.#pages[index];
    try{
      this.#anchor={stage:'witness-page',index,object:ref.sha256};const bytes=await readCheckpointObject(this.#source,ref,WITNESS_PAGE_BYTES);this.#active();sessionValidateWitnessPage(bytes);const page=parsed(bytes);
      need(page.before===this.#witnessRows&&sameRef(page.previous,index?this.#pages[index-1]:null),'WitnessOrder',this.#anchor);
      const range={afterPosition:this.#witnessPrevious?.lastPosition??null,firstPosition:pos(page.rows[0]),lastPosition:pos(page.rows.at(-1)),firstSequence:page.rows[0].sequence,lastSequence:page.rows.at(-1).sequence,count:page.rows.length,ownedReceiptBytes:bytes.length};
      const predecessor={windowIndex:index?index-1:null,windowDigest:this.#witnessPrevious?.windowDigest??null,lastPosition:range.afterPosition,lastSequence:range.afterPosition?.sequence??null};
      const windowDigest=this.#windowIdentity('witnesses',index,range,predecessor,ref.sha256,[ref]);
      const consumed=this.#witnessRows+page.rows.length;need(consumed<=this.#metadata.witnesses&&(index!==this.#pages.length-1||consumed===this.#metadata.witnesses&&same(page.rows.at(-1),this.#manifest.end)),'WitnessCoverage',this.#anchor);
      this.#active();this.#witnessRows=consumed;this.#witnessIndex++;this.#witnessPrevious={windowDigest,lastPosition:pos(page.rows.at(-1))};const nextCursor=this.#witnessIndex<this.#pages.length?this.#token():null;this.#witnessToken=nextCursor;
      this.#metrics.witnessPageRows=Math.max(this.#metrics.witnessPageRows,page.rows.length);this.#metrics.witnessPageBytes=Math.max(this.#metrics.witnessPageBytes,bytes.length);
      need(page.rows.length<=WITNESS_PAGE_ROWS,'WitnessBound',this.#anchor);
      return {version:1,session:structuredClone(this.#session),stream:'witnesses',index,range,predecessor,reference:{...ref},windowDigest,rows:page.rows.map(row=>({...pos(row),digest:Uint8Array.from(row.digest)})),nextCursor,nativeAdmitted:false};
    }catch(error){throw this.#failure(error);}finally{this.#busy=false;}
  }
}
const privateKey=Symbol('GPU history callback lease');
