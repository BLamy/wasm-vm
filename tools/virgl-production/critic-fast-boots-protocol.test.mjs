// This is a structured-clone/callback regression, not evidence of a guest boot.
// Guest boot evidence is the separate real-browser critic-fast-boots.mjs run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {startLinuxBootWorker} from '../../web/linux-worker-host.js';
import {LINUX_WORKER_PROTOCOL_VERSION as version} from '../../web/linux-worker-protocol.js';

class CloneBoundaryWorker {
  static instances=[];
  constructor(url,options){this.url=url;this.options=options;this.listeners=new Map();this.messages=[];this.terminated=false;CloneBoundaryWorker.instances.push(this);}
  addEventListener(type,listener){let entries=this.listeners.get(type);if(!entries)this.listeners.set(type,entries=new Set());entries.add(listener);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  emit(message){for(const listener of this.listeners.get('message')||[])listener({data:structuredClone(message)});}
  postMessage(message){
    // This is the actual browser structured-clone rule that the previous fake
    // controller tests did not exercise through startLinuxBootWorker.
    const copied=structuredClone(message);this.messages.push(copied);
    queueMicrotask(()=>{
      if(copied.type==='boot')this.emit({type:'ready',version,restored:false,info:{backend:'whole-machine-worker'}});
      if(copied.type==='ping')this.emit({type:'pong',version});
      if(copied.type==='call'&&copied.method==='stop-internal'){
        this.emit({type:'done',version,state:'stopped'});
        this.emit({type:'result',version,id:copied.id,result:true});
      }
    });
  }
  terminate(){this.terminated=true;}
}

test('GPU events remain page callbacks and never enter structured-clone boot data',async()=>{
  const observed=[];
  const callback=event=>observed.push(event);
  const controller=await startLinuxBootWorker({WorkerCtor:CloneBoundaryWorker,
    manifestUrl:'./artifacts.json',virgl:false,onGpuEvent:callback,
    workerHeartbeatIntervalMs:10000,workerHeartbeatTimeoutMs:20000});
  const worker=CloneBoundaryWorker.instances.at(-1);
  try{
    const boot=worker.messages.find(message=>message.type==='boot');
    assert.deepEqual(boot.opts,{manifestUrl:'./artifacts.json',virgl:false});
    assert.equal(Object.hasOwn(boot.opts,'onGpuEvent'),false);
    worker.emit({type:'gpu-event',version,info:{type:'qualified',renderer:'physical renderer'}});
    worker.emit({type:'gpu-event',version,info:{type:'context-lost'}});
    assert.deepEqual(observed,[{type:'qualified',renderer:'physical renderer'},{type:'context-lost'}]);
  }finally{await controller.stop();}
  assert.equal(worker.terminated,true);
});

test('ordinary callers without a GPU callback keep a cloneable worker boot',async()=>{
  const controller=await startLinuxBootWorker({WorkerCtor:CloneBoundaryWorker,
    manifestUrl:'./artifacts-alpine.json',mode:'chunked',persist:true,
    workerHeartbeatIntervalMs:10000,workerHeartbeatTimeoutMs:20000});
  const worker=CloneBoundaryWorker.instances.at(-1);
  try{
    assert.deepEqual(worker.messages.find(message=>message.type==='boot').opts,
      {manifestUrl:'./artifacts-alpine.json',mode:'chunked',persist:true});
    worker.emit({type:'gpu-event',version,info:{type:'qualified'}});
  }finally{await controller.stop();}
  assert.equal(worker.terminated,true);
});
