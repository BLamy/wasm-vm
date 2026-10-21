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
