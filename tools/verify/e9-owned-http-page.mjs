// Evidence adapter around the actual product probe: immutable-base delivery,
// raw captures and host-egress tripwires do not replace any guest/network work.
import {runOwnedHttpProbe} from '/owned-http-probe.js';
const enc=new TextEncoder();
export async function qualifyOwnedHttp() {
 let replayEgress=0, trapping=false;
 const liveFetch=globalThis.fetch,liveSocket=globalThis.WebSocket;
 const retain=async(name,bytes)=>{const response=await liveFetch('/__proof__/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('retain '+name);return response.json();};
 const trap=()=>{
  trapping=true;
  globalThis.fetch=()=>{replayEgress++;throw Error('live fetch during replay');};
  globalThis.WebSocket=class{constructor(){replayEgress++;throw Error('live socket during replay');}};
 };
 const restore=()=>{globalThis.fetch=liveFetch;globalThis.WebSocket=liveSocket;trapping=false;};
 let state;
 try{
  state=await runOwnedHttpProbe({baseUrl:location.origin+'/',retain,onProgress:async progress=>{
   if(progress.phase==='replay-start')trap();
   if(progress.phase==='replay-end')restore();
   await qualificationProgress(progress);
  }});
  state.replayEgress=replayEgress;
  if(replayEgress)throw Error('replay attempted host egress');
 }finally{if(trapping)restore();}
 document.querySelector('pre').textContent=state.status+'\n'+state.modes.map(row=>row.mode+'\n'+row.console).join('\n');
 // Keep the accepted public result vocabulary in the evidence harness only.
 if(state.status==='passed')state.status='owned-http-full-alpine-off-on-replay';
 return state;
}
