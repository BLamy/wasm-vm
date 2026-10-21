// Built-browser E9-T16 proof: authenticated keyframe restore, independent from-start
// replay oracles, transition stepping, and 100 superseding seek requests.
import {runSessionKeyframeProbe} from './session-keyframe-probe.js';
import {SessionSeekController} from './session-seek.js';

const need=(condition,message)=>{if(!condition)throw Error('seek probe: '+message);};
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const pos=value=>({transition:value.transition,retired:value.retired,phase:value.phase,
  ordinal:value.ordinal,sequence:value.sequence});
const equal=(a,b)=>['transition','retired','phase','ordinal','sequence'].every(key=>a[key]===b[key]);
const timeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('seek probe timeout')),ms))]);

export async function runSessionSeekProbe({onProgress=()=>{},onRender=()=>{}}={}){
 let proof=null;
 const keyframes=await runSessionKeyframeProbe({onProgress,onSeekFixture:async fixture=>{
  const {store,id,configuration,make,read,initial,final}=fixture;
  const publishes=[],progress=[];
  let holdNext=false,releaseHeld,renderStarted;
  const held=new Promise(resolve=>{releaseHeld=resolve;});
  const started=new Promise(resolve=>{renderStarted=resolve;});
  const controller=await SessionSeekController.open({store,id,configuration,makeReplay:()=>make(true),quantum:4096,
   render:async(candidate,at)=>{
    const digest=hex(candidate.exactSessionWitness(false).digest);
    if(holdNext){holdNext=false;renderStarted();await held;return {text:'STALE '+at.transition};}
    return {text:'Transition '+at.transition+' · retired '+at.retired,digest};
   },
   onPublish:selection=>{publishes.push({position:pos(selection.position),rendered:selection.rendered,requestId:selection.requestId});
    onRender(selection.rendered.text);},
   onProgress:(message,metadata)=>{progress.push({message,requestId:metadata.requestId});onProgress(message);}});
  const fromStart=(target,transitionOnly=false)=>{
   const candidate=make(true);
   try{
    candidate.beginExactReplay(read.initialResume,read.receipts,read.witnesses,read.manifest.end);
    const fence=transitionOnly?{transition:target,transitionOnly:true}:target;
    let at,calls=0;
    do{at=candidate.runExactReplayChunkTo(fence,4096);need(++calls<100000,'from-start work bound');}
    while(!at.reached);
    return {position:pos(at),digest:hex(candidate.exactSessionWitness(false).digest)};
   }finally{candidate.free();}
  };
  const checked=[];
  const check=async(label,target,transitionOnly=false)=>{
   const expected=fromStart(target,transitionOnly);
   const result=transitionOnly?await controller.seekTransition(target):await controller.seekPosition(target);
   need(result.status==='ready'&&equal(result.position,expected.position)
    &&result.rendered.digest===expected.digest,'seek state '+label);
   checked.push({label,position:result.position,expectedDigest:expected.digest,
    checkpointId:result.checkpointId,rendered:result.rendered.text});
   return result;
  };
  try{
   const beforeEvents=pos(initial);
   const eventTargets=read.receipts.filter(row=>row.phase==='before').map(pos);
   need(eventTargets.length>=2&&eventTargets[0].transition===eventTargets[1].transition,
    'same-boundary events required');
   const firstAfter=eventTargets[0];
   const firstGap=(BigInt(read.manifest.checkpoints[1].position.transition)+1n).toString();
   const finalTransition=BigInt(final.transition);
   const lastGap=(finalTransition-1n).toString();
   need(BigInt(firstGap)<BigInt(read.manifest.checkpoints[2].position.transition),'first between-keyframe target');
   need(BigInt(lastGap)>BigInt(fixture.atRebase.transition),'post-rebase between-keyframe target');
   await check('before-event',beforeEvents);
   await check('after-event',firstAfter);
   const afterSecondEvent=await check('after-second-event',eventTargets[1]);
   const boundaryForward=await controller.forwardStep();
   const boundaryReverse=await controller.reverseStep();
   need(BigInt(boundaryForward.position.transition)===BigInt(eventTargets[1].transition)+1n
    &&equal(boundaryReverse.position,afterSecondEvent.position)
    &&boundaryReverse.rendered.digest===afterSecondEvent.rendered.digest,
    'reverse instruction step must preserve prior same-boundary deliveries');
   await check('first-gap',firstGap,true);
   await check('post-rebase-gap',lastGap,true);
   const afterForward=await controller.forwardStep();
   const forwardOracle=fromStart((BigInt(lastGap)+1n).toString(),true);
   need(equal(afterForward.position,forwardOracle.position)
    &&afterForward.rendered.digest===forwardOracle.digest,'forward transition step');
   const afterReverse=await controller.reverseStep();
   const reverseOracle=fromStart(lastGap,true);
   need(equal(afterReverse.position,reverseOracle.position)
    &&afterReverse.rendered.digest===reverseOracle.digest,'reverse transition step');
   const beforeRestoreCancel=publishes.length;
   const restoring=controller.seekPosition(pos(fixture.atDelta2));
   await new Promise(resolve=>setTimeout(resolve,0));
   const restoreCancelStart=performance.now();
   const replacement=controller.seekTransition(firstGap);
   const restoreCancelled=await timeout(restoring,250);
   const restoreCancelMs=performance.now()-restoreCancelStart;
   const replacementResult=await timeout(replacement,15000);
   need(restoreCancelled.status==='cancelled'&&restoreCancelMs<=250
    &&replacementResult.status==='ready'&&publishes.length===beforeRestoreCancel+1,
    'in-flight restore cancellation and private candidate ownership');
   const beforeCount=publishes.length;
   holdNext=true;
   const old=controller.seekTransition(firstGap);
   await timeout(started,15000);
   const beforeProgress=progress.length;
   const issued=[];let seed=17,winnerTarget=null;
   const cancelStart=performance.now();
   for(let i=0;i<100;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const offset=BigInt((seed>>>16)%4);
    const target=(i%2===0?BigInt(firstGap)+offset
     :BigInt(lastGap)-offset).toString();
    issued.push(controller.seekTransition(target));winnerTarget=target;
   }
   const obsolete=await timeout(Promise.all([old,...issued.slice(0,-1)]),250);
   const cancellationMs=performance.now()-cancelStart;
   need(obsolete.every(value=>value.status==='cancelled')&&cancellationMs<=250,'superseded cancellation bound');
   releaseHeld();
   const winner=await timeout(issued.at(-1),30000);
   need(winner.status==='ready'&&winner.position.transition===winnerTarget,'latest seek wins');
   need(publishes.length===beforeCount+1&&publishes.at(-1).requestId===winner.requestId
    &&publishes.at(-1).rendered.text.startsWith('Transition '),
    'stale machine/render publication');
   need(progress.slice(beforeProgress).every(value=>value.requestId===winner.requestId),
    'stale progress publication');
   const winnerOracle=fromStart(winnerTarget,true);
   need(equal(winner.position,winnerOracle.position)
    &&winner.rendered.digest===winnerOracle.digest,'winning state from-start');
   proof={status:'passed',checked,boundaryForward:pos(boundaryForward.position),
    boundaryReverse:pos(boundaryReverse.position),
    forward:afterForward.position,reverse:afterReverse.position,
    seededRequests:100,cancelled:obsolete.length,cancellationMs,winner:pos(winner.position),winnerTarget,
    restoreCancelMs,restoreCancelled:restoreCancelled.status,
    winnerDigest:winnerOracle.digest,latestRender:publishes.at(-1).rendered.text,
    publicationsDuringOverlap:publishes.length-beforeCount,progressMessages:progress.length,
    eventPositions:eventTargets};
  }finally{releaseHeld();controller.close();}
 }});
 need(proof?.status==='passed'&&keyframes.status==='passed','seek/keyframe probe incomplete');
 return proof;
}
