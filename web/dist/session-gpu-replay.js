// UI owner for private physical-GPU replay workers. Only the latest completed
// request publishes a canvas; cancellation immediately revokes the old worker.
import {SessionGpuJournal} from './session-gpu-journal.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {PresentationController} from './src/sink/presentation.js';
import {gpuNeed as need,gpuPosition as pos,gpuCompare as compare,validateGpuConfiguration} from './session-gpu-replay-format.js';
export async function openGpuTimelineReplay({store,id,configuration,onPublish=()=>{},onProgress=()=>{},beforeFrame=async()=>{}}){
  const config=validateGpuConfiguration(configuration);need(config.wasm.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256&&config.renderer.buildId===GPU_CHECKPOINT_BUILD_ID,'GPU build unavailable');
  const read=await SessionGpuJournal.readExact(store,id,{configuration:config});
  const controller=new SessionGpuReplayController({read,database:store.databaseName,id,onPublish,onProgress,beforeFrame});
  return {controller,manifest:read.manifest,events:read.receipts,configuration:config};
}
export class SessionGpuReplayController {
  #read;#database;#id;#publish;#progress;#beforeFrame;#selected=null;#active=null;#next=0;
  constructor({read,database,id,onPublish=()=>{},onProgress=()=>{},beforeFrame=async()=>{}}){
    need(read?.admitted&&typeof database==='string','GPU replay requires an admitted local store');this.#read=read;this.#database=database;this.#id=id;this.#publish=onPublish;this.#progress=onProgress;this.#beforeFrame=beforeFrame;
  }
  get end(){return pos(this.#read.manifest.end);}
  get selected(){const s=this.#selected;return s?{position:pos(s.position),checkpointId:s.checkpointId,requestId:s.requestId,rendered:s.rendered}:null;}
  cancel(){this.#active?.cancel();this.#active=null;}
  close(){this.cancel();this.#selected?.worker.terminate();this.#selected?.presentation.dispose();this.#selected=null;}
  forwardStep(){need(this.#selected,'select a GPU position first');return this.seekTransition((BigInt(this.#selected.position.transition)+1n).toString());}
  reverseStep(){need(this.#selected,'select a GPU position first');return this.seekTransition((BigInt(this.#selected.position.transition)-1n).toString());}
  seekTransition(transition){need(typeof transition==='string'&&/^(0|[1-9][0-9]*)$/.test(transition)&&BigInt(transition)>=BigInt(this.#read.manifest.begin.transition)&&BigInt(transition)<=BigInt(this.#read.manifest.end.transition),'GPU seek transition');return this.#request({transition,transitionOnly:true});}
  seekPosition(target){need(target?.phase==='before'&&compare(target,this.#read.manifest.begin)>=0&&compare(target,this.#read.manifest.end)<=0,'GPU seek position');return this.#request(pos(target));}
  #request(target){
    this.cancel();const requestId=++this.#next;
    let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const worker=new Worker(new URL('./session-gpu-replay-worker.js',import.meta.url),{type:'module'});
    let point=this.#read.manifest.checkpoints[0];for(const candidate of this.#read.manifest.checkpoints.slice(1)){
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
        const rendered={position:pos(value.position),digest:value.digest,console:value.console,canvas,gpu:value.gpu,presentation:presentation.snapshot()};
        await this.#beforeFrame(rendered);if(!owns()){presentation.dispose();return;}
        const selected={worker,presentation,position:pos(value.position),checkpointId:point.id,requestId,rendered};
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
