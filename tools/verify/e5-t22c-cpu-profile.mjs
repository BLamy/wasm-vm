// Diagnostic-only CPU sampling of this test's actual whole-machine worker.
// CDP Target routing and Profiler: https://chromedevtools.github.io/devtools-protocol/
import assert from "node:assert/strict";

export async function attachWorkerProfiler(browser, url) {
  const root=await browser.newBrowserCDPSession();
  let sessionId,nextId=0,active=false;
  const pending=new Map();
  const receive=event=>{
    if(event.sessionId!==sessionId)return;
    const message=JSON.parse(event.message),request=pending.get(message.id);
    if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    if(message.error)request.reject(Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  root.on("Target.receivedMessageFromTarget",receive);
  async function send(method,params={}) {
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error("bounded CDP wait: "+method));},10000);
      pending.set(id,{resolve,reject,timer});
      root.send("Target.sendMessageToTarget",{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{
        const request=pending.get(id);if(!request)return;
        clearTimeout(timer);pending.delete(id);reject(error);
      });
    });
  }
  try {
    const matches=(await root.send("Target.getTargets")).targetInfos.filter(t=>t.type==="worker"&&t.url===url);
    assert.equal(matches.length,1,"one exact owned worker target");
    ({sessionId}=await root.send("Target.attachToTarget",{targetId:matches[0].targetId,flatten:false}));
    await send("Profiler.enable");
    await send("Profiler.setSamplingInterval",{interval:1000});
  } catch(error) {root.off("Target.receivedMessageFromTarget",receive);await root.detach();throw error;}
  return {
    async start(){assert.equal(active,false);await send("Profiler.start");active=true;},
    async stop(){assert.equal(active,true);const result=await send("Profiler.stop");active=false;return {url,intervalUs:1000,browser:browser.version(),...result};},
    async close(){
      try{if(active)await send("Profiler.stop");await root.send("Target.detachFromTarget",{sessionId});}
      finally{active=false;root.off("Target.receivedMessageFromTarget",receive);
        for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error("profiler closed"));}
        pending.clear();await root.detach();}
    },
  };
}
