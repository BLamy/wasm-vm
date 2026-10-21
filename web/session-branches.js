// A continuation always owns a fresh recorder; a selected replay is only a source of copied bytes.
import {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {sessionValidateManifest} from './session-pkg/wasm_vm_session.js';
import {SessionInputJournal} from './session-inputs.js';
import {checkpointHash,readCheckpointObject} from './session-checkpoints.js';
import {branchOrigin,sameBranchPosition} from './session-branch-format.js';
import {renderReplayConsole} from './session-timeline-runtime.js';
const encoder=new TextEncoder(),need=(v,message)=>{if(!v)throw Error('Continuation: '+message);};
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

export async function createSessionBranch({store,parent,id='branch-'+crypto.randomUUID(),signal,onProgress=()=>{}}){
  if(parent.manifest.machine.gpu){
    const {createGpuSessionBranch}=await import('./session-gpu-branches.js');
    return createGpuSessionBranch({store,parent,id,signal,onProgress});
  }
  // This call copies the native state synchronously, before any await can retire the selection.
  const selected=parent.controller.captureSelectedBranch(),check=()=>{
    need(!signal?.aborted&&parent.controller.selected?.requestId===selected.requestId&&parent.controller.canContinue,'creation was cancelled or the source selection changed');
  };
  check();
  const parentManifestSha256=checkpointHash(sessionValidateManifest(encoder.encode(JSON.stringify(selected.parentManifest))));
  const opened=await store.openSession(parent.id);check();
  need(opened&&checkpointHash(opened.manifest)===parentManifestSha256,'saved source history changed');
  const configuration=JSON.parse(JSON.stringify(parent.configuration));
  configuration.branchOrigin=branchOrigin({parentId:parent.id,
    parentManifestSha256,
    sourceDigestSha256:hex(selected.capture.sourceDigest),position:selected.position,consolePrefix:selected.consolePrefix});
  const assets={};
  for(const role of ['kernel','wasm']){
    const ref=selected.parentManifest.assets.find(a=>a.role===role)?.content;need(ref,'local '+role+' asset is missing');
    assets[role]=await readCheckpointObject(store,ref,64*1048576);check();
  }
  let machine,writer,created=false;
  try{
    onProgress('Preparing a private continuation…');
    writer=await store.writer(id);check();need(!await store.openSession(id),'session ID already exists');check();created=true;
    machine=WasmLinux.newExactSession(assets.kernel,configuration.imageManifest,configuration.bootargs,()=>{},false);
    machine.beginExactBranch(selected.capture.native,{pending:selected.capture.pending,output:selected.capture.output});
    need(machine.exactBranchNetworkOffline(),'offline policy was not installed');
    const initial=machine.exactSessionWitness(true);
    need(sameBranchPosition(initial,selected.position),'restored position differs from the source');
    const view=renderReplayConsole({receipts:[],consolePrefix:Uint8Array.from(configuration.branchOrigin.consolePrefix)},machine,initial);
    need(view.console===selected.console,'copied console differs from the selected source');
    const journal=await SessionInputJournal.createBranchExact(store,writer,configuration,selected.capture,initial,assets,check);check();
    const branch=new SoftwareSessionBranch({store,id,machine,writer,journal,configuration,initial});
    machine=null;writer=null;return branch;
  }catch(error){
    machine?.free();await writer?.release();if(created)await store.deleteSession(id);throw error;
  }
}

class SoftwareSessionBranch {
  #store;#id;#machine;#writer;#journal;#configuration;#initial;#rows=[];#taken=[];
  #serial=Promise.resolve();#closed=false;#saved=false;#freed=false;#discarding=null;
  constructor({store,id,machine,writer,journal,configuration,initial}){
    this.#store=store;this.#id=id;this.#machine=machine;this.#writer=writer;this.#journal=journal;this.#configuration=configuration;
    const {resume,...state}=initial;this.#initial=state;
  }
  get id(){return this.#id;}
  get offline(){return true;}
  #queue(action){const operation=this.#serial.catch(()=>{}).then(()=>{need(!this.#closed,'owner is closed');return action();});this.#serial=operation;return operation;}
  async #collect(){
    this.#taken.push(...this.#machine.takeExactSessionDeliveries());
    while(this.#taken.length){
      if(this.#journal.pending>=128)await this.#journal.flush();
      const batch=this.#taken.slice(0,64);need(this.#rows.length+batch.length<=4096,'recording reached its event limit');
      this.#journal.stage(batch);this.#taken.splice(0,batch.length);
      this.#rows.push(...batch.map(row=>({...row,kind:[17,18].includes(row.channel)?'observation':'host'})));
    }
  }
  async #localBlocks(){
    for(const request of this.#machine.exactDeviceRequests()){
      need(request.intent.kind==='block','this host device needs a separate service');
      const lease=this.#machine.exactLeaseDeviceRequest(request.id);
      try{
        // A branch never opens a remote base URL or a guest network transport.
        const ref={sha256:request.intent.content.sha256,length:String(request.intent.content.length)};
        let bytes;try{bytes=await readCheckpointObject(this.#store,ref,1048576);}catch{
          throw Error('This disk chunk is not retained locally. The continuation stays offline.');
        }
        need(!this.#closed,'owner was closed while reading a disk chunk');
        this.#machine.exactCompleteDeviceRequest(lease,0,0,bytes);await this.#collect();
      }finally{lease.free();}
    }
  }
  sendInput(bytes){
    need(bytes instanceof Uint8Array&&bytes.buffer instanceof ArrayBuffer&&bytes.length<=65536,'input bound');
    const owned=bytes.slice();return this.#queue(async()=>{this.#machine.sendInput(owned);await this.#collect();});
  }
  advance(steps=32768){
    need(Number.isInteger(steps)&&steps>0&&steps<=1048576,'work bound');
    return this.#queue(async()=>{
      await this.#collect();
      for(let left=steps;left>0;){
        await this.#localBlocks();need(!this.#closed,'owner was closed');
        const amount=Math.min(left,32768),result=this.#machine.runChunk(amount);left-=amount;
        await this.#collect();if(result.done)break;
        if(left)await tick();
      }
      return this.#machine.inputPosition();
    });
  }
  view(){
    need(!this.#closed,'owner is closed');
    return renderReplayConsole({receipts:this.#rows,consolePrefix:Uint8Array.from(this.#configuration.branchOrigin.consolePrefix)},
      this.#machine,this.#machine.inputPosition());
  }
  preview(){
    need(!this.#closed,'owner is closed');
    return renderReplayConsole({receipts:this.#rows,consolePrefix:Uint8Array.from(this.#configuration.branchOrigin.consolePrefix)},
      this.#machine,this.#machine.inputPosition(),{digest:false});
  }
  goLive(){return this.#queue(()=>this.#machine.requestExactBranchGoLive());}
  async #release(){
    if(this.#freed)return;
    await this.#writer.release();if(!this.#freed){this.#machine.free();this.#freed=true;}
  }
  finish(){return this.#queue(async()=>{
    await this.#collect();await this.#journal.flush();
    const end=this.#machine.exactSessionWitness(false);need(!sameBranchPosition(end,this.#initial),'run the continuation before saving');
    await this.#journal.completeExact(end,[this.#initial,end],()=>need(!this.#closed,'owner was closed before saving'));
    this.#saved=true;
    const result={id:this.#id,...this.view()};this.#closed=true;await this.#release();return result;
  });}
  discard(){
    if(this.#discarding)return this.#discarding;
    this.#closed=true;this.#discarding=(async()=>{await this.#serial.catch(()=>{});await this.#release();if(!this.#saved)await this.#store.deleteSession(this.#id);})();
    return this.#discarding;
  }
}
