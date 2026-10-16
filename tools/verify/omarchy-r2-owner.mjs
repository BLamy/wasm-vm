// Own the complete Wrangler/workerd process group. No credentials cross IPC.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function createWranglerProcessProxy({modulePath,configPath,record=async()=>{},startupTimeoutMs=45000,callTimeoutMs=300000,readTimeoutMs=20000,closeTimeoutMs=3000,workerPath=fileURLToPath(new URL('./omarchy-r2-worker.mjs',import.meta.url))}) {
  const child=fork(workerPath,[modulePath,configPath],{detached:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,WRANGLER_LOG:'error'}});
  const calls=new Map();let next=0,exited=false,closed=false,events=Promise.resolve(),eventError;
  const killed=()=>{
    if(!Number.isInteger(child.pid))return;
    try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  };
  const rejectCalls=error=>{for(const item of calls.values()){clearTimeout(item.timer);item.reject(error);}calls.clear();};
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  child.on('message',message=>{
    if(message.kind==='event'){events=events.then(()=>record(message.event)).catch(error=>{eventError=error;});return;}
    if(message.kind==='ready'){readyResolve();return;}
    if(message.kind==='startup-error'){readyReject(Error('Wrangler R2 startup failed: '+message.code));return;}
    const item=calls.get(message.id);if(!item)return;
    clearTimeout(item.timer);calls.delete(message.id);
    if(message.error)item.reject(Error(message.error));else item.resolve(message.result);
  });
  child.once('error',error=>{readyReject(error);rejectCalls(error);});
  child.once('exit',()=>{exited=true;killed();readyReject(Error('Owned Wrangler process exited'));rejectCalls(Error('Owned Wrangler process exited'));});
  const call=(method,args)=>new Promise((resolve,reject)=>{
    if(closed||exited){reject(Error('Owned Wrangler process is closed'));return;}
    const id=++next,timer=setTimeout(()=>{calls.delete(id);reject(Error('R2 '+method+' timed out'));killed();},method==='dispose'?closeTimeoutMs:method==='read'?readTimeoutMs:callTimeoutMs);
    calls.set(id,{resolve,reject,timer});
    child.send({id,method,args},error=>{if(error){clearTimeout(timer);calls.delete(id);reject(error);}});
  });
  let startupTimer;
  try{
    await Promise.race([ready,new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('Owned Wrangler startup timed out')),startupTimeoutMs);})]);
    await events;if(eventError)throw eventError;
    await record({phase:'wrangler-owned-process',pid:child.pid,group:child.pid});
  }catch(error){killed();throw error;}
  finally{clearTimeout(startupTimer);}
  return {env:{ASSETS:{put:(key,bytes,options)=>call('put',{key,bytes,options}),read:(key,limit)=>call('read',{key,limit})}},
    async dispose(){
      if(closed)return;
      try{if(!exited)await call('dispose',{});}finally{closed=true;killed();rejectCalls(Error('Owned Wrangler process closed'));await events;if(eventError)throw eventError;}
      await record({phase:'wrangler-owned-process-closed',pid:child.pid});
    }};
}
