#!/usr/bin/env node
// Real production worker + supervisor original MMIO guest. This is not a Linux/Mesa claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(process.cwd());
const output=path.resolve(process.argv[2]),mode=process.argv[3]??'healthy';
const driverBytes=await fs.readFile(fileURLToPath(import.meta.url));
assert.ok(['healthy','no-disk-witness'].includes(mode));await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'driver-executed.mjs'),driverBytes);
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=new Map(),served=new Map(),pairs=new Map(),errors=[];
async function freeze(directory){for(const entry of await fs.readdir(path.join(repo,directory),{withFileTypes:true})){
  const name=path.posix.join(directory,entry.name);
  if(entry.isDirectory()){if(!['node_modules','dist','test-results','tests'].includes(entry.name))await freeze(name);}
  else if(/\.(m?js|wasm)$/.test(entry.name))sources.set('/'+name.slice(4),{name,bytes:await fs.readFile(path.join(repo,name))});
}}
for(const entry of await fs.readdir(path.join(repo,'web'),{withFileTypes:true}))if(entry.isFile()&&/\.m?js$/.test(entry.name)){
  const name='web/'+entry.name;sources.set('/'+entry.name,{name,bytes:await fs.readFile(path.join(repo,name))});
}
for(const name of ['web/src','web/renderer','web/pkg'])await freeze(name);
let negativeControl=null;
if(mode==='no-disk-witness'){const item=sources.get('/gpu-checkpoint.js'),needle='clockState:clock,rendererSha256,diskSha256}';assert.equal(item.bytes.toString().split(needle).length,2,'one exact tagged disk-witness field');const original=item.bytes;await fs.writeFile(path.join(output,'negative-control-original-gpu-checkpoint.js'),original);item.bytes=Buffer.from(original.toString().replace(needle,'clockState:clock,rendererSha256 /* critic isolated omitted disk binding */}'));negativeControl={path:item.name,originalSha256:sha(original),servedSha256:sha(item.bytes),delta:'Omit only diskSha256 from the shared producer/decoder native witness encoding, leaving all original components and repository untouched'};}
const kernel=await fs.readFile(path.join(repo,'guest/prebuilt/production-gpu-pair.bin')),chunk=Buffer.alloc(262144),chunkHash=sha(chunk);
const image=Buffer.from(JSON.stringify({version:1,image_len:chunk.length,chunk_size:chunk.length,layout:'split',chunks:[chunkHash]}));
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Paired production GPU worker</title><style>body{background:#10151c;color:#eee;font:14px monospace}canvas{width:384px;height:384px;image-rendering:pixelated;border:1px solid #789}pre{white-space:pre-wrap}</style><h1>Paired production GPU worker</h1><p>Original MMIO supervisor guest; Linux/Mesa is verified separately.</p><canvas id="display" width="64" height="64" tabindex="0"></canvas><pre id="serial"></pre>');
const guestSources=new Map();for(const name of ['main.c','start.S','link.ld','commands.h','build.mjs'])guestSources.set(name,await fs.readFile(path.join(repo,'tools/virgl-production/paired-guest',name)));
const report={schema:'production-paired-worker-v1',driver:{bytes:driverBytes.length,sha256:sha(driverBytes)},status:'running',mode,guest:'supervisor original-MMIO; not Linux/Mesa',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),sources:[...sources.values()].map(s=>({path:s.name,bytes:s.bytes.length,sha256:sha(s.bytes)})),kernel:{bytes:kernel.length,sha256:sha(kernel)},image:{bytes:image.length,sha256:sha(image)},errors,phases:[],negativeControl,observations:[],guestSources:[...guestSources].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha(bytes)}))};
let browser,page;
const shaderFixture=JSON.parse(await fs.readFile(path.join(repo,'tools/virgl-production/fixtures/critic-paired-worker-vertex.json'),'utf8')),observedShaders=[shaderFixture.vertex];
const lossBootstrap=Buffer.from(`// Critic physical-fault observer; original calls, promise results and transport are forwarded.
const phase=new URL(location.href).searchParams.get('phase')??'replay';let nativeGl=null,captureStarted=false,captureFired=false;
addEventListener('message',event=>{if(event.data?.type==='call'&&event.data.method==='saveGpuCheckpoint')captureStarted=true;});
const originalDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...args)=>{const promise=originalDigest(...args);if(phase==='capture'&&captureStarted&&nativeGl&&!captureFired){captureFired=true;queueMicrotask(()=>{nativeGl.getExtension('WEBGL_lose_context').loseContext();console.log('CRITIC_CONTEXT_LOSS_TRIGGER '+JSON.stringify({actualLost:nativeGl.isContextLost(),phase:'capture',call:'digest'}));});}return promise;};
const Original=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=function(...args){const canvas=new Original(...args),get=canvas.getContext.bind(canvas);canvas.getContext=function(...args){const native=get(...args);if(!native||args[0]!=='webgl2')return native;nativeGl=native;const shaders=new Set(),programs=new Set();let current=null,fired=false;return new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...values)=>{if(name==='shaderSource'&&${JSON.stringify(observedShaders)}.includes(values[1]))shaders.add(values[0]);if(name==='attachShader'&&shaders.has(values[1]))programs.add(values[0]);if(name==='useProgram')current=values[0];const result=method.apply(target,values);if(phase==='replay'&&!fired&&programs.has(current)&&['drawArrays','drawElements'].includes(name)){fired=true;target.getExtension('WEBGL_lose_context').loseContext();console.log('CRITIC_CONTEXT_LOSS_TRIGGER '+JSON.stringify({actualLost:target.isContextLost(),phase:'replay',call:name}));}return result;};}});};return canvas;};globalThis.OffscreenCanvas.prototype=Original.prototype;await import('/linux-worker.js');postMessage({criticObserverReady:true});
`);report.contextLossObserver={sourceSha256:sha(lossBootstrap),shaderReferenceRowSha256:shaderFixture.provenance.workerRowSha256,shaderHashes:observedShaders.map(t=>sha(t)),scope:'Only physical context loss candidate uses this bootstrap. Actual methods/returns/transport remain original; native GL extension performs loss.'};
const server=createServer(async(req,res)=>{
  try{
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    if(req.method==='POST'&&/^\/pair\/[a-z0-9-]+$/.test(name)){
      const parts=[];let size=0;for await(const part of req){size+=part.length;assert.ok(size<=512*1024*1024);parts.push(part);}
      const bytes=Buffer.concat(parts);pairs.set(name,bytes);await fs.writeFile(path.join(output,name.slice(6)+'.wvgpair'),bytes);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:name,bytes:bytes.length,sha256:sha(bytes)}));return;
    }
    let bytes,type='application/octet-stream',source;
    if(name==='/'){bytes=html;type='text/html';}
    else if(name==='/kernel.bin')bytes=kernel;
    else if(name==='/critic-loss-worker.js'){bytes=lossBootstrap;type='text/javascript';}
    else if(name==='/guest/manifest.json'){bytes=image;type='application/json';}
    else if(name==='/guest/chunks/'+chunkHash+'.bin')bytes=chunk;
    else if(name==='/boot.json'){
      const pairName=url.searchParams.get('pair'),pair=pairName?pairs.get('/pair/'+pairName):null;
      assert.ok(!pairName||pair,'unknown saved pair');
      bytes=Buffer.from(JSON.stringify({artifacts:{kernel:{url:'/kernel.bin',size:kernel.length,sha256:sha(kernel)},...(pair?{gpuCheckpoint:{url:'/pair/'+pairName,size:pair.length,sha256:sha(pair)}}:{})}}));type='application/json';
    }else if(pairs.has(name))bytes=pairs.get(name);
    else if(sources.has(name)){source=sources.get(name);bytes=source.bytes;type=name.endsWith('.wasm')?'application/wasm':'text/javascript';}
    else throw Error('unknown frozen path '+name);
    served.set(name,{path:source?.name??name,bytes:bytes.length,sha256:sha(bytes)});res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length}).end(bytes);
  }catch(error){res.writeHead(404).end(String(error));}
});
async function state(label){
  const value=await page.evaluate(async()=>{
    const p=globalThis.__paired,c=p.controller,canvas=document.querySelector('#display'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
    const context=copy.getContext('2d');context.drawImage(canvas,0,0);const pixel=[...context.getImageData(32,32,1,1).data];
    return {serial:p.serial,errors:p.errors,states:p.states,events:p.events,gpu:await c.gpuStats(),clock:await c.guestClockState(),scheduler:await c.schedulerStats(),input:await c.inputDeviceStats(),restored:await c.restoredFromBootSnapshot(),paused:await c.isPaused(),display:p.presentation.snapshot(),cursor:p.cursor,frames:p.frames,pixel,trusted:p.trusted};
  });
  await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(value,null,2)+'\n');report.phases.push({label,sha256:sha(Buffer.from(JSON.stringify(value,null,2)+'\n'))});return value;
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));report.hardware={gpu:system.gpu,commandLine:command.arguments,version:browser.version()};
  page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:1});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());else if(m.text().startsWith('CRITIC_'))report.observations.push({text:m.text()});});page.on('pageerror',e=>errors.push(e.stack));
  await fs.writeFile(path.join(output,'lease.json'),JSON.stringify({status:'frozen',buildIdSourceSha256:sha(sources.get('/gpu-checkpoint-build.js').bytes),sources:report.sources,negativeControl},null,2)+'\n');console.log('SOURCES_FROZEN '+report.sources.length);
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async()=>{
    const {createLinuxWorkerClient}=await import('/linux-worker-protocol.js'),{PresentationController}=await import('/src/sink/presentation.js');
    const {createKeyboardBridge,createWasmKeyboardAdapter,attachKeyboardBridge}=await import('/src/input/keyboard.js');
    const {createPointerBridge,createWasmPointerAdapter,attachPointerBridge}=await import('/src/input/pointer.js');
    const canvas=document.querySelector('#display');
    globalThis.__startPair=async (pair,{lossObserver=false,stopOnApplied=false,extra={}}={})=>{
      const previous=globalThis.__paired;if(previous){for(const detach of previous.detach)detach();if(previous.controller)await previous.controller.stop();previous.worker.terminate();}
      const worker=new Worker(lossObserver?'/critic-loss-worker.js?phase='+((lossObserver===true)?'replay':lossObserver):'/linux-worker.js',{type:'module'});if(lossObserver)await new Promise(resolve=>worker.addEventListener('message',function ready(event){if(event.data?.criticObserverReady){worker.removeEventListener('message',ready);resolve();}}));const presentation=new PresentationController(canvas,{scheduleFrames:false}),decoder=new TextDecoder();
      const p=globalThis.__paired={worker,presentation,serial:'',errors:[],states:[],cursor:[],frames:[],trusted:[],events:[],detach:[],retirements:[],wire:[]};
      worker.addEventListener('message',event=>{const m=event.data;if(m?.type==='display')p.wire.push({type:m.type,token:m.frame?.presentationToken,rect:m.frame?.rect});});
      let appliedResolve;const applied=new Promise(resolve=>{appliedResolve=resolve;});
      const client=createLinuxWorkerClient(worker,{bootTimeoutMs:90000,
        onOutput(bytes){p.serial+=decoder.decode(bytes,{stream:true});document.querySelector('#serial').textContent=p.serial.slice(-6000);},
        onState(value){p.states.push(value);},onCursorState(value){p.cursor.push(value);},onError(error){p.errors.push(String(error));},
        onGpuEvent(event){if(event.type==='context-lost')p.errors.push('context lost');if(['checkpoint-loaded','context-lost','loss-injected','qualified'].includes(event.type))p.events.push(event);if(event.type==='checkpoint-loaded')appliedResolve({forbiddenNativeApplication:true,event});},
        onDisplayFrame(frame){if(frame.onRetired)p.retirements.push(frame.onRetired);if(frame.type==='clear'){presentation.clear();return;}requestAnimationFrame(()=>{try{
          const before=presentation.snapshot().drawnPresents,accepted=presentation.present(frame),after=presentation.snapshot();
          p.frames.push({token:frame.token??frame.retirementToken,accepted,drawn:after.drawnPresents>before});
          frame.onRetired?.(accepted&&after.drawnPresents>before?'drawn':'failed',{backend:after.backend});
        }catch(error){p.errors.push(String(error));frame.onRetired?.('failed');}});},
      });
      const start=performance.now();const boot=client.boot({mode:'chunked',manifestUrl:'/boot.json'+(pair?'?pair='+pair:''),imageManifestUrl:'/guest/manifest.json',baseUrl:location.origin+'/guest/',bootProfileUrl:null,persist:false,bootSnapshot:!!pair,ramMib:64,bootargs:'console=ttyS0',virgl:true,gpuTrace:true,guestClock:'icount',icountDivider:64,interactiveClock:'paced-on-keyboard',jit:true,quantum:10000,...extra});if(stopOnApplied){const outcome=await Promise.race([boot.then(controller=>({controller}),error=>({error:String(error.message||error)})),applied]);if(outcome.forbiddenNativeApplication){p.forbiddenNativeApplication=outcome;worker.terminate();return outcome;}if(outcome.error){worker.terminate();throw Error(outcome.error);}p.controller=outcome.controller;}else p.controller=await boot;p.bootMs=performance.now()-start;
      p.detach.push(attachKeyboardBridge(canvas,createKeyboardBridge(createWasmKeyboardAdapter(p.controller))));
      p.detach.push(attachPointerBridge(canvas,createPointerBridge(createWasmPointerAdapter(p.controller),{target:canvas,serializeTransport:true})));
      const trusted=event=>p.trusted.push({type:event.type,code:event.code??null,isTrusted:event.isTrusted});for(const name of ['keydown','keyup','pointermove']){canvas.addEventListener(name,trusted);p.detach.push(()=>canvas.removeEventListener(name,trusted));}
      return {bootMs:p.bootMs,restored:await p.controller.restoredFromBootSnapshot()};
    };
    globalThis.__savePair=async name=>{
      const c=__paired.controller;await c.pause();const before={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};
      const bytes=await c.saveGpuCheckpoint(),after={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};
      const response=await fetch('/pair/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('pair publication failed');
      return {before,after,pin:await response.json()};
    };
  });
  const evalCase=async(name,fn)=>{const value=await fn();report.phases.push({label:name,outcome:value});await fs.writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n');return value;};
  report.cold=await page.evaluate(()=>__startPair(null));
  await page.waitForFunction(()=>__paired.serial.includes('PAIR_FRAME_M')||__paired.serial.includes('PAIR_FAIL'),null,{timeout:45000});
  await page.waitForFunction(()=>__paired.presentation.snapshot().drawnPresents>=2,null,{timeout:45000});
  const cold=await state('source-green');assert.ok(!cold.serial.includes('PAIR_FAIL'));assert.deepEqual(cold.pixel,[0,255,0,255]);assert.deepEqual(cold.errors,[]);
  report.captureA=await page.evaluate(()=>__savePair('a'));
  assert.deepEqual(report.captureA.before,report.captureA.after,'save drains without clock/retirement progress');
  await page.evaluate(()=>__paired.controller.resume());await page.locator('#display').focus();await page.keyboard.press('b',{delay:50});
  await page.waitForFunction(()=>__paired.serial.includes('PAIR_KEY_BLUE')&&__paired.serial.includes('PAIR_FRAME_Z'),null,{timeout:15000});
  await page.waitForTimeout(30);report.captureB=await page.evaluate(()=>__savePair('b'));assert.deepEqual(report.captureB.before,report.captureB.after);
  await page.evaluate(()=>{globalThis.__oldReceipts={callbacks:__paired.retirements.slice(),wire:__paired.wire.slice()};});
  const mixed=await page.evaluate(async()=>{
    const {decodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs');const codec=await import('/gpu-checkpoint.js');
    const ab=new Uint8Array(await(await fetch('/pair/a')).arrayBuffer()),bb=new Uint8Array(await(await fetch('/pair/b')).arrayBuffer()),identity=decodeCheckpointData(ab.subarray(16,-32)).identity;
    const a=await codec.decodeGpuCheckpointPair(ab,identity),b=await codec.decodeGpuCheckpointPair(bb,identity);
    function disk(delta,marker){const v=new DataView(delta.buffer,delta.byteOffset,delta.length);if(new TextDecoder().decode(delta.subarray(0,5))!=='WVOD1'||v.getUint32(5,true)!==4096)throw Error('unexpected actual disk format');const count=v.getUint32(57,true);if(delta.length!==61+count*4104)throw Error('actual disk framing');let found=false;for(let i=0;i<count;i++){const at=61+i*4104;if(v.getBigUint64(at,true)===1n){if(!delta.subarray(at+8,at+8+512).every(n=>n===marker))throw Error('literal real disk marker differs');found=true;}}if(!found)throw Error('original guest write block absent');return {generation:v.getBigUint64(49,true).toString(),base:[...delta.subarray(17,49)],marker};}
    const da=disk(a.disk,0x4d),db=disk(b.disk,0x7a);if(da.generation!==db.generation||JSON.stringify(da.base)!==JSON.stringify(db.base))throw Error('attack must retain same base/generation');
    const upload=async(name,bytes)=>{const response=await fetch('/pair/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('fixture upload failed');return response.json();};
    const mixed=await upload('mixed',await codec.encodeGpuCheckpointPair({...a,disk:b.disk}));
    const profile=structuredClone(a.profile);profile.hostWords[0]=0xffffffff;const unsupported=await upload('unsupported',await codec.encodeGpuCheckpointPair({...a,profile}));
    const corrupt=new Uint8Array(ab);corrupt[18]^=1;await upload('corrupt',corrupt);
    return {diskA:da,diskB:db,mixed,unsupported,clockA:a.clockState,clockB:b.clockState};
  });report.mix=mixed;assert.equal(mixed.clockA.mode,'icount');assert.equal(mixed.clockB.mode,'paced-icount');
  const reject=async(name,pair,extra,pattern,{lossObserver=false}={})=>{
    const outcome=await page.evaluate(async({pair,extra,lossObserver})=>{try{return {resolved:await __startPair(pair,{extra,lossObserver,stopOnApplied:true}),serial:__paired.serial,states:__paired.states,events:__paired.events,errors:__paired.errors};}catch(error){return {rejected:String(error.message||error),serial:__paired.serial,states:__paired.states,events:__paired.events,errors:__paired.errors};}},{pair,extra,lossObserver});
    await fs.writeFile(path.join(output,name+'.json'),JSON.stringify(outcome,null,2)+'\n');report.phases.push({label:name,outcome});
    assert.ok(!outcome.resolved?.forbiddenNativeApplication,'forbidden-native-application: mismatched pair reached native load before rejection');
    assert.ok(!outcome.resolved,'candidate must not publish ready');assert.match(outcome.rejected,pattern);assert.equal(outcome.events.some(e=>e.type==='checkpoint-loaded'),false);assert.equal(outcome.serial.includes('PAIR_'),false,'no guest may execute a rejected pair');return outcome;
  };
  await reject('mixed-disk-native-refusal','mixed',{},/gpu_checkpoint_restore/);
  if(mode==='healthy'){
    await reject('unsupported-profile-refusal','unsupported',{},/unsupported saved limit0/);
    await reject('foreign-identity-refusal','a',{ramMib:128},/build, image or boot identity differs/);
    await reject('corrupt-envelope-refusal','corrupt',{},/pair digest differs/);
    await reject('warm-start-paused-refusal','a',{startPaused:true},/new.*work|paused/i);
    await reject('warm-persistent-refusal','a',{persist:true},/persist|ephemeral/i);
    const lost=await reject('physical-loss-during-replay','a',{},/lost|reconstruct|bridge|renderer|GPU/i,{lossObserver:true});assert.ok(report.observations.some(e=>e.text.includes('CRITIC_CONTEXT_LOSS_TRIGGER')&&e.text.includes('actualLost')&&e.text.includes('true')),'actual native context reports lost before fail-closed teardown');assert.match(lost.rejected,/restoreProductionRenderer/);
    report.warm=await page.evaluate(()=>__startPair('a'));assert.equal(report.warm.restored,true);const warm=await state('healthy-after-failures');assert.deepEqual(warm.pixel,[0,255,0,255]);assert.deepEqual(warm.errors,[]);assert.deepEqual(warm.events.find(e=>e.type==='checkpoint-loaded')?.clockState,report.mix.clockA,'saved clock matches before any warm execution');assert.ok(!warm.serial.includes('PAIR_GUEST_START'));assert.ok(!warm.serial.includes('PAIR_FAIL'));
    assert.ok(warm.gpu.scanout.retirements.some(r=>r.epoch===warm.gpu.epoch&&typeof r.sequence==='string'&&r.status==='drawn'),'ready requires a new original-sequence drawn receipt');
    report.staleTargetCapture=await page.evaluate(()=>__savePair('stale-target'));
    report.oldReceipt=await page.evaluate(async()=>{const c=__paired.controller,snapshot=async()=>({gpu:await c.gpuStats(),clock:await c.guestClockState(),scheduler:await c.schedulerStats()});const before=await snapshot();for(const callback of __oldReceipts.callbacks)callback('drawn',{backend:'late-owned-old-worker'});await new Promise(resolve=>setTimeout(resolve,30));const after=await snapshot();return {before,after,count:__oldReceipts.callbacks.length,originalWire:__oldReceipts.wire,scope:'Late duplicate receipt capabilities bound to the stopped old Worker endpoint; no synthetic fresh-endpoint message'};});assert.ok(report.oldReceipt.count>0);assert.deepEqual(report.oldReceipt.before,report.oldReceipt.after,'old endpoint receipts cannot modify fresh paused native state');
    report.concurrentSave=await page.evaluate(async()=>{const c=__paired.controller,before={clock:await c.guestClockState(),scheduler:await c.schedulerStats()},saved=await Promise.all([c.saveGpuCheckpoint(),c.saveGpuCheckpoint()]),after={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};const {decodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs'),codec=await import('/gpu-checkpoint.js'),identity=decodeCheckpointData(saved[0].subarray(16,-32)).identity;const decoded=await Promise.all(saved.map(bytes=>codec.decodeGpuCheckpointPair(bytes,identity)));const same=['native','disk','renderer'].every(name=>decoded[0][name].length===decoded[1][name].length&&decoded[0][name].every((v,i)=>v===decoded[1][name][i]));const pins=[];for(let i=0;i<saved.length;i++){const response=await fetch('/pair/concurrent-'+i,{method:'POST',body:saved[i]});pins.push(await response.json());}return {before,after,sameComponents:same,clockStates:decoded.map(d=>d.clockState),pins,scope:'Two simultaneously issued real worker RPCs, serialized by original FIFO, no guest execution between paused captures'};});assert.deepEqual(report.concurrentSave.before,report.concurrentSave.after);assert.equal(report.concurrentSave.sameComponents,true);assert.deepEqual(report.concurrentSave.clockStates[0],report.concurrentSave.clockStates[1]);
    await page.evaluate(()=>__paired.controller.resume());
    await page.locator('#display').focus();await page.keyboard.down('a');await page.mouse.down({button:'left'});await page.waitForFunction(()=>__paired.serial.includes('PAIR_KEY_RED'),null,{timeout:15000});
    report.heldBefore=await page.evaluate(()=>__paired.controller.inputDeviceStats());report.heldCapture=await page.evaluate(()=>__savePair('held'));report.heldAfter=await page.evaluate(()=>__paired.controller.inputDeviceStats());assert.deepEqual(report.heldCapture.before,report.heldCapture.after);await page.keyboard.up('a');await page.mouse.up({button:'left'});
    report.heldWarm=await page.evaluate(()=>__startPair('held'));assert.equal(report.heldWarm.restored,true);const released=await state('restored-held-input-release');assert.deepEqual(released.errors,[]);assert.equal(released.clock.mode,'paced-icount');assert.deepEqual(released.events.find(e=>e.type==='checkpoint-loaded')?.clockState,report.heldCapture.before.clock,'held capture restores exact clock before execution');assert.deepEqual(released.pixel,[255,0,0,255]);assert.ok(!released.serial.includes('PAIR_FAIL'));
    await page.evaluate(async()=>{await __paired.controller.pause();});report.quiet=await page.evaluate(()=>__savePair('quiet'));
    report.captureLossBoot=await page.evaluate(()=>__startPair('a',{lossObserver:'capture'}));assert.equal(report.captureLossBoot.restored,true);
    report.lossSave=await page.evaluate(async()=>{const p=__paired;await p.controller.pause();try{const bytes=await p.controller.saveGpuCheckpoint();return {accepted:true,bytes:bytes.length,events:p.events,errors:p.errors};}catch(error){return {accepted:false,error:String(error.message||error),events:p.events,errors:p.errors};}});assert.equal(report.lossSave.accepted,false,'physical loss while checkpoint hashing must refuse publication');assert.match(report.lossSave.error,/lost|checkpoint|renderer|GPU/i);assert.ok(report.observations.some(e=>e.text.includes('CRITIC_CONTEXT_LOSS_TRIGGER')&&e.text.includes('capture')&&e.text.includes('true')),'actual native capture context was lost');
    report.contextLossObserver.captureScope='Real context loss after original saveGpuCheckpoint began, at the first unchanged native digest promise; not an explicit pending command-fence proof';
  }
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);
  if(page)try{report.partial=await page.evaluate(()=>({serial:globalThis.__paired?.serial,errors:globalThis.__paired?.errors,states:globalThis.__paired?.states}));if(await page.evaluate(()=>!!globalThis.__paired?.controller))await state('failure');await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch(capture){report.captureFailure=String(capture);}
}finally{
  report.served=[...served.values()];await fs.writeFile(path.join(output,'kernel.bin'),kernel);await fs.writeFile(path.join(output,'image-manifest.json'),image);await fs.writeFile(path.join(output,'base-chunk.bin'),chunk);await fs.writeFile(path.join(output,'context-loss-observer.mjs'),lossBootstrap);for(const [file,bytes]of guestSources){const dir=path.join(output,'guest-source');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,file),bytes);}report.finishedAt=new Date().toISOString();
  for(const item of sources.values()){const name=path.join(output,'source',item.name);await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,item.bytes);}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
