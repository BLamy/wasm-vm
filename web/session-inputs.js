// E9-T10: durable input-only prefixes. These are inspectable recordings; full replay is gated.
import init, {sessionValidateManifest,sessionIndexEventChunk} from './session-pkg/wasm_vm_session.js';
import {SessionStoreError} from './session-store.js';
import {SessionDiskRoots} from './session-disk-roots.js';
import {deviceEventParts,joinDeviceCompletion} from './session-devices.js';
import {networkEventParts,joinNetworkEvent} from './session-network.js';
import {checkpointReference,checkpointChunks,readCheckpointObject,fetchCheckpointAsset,checkpointZeroPosition} from './session-checkpoints.js';
await init();
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const need=(condition,message)=>{if(!condition)throw new SessionStoreError('InputPrefix',message);};
const kinds=['','uart','uart','keyboard','keyboard','tablet','tablet','mouse','mouse','display','agent','agent','file-transfer','file-transfer','file-transfer','mouse','lifecycle','rtc','entropy'];
const devices=['','uart16550','uart16550','keyboard','keyboard','tablet','tablet','mouse','mouse','display','agent','agent','file-transfer','file-transfer','file-transfer','pointer-mode','lifecycle','goldfish-rtc','virtio-rng'];
const inputs=['uart','keyboard','pointer','display','agent','clipboard','file-transfer','lifecycle'];
const statuses=['applied','failed','partial','rejected','drop-policy'];
const recordStatus=(channel,outcome)=>outcome[0]==='0'&&[3,5,7].includes(channel)?'staged':outcome[0]==='0'&&[4,6,8].includes(channel)?'published':statuses[Number(outcome[0])];
const position=value=>({transition:value.transition,phase:value.phase,ordinal:value.ordinal,sequence:value.sequence,retired:value.retired});
const exact=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
function own(receipt,previous){
  need(receipt&&Number.isInteger(receipt.channel)&&receipt.channel>=1&&receipt.channel<=20,'unsupported input channel');
  need(['transition','retired','sequence'].every(key=>exact(receipt[key]))&&receipt.phase===([17,18].includes(receipt.channel)?'observe':'before')
    &&Number.isInteger(receipt.ordinal)&&receipt.ordinal>0&&receipt.ordinal<=0xffffffff,'exact input position required');
  need(BigInt(receipt.sequence)===BigInt(previous.sequence)+1n&&BigInt(receipt.transition)>=BigInt(previous.transition)
    &&BigInt(receipt.retired)>=BigInt(previous.retired)&&BigInt(receipt.retired)<=BigInt(receipt.transition)
    &&(receipt.transition===previous.transition?(receipt.phase===previous.phase?receipt.ordinal===previous.ordinal+1:previous.phase==='before'&&receipt.phase==='observe'&&receipt.ordinal===1):receipt.ordinal===1),'input prefix order');
  need(Array.isArray(receipt.outcome)&&receipt.outcome.length===4&&receipt.outcome.every(exact)
    &&BigInt(receipt.outcome[0])<=4n,'input outcome');
  need(receipt.bytes instanceof Uint8Array&&receipt.bytes.buffer instanceof ArrayBuffer&&receipt.bytes.length<=1048576,'owned input bytes');
  if(receipt.channel===19)deviceEventParts(receipt);
  if(receipt.channel===20)networkEventParts(receipt);
  if(receipt.channel===17||receipt.channel===18)need(BigInt(receipt.outcome[0])<=1n&&receipt.outcome[3]==='0'
    &&(receipt.channel===17?BigInt(receipt.outcome[1])>=1n&&BigInt(receipt.outcome[1])<=5n&&receipt.outcome[2]==='8'
      :receipt.outcome[1]==='6'&&BigInt(receipt.outcome[2])>=1n&&BigInt(receipt.outcome[2])<=1048576n)
    &&receipt.bytes.length===(receipt.outcome[0]==='0'?Number(receipt.outcome[2]):0),'source observation intent/result');
  return {...position(receipt),channel:receipt.channel,outcome:[...receipt.outcome],bytes:receipt.bytes.slice()};
}
export class SessionInputJournal{
  #writer;#manifest;#pending=[];#inflight=null;
  constructor(writer,manifest){this.#writer=writer;this.#manifest=manifest;}
  // A partial-provider recording retains an exact native/input/disk witness. It is explicitly
  // ineligible for executable restore: SLIRP/time/provider state is owned by subsequent slices.
  static async createWitness(store,writer,configuration,native,disk,pending,output){
    need(configuration?.inputPrefixWitness===1&&configuration.providersComplete===false,'input witness scope');
    need(native instanceof Uint8Array&&native.buffer instanceof ArrayBuffer&&native.length>=84&&native.length<=300*1048576
      &&disk instanceof Uint8Array&&disk.buffer instanceof ArrayBuffer&&disk.length>=61&&disk.length<=61+65536*4104,'initial witness bounds');
    need(pending instanceof Uint8Array&&pending.buffer instanceof ArrayBuffer&&pending.length<=1048576
      &&output instanceof Uint8Array&&output.buffer instanceof ArrayBuffer&&output.length<=1048576,'initial host queue bounds');
    native=native.slice();disk=disk.slice();pending=pending.slice();output=output.slice();
    const witness=new Uint8Array(28+native.length+pending.length+output.length),header=new DataView(witness.buffer);
    witness.set(encoder.encode('WVINPUT1'));header.setUint32(8,1,true);header.setBigUint64(12,BigInt(native.length),true);
    header.setUint32(20,pending.length,true);header.setUint32(24,output.length,true);
    witness.set(native,28);witness.set(pending,28+native.length);witness.set(output,28+native.length+pending.length);
    const configBytes=encoder.encode(JSON.stringify(configuration)),config=JSON.parse(decoder.decode(configBytes));
    need(config.ramMib<=256&&config.clock.mode==='icount'&&config.clock.interactive===null,'input witness profile');

    if(config.timeEntropyPolicy!==undefined){const policy=config.timeEntropyPolicy;
      need(policy?.version===1&&policy.divider===config.clock.divider&&policy.timebase_hz===config.clock.timebase_hz
        &&policy.rtc==='external-nanoseconds-v1'&&policy.entropy==='exact-fill-bytes-v1','frozen time/entropy policy');}
    if(config.deviceCompletionPolicy!==undefined){const policy=config.deviceCompletionPolicy;
      need(policy?.version===1&&policy.block==='immutable-base-cow-v1'&&policy.agent==='owned-agent-receive-v1'
        &&policy.capture==='owned-s16-capture-v1','frozen device completion policy');}
    if(config.networkPolicy!==undefined)need(config.networkPolicy?.version===1&&config.networkPolicy.transport==='owned-ethernet-v1'&&config.networkPolicy.replay==='zero-egress','frozen network policy');
    const vm=checkpointReference(configBytes),machine=checkpointReference(witness);
    const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
    const nv=new DataView(native.buffer),dv=new DataView(disk.buffer);
    need(hex(native.subarray(44,76))===hex(disk.subarray(17,49))&&nv.getBigUint64(76,true)===dv.getBigUint64(49,true),'input witness disk binding');
    const {sessionCanonicalImage}=await import('./session-pkg/wasm_vm_session.js');
    const baseBytes=sessionCanonicalImage(config.imageManifest),base=checkpointReference(baseBytes);
    need(base.sha256===hex(disk.subarray(17,49)),'input witness base');
    const root=await new SessionDiskRoots(store).capture(writer,disk,config.imageManifest);
    const zero=checkpointZeroPosition();
    const manifest={version:{major:1,minor:0},id:writer.id,
      machine:{vm_build:vm.sha256,wasm_build:config.wasm.sha256,base_image:base.sha256,kernel:config.kernel.sha256,
        initramfs:null,ram_bytes:String(config.ramMib*1048576),harts:1,devices:config.devices,gpu:null},
      policy:{mode:'capture-prefix',profile:'rv64-linux-software-v1',event_version:{major:1,minor:0},
        checkpoint_version:{major:1,minor:0},boundary_version:1,clock:config.clock,required_inputs:[...inputs,...(config.timeEntropyPolicy?['mtime','rtc','entropy','timers']:[]),...(config.deviceCompletionPolicy?['block-read','audio-capture']:[]),...(config.networkPolicy?['network']:[])]},
      assets:[{role:'vm',content:vm},{role:'wasm',content:{sha256:config.wasm.sha256,length:config.wasm.length}},
        {role:'kernel',content:{sha256:config.kernel.sha256,length:config.kernel.length}},{role:'base',content:base}],
      begin:zero,end:zero,events:[],checkpoints:[{id:'input-witness',position:zero,next_sequence:'1',machine,disk_root:root.content.sha256,gpu:null}],extensions:[]};
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    for(const [ref,bytes] of [[vm,configBytes],[base,baseBytes],[machine,witness]])await writer.put(ref,checkpointChunks(bytes));
    for(const role of ['kernel','wasm']){const ref=manifest.assets.find(a=>a.role===role).content;
      const bytes=await fetchCheckpointAsset(config[role].url,ref.sha256,64*1048576);
      need(String(bytes.length)===ref.length,'input witness asset length');await writer.put(ref,checkpointChunks(bytes));}
    await writer.publish(canonical);return new SessionInputJournal(writer,manifest);
  }
  get end(){return {...this.#manifest.end};}
  get pending(){return this.#pending.length;}
  stage(receipts){
    need(Array.isArray(receipts)&&this.#pending.length+receipts.length<=256,'input receipt bound');
    let previous=this.#pending.at(-1)??this.#manifest.end,bytes=this.#pending.reduce((n,r)=>n+r.bytes.length,0);
    const owned=[];
    for(const receipt of receipts){const value=own(receipt,previous);
      need(value.channel===20?this.#manifest.policy.required_inputs.includes('network'):value.channel===19?this.#manifest.policy.required_inputs.includes('block-read'):value.channel<17||this.#manifest.policy.required_inputs.includes(kinds[value.channel]),'source adapter is absent from this prefix');
      bytes+=value.bytes.length;
      need(bytes<=4*1048576,'input payload budget');owned.push(value);previous=value;}
    this.#pending.push(...owned);
  }
  flush(){
    if(this.#inflight)return this.#inflight;
    this.#inflight=this.#flush().finally(()=>{this.#inflight=null;});return this.#inflight;
  }
  async #flush(){
    const batch=this.#pending.slice();if(!batch.length)return this.end;
    const manifest=structuredClone(this.#manifest),objects=[],encoded=[];
    for(const receipt of batch){
      if(receipt.channel===19||receipt.channel===20){const parts=receipt.channel===20?networkEventParts(receipt):deviceEventParts(receipt);if(parts.object)objects.push(parts.object);
        encoded.push(JSON.stringify({version:{major:1,minor:0},kind:parts.kind,required:true,...position(receipt),device:parts.device,intent:[...encoder.encode(JSON.stringify(parts.intent))],status:parts.status,payload:parts.payload}));manifest.end=position(receipt);continue;}
      let payload;
      if(receipt.bytes.length>65536){const ref=checkpointReference(receipt.bytes);payload={storage:'blob',content:ref};objects.push([ref,receipt.bytes]);}
      else payload={storage:'inline',bytes:[...receipt.bytes]};
      const record={version:{major:1,minor:0},kind:kinds[receipt.channel],required:true,...position(receipt),
        device:devices[receipt.channel],intent:[...encoder.encode(JSON.stringify({version:1,channel:receipt.channel,outcome:receipt.outcome}))],
        status:recordStatus(receipt.channel,receipt.outcome),payload};
      encoded.push(JSON.stringify(record));manifest.end=position(receipt);
    }
    let group=[],length=2;
    const seal=()=>{if(!group.length)return;const bytes=encoder.encode('['+group.join(',')+']');
      const index=JSON.parse(decoder.decode(sessionIndexEventChunk(bytes)));manifest.events.push(index);objects.push([index.content,bytes]);group=[];length=2;};
    for(const text of encoded){const size=encoder.encode(text).length;if(length+size+Number(group.length>0)>4194304)seal();group.push(text);length+=size+Number(group.length>1);}seal();
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    for(const[ref,bytes]of objects)await this.#writer.put(ref,checkpointChunks(bytes));
    await this.#writer.publish(canonical);this.#manifest=manifest;this.#pending.splice(0,batch.length);return this.end;
  }
  static async read(store,id){
    const opened=await store.openSession(id);need(opened,'input prefix unavailable');
    const manifest=JSON.parse(decoder.decode(opened.manifest));need(manifest.policy.mode==='capture-prefix','input-only prefix required');
    const receipts=[];let previous=manifest.begin,total=0;
    for(const index of manifest.events){
      const records=JSON.parse(decoder.decode(await readCheckpointObject(store,index.content,4194304)));
      for(const record of records){
        const intent=JSON.parse(decoder.decode(Uint8Array.from(record.intent)));
        const completion=intent.channel===19||intent.channel===20;
        need(intent.version===1&&Object.keys(intent).sort().join(',')===(completion?'channel,header,outcome,version':'channel,outcome,version'),'input adapter version');
        let bytes=record.payload.storage==='inline'?Uint8Array.from(record.payload.bytes)
          :await readCheckpointObject(store,record.payload.content,1048576);
        if(completion)bytes=(intent.channel===20?joinNetworkEvent:joinDeviceCompletion)(Uint8Array.from(intent.header),bytes);
        const receipt=own({...position(record),channel:intent.channel,outcome:intent.outcome,bytes},previous);
        need(receipt.channel===20?manifest.policy.required_inputs.includes('network'):receipt.channel===19?manifest.policy.required_inputs.includes('block-read'):receipt.channel<17||manifest.policy.required_inputs.includes(kinds[receipt.channel]),'source adapter is absent from this prefix');
        const expected=completion?(receipt.channel===20?networkEventParts(receipt):deviceEventParts(receipt)):{kind:kinds[receipt.channel],device:devices[receipt.channel],status:recordStatus(receipt.channel,receipt.outcome)};
        need(record.kind===expected.kind&&record.device===expected.device&&record.status===expected.status,'input adapter identity');
        total+=receipt.bytes.length;need(total<=4*1048576&&receipts.length<4096,'input inspection bound; use bounded chunks for larger histories');
        receipts.push(receipt);previous=receipt;
      }
    }
    return {manifest,receipts};
  }
}
