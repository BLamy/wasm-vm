// UI owner for private physical-GPU replay workers. Only the latest completed
// request publishes a canvas; cancellation immediately revokes the old worker.
import {SessionGpuJournal} from './session-gpu-journal.js';
import {SessionGpuHistoryReader} from './session-gpu-history-reader.js';
import {witnessCommitment} from './session-witness-pages.js';
import {checkpointHash} from './session-checkpoints.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {PresentationController} from './src/sink/presentation.js';
import {gpuNeed as need,gpuPosition as pos,gpuCompare as compare,validateGpuConfiguration} from './session-gpu-replay-format.js';
export async function openGpuTimelineReplay({store,id,configuration,onPublish=()=>{},onProgress=()=>{},beforeFrame=async()=>{}}){
  const config=validateGpuConfiguration(configuration);need(config.wasm.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256&&config.renderer.buildId===GPU_CHECKPOINT_BUILD_ID,'GPU build unavailable');
  const opened=await store.openSession(id);need(opened,'GPU session missing');
  const manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
  const read=witnessCommitment(manifest)?await SessionGpuHistoryReader.withOpen(store,id,{},async reader=>{
    const metadata=reader.metadata;
    need(metadata.session.manifestSha256===checkpointHash(opened.manifest)
      &&JSON.stringify(metadata.configuration)===JSON.stringify(config),'GPU history changed or configuration differs');
    const events=[];let cursor=reader.initialEventCursor;
    while(cursor){const window=await reader.nextReceiptWindow(cursor);
      for(const row of window.receipts)events.push({sequence:row.sequence,kind:row.kind,transition:row.transition,
        phase:row.phase,ordinal:row.ordinal,retired:row.retired});
      cursor=window.nextCursor;
    }
    need(events.length===metadata.receipts,'GPU history event navigation coverage');
    return {manifest,receipts:events,admitted:true,paged:true};
  }):await SessionGpuJournal.readExact(store,id,{configuration:config});
  const controller=new SessionGpuReplayController({read,database:store.databaseName,id,onPublish,onProgress,beforeFrame});
  return {controller,manifest:read.manifest,events:read.receipts,configuration:config};
}
export class SessionGpuReplayController {
  #read;#database;#id;#publish;#progress;#beforeFrame;#selected=null;#active=null;#next=0;
  #captures=new Map();#captureId=0;
  constructor({read,database,id,onPublish=()=>{},onProgress=()=>{},beforeFrame=async()=>{}}){
    need(read?.admitted&&typeof database==='string','GPU replay requires an admitted local store');this.#read=read;this.#database=database;this.#id=id;this.#publish=onPublish;this.#progress=onProgress;this.#beforeFrame=beforeFrame;
  }
  get end(){return pos(this.#read.manifest.end);}
  get selected(){const s=this.#selected;return s?{position:pos(s.position),checkpointId:s.checkpointId,requestId:s.requestId,rendered:s.rendered}:null;}
  get canContinue(){return Boolean(this.#selected?.continuationReady&&!this.#active);}
  cancel(){for(const cancel of [...this.#captures.values()])cancel();this.#active?.cancel();this.#active=null;}
  close(){this.cancel();this.#selected?.worker.terminate();this.#selected?.presentation.dispose();this.#selected=null;}
  forwardStep(){need(this.#selected,'select a GPU position first');return this.seekTransition((BigInt(this.#selected.position.transition)+1n).toString());}
  reverseStep(){need(this.#selected,'select a GPU position first');return this.seekTransition((BigInt(this.#selected.position.transition)-1n).toString());}
  seekTransition(transition){need(typeof transition==='string'&&/^(0|[1-9][0-9]*)$/.test(transition)&&BigInt(transition)>=BigInt(this.#read.manifest.begin.transition)&&BigInt(transition)<=BigInt(this.#read.manifest.end.transition),'GPU seek transition');return this.#request({transition,transitionOnly:true});}
  seekPosition(target){need(target?.phase==='before'&&compare(target,this.#read.manifest.begin)>=0&&compare(target,this.#read.manifest.end)<=0,'GPU seek position');return this.#request(pos(target));}
  captureSelectedBranch({signal}={}){
    need(this.canContinue&&!signal?.aborted,'select an available completed GPU point before continuing');
    const selected=this.#selected,captureId=++this.#captureId,worker=selected.worker;
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const cleanup=()=>{done=true;clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',error);signal?.removeEventListener('abort',cancel);this.#captures.delete(captureId);};
      const fail=value=>{if(done)return;cleanup();reject(value);};
      const cancel=()=>fail(Error('GPU continuation capture cancelled'));
      const error=event=>fail(Error(event.message||'GPU continuation worker failed'));
      const message=event=>{
        const value=event.data;if(value.captureId!==captureId||value.requestId!==selected.requestId||done)return;
        if(value.type==='branch-error'){fail(Error(value.message));return;}
        if(value.type!=='branch-captured')return;
        try{
          need(this.#selected===selected&&this.canContinue&&!signal?.aborted,'GPU source selection changed');
          need(compare(value.position,selected.position)===0&&value.console===selected.rendered.console,'GPU source view changed');
          cleanup();resolve(value);
        }catch(error){fail(error);}
      };
      this.#captures.set(captureId,cancel);worker.addEventListener('message',message);worker.addEventListener('error',error);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>fail(Error('GPU continuation capture timed out')),30000);
      try{worker.postMessage({type:'capture-branch',requestId:selected.requestId,captureId});}catch(error){fail(error);}
    });
  }
  inspectSelected({signal}={}){
    need(this.#selected&&!this.#active&&!signal?.aborted,'select a completed GPU point before inspection');
    const selected=this.#selected,worker=selected.worker,inspectionId=++this.#captureId;
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const cleanup=()=>{done=true;clearTimeout(timer);worker.removeEventListener('message',message);
        worker.removeEventListener('error',error);signal?.removeEventListener('abort',cancel);this.#captures.delete(inspectionId);};
      const fail=value=>{if(done)return;cleanup();reject(value);};
      const cancel=()=>fail(Error('GPU selected inspection cancelled'));
      const error=event=>fail(Error(event.message||'GPU inspection worker failed'));
      const message=event=>{const value=event.data;
        if(done||value.inspectionId!==inspectionId||value.requestId!==selected.requestId)return;
        if(value.type==='inspection-error'){fail(Error(value.message));return;}
        if(value.type!=='selected-inspection')return;
        try{need(this.#selected===selected&&!this.#active&&!signal?.aborted
          &&compare(value.position,selected.position)===0,'GPU selected inspection changed');
          cleanup();resolve(value);
        }catch(cause){fail(cause);}
      };
      this.#captures.set(inspectionId,cancel);worker.addEventListener('message',message);worker.addEventListener('error',error);
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>fail(Error('GPU selected inspection timed out')),30000);
      try{worker.postMessage({type:'inspect-selected',requestId:selected.requestId,inspectionId});}catch(cause){fail(cause);}
    });
  }
  #request(target){
    this.cancel();const requestId=++this.#next;
    let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const worker=new Worker(new URL('./session-gpu-replay-worker.js',import.meta.url),{type:'module'});
    let point=this.#read.manifest.checkpoints[0];for(const candidate of (this.#read.paged?[]:this.#read.manifest.checkpoints.slice(1))){
      const eligible=target.transitionOnly?BigInt(candidate.position.transition)<=BigInt(target.transition):compare(candidate.position,target)<=0;
      if(eligible)point=candidate;}
    let startupTimer;
    const job={requestId,worker,done:false,cancel(){if(!this.done){this.done=true;clearTimeout(startupTimer);worker.terminate();resolve({status:'cancelled',requestId});}}};this.#active=job;
    const owns=()=>this.#active===job&&!job.done;
    const fail=error=>{if(owns()){job.done=true;clearTimeout(startupTimer);worker.terminate();this.#active=null;reject(error);}};
    worker.onerror=event=>{event.preventDefault();fail(Error(event.message));};
    worker.onmessage=async event=>{
      const value=event.data;if(!owns())return;
      if(value.type==='initialized'){
        clearTimeout(startupTimer);
        worker.postMessage({type:'seek',requestId,database:this.#database,sessionId:this.#id,checkpointId:point.id,target,quantum:4096});return;
      }
      if(value.requestId!==requestId)return;
      if(value.type==='progress'){this.#progress(`Replaying GPU transition ${value.position.transition}`,{requestId});return;}
      if(value.type==='error'){fail(Error(value.message));return;}
      if(value.type!=='ready')return;
      let presentation;
      try{
        const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.setAttribute('aria-label','Replayed GPU display');canvas.style.maxWidth='100%';canvas.style.height='auto';
        presentation=new PresentationController(canvas,{scheduleFrames:false});
        if(value.frame){const before=presentation.snapshot().drawnPresents;need(presentation.present(value.frame)&&presentation.snapshot().drawnPresents>before,'actual selected GPU frame could not be painted');}
        const rendered={position:pos(value.position),digest:value.digest,console:value.console,canvas,gpu:value.gpu,presentation:presentation.snapshot(),replay:value.replay??null};
        await this.#beforeFrame(rendered);if(!owns()){presentation.dispose();return;}
        const selected={worker,presentation,position:pos(value.position),checkpointId:point.id,requestId,rendered,continuationReady:value.continuationReady===true};
        this.#publish(selected);if(!owns()){presentation.dispose();return;}
        const previous=this.#selected;this.#selected=selected;job.done=true;this.#active=null;previous?.worker.terminate();previous?.presentation.dispose();
        resolve({status:'ready',position:selected.position,checkpointId:point.id,requestId,rendered});
      }catch(error){presentation?.dispose();fail(error);}
    };
    this.#progress(`Restoring GPU checkpoint ${point.id}`,{requestId});
    startupTimer=setTimeout(()=>fail(Error('GPU replay worker did not initialize')),30000);
    return result;
  }
}
