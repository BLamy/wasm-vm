// Private GPU execution lives in a worker; the page owns the writer and publication checks.
import {sessionValidateLocalManifest} from './session-pkg/wasm_vm_session.js';
import {SessionGpuJournal} from './session-gpu-journal.js';
import {checkpointHash,readCheckpointObject} from './session-checkpoints.js';
import {branchOrigin,sameBranchPosition} from './session-branch-format.js';
import {gpuEventParts,gpuHex} from './session-gpu-replay-format.js';
import {PresentationController} from './src/sink/presentation.js';
const encoder=new TextEncoder(),need=(value,message)=>{if(!value)throw Error('GPU continuation: '+message);};
class BranchWorker {
  #worker;#ready;#jobs=new Map();#next=0;#closed=false;#initResolve;#initReject;#timer;
  constructor(){
    this.#worker=new Worker(new URL('./session-gpu-branch-worker.js',import.meta.url),{type:'module'});
    this.#ready=new Promise((resolve,reject)=>{this.#initResolve=resolve;this.#initReject=reject;});
    // Install a rejection handler even if a caller aborts before awaiting readiness.
    void this.#ready.catch(()=>{});
    this.#timer=setTimeout(()=>this.close(Error('GPU continuation worker did not initialize')),30000);
    this.#worker.onmessage=event=>{
      const value=event.data;
      if(value.type==='initialized'){clearTimeout(this.#timer);this.#initResolve();return;}
      const job=this.#jobs.get(value.requestId);if(!job)return;
      clearTimeout(job.timer);this.#jobs.delete(value.requestId);
      if(value.type==='error'){const error=Error(value.message);error.stopped=value.stopped===true;job.reject(error);}else job.resolve(value);
    };
    this.#worker.onerror=event=>{event.preventDefault();this.close(Error(event.message||'GPU continuation worker failed'));};
  }
  async request(type,data={},transfer=[]){
    await this.#ready;need(!this.#closed,'worker is closed');const requestId=++this.#next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.close(Error('GPU continuation action timed out')),30000);
      this.#jobs.set(requestId,{resolve,reject,timer});
      try{this.#worker.postMessage({type,requestId,...data},transfer);}catch(error){clearTimeout(timer);this.#jobs.delete(requestId);reject(error);}
    });
  }
  close(error=Error('GPU continuation was closed')){
    if(this.#closed)return;this.#closed=true;error.stopped=true;clearTimeout(this.#timer);this.#initReject(error);
    for(const job of this.#jobs.values()){clearTimeout(job.timer);job.reject(error);}this.#jobs.clear();this.#worker.terminate();
  }
}
function splitBatch(batch){
  need(Array.isArray(batch?.events)&&Array.isArray(batch?.payloads),'recording batch');
  const used=new Set(batch.events.flatMap(row=>{const body=gpuEventParts(row).body;return body?[body.sha256]:[];}));
  need(batch.payloads.every(body=>used.has(gpuHex(body.sha256))),'unreferenced recording body');
  const parts=[];
  for(let at=0;at<batch.events.length;at+=64){const events=batch.events.slice(at,at+64),needed=new Set(events.flatMap(row=>{const body=gpuEventParts(row).body;return body?[body.sha256]:[];}));
    parts.push({events,payloads:batch.payloads.filter(body=>needed.has(gpuHex(body.sha256)))});}
  return parts;
}
export async function createGpuSessionBranch({store,parent,id,signal,onProgress=()=>{}}){
  const selected=await parent.controller.captureSelectedBranch({signal});
  const check=()=>need(!signal?.aborted&&parent.controller.selected?.requestId===selected.requestId&&parent.controller.canContinue,'creation cancelled or source selection changed');check();
  const parentManifestSha256=checkpointHash(sessionValidateLocalManifest(encoder.encode(JSON.stringify(selected.parentManifest))));
  const opened=await store.openSession(parent.id);check();need(opened&&checkpointHash(opened.manifest)===parentManifestSha256,'saved source history changed');
  const configuration=JSON.parse(JSON.stringify(parent.configuration));
  configuration.branchOrigin=branchOrigin({parentId:parent.id,parentManifestSha256,sourceDigestSha256:gpuHex(selected.capture.sourceDigest),position:selected.position,consolePrefix:selected.consolePrefix});
  const assets={};
  for(const [role,savedRole]of [['kernel','kernel'],['wasm','wasm'],['renderer','gpu-renderer']]){
    const ref=selected.parentManifest.assets.find(value=>value.role===savedRole)?.content;need(ref,'local '+role+' asset missing');
    assets[role]=await readCheckpointObject(store,ref,role==='renderer'?1048576:64*1048576);check();
  }
  let writer,worker,created=false,abort;
  try{
    onProgress('Preparing a private GPU continuation…');writer=await store.writer(id);check();
    need(!await store.openSession(id),'session ID already exists');check();created=true;
    worker=new BranchWorker();abort=()=>worker.close(Error('GPU continuation creation cancelled'));signal?.addEventListener('abort',abort,{once:true});check();
    const kernel=assets.kernel.slice(),wasm=assets.wasm.slice(),transfer=[kernel,wasm,...Object.values(selected.capture).filter(value=>value instanceof Uint8Array),selected.renderer.bytes].map(bytes=>bytes.buffer);
    const candidate=await worker.request('prepare',{database:store.databaseName,configuration,kernel,wasm,capture:selected.capture,renderer:selected.renderer},[...new Set(transfer)]);check();
    need(sameBranchPosition(candidate.view.position,selected.position)&&candidate.view.console===selected.console,'restored source view differs');
    const journal=await SessionGpuJournal.createBranchExact(store,writer,configuration,candidate.prepared,assets,check);check();
    const initial=journal.initialWitness,activated=await worker.request('activate');check();
    need(sameBranchPosition(activated.view.position,initial)&&activated.view.digest===gpuHex(initial.digest),'initial GPU state changed during publication');
    signal?.removeEventListener('abort',abort);
    const branch=new GpuSessionBranch({store,id,writer,worker,journal,initial,view:candidate.view});writer=null;worker=null;return branch;
  }catch(error){
    signal?.removeEventListener('abort',abort);worker?.close();await writer?.release();if(created)await store.deleteSession(id);throw error;
  }
}
class GpuSessionBranch {
  #store;#id;#writer;#worker;#journal;#initial;#canvas;#presentation;#view;#taken=[];
  #serial=Promise.resolve();#closed=false;#failed=false;#saved=false;#released=false;#discarding=null;
  constructor({store,id,writer,worker,journal,initial,view}){
    this.#store=store;this.#id=id;this.#writer=writer;this.#worker=worker;this.#journal=journal;this.#initial=initial;
    this.#canvas=document.createElement('canvas');this.#canvas.width=1;this.#canvas.height=1;this.#canvas.setAttribute('aria-label','Continuation GPU display');this.#canvas.style.maxWidth='100%';this.#canvas.style.height='auto';
    this.#presentation=new PresentationController(this.#canvas,{scheduleFrames:false});this.#apply(view);
  }
  get id(){return this.#id;}
  get offline(){return true;}
  #open(){need(!this.#closed&&!this.#failed,'owner is closed or stopped');}
  #queue(action){const operation=this.#serial.catch(()=>{}).then(()=>{this.#open();return action();});this.#serial=operation;return operation;}
  async #request(type,data={},transfer=[]){try{return await this.#worker.request(type,data,transfer);}catch(error){if(error.stopped)this.#failed=true;throw error;}}
  async #consume(batch=null){
    if(batch)this.#taken.push(...splitBatch(batch));
    while(this.#taken.length){if(this.#journal.pending>=128)await this.#journal.flush();this.#journal.stage(this.#taken[0]);this.#taken.shift();}
  }
  #apply(view){
    try{
      if(view.frameChanged){
        if(view.frame)need(this.#presentation.present(view.frame),'physical GPU frame could not be painted');
        else{this.#presentation.dispose();this.#canvas.width=1;this.#canvas.height=1;this.#presentation=new PresentationController(this.#canvas,{scheduleFrames:false});}
      }
    }catch(error){
      // No later digest/view may claim pixels after an unaccepted physical frame.
      this.#failed=true;this.#worker.close();this.#presentation.dispose();this.#canvas.width=1;this.#canvas.height=1;throw error;
    }
    const {frame,frameChanged,...state}=view;this.#view={...state,canvas:this.#canvas,presentation:this.#presentation.snapshot()};
  }
  sendInput(bytes){
    need(bytes instanceof Uint8Array&&bytes.buffer instanceof ArrayBuffer&&bytes.length<=65536,'owned input bound');const copy=bytes.slice();
    return this.#queue(async()=>{await this.#consume();const result=await this.#request('input',{bytes:copy},[copy.buffer]);this.#apply(result.view);await this.#consume(result.batch);});
  }
  advance(steps=32768){
    need(Number.isInteger(steps)&&steps>0&&steps<=1048576,'work bound');
    return this.#queue(async()=>{await this.#consume();const result=await this.#request('advance',{steps});this.#apply(result.view);await this.#consume(result.batch);return result.view.position;});
  }
  view(){return this.#queue(async()=>{const result=await this.#request('view');this.#apply(result.view);return this.#view;});}
  preview(){this.#open();return {...this.#view,position:{...this.#view.position},digest:null};}
  goLive(){return this.#queue(()=>this.#request('go-live'));}
  async #release(){
    if(this.#released)return;
    try{await this.#writer.release();}finally{this.#worker.close();this.#presentation.dispose();this.#released=true;}
  }
  finish(){return this.#queue(async()=>{
    await this.#consume();const result=await this.#request('finish');this.#apply(result.view);await this.#consume(result.batch);await this.#journal.flush();
    need(!sameBranchPosition(result.end,this.#initial),'run the continuation before saving');
    await this.#journal.completeExact(result.end,[this.#initial,result.end],()=>this.#open());this.#saved=true;
    const saved={id:this.#id,...this.#view};this.#closed=true;await this.#release();return saved;
  });}
  discard(){
    if(this.#discarding)return this.#discarding;
    this.#closed=true;this.#worker.close();this.#discarding=(async()=>{await this.#serial.catch(()=>{});await this.#release();if(!this.#saved)await this.#store.deleteSession(this.#id);})();return this.#discarding;
  }
}
