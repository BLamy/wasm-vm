#!/usr/bin/env node
// Independent74d1 bounded verifier. Real DOM/Canvas2D; no physical-GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]??path.join(repo,'target/evidence/critic-production-scanout-continuity74d1/headless01'));
const sabotage=process.argv.includes('--sabotage-clear');
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['web/linux-worker-protocol.js','web/main.js','web/renderer/virgl-command/production.mjs','web/renderer/virgl-command/scanout.mjs','web/renderer/virgl-command/checkpoint.mjs','web/src/sink/presentation.js','web/src/sink/virgl-scanout-presenter.js'];
await fs.mkdir(output,{recursive:true});
const predictions=[
 ['P1','A→B valid production bind retains every RGBA pixel of A until B draws.'],
 ['P2','A pending frame retires once as cancelled; its saved callback after B queues cannot consume B, and its receipt cannot satisfy B.'],
 ['P3','First B frame with1×1 damage uses its complete owned B buffer; no A pixel remains.'],
 ['P4','Invalidate before recovery removes A from latest; synthetic loss/fallback cannot replay A.'],
 ['P5','Disable/reset/teardown clear all alpha bytes and pending ownership.'],
 ['P6','B→C rapid binds retain A until C; B callback/receipt is stale.'],
 ['P7','Protocol1 ready/display/receipt messages cannot be accepted as protocol2.'],
 ['P8','Invalid preserveDisplay flags and stale bindings reject without erasing pixels or cancelling current ownership.'],
 ['P9','Active checkpoint gate forwards preservation; inactive replay suppresses historical frames; activation explicitly clears before fresh repair.'],
];
// Written before starting Chrome or inspecting any runtime result.
await fs.writeFile(path.join(output,'predictions.json'),JSON.stringify({recordedAt:new Date().toISOString(),predictions},null,2));
const report={task:'E6-T11d74d1',role:'independent verifier',scope:'headless real Canvas2D, source main handler, structured-clone wire; not physical GPU or native/MMIO',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),sabotage,predictions,sources:[],served:[],errors:[],results:[]};
const driver=await fs.readFile(fileURLToPath(import.meta.url));
report.driver={path:path.relative(repo,fileURLToPath(import.meta.url)),sha256:hash(driver),bytes:driver.length};
await fs.writeFile(path.join(output,'executed-verifier-driver.mjs'),driver);
const source=new Map();
for(const f of files){const b=await fs.readFile(path.join(repo,f));source.set(f,b);report.sources.push({path:f,sha256:hash(b),bytes:b.length});}
const main=source.get('web/main.js').toString(),begin=main.indexOf('let pendingGpuFrame = null, gpuFrameRequest = null;'),end=main.indexOf('\nfunction emitGuestLifecycleEvent',begin);
assert.ok(begin>=0&&end>begin,'exact main handler source anchors');
const body=main.slice(begin,end);
report.mainHandler={line:main.slice(0,begin).split('\n').length,sha256:hash(body),bytes:body.length};
const adapter=`export function makeHandle(presentation,scheduler){const requestAnimationFrame=scheduler.requestFrame,cancelAnimationFrame=scheduler.cancelFrame;const displayViewport=null,displayStatusEl=null;\n${body}\nreturn {handle:handleDisplayFrame,inspect:()=>({pending:!!pendingGpuFrame,scheduled:gpuFrameRequest!==null})};}`;
const checkpoint=source.get('web/renderer/virgl-command/checkpoint.mjs').toString(),gateBegin=checkpoint.indexOf('function presentationGate(target, enabled) {'),gateEnd=checkpoint.indexOf('\nfunction owner(',gateBegin);
assert.ok(gateBegin>=0&&gateEnd>gateBegin,'exact checkpoint gate source anchors');
const gateBody=checkpoint.slice(gateBegin,gateEnd);
report.checkpointGate={line:checkpoint.slice(0,gateBegin).split('\n').length,sha256:hash(gateBody),bytes:gateBody.length};
const gateAdapter=`const need=(value,message)=>{if(!value)throw Error('GPU checkpoint: '+message);};const unwrap=value=>{need(value?.ok===true,value?.error?.message??'renderer operation failed');return value;};export ${gateBody}`;
let context,server;const profile=await fs.mkdtemp(path.join(os.tmpdir(),'wasm-vm-critic74d1-headless-'));
const html='<!doctype html><meta charset="utf-8"><title>Independent scanout verifier</title><style>canvas{width:400px;height:300px;image-rendering:pixelated;border:1px solid}</style><main></main>';
try{
  server=createServer(async(req,res)=>{try{
    const name=new URL(req.url,'http://localhost').pathname;
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    let b;if(name==='/critic-main-handler.js')b=Buffer.from(adapter);
    else if(name==='/critic-checkpoint-gate.js')b=Buffer.from(gateAdapter);
    else{const filename=path.resolve(repo,'web','.'+name);assert.ok(filename.startsWith(path.join(repo,'web')+'/'));b=source.get(path.relative(repo,filename))??await fs.readFile(filename);}
    if(sabotage&&name==='/renderer/virgl-command/production.mjs'){
      const before=b.toString(),anchor="generation = next; send({type:preserveDisplay?'invalidate':'clear'}); return {ok:true};";
      assert.equal(before.split(anchor).length,2,'unique old-clear sabotage anchor');b=Buffer.from(before.replace(anchor,"generation = next; send({type:'clear'}); return {ok:true};"));
    }
    report.served.push({path:name,sha256:hash(b),bytes:b.length});res.setHeader('Content-Type',name.endsWith('.json')?'application/json':'text/javascript');res.end(b);
  }catch(e){report.errors.push({request:req.url,error:String(e)});res.writeHead(404).end(String(e));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  context=await chromium.launchPersistentContext(profile,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu','--no-first-run'],viewport:{width:900,height:800}});
  report.browser={version:context.browser()?.version(),headless:true,profile,physicalGpu:false};
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const coverageSession=await context.newCDPSession(page);await coverageSession.send('Profiler.enable');await coverageSession.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  report.results=await page.evaluate(async()=>{
    const {PresentationController}=await import('/src/sink/presentation.js');
    const {Canvas2DBackend}=await import('/src/sink/canvas2d.js');
    const {createVirglScanoutPresenter}=await import('/src/sink/virgl-scanout-presenter.js');
    const {createWorkerScanoutPresenter}=await import('/renderer/virgl-command/production.mjs');
    const {createRetainedScanout}=await import('/renderer/virgl-command/scanout.mjs');
    const {createLinuxWorkerClient,createLinuxWorkerRuntime,LINUX_WORKER_PROTOCOL_VERSION}=await import('/linux-worker-protocol.js');
    const {makeHandle}=await import('/critic-main-handler.js');
    const {presentationGate}=await import('/critic-checkpoint-gate.js');
    const results=[],A=0xff102030,B=0xff506070,C=0xff90a0b0,W=4,H=3;
    const gen=n=>n.toString(16).padStart(16,'0');
    const expected=word=>Array.from({length:W*H},()=>[word>>>16&255,word>>>8&255,word&255,word>>>24]).flat();
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const demand=(v,m)=>{if(!v)throw Error(m);};
    const checked=r=>{demand(r?.ok,JSON.stringify(r));return r;};
    const frame=(word,partial=false)=>({scanout:0,format:1,resourceWidth:W,resourceHeight:H,rect:partial?{x:1,y:1,width:1,height:1}:{x:0,y:0,width:W,height:H},pixels:new Uint32Array(W*H).fill(word)});
    const canvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;document.querySelector('main').append(c);return c;};
    const scheduler=()=>{let id=0;const live=new Map(),history=new Map();return {requestFrame:fn=>{live.set(++id,fn);history.set(id,fn);return id;},cancelFrame:key=>live.delete(key),tick(){const list=[...live];live.clear();for(const [,fn]of list)fn(0);},ghost(){for(const fn of history.values())fn(0);},ghostOne:key=>history.get(key)?.(0),last:()=>id,size:()=>live.size};};
    const turns=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
    const run=async(name,fn)=>{try{results.push({name,status:'HELD',...(await fn())});}catch(e){results.push({name,status:'FAILED',message:String(e),stack:e.stack});}};
    const pair=()=>{const p={listeners:new Set()},w={listeners:new Set()};for(const [x,y]of [[p,w],[w,p]]){x.addEventListener=(t,f)=>x.listeners.add(f);x.removeEventListener=(t,f)=>x.listeners.delete(f);x.postMessage=(m,transfer=[])=>{const clone=structuredClone(m,{transfer});queueMicrotask(()=>{for(const f of y.listeners)f({data:clone});});};x.terminate=()=>{};}return {p,w};};
    const rig=async()=>{
      const c=canvas(),s=scheduler(),pc=new PresentationController(c,{scheduleFrames:true,requestFrame:s.requestFrame,cancelFrame:s.cancelFrame});pc.setViewport(W,H);
      const host=makeHandle(pc,s),{p,w}=pair(),wire=[],acks=[];let done;
      const completed=new Promise(resolve=>{done=resolve;});
      const runtime=createLinuxWorkerRuntime(w,{startBoot:async opts=>{opts.onGpuFrameAcknowledger((...a)=>presenter.acknowledge(...a));return {whenDone:completed,acknowledgeGpuFrame:(...a)=>{const accepted=presenter.acknowledge(...a);acks.push({token:a[0],status:a[1],accepted});return accepted;},async stop(){done('stopped');}};}});
      const presenter=createWorkerScanoutPresenter(f=>{wire.push(structuredClone(f));runtime.callbacks.onDisplayFrame(f);});
      const client=createLinuxWorkerClient(p,{onDisplayFrame:host.handle,onError:e=>{throw e;}}),controller=await client.boot({});
      const gate=presentationGate(presenter,true);
      const scan=createRetainedScanout({production:true,presenter:gate.presenter,getOwners:()=>({}),resolveResource:()=>{throw Error('unexpected renderer resource resolution in2D wire check');},onFault:e=>{throw e;}});
      const bind=(n,disabled=false)=>checked(scan.bind({epoch:gen(1),binding:{generation:gen(n),rect:{x:0,y:0,width:W,height:H},target:disabled?{kind:'disabled'}:{kind:'2d',resourceId:n,format:1,width:W,height:H}}}));
      return {c,s,pc,host,wire,presenter,scan,acks,bind,read:()=>[...pc.readPixels()],send:async(word,partial=false)=>{checked(scan.present2D(frame(word,partial)));await turns();},flush:async()=>{await turns();s.tick();await turns();},async close(){checked(scan.dispose());await turns();await controller.stop();pc.dispose();}};
    };
    await run('P1/P2/P3/P6/P9 retained production2D→active checkpoint gate→wire→exact main handler, fixed viewport',async()=>{
      const r=await rig();try{
        r.bind(1);await r.send(A);await r.flush();demand(equal(r.read(),expected(A)),'A initial full frame');
        await r.send(C);const old=r.wire.at(-1).presentationToken,oldRequest=r.s.last();r.bind(2);await turns();
        const between=r.read();demand(equal(between,expected(A)),'valid bind blanked/changed A before B');
        demand(r.scan.inspect().retirements.filter(x=>x.status==='cancelled').length===1,'old frame cancelled exactly once');
        demand(!r.presenter.acknowledge(old,'drawn'),'old receipt accepted after bind');r.s.ghost();demand(equal(r.read(),expected(A)),'cancelled old callback painted C');
        await r.send(B,true);const priorRetirements=r.scan.inspect().retirements.length;r.s.ghostOne(oldRequest);await turns();demand(equal(r.read(),expected(A))&&r.host.inspect().pending&&r.scan.inspect().retirements.length===priorRetirements,'cancelled old callback consumed new B ownership');await r.flush();const partial=r.read();demand(equal(partial,expected(B)),'first B partial did not repaint its complete owned buffer');
        await r.send(A);const btoken=r.wire.at(-1).presentationToken;r.bind(3);r.bind(4);await turns();r.s.ghost();demand(equal(r.read(),expected(B)),'rapid binds changed visible B');demand(!r.presenter.acknowledge(btoken,'drawn'),'rapid-rebind old receipt accepted');
        await r.send(C,true);await r.flush();demand(equal(r.read(),expected(C)),'C partial full repaint');
        return {between,partial,wire: r.wire.map(f=>({type:f.type??'frame',token:f.presentationToken??null})),retirements:r.scan.inspect().retirements,acks:r.acks,state:r.pc.snapshot()};
      }finally{await r.close();}
    });
    await run('P5 explicit disabled bind, reset and teardown',async()=>{
      const r=await rig();try{
        r.bind(1);await r.send(A);await r.flush();r.bind(2,true);await turns();const disabled=r.read();demand(disabled.every(x=>x===0),'disable retained visible bytes');
        r.bind(3);await r.send(B);await r.flush();checked(r.scan.reset());await turns();const reset=r.read();demand(reset.every(x=>x===0),'reset retained visible bytes');
        r.bind(4);await r.send(C);await r.flush();checked(r.scan.dispose());await turns();const teardown=r.read();demand(teardown.every(x=>x===0),'teardown retained visible bytes');return {disabled,reset,teardown};
      }finally{await r.close();}
    });
    await run('P1/P2/P3 ordinary scheduled controller',async()=>{
      const s=scheduler(),pc=new PresentationController(canvas(),{scheduleFrames:true,requestFrame:s.requestFrame,cancelFrame:s.cancelFrame});pc.setViewport(W,H);
      try{pc.present(frame(A));s.tick();pc.present(frame(C));pc.present({type:'invalidate'});demand(equal([...pc.readPixels()],expected(A)),'ordinary invalidate blanked A');s.ghost();demand(equal([...pc.readPixels()],expected(A)),'ordinary old queue drew C');pc.present(frame(B,true));s.tick();const pixels=[...pc.readPixels()];demand(equal(pixels,expected(B)),'ordinary first B partial kept A');return {pixels,state:pc.snapshot()};}finally{pc.clear();pc.dispose();}
    });
    await run('P4 synthetic loss/fallback after invalidate (real Canvas2D, explicitly injected WebGL label)',async()=>{
      const pc=new PresentationController(canvas(),{defaultBackend:'webgl2',backendFactories:{webgl2:c=>new Canvas2DBackend(c)}});pc.setViewport(W,H);
      try{pc.present(frame(A));demand(equal([...pc.canvas.getContext('2d').getImageData(0,0,W,H).data],expected(A)),'A before injected loss');pc.invalidate();const before=pc.snapshot();demand(before.latest===null,'invalidate retained recovery A');pc.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));const pixels=[...pc.readPixels()],after=pc.snapshot();demand(pixels.every(x=>x===0),'recovery resurrected A');demand(after.replayedFrames===0&&after.contextLosses===1,'old recovery replay counted');pc.canvas.dispatchEvent(new Event('webglcontextrestored'));pc.present(frame(B,true));demand(equal([...pc.readPixels()],expected(B)),'new B after recovery');return {before,after,pixels,synthetic:true,physicalWebgl:false};}finally{pc.clear();pc.dispose();}
    });
    await run('P3 default non-fixed retained presenter probe',async()=>{
      const s=scheduler(),p=checked(createVirglScanoutPresenter({canvas:canvas(),requestFrame:s.requestFrame,cancelFrame:s.cancelFrame})).presenter,receipts=[];
      try{checked(p.rebind(gen(1)));checked(p.enqueueOwned({bindingGeneration:gen(1),frame:frame(A)},r=>receipts.push(r)));s.tick();checked(p.rebind(gen(2),true));demand(equal([...checked(p.readPixels()).bytes],expected(A)),'non-fixed preserve erased A');checked(p.enqueueOwned({bindingGeneration:gen(2),frame:frame(B,true)},r=>receipts.push(r)));s.tick();const pixels=[...checked(p.readPixels()).bytes];demand(equal(pixels,expected(B)),'non-fixed first partial leaves old resource pixels: '+JSON.stringify(pixels));return {pixels,receipts,state:p.inspect()};}finally{checked(p.dispose());}
    });
    await run('P8 invalid preservation flags and stale bindings leave ownership intact',async()=>{
      const messages=[],retired=[],worker=createWorkerScanoutPresenter(f=>messages.push(f));checked(worker.rebind(gen(1)));checked(worker.enqueueOwned({bindingGeneration:gen(1),frame:frame(A)},r=>retired.push(r)));
      demand(!worker.rebind(gen(2),'true').ok&&!worker.rebind(gen(1),true).ok,'worker accepted invalid flag/generation');demand(worker.inspect().generation===gen(1)&&worker.inspect().retainedFrames===1&&retired.length===0&&messages.length===2,'invalid worker bind mutated ownership');worker.dispose();
      const s=scheduler(),p=checked(createVirglScanoutPresenter({canvas:canvas(),requestFrame:s.requestFrame,cancelFrame:s.cancelFrame})).presenter;
      try{checked(p.rebind(gen(1)));checked(p.enqueueOwned({bindingGeneration:gen(1),frame:frame(A)},()=>{}));s.tick();checked(p.enqueueOwned({bindingGeneration:gen(1),frame:frame(B)},r=>retired.push(r)));const before=p.inspect();demand(!p.rebind(gen(2),'true').ok&&!p.rebind(gen(1),true).ok,'retained presenter accepted invalid flag/generation');demand(equal([...checked(p.readPixels()).bytes],expected(A))&&p.inspect().pending===1&&p.inspect().bindingGeneration===gen(1),'invalid retained bind changed display/ownership');s.tick();demand(equal([...checked(p.readPixels()).bytes],expected(B)),'current B failed after invalid bind');return {workerMessages:messages.length,retainedBefore:before,retainedAfter:p.inspect()};}finally{p.dispose();}
    });
    await run('P9 staged checkpoint gate suppresses history, activation clears, new frame draws',async()=>{
      const s=scheduler(),target=checked(createVirglScanoutPresenter({canvas:canvas(),requestFrame:s.requestFrame,cancelFrame:s.cancelFrame})).presenter,retired=[];
      try{checked(target.rebind(gen(1)));checked(target.enqueueOwned({bindingGeneration:gen(1),frame:frame(A)},()=>{}));s.tick();const gate=presentationGate(target,false);checked(gate.presenter.rebind(gen(2),true));checked(gate.presenter.enqueueOwned({bindingGeneration:gen(2),frame:frame(B)},r=>retired.push(r)));demand(equal([...checked(target.readPixels()).bytes],expected(A))&&retired.length===1&&retired[0].status==='cancelled','historical checkpoint frame escaped staging');const staged=gate.presenter.inspect();gate.activate();const activated=[...checked(target.readPixels()).bytes];demand(activated.every(x=>x===0),'activation retained historical A');checked(gate.presenter.enqueueOwned({bindingGeneration:gen(2),frame:frame(B,true)},r=>retired.push(r)));s.tick();demand(equal([...checked(target.readPixels()).bytes],expected(B)),'fresh post-activation partial B failed');return {staged,activated,retired,after:target.inspect()};}finally{target.dispose();}
    });
    await run('P7 protocol1 rejected at client and runtime, no display or receipt dispatch',async()=>{
      const events=[],endpoint=()=>({listeners:new Set(),addEventListener(t,f){this.listeners.add(f);},removeEventListener(t,f){this.listeners.delete(f);},postMessage(m){events.push(m);},terminate(){events.push('terminated');}});
      const e=endpoint(),errors=[],frames=[],client=createLinuxWorkerClient(e,{onError:x=>errors.push(String(x)),onDisplayFrame:x=>frames.push(x)});client.boot({}).catch(()=>{});
      for(const f of e.listeners)f({data:{type:'display',version:1,frame:{type:'invalidate'}}});await turns();demand(errors.length===1&&frames.length===0,'client accepted stale invalidate');
      let receipts=0;const rt=createLinuxWorkerRuntime(endpoint(),{startBoot:async()=>{throw Error('must not boot');}});rt.callbacks.onGpuFrameAcknowledger(()=>{receipts++;});rt.handleMessage({data:{type:'display-retired',version:1,token:{sequence:1,generation:gen(1)},status:'drawn'}});await turns();demand(receipts===0,'runtime accepted version1 receipt');return {version:LINUX_WORKER_PROTOCOL_VERSION,errors,frames:frames.length,receipts,wire:events};
    });
    return results;
  });
  const coverage=await coverageSession.send('Profiler.takePreciseCoverage');
  const changedUrls=new Set(['/critic-main-handler.js','/critic-checkpoint-gate.js',...files.filter(f=>f!=='web/main.js').map(f=>'/'+f.slice(4))]);
  const changedCoverage=coverage.result.filter(s=>{try{return changedUrls.has(new URL(s.url).pathname);}catch{return false;}});
  await fs.writeFile(path.join(output,'coverage.json'),JSON.stringify(changedCoverage,null,2));report.coverage={path:'coverage.json',sha256:hash(JSON.stringify(changedCoverage,null,2)),scripts:changedCoverage.map(s=>s.url)};
  await coverageSession.send('Profiler.stopPreciseCoverage');
  await page.screenshot({path:path.join(output,'canvas-checks.png'),fullPage:true});
  await context.tracing.stop({path:path.join(output,'playwright-trace.zip')});
}catch(e){report.errors.push({fatal:String(e),stack:e.stack});}
finally{if(context)await context.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true});report.completedAt=new Date().toISOString();report.status=report.errors.length||report.results.some(r=>r.status==='FAILED')?'findings':'held-within-scope';await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));process.exitCode=report.status==='findings'?1:0;console.log(JSON.stringify({output,status:report.status,results:report.results.map(({name,status,message})=>({name,status,message})),errors:report.errors},null,2));}
