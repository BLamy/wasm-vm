// Test harness only. Input timers run outside the GPU recorder's event loop.
import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parentPort,workerData} from 'node:worker_threads';

const require=createRequire(import.meta.url);
const core=path.dirname(require.resolve('../../web/node_modules/playwright-core/package.json'));
// Use the pinned Playwright version's physical key mapping and Chromium adapter.
const {Keyboard,Mouse}=require(path.join(core,'lib/server/input.js'));
const {RawKeyboardImpl,RawMouseImpl}=require(path.join(core,'lib/server/chromium/crInput.js'));
const record=row=>appendFileSync(workerData.log,JSON.stringify({wallTime:Date.now(),time:performance.now(),...row})+'\n');
const socket=new WebSocket(workerData.endpoint);
let nextId=0,sessionId,closing=false;
const pending=new Map();
const rejectAll=error=>{for(const row of pending.values()){clearTimeout(row.timer);row.reject(error);}pending.clear();};
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(!message.id)return; // No Runtime/Page domains enabled; no GPU binding traffic.
  const row=pending.get(message.id);if(!row)return;
  pending.delete(message.id);clearTimeout(row.timer);
  if(message.error)row.reject(Error(JSON.stringify(message.error)));else row.resolve(message.result);
});
socket.addEventListener('close',()=>{rejectAll(Error('Owned input CDP connection closed'));if(!closing)parentPort.postMessage({fatal:'Owned input CDP connection closed'});});
async function send(method,params={},target=true){
  const id=++nextId;
  const result=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Input CDP deadline: '+method));},30000);
    pending.set(id,{resolve,reject,timer});
  });
  record({kind:'dispatch',id,method,params});
  socket.send(JSON.stringify({id,method,params,...(target?{sessionId}:{})}));
  try{const value=await result;record({kind:'ack',id,method});return value;}
  catch(error){record({kind:'dispatch-error',id,method,error:String(error)});throw error;}
}
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
({sessionId}=await send('Target.attachToTarget',{targetId:workerData.targetId,flatten:true},false));
const client={send:(method,params)=>send(method,params)};
const drag={cancelDrag:async()=>false,isDragging:()=>false,interceptDragCausedByMove:async(_x,_y,_button,_buttons,_modifiers,move)=>move()};
const keyboard=new Keyboard(new RawKeyboardImpl(client,process.platform==='darwin',drag));
const mouse=new Mouse(new RawMouseImpl(null,client,drag),{keyboard});
const allowed={keyboard:new Set(['press','type','down','up']),mouse:new Set(['click','dblclick','move','down','up','wheel'])};
let queue=Promise.resolve();
parentPort.on('message',message=>{
  queue=queue.then(async()=>{
    try{
      if(message.method==='dispose'){
        const heldKeys=[...keyboard._pressedKeys],heldButtons=[...mouse._buttons];
        for(const key of heldKeys)await keyboard.up(key);
        for(const button of heldButtons)await mouse.up({button});
        record({kind:'dispose',heldKeys,heldButtons});closing=true;
        await send('Target.detachFromTarget',{sessionId},false);socket.close();
        parentPort.postMessage({id:message.id,value:{heldKeys,heldButtons}});parentPort.close();return;
      }
      const [device,method]=message.method.split('.');
      assert.ok(allowed[device]?.has(method),'known physical input method');
      assert.ok(Array.isArray(message.args));
      record({kind:'operation-start',request:message.id,method:message.method,args:message.args});
      await ({keyboard,mouse})[device][method](...message.args);
      record({kind:'operation-end',request:message.id,method:message.method});
      parentPort.postMessage({id:message.id,value:null});
    }catch(error){record({kind:'operation-error',request:message.id,error:error.stack??String(error)});parentPort.postMessage({id:message.id,error:error.stack??String(error)});}
  });
});
record({kind:'ready',targetId:workerData.targetId});
parentPort.postMessage({ready:true});
