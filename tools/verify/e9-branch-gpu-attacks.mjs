// Bounded faults against real physical-GPU continuations, not a mock worker.
import {createSessionBranch} from '/session-branches.js';
import {SessionGpuJournal} from '/session-gpu-journal.js';
import {PresentationController} from '/src/sink/presentation.js';
import {checkpointHash} from '/session-checkpoints.js';
const need=(value,message)=>{if(!value)throw Error(message);};
const refusal=async action=>{try{await action();}catch(error){return error.message;}throw Error('Fault did not refuse');};
const pixel=view=>[...view.canvas.getContext('2d').getImageData(32,32,1,1).data];
const complete=manifest=>manifest.extensions.some(value=>value.kind==='e9-exact-state-witnesses-v1');
export async function gpuBranchAttacks(proof){
 const {store,timeline}=proof,parent=timeline.owner,parentHash=checkpointHash((await store.openSession(parent.id)).manifest),results=[];
 // Exercise the no-yield guard in the real final IndexedDB transaction.
 for(const kind of ['promise-authorizer','thenable-authorizer']){
  const before=await store.openSession(parent.id),writer=await store.writer(parent.id);let hit=0,thenCalls=0,failure,code;
  try{
   try{await writer.publish(before.manifest,null,()=>{hit++;return kind==='promise-authorizer'?Promise.resolve(true):{then(){thenCalls++;}};});}
   catch(error){failure=error.message;code=error.code;}
   need(hit===1&&code==='PublicationGuard'&&thenCalls===0,'a yielding final authorizer was not refused synchronously');
  }finally{await writer.release();}
  const after=await store.openSession(parent.id);need(after.revision===before.revision&&checkpointHash(after.manifest)===parentHash,'yielding final authorizer changed the session');
  results.push({kind,hit,code,failure,thenCalls,unchangedRevision:after.revision});
 }
 for(const kind of ['missing-retained-wasm','existing-session-id','foreign-renderer-build']){
  console.log('GPU branch refusal: '+kind);
  const before=(await store.list()).sessions.map(row=>row.id).sort(),old=await store.openSession(parent.id),stream=store.stream,WorkerClass=globalThis.Worker;
  const id=kind==='existing-session-id'?parent.id:'gpu-refusal-'+kind;
  let streamHit=0,workers=0,failure,unexpected;
  globalThis.Worker=class extends WorkerClass{constructor(...args){super(...args);if(new URL(String(args[0]),location).pathname.endsWith('/session-gpu-branch-worker.js'))workers++;}};
  if(kind==='missing-retained-wasm'){
   const ref=parent.manifest.assets.find(asset=>asset.role==='wasm').content;
   store.stream=function(expected){if(expected.sha256===ref.sha256){streamHit++;throw Error('intentional unavailable retained Wasm');}return stream.call(this,expected);};
  }
  const source=kind==='foreign-renderer-build'?{...parent,configuration:{...parent.configuration,renderer:{...parent.configuration.renderer,buildId:'00'.repeat(32)}}}:parent;
  try{try{unexpected=await createSessionBranch({store,parent:source,id});}catch(error){failure=error.message;}}
  finally{store.stream=stream;globalThis.Worker=WorkerClass;if(unexpected)await unexpected.discard();}
  need(!unexpected&&failure,'invalid creation was admitted');
  if(kind==='missing-retained-wasm')need(streamHit===1&&workers===0&&/unavailable retained Wasm/.test(failure),'missing asset did not refuse before worker startup');
  if(kind==='existing-session-id')need(workers===0&&/session ID already exists/.test(failure),'ID collision did not preserve the existing owner');
  if(kind==='foreign-renderer-build')need(workers===1&&/build unavailable/.test(failure),'foreign build did not reach the fresh worker refusal');
  const after=(await store.list()).sessions.map(row=>row.id).sort(),saved=await store.openSession(parent.id);
  need(JSON.stringify(before)===JSON.stringify(after)&&saved.revision===old.revision&&checkpointHash(saved.manifest)===parentHash,'failed creation changed local history');
  results.push({kind,streamHit,workers,failure,sameSessions:true,unchangedRevision:saved.revision});
 }
 // A wrapper only observes getContext and invokes WEBGL_lose_context; it imports
 // the unchanged production branch worker for all execution and error handling.
 {
  console.log('GPU branch fault: real worker context loss');
  const WorkerClass=globalThis.Worker,id='gpu-fault-context-loss';let worker,branch;
  globalThis.Worker=class extends WorkerClass{constructor(url,options){
   const branchUrl=new URL(String(url),location).pathname.endsWith('/session-gpu-branch-worker.js');
   super(branchUrl?new URL('/__verify__/branch-context-loss-worker.mjs',location):url,options);if(branchUrl)worker=this;
  }};
  try{
   branch=await createSessionBranch({store,parent,id});need(worker,'no real branch worker was created');
   const event=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('real branch context-loss event timed out')),10000);
    worker.addEventListener('message',message=>{if(message.data.type==='verify-branch-context-lost'&&message.data.id===id){clearTimeout(timeout);resolve(message.data);}});
    worker.postMessage({type:'verify-branch-context-loss',id});
   });
   need(event.lost===true&&!event.error,'real worker WebGL context was not lost');
   const failure=await refusal(()=>branch.advance(64));need(/context.*lost/i.test(failure),'lost context did not stop real execution');
   const stopped=await refusal(()=>branch.view());await refusal(()=>branch.finish());
   need(!complete(JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest))),'lost context published a completed child');
   results.push({kind:'context-loss',lost:true,failure,stopped,finalManifest:false});
  }finally{globalThis.Worker=WorkerClass;await branch?.discard();}
  need(!await store.openSession(id)&&checkpointHash((await store.openSession(parent.id)).manifest)===parentHash,'lost context damaged retained history');
 }
 for(const kind of ['journal','paint-advance','paint-finish','cancel-final-put']){
  console.log('GPU branch fault: '+kind);
  const id='gpu-fault-'+kind,branch=await createSessionBranch({store,parent,id}),present=PresentationController.prototype.present,
   stage=SessionGpuJournal.prototype.stage,finish=SessionGpuJournal.prototype.completeExact;
  let armed=false,hit=0,discard,failure,finalizing=false;
  const canvas=branch.preview().canvas;
  try{
   await branch.sendInput(new TextEncoder().encode('A\n'));
   if(kind==='journal')SessionGpuJournal.prototype.stage=function(batch){
    if(armed&&!hit&&batch.events.some(row=>row.channel===22&&row.outcome[1]==='20')){hit++;throw Error('intentional GPU journal fault');}
    return stage.call(this,batch);
   };
   if(kind==='paint-advance'||kind==='paint-finish')PresentationController.prototype.present=function(frame){
    if(armed&&!hit&&this.canvas===canvas){hit++;return false;}return present.call(this,frame);
   };
   armed=kind==='journal'||kind==='paint-advance';
   for(let step=0;step<8;step++){
    try{await branch.advance(1048576);}catch(error){failure=error.message;break;}
    if(branch.preview().console.includes('BRANCH_GPU_DONE_A'))break;
   }
   if(kind==='journal'){
    need(hit===1&&failure==='intentional GPU journal fault','fresh flush did not exercise the journal fault');
    const paused=await branch.view(),pausedPixel=pixel(paused);need(JSON.stringify(pausedPixel)==='[0,0,255,255]','paused view lost the fresh physical blue frame after a journal failure');
    await branch.advance(64);const end=await branch.finish();
    const {openTimelineReplay}=await import('/session-timeline-runtime.js'),replay=await openTimelineReplay({store,id});
    try{await replay.controller.seekPosition(replay.manifest.end);need(replay.controller.selected.rendered.digest===end.digest,'retried journal lost its exact state');need(JSON.stringify(pixel(replay.controller.selected.rendered))==='[0,0,255,255]','retried journal lost its physical frame');}finally{replay.controller.close();}
    results.push({kind,hit,failure,recoveredDigest:end.digest,pixel:pausedPixel});
   }else if(kind==='paint-advance'){
    need(hit===1&&/could not be painted/.test(failure),'new frame did not exercise paint refusal');
    const stopped=await refusal(()=>branch.view());await refusal(()=>branch.finish());
    need(!complete(JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest))),'paint failure published a final manifest');
    results.push({kind,hit,failure,stopped,finalManifest:false});
   }else{
    need(branch.preview().console.includes('BRANCH_GPU_DONE_A'),'guest second wave did not finish');
    if(kind==='paint-finish'){
     armed=true;failure=await refusal(()=>branch.finish());need(hit===1&&/could not be painted/.test(failure),'final frame paint fault not reached');
     need(!complete(JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest))),'failed final paint published a completed child');
     results.push({kind,hit,failure,finalManifest:false});
    }else{
     SessionGpuJournal.prototype.completeExact=function(...args){finalizing=true;return finish.apply(this,args);};
     globalThis.__e9SessionStoreProbe=event=>{if(finalizing&&event.id===id&&event.phase==='before-final-authorize'&&!hit++){discard=branch.discard();}};
     failure=await refusal(()=>branch.finish());need(hit===1&&discard,'final put cancellation was not reached');await discard;
     need(!await store.openSession(id),'cancelled final put retained a child');results.push({kind,hit,failure,finalManifest:false});
    }
   }
  }finally{
   PresentationController.prototype.present=present;SessionGpuJournal.prototype.stage=stage;SessionGpuJournal.prototype.completeExact=finish;delete globalThis.__e9SessionStoreProbe;
   await branch.discard();if(await store.openSession(id))await store.deleteSession(id);
  }
  need(checkpointHash((await store.openSession(parent.id)).manifest)===parentHash,'fault changed parent history');
 }
 // Revoke an actual fresh owner after its initial manifest exists, before adoption.
 const before=(await store.list()).sessions.map(row=>row.id).sort(),create=SessionGpuJournal.createBranchExact;
 let reach,release,hit=0,candidateId,start;
 const reached=new Promise(resolve=>{reach=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 SessionGpuJournal.createBranchExact=async function(...args){
  const journal=await create.apply(this,args);hit++;candidateId=args[1].id;
  need(!!await store.openSession(candidateId),'creation barrier did not reach a saved initial manifest');
  reach();await gate;return journal;
 };
 try{
  start=timeline.continueHere();await Promise.race([reached,start.then(()=>{throw Error('creation completed without reaching its barrier');})]);
  need(hit===1&&candidateId&&!timeline.branch,'creation barrier did not precede owner adoption');
  await timeline.discardBranch();release();await start;
  need(!await store.openSession(candidateId),'cancelled prepared owner retained its initial manifest');
 }finally{SessionGpuJournal.createBranchExact=create;release();await start?.catch(()=>{});}
 const after=(await store.list()).sessions.map(row=>row.id).sort();need(JSON.stringify(before)===JSON.stringify(after),'cancelled creation retained a session');
 need(checkpointHash((await store.openSession(parent.id)).manifest)===parentHash,'cancelled creation changed parent');
 results.push({kind:'cancel-creation',phase:'initial-manifest-before-adoption',hit,candidateId,sameSessions:true});return results;
}
