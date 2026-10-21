// E9-T16: a private replay candidate is published only by the newest completed request.
// The clock's transition, not instret, is the stepping coordinate: traps and WFI advances
// have positions too. Rendering is prepared off-screen before the ownership check.
import {SessionInputJournal} from './session-inputs.js';
import {SessionCheckpoints,decodeSoftwareKeyframeBase,readCheckpointObject} from './session-checkpoints.js';

const need=(condition,message)=>{if(!condition)throw Error('session seek: '+message);};
const exact=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)
  &&BigInt(value)<=0xffffffffffffffffn;
const phase=value=>value==='before'?0:value==='observe'?1:-1;
const coordinate=value=>[BigInt(value.transition),phase(value.phase),value.ordinal,BigInt(value.sequence)];
const compare=(a,b)=>{const x=coordinate(a),y=coordinate(b);
  for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return 0;};
const same=(a,b)=>compare(a,b)===0&&a.retired===b.retired;
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const position=value=>({transition:value.transition,retired:value.retired,
  phase:value.phase,ordinal:value.ordinal,sequence:value.sequence});

export class SessionSeekController {
  #read;#store;#id;#make;#render;#publish;#progress;#quantum;
  #serial=Promise.resolve();#active=null;#selected=null;#nextId=0;
  constructor({read,store,id,makeReplay,render=()=>null,onPublish=()=>{},onProgress=()=>{},quantum=4096}){
    need(read?.admitted&&read.manifest?.policy?.mode==='exact-replay','admitted exact session required');
    need(typeof makeReplay==='function'&&typeof render==='function'&&typeof onPublish==='function'
      &&typeof onProgress==='function','controller callbacks');
    need(Number.isInteger(quantum)&&quantum>=1&&quantum<=65536,'bounded quantum');
    this.#read=read;this.#store=store;this.#id=id;this.#make=makeReplay;
    this.#render=render;this.#publish=onPublish;this.#progress=onProgress;this.#quantum=quantum;
  }
  static async open({store,id,configuration,...options}){
    const read=await SessionInputJournal.readExact(store,id,{configuration});
    return new SessionSeekController({read,store,id,...options});
  }
  get selected(){return this.#selected&&{position:position(this.#selected.position),
    checkpointId:this.#selected.checkpointId,rendered:this.#selected.rendered,
    requestId:this.#selected.requestId};}
  get end(){return position(this.#read.manifest.end);}
  cancel(){if(this.#active)this.#active.cancel();}
  close(){this.cancel();this.#selected?.machine.free();this.#selected=null;}
  seekPosition(target){
    need(target?.phase==='before'&&exact(target.transition)&&exact(target.retired)
      &&exact(target.sequence)&&Number.isInteger(target.ordinal)&&target.ordinal>=0
      &&target.ordinal<=0xffffffff,'quiescent target');
    need(compare(target,this.#read.manifest.begin)>=0&&compare(target,this.#read.manifest.end)<=0,
      'target outside saved history');
    return this.#request({kind:'position',value:position(target)});
  }
  seekTransition(transition){
    need(exact(transition)&&BigInt(transition)>=BigInt(this.#read.manifest.begin.transition)
      &&BigInt(transition)<=BigInt(this.#read.manifest.end.transition),'transition outside saved history');
    return this.#request({kind:'transition',value:transition});
  }
  forwardStep(){
    need(this.#selected,'select a position before stepping');
    const next=BigInt(this.#selected.position.transition)+1n;
    need(next<=BigInt(this.#read.manifest.end.transition),'end of saved history');
    return this.seekTransition(next.toString());
  }
  reverseStep(){
    need(this.#selected,'select a position before stepping');
    const previous=BigInt(this.#selected.position.transition)-1n;
    need(previous>=BigInt(this.#read.manifest.begin.transition),'beginning of saved history');
    return this.seekTransition(previous.toString());
  }
  #request(target){
    this.#active?.cancel();
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={id:++this.#nextId,target,settled:false,abort:new AbortController(),cancel(){if(!this.settled){this.settled=true;this.abort.abort();resolve({status:'cancelled',requestId:this.id});}},
      resolve(value){if(!this.settled){this.settled=true;resolve(value);}},
      reject(error){if(!this.settled){this.settled=true;reject(error);}}};
    this.#active=job;
    this.#serial=this.#serial.catch(()=>{}).then(()=>this.#execute(job)).catch(error=>job.reject(error));
    return promise;
  }
  #owns(job){return this.#active===job&&!job.settled;}
  #update(job,message){if(this.#owns(job))this.#progress(message,{requestId:job.id});}
  #checkpoint(target){
    const checkpoints=this.#read.manifest.checkpoints;
    let chosen=checkpoints[0];
    for(const candidate of checkpoints.slice(1)){
      const eligible=target.kind==='transition'
        ? BigInt(candidate.position.transition)<BigInt(target.value)
        : compare(candidate.position,target.value)<=0;
      if(eligible&&compare(candidate.position,chosen.position)>0)chosen=candidate;
    }
    return chosen;
  }
  async #resume(checkpoint,job){
    if(checkpoint===this.#read.manifest.checkpoints[0])return {resume:this.#read.initialResume,
      queues:{pending:new Uint8Array(),output:new Uint8Array()}};
    const checkpoints=new SessionCheckpoints(this.#store);
    const chain=await checkpoints.resolveDelta(this.#id,checkpoint.id,{signal:job.abort.signal});
    if(!this.#owns(job))return null;
    if(chain.deltas.length===0){
      const base=await readCheckpointObject(this.#store,chain.base,undefined,{signal:job.abort.signal});
      const parts=decodeSoftwareKeyframeBase(base);
      return {resume:parts.native,queues:{pending:parts.input,output:parts.output}};
    }
    const scratch=this.#make();
    try{
      await checkpoints.restoreExactDeltaToCandidate(this.#id,checkpoint.id,scratch,{signal:job.abort.signal});
      if(!this.#owns(job))return null;
      return {resume:scratch.exactSessionWitness(true).resume,queues:scratch.exactSessionHostQueues()};
    }finally{scratch.free();}
  }
  async #execute(job){
    if(!this.#owns(job))return;
    let candidate=null;
    try{
      const checkpoint=this.#checkpoint(job.target);
      this.#update(job,`Restoring ${checkpoint.id}`);
      const restored=await this.#resume(checkpoint,job);
      if(!this.#owns(job))return;
      const {resume,queues}=restored;
      need(resume instanceof Uint8Array,'checkpoint resume');
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',resume));
      if(!this.#owns(job))return;
      const committed=this.#read.witnesses.find(w=>same(w,checkpoint.position));
      need(!committed||hex(committed.digest)===hex(digest),'keyframe state witness mismatch');
      const witnesses=[{...checkpoint.position,digest},...this.#read.witnesses
        .filter(w=>compare(w,checkpoint.position)>0)];
      const receipts=this.#read.receipts.filter(row=>BigInt(row.sequence)>BigInt(checkpoint.position.sequence));
      candidate=this.#make();
      candidate.beginExactReplay(resume,receipts,witnesses,this.#read.manifest.end,queues);
      const fence=job.target.kind==='transition'
        ? {transition:job.target.value,transitionOnly:true}:job.target.value;
      let outcome;
      for(let calls=0;this.#owns(job);calls++){
        outcome=candidate.runExactReplayChunkTo(fence,this.#quantum);
        if(outcome.reached)break;
        need(calls<100000,'seek work bound');
        this.#update(job,`Replaying transition ${outcome.transition}`);
        await tick();
      }
      if(!this.#owns(job))return;
      need(outcome?.reached,'seek did not reach target');
      this.#update(job,'Preparing selected frame');
      const rendered=await this.#render(candidate,position(outcome));
      if(!this.#owns(job))return;
      const selection={machine:candidate,position:position(outcome),checkpointId:checkpoint.id,rendered,requestId:job.id};
      this.#publish(selection);
      const previous=this.#selected;
      this.#selected=selection;candidate=null;
      previous?.machine.free();
      job.resolve({status:'ready',position:selection.position,checkpointId:checkpoint.id,rendered,requestId:job.id});
    }finally{candidate?.free();}
  }
}
