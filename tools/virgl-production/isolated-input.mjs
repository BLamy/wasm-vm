import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';

export function assertPhysicalKeyHolds(events,maxHoldMs=250){
  const pending=new Map(),holds=[];
  for(const row of events.filter(row=>row.type==='keydown'||row.type==='keyup')){
    assert.equal(row.trusted,true,'original trusted browser key event');
    assert.equal(row.repeat,false,'one requested physical make per key');
    if(row.type==='keydown'){
      assert.equal(pending.has(row.code),false,'no overlapping physical makes');pending.set(row.code,row);
    }else{
      const down=pending.get(row.code);assert.ok(down,'matching physical make before break');pending.delete(row.code);
      const durationMs=row.time-down.time;
      assert.ok(durationMs>=0&&durationMs<=maxHoldMs,'requested short physical key hold exceeded '+maxHoldMs+'ms: '+row.code+' '+durationMs);
      holds.push({code:row.code,durationMs});
    }
  }
  assert.equal(pending.size,0,'all requested physical keys released');
  assert.ok(holds.length>0,'physical key evidence present');
  return {maxHoldMs,holds};
}

// A second, Input-only CDP session avoids inheriting the recorder's Runtime
// binding stream. It sends genuine browser input; it never dispatches DOM events.
export async function attachIsolatedInput(browser,page,log){
  const browserSession=await browser.newBrowserCDPSession();
  let commandLine;
  try{commandLine=await browserSession.send('Browser.getBrowserCommandLine');}finally{await browserSession.detach();}
  const profile=commandLine.arguments.find(value=>value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  assert.ok(profile&&path.basename(profile).startsWith('playwright_chromiumdev_profile-'),'only the harness-owned temporary Chrome profile');
  const [port,socketPath]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');
  assert.match(port,/^[0-9]+$/);assert.ok(Number(port)>0&&Number(port)<65536);
  assert.match(socketPath,/^\/devtools\/browser\/[a-f0-9-]+$/);
  const targetSession=await page.context().newCDPSession(page);
  let targetId;
  try{({targetInfo:{targetId}}=await targetSession.send('Target.getTargetInfo'));}finally{await targetSession.detach();}
  await fs.writeFile(log,'',{flag:'wx'});
  const worker=new Worker(new URL('./isolated-input-worker.mjs',import.meta.url),{
    workerData:{endpoint:`ws://127.0.0.1:${port}${socketPath}`,targetId,log},
  });
  let nextId=0,closed=false,fatal;
  const pending=new Map();
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const fail=error=>{fatal=error;readyReject(error);for(const row of pending.values())row.reject(error);pending.clear();};
  worker.on('error',fail);
  worker.on('exit',code=>{if(!closed)fail(Error('Isolated input worker exited '+code));});
  worker.on('message',message=>{
    if(message.ready){readyResolve();return;}
    if(message.fatal){fail(Error(message.fatal));return;}
    const row=pending.get(message.id);if(!row)return;
    pending.delete(message.id);
    if(message.error)row.reject(Error(message.error));else row.resolve(message.value);
  });
  try{await ready;}catch(error){closed=true;await worker.terminate();throw error;}
  const call=(method,args=[])=>{
    if(fatal)return Promise.reject(fatal);
    assert.equal(closed,false,'input driver remains owned and open');
    const id=++nextId;
    const result=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
    worker.postMessage({id,method,args});return result;
  };
  const proxy=(device,methods)=>Object.fromEntries(methods.map(method=>[method,(...args)=>call(device+'.'+method,args)]));
  const original={keyboard:page.keyboard,mouse:page.mouse};
  page.keyboard=proxy('keyboard',['press','type','down','up']);
  page.mouse=proxy('mouse',['click','dblclick','move','down','up','wheel']);
  return{log,targetId,async dispose(){
    if(closed)return;
    try{return await call('dispose');}
    finally{closed=true;page.keyboard=original.keyboard;page.mouse=original.mouse;await worker.terminate();}
  }};
}
