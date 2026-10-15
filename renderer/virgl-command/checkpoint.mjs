/** Bounded original-event reconstruction. Replay transport never touches a guest machine. */
import {createVirglProductionBridge} from './control-bridge.mjs';
import {CHECKPOINT_MAX_BYTES,checkpointBytes,checkpointHash,encodeCheckpointData,decodeCheckpointData,equalCheckpointBytes} from './checkpoint-codec.mjs';

const MAGIC=new TextEncoder().encode('WVGJRN01'), MAX_FRAMES=100000;
const TRANSPORT=['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'];
const need=(value,message)=>{if(!value)throw Error('GPU checkpoint: '+message);};
const unwrap=value=>{need(value?.ok===true,value?.error?.message ?? 'renderer operation failed');return value;};
const same=(a,b)=>equalCheckpointBytes(encodeCheckpointData(a),encodeCheckpointData(b));
const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
function profileData(profile) {
  need(profile && profile.hostWords && profile.formatRoles && typeof profile.renderer==='string','missing qualified profile');
  const hostWords=Array.from(profile.hostWords),formatRoles=Array.from(profile.formatRoles);
  need(hostWords.length===14 && formatRoles.length<=2048 && hostWords.concat(formatRoles).every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff),'invalid qualified profile');
  return {hostWords,formatRoles,renderer:profile.renderer};
}
async function contentIdentity(contents) {
  const allocations=[];
  for(const allocation of contents.allocations) {
    const levels=[];
    for(const level of allocation.levels)levels.push({level:level.level,bytes:level.bytes.length,sha256:await checkpointHash(level.bytes)});
    allocations.push({metadata:allocation.metadata,levels});
  }
  const resources=[];
  for(const resource of contents.resources) {
    const {backing,...fields}=resource;
    resources.push({...fields,...(backing?{backing:{bytes:backing.length,sha256:await checkpointHash(backing)}}:{})});
  }
  return {allocations,resources,views:contents.views,byteLength:contents.byteLength};
}
function presentationGate(target, enabled) {
  let active=enabled,generation='0000000000000000',sequence=0,disposed=false;
  const presenter={
    rebind(next) {
      if(active)return target.rebind(next);
      need(!disposed && /^[0-9a-f]{16}$/.test(next) && next>generation,'stale replay presentation');generation=next;return {ok:true};
    },
    enqueueOwned(value,onRetired) {
      if(active)return target.enqueueOwned(value,onRetired);
      need(!disposed && value.bindingGeneration===generation,'stale replay frame');
      const token={sequence:++sequence,generation};
      // The fresh GPU read really ran, but historical frames are never claimed to be painted.
      onRetired({token,status:'cancelled'});return {ok:true,token};
    },
    inspect:()=>active?target.inspect():{disposed,generation,retainedFrames:0},
    readPixels:()=>active?target.readPixels():{ok:false,error:{code:'unsupported-feature',message:'Reconstruction does not publish historical pixels'}},
    dispose() {if(active)return target.dispose();disposed=true;return {ok:true};},
  };
  return {presenter,activate() {need(!disposed && !active,'owner is not staged');if(generation!=='0000000000000000')unwrap(target.rebind(generation));active=true;}};
}
function owner(options, replay=null) {
  const profile=profileData(options.profile), frames=replay?replay.frames.map(b=>new Uint8Array(b)):[];
  const byteLimit=options.journalLimits?.bytes ?? CHECKPOINT_MAX_BYTES-65536, frameLimit=options.journalLimits?.frames ?? MAX_FRAMES;
  need(Number.isSafeInteger(byteLimit) && byteLimit>=0 && byteLimit<=CHECKPOINT_MAX_BYTES-65536 &&
    Number.isSafeInteger(frameLimit) && frameLimit>=0 && frameLimit<=MAX_FRAMES,'invalid journal policy');
  const gate=presentationGate(options.presenter,!replay);
  let byteLength=frames.reduce((sum,b)=>sum+b.length,0), unavailable=null, version=0, cursor=0, mode=replay?'replay':'record', disposed=false, active=!replay;
  let activating=false,disposeRequested=false,saving=false;
  need(byteLength<=byteLimit && frames.length<=frameLimit,'journal exceeds selected policy');
  const append = frame => {
    version++;
    if(unavailable)return;
    try {
      const bytes=encodeCheckpointData(frame);
      if(frames.length>=frameLimit || bytes.length>byteLimit-byteLength)throw Error('journal budget exceeded');
      frames.push(bytes);byteLength+=bytes.length;
    } catch(error) {unavailable=String(error.message);frames.length=0;byteLength=0;}
  };
  const consume = (name,args) => {
    need(cursor<frames.length,'unexpected replay transport call');
    const frame=decodeCheckpointData(frames[cursor]);need(frame.op===name && same(frame.args,args),'replay transport identity differs');cursor++;return frame;
  };
  const queryIds=new WeakMap(),queries=new Map();let nextQuery=0;
  const queryGl=new Proxy(options.gl,{get(target,name){
    const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
    return (...args)=>{
      if(name==='getQueryParameter' && (args[1]===target.QUERY_RESULT_AVAILABLE || args[1]===target.QUERY_RESULT)) {
        const id=queryIds.get(args[0]),parameter=args[1]===target.QUERY_RESULT_AVAILABLE?'availability':'result';
        need(id!==undefined,'unknown physical query');const actual=method.apply(target,args);
        if(mode==='record') {append({op:'query',id,parameter,value:actual});return actual;}
        const expected=cursor<frames.length?decodeCheckpointData(frames[cursor]):null;
        if(parameter==='availability') {
          need(typeof actual==='boolean','invalid physical query availability');
          // Additional physical wait polls can occur. Never invent readiness or a result;
          // a recorded false can only delay an actual ready native measurement.
          if(expected?.op!=='query' || expected.id!==id || expected.parameter!==parameter)return false;
          if(expected.value===true && !actual)return false;
          need(typeof expected.value==='boolean','invalid recorded query availability');cursor++;return expected.value;
        }
        need(expected?.op==='query' && expected.id===id && expected.parameter===parameter && Object.is(expected.value,actual),'fresh physical query result differs');cursor++;return actual;
      }
      const result=method.apply(target,args);
      if(name==='createQuery' && result) {queryIds.set(result,++nextQuery);queries.set(nextQuery,result);}
      if(name==='deleteQuery')queries.delete(queryIds.get(args[0]));return result;
    };
  }});
  const transport=Object.fromEntries(TRANSPORT.map(name=>[name,(...args)=>{
    if(mode==='replay') {
      if(name.startsWith('gather'))return new Uint8Array(consume(name,args).data);
      if(name.startsWith('scatter')) {const data=checkpointBytes(args.at(-1));const frame=consume(name,args.slice(0,-1));need(equalCheckpointBytes(frame.data,data),'fresh GPU output differs');return;}
      consume(name,args);return;
    }
    if(unavailable)return options.transport[name](...args);
    try {
      const data=name.startsWith('scatter')?new Uint8Array(checkpointBytes(args.at(-1))):null;
      const result=options.transport[name](...args);
      if(name.startsWith('gather'))append({op:name,args,data:new Uint8Array(checkpointBytes(result))});
      else if(data)append({op:name,args:args.slice(0,-1),data});
      else {append({op:name,args});if(args[3]!==0 || args[4]!==true)unavailable='a GPU job failed or has an unproved applied prefix';}
      return result;
    }catch(error){unavailable='transport failed';throw error;}
  }]));
  const raw=unwrap(createVirglProductionBridge({gl:queryGl,shaderBridge:options.shaderBridge,transport,presenter:gate.presenter})).bridge;
  const bridge={
    apply(event) {
      if(disposed || !active)return {ok:false,error:{code:'bridge-poisoned',message:'GPU checkpoint owner is not active'}};
      let frame;if(!unavailable)try{frame=encodeCheckpointData({op:'event',event});}catch(error){unavailable=String(error.message);}
      const result=raw.apply(event);
      if(result.ok && frame)append(decodeCheckpointData(frame));else if(!result.ok)unavailable='a control event failed';
      return result;
    },
    pump:()=>raw.pump(),
    inspect:()=>({...raw.inspect(),checkpoint:{available:!unavailable,reason:unavailable,frames:frames.length,bytes:byteLength,staged:!active}}),
    present2D:frame=>raw.present2D(frame),
    dispose(){
      if(disposed)return {ok:true};
      if(activating){disposeRequested=true;return {ok:true,pending:true};}
      const result=raw.dispose();if(result.ok){disposed=true;frames.length=0;}return result;
    },
    async saveCheckpoint() {
      need(active && !disposed && !unavailable && !saving,unavailable ?? 'owner is inactive or already capturing');saving=true;
      try {const before=version;
      const state=unwrap(raw.checkpointState()),contents=await contentIdentity(state.contents);
      need(before===version && !unavailable && !disposed,'renderer changed during checkpoint');unwrap(raw.checkpointReady());
      const payload=encodeCheckpointData({schema:'production-gpu-journal-v1',profile,frames,logical:state.logical,contents});
      need(payload.length<=CHECKPOINT_MAX_BYTES-48,'journal envelope exceeds budget');
      const bytes=new Uint8Array(16+payload.length+32);bytes.set(MAGIC);const view=new DataView(bytes.buffer);view.setUint32(8,1,true);view.setUint32(12,payload.length,true);bytes.set(payload,16);
      const hash=await checkpointHash(bytes.subarray(0,bytes.length-32));bytes.set(Uint8Array.from(hash.match(/../g),s=>parseInt(s,16)),bytes.length-32);
      const artifactHash=await checkpointHash(bytes);
      need(before===version && !unavailable && !disposed,'renderer changed during checkpoint');unwrap(raw.checkpointReady());
      return {bytes,sha256:artifactHash,epoch:state.logical.epoch,contents};
      }finally{saving=false;}
    },
    rebaseCheckpointEpoch(expected,next) {
      const result=raw.rebaseCheckpointEpoch(expected,next);if(result.ok)append({op:'rebase',expected,next});return result;
    },
    async activate() {
      need(!active && !disposed && !activating && !disposeRequested,'owner is not staged');activating=true;
      try {
        unwrap(raw.checkpointReady());gate.activate();
        const result=unwrap(await raw.repairCheckpointScanout(()=>disposeRequested));
        need(!disposeRequested,'activation was cancelled');active=true;return result;
      }catch(error){disposeRequested=true;throw error;}
      finally {activating=false;if(disposeRequested)bridge.dispose();}
    },
  };
  return {bridge,raw,frames,profile,get cursor(){return cursor;},advance(){cursor++;},setLive(){mode='record';},gate,
    canPump() {
      for(let index=cursor;index<frames.length;index++) {
        const frame=decodeCheckpointData(frames[index]);if(frame.op==='event' || frame.op==='rebase')break;
        if(frame.op==='query' && frame.parameter==='availability' && frame.value===true && queries.has(frame.id)) {
          if(options.gl.getQueryParameter(queries.get(frame.id),options.gl.QUERY_RESULT_AVAILABLE)!==true)return false;
        }
      }
      return true;
    }};
}
export function createJournalledProductionBridge(options) {
  try {return {ok:true,bridge:owner(options).bridge};}
  catch(error){return {ok:false,error:{code:'invalid-parameter',message:String(error.message)}};}
}
export async function restoreProductionRenderer(source, options) {
  // Own and validate the entire artifact before allocating an unpublished renderer.
  const original=checkpointBytes(source);need(original.length>=48 && original.length<=CHECKPOINT_MAX_BYTES,'invalid envelope size');
  const bytes=new Uint8Array(original),view=new DataView(bytes.buffer);
  need(equalCheckpointBytes(bytes.subarray(0,8),MAGIC) && view.getUint32(8,true)===1 && view.getUint32(12,true)===bytes.length-48,'invalid envelope framing');
  const digest=await checkpointHash(bytes.subarray(0,bytes.length-32));
  const artifactHash=await checkpointHash(bytes);
  need(equalCheckpointBytes(bytes.subarray(bytes.length-32),Uint8Array.from(digest.match(/../g),s=>parseInt(s,16))),'envelope digest differs');
  const payload=decodeCheckpointData(bytes.subarray(16,bytes.length-32));
  need(payload.schema==='production-gpu-journal-v1' && same(payload.profile,profileData(options.profile)),'incompatible renderer profile');
  need(Array.isArray(payload.frames) && payload.frames.length<=MAX_FRAMES,'invalid frame count');
  let total=0;for(const frame of payload.frames){total+=checkpointBytes(frame).length;need(total<=CHECKPOINT_MAX_BYTES,'journal budget exceeded');}
  const candidate=owner(options,payload),deadline=performance.now()+120000;let pumps=0;
  try {
    while(candidate.cursor<candidate.frames.length) {
      need(performance.now()<deadline && pumps<1000000,'reconstruction work budget exceeded');
      const frame=decodeCheckpointData(candidate.frames[candidate.cursor]);
      if(frame.op==='event') {candidate.advance();unwrap(candidate.raw.apply(frame.event));}
      else if(frame.op==='rebase') {candidate.advance();unwrap(candidate.raw.rebaseCheckpointEpoch(frame.expected,frame.next));}
      else {
        if(!candidate.canPump()){await delay();pumps++;continue;}
        const before=candidate.cursor;const result=unwrap(candidate.raw.pump());pumps++;need(result.status!=='idle' || candidate.cursor!==before,'incomplete reconstruction journal');await delay();
      }
    }
    const state=unwrap(candidate.raw.checkpointState()),contents=await contentIdentity(state.contents);
    need(same(state.logical,payload.logical) && same(contents,payload.contents),'reconstructed physical contents or state differ');
    candidate.setLive();
    if(options.epoch!==undefined)unwrap(candidate.bridge.rebaseCheckpointEpoch(state.logical.epoch,options.epoch));
    unwrap(candidate.raw.checkpointReady());
    return {bridge:candidate.bridge,epoch:state.logical.epoch,sha256:artifactHash,frames:payload.frames.length,bytes:bytes.length,pumps};
  }catch(error){candidate.bridge.dispose();throw error;}
}
