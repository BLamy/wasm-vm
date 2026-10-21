#!/usr/bin/env node
// Original supervisor-MMIO GPU guest: two local session keyframes, fresh workers and physical input.
// The real Omarchy desktop is proved by the separate T17 desktop acceptance run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]??'target/evidence/e9-gpu-session-browser');
await fs.mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=new Map(),served=[],errors=[];
async function freeze(directory){for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){
  const name=path.posix.join(directory,entry.name);
  if(entry.isDirectory()){if(!['node_modules','dist','test-results','tests'].includes(entry.name))await freeze(name);}
  else if(/\.(m?js|wasm)$/.test(entry.name))sources.set('/'+name.slice(4),{name,bytes:await fs.readFile(path.join(root,name))});
}}
for(const entry of await fs.readdir(path.join(root,'web'),{withFileTypes:true}))if(entry.isFile()&&/\.m?js$/.test(entry.name)){
  const name='web/'+entry.name;sources.set('/'+entry.name,{name,bytes:await fs.readFile(path.join(root,name))});
}
for(const name of ['web/src','web/renderer','web/pkg','web/session-pkg'])await freeze(name);
const kernel=await fs.readFile(path.join(root,'guest/prebuilt/production-gpu-pair.bin'));
const chunk=Buffer.alloc(262144),chunkHash=sha(chunk);
const image=Buffer.from(JSON.stringify({version:1,image_len:chunk.length,chunk_size:chunk.length,layout:'split',chunks:[chunkHash]}));
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>GPU session history</title><style>body{background:#10151c;color:#eee;font:14px monospace}canvas{width:384px;height:384px;image-rendering:pixelated;border:1px solid #789}</style><h1>GPU session history</h1><canvas id="display" width="64" height="64" tabindex="0"></canvas><pre id="serial"></pre>');
const report={task:'E9-T17',scope:'original supervisor-MMIO guest, not Linux/Mesa',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:'running',sources:[...sources.values()].map(s=>({path:s.name,sha256:sha(s.bytes),bytes:s.bytes.length})),kernelSha256:sha(kernel),imageSha256:sha(image),errors,served,states:[],captures:[]};
const server=createServer(async(req,res)=>{try{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');
  const name=new URL(req.url,'http://localhost').pathname;let bytes,type='application/octet-stream';
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  if(name==='/'){bytes=html;type='text/html';}
  else if(name==='/kernel.bin')bytes=kernel;
  else if(name==='/guest/manifest.json'){bytes=image;type='application/json';}
  else if(name==='/guest/chunks/'+chunkHash+'.bin')bytes=chunk;
  else if(name==='/boot.json'){bytes=Buffer.from(JSON.stringify({artifacts:{kernel:{url:'/kernel.bin',size:kernel.length,sha256:sha(kernel)}}}));type='application/json';}
  else if(sources.has(name)){const source=sources.get(name);bytes=source.bytes;type=name.endsWith('.wasm')?'application/wasm':'text/javascript';}
  else throw Error('unknown path '+name);
  served.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
  res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length}).end(bytes);
}catch(error){res.writeHead(404).end(String(error));}});
let browser,page;
async function state(label){const value=await page.evaluate(async()=>{
  const p=globalThis.__gpuSession,c=p.controller,canvas=document.querySelector('#display');
  const pixel=[...canvas.getContext('2d').getImageData(32,32,1,1).data];
  return {serial:p.serial,errors:p.errors,states:p.states,gpu:await c.gpuStats(),
    clock:await c.guestClockState(),scheduler:await c.schedulerStats(),restored:await c.restoredFromBootSnapshot(),
    display:p.presentation.snapshot(),frames:p.frames,pixel,events:p.events};
});
  await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(value,null,2)+'\n');
  report.states.push({label,sha256:sha(Buffer.from(JSON.stringify(value,null,2)+'\n'))});return value;}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  const cdp=await browser.newBrowserCDPSession(),hardware=await cdp.send('SystemInfo.getInfo'),command=await cdp.send('Browser.getBrowserCommandLine');
  assert.equal(hardware.gpu.featureStatus.webgl2??hardware.gpu.featureStatus.webgl,'enabled');
  assert.ok(!command.arguments.some(value=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(value)));
  report.hardware={gpu:hardware.gpu,commandLine:command.arguments,version:browser.version()};
  page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:1});
  await page.context().tracing.start({screenshots:true,snapshots:true,sources:true});
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('pageerror',error=>errors.push(error.stack));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async()=>{
    const {createLinuxWorkerClient}=await import('/linux-worker-protocol.js');
    const {PresentationController}=await import('/src/sink/presentation.js');
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuCheckpoints}=await import('/session-gpu-checkpoints.js');
    const {createKeyboardBridge,createWasmKeyboardAdapter,attachKeyboardBridge}=await import('/src/input/keyboard.js');
    const db='wasm-vm-sessions-v1-e9-gpu-probe',id='accelerated-positions';
    const canvas=document.querySelector('#display');
    globalThis.__startGpuSession=async checkpoint=>{
      const old=globalThis.__gpuSession;if(old){for(const detach of old.detach)detach();await old.controller.stop();old.worker.terminate();}
      const worker=new Worker('/linux-worker.js',{type:'module'}),presentation=new PresentationController(canvas,{scheduleFrames:false}),decoder=new TextDecoder();
      const p=globalThis.__gpuSession={worker,presentation,serial:'',errors:[],states:[],frames:[],events:[],detach:[],deferNextFrame:globalThis.__holdNextGpuSessionFrame===true,pendingFrame:null};
      globalThis.__holdNextGpuSessionFrame=false;
      const client=createLinuxWorkerClient(worker,{bootTimeoutMs:90000,
        onOutput(bytes){p.serial+=decoder.decode(bytes,{stream:true});document.querySelector('#serial').textContent=p.serial.slice(-6000);},
        onState(value){p.states.push(value);},onError(error){p.errors.push(String(error));},
        onGpuEvent(event){if(['checkpoint-loaded','context-lost'].includes(event.type))p.events.push(event);},
        onDisplayFrame(frame){if(frame.type==='clear'){presentation.clear();return;}requestAnimationFrame(()=>{try{
          if(p.deferNextFrame){p.deferNextFrame=false;p.pendingFrame=frame;return;}
          const before=presentation.snapshot().drawnPresents,accepted=presentation.present(frame),after=presentation.snapshot();
          p.frames.push({accepted,drawn:after.drawnPresents>before});
          frame.onRetired?.(accepted&&after.drawnPresents>before?'drawn':'failed',{backend:after.backend});
        }catch(error){p.errors.push(String(error));frame.onRetired?.('failed');}});},
      });
      p.controller=await client.boot({mode:'chunked',manifestUrl:'/boot.json',imageManifestUrl:'/guest/manifest.json',
        baseUrl:location.origin+'/guest/',bootProfileUrl:null,persist:false,bootSnapshot:false,ramMib:64,
        bootargs:'console=ttyS0',virgl:true,gpuTrace:true,guestClock:'icount',icountDivider:64,
        interactiveClock:'paced-on-keyboard',jit:true,quantum:10000,
        ...(checkpoint?{sessionGpuCheckpoint:{database:db,id,checkpoint}}:{})});
      p.detach.push(attachKeyboardBridge(canvas,createKeyboardBridge(createWasmKeyboardAdapter(p.controller))));
      return {restored:await p.controller.restoredFromBootSnapshot()};
    };
    globalThis.__captureGpuSession=async checkpoint=>{
      const store=await SessionStore.open(db);
      try{return await new SessionGpuCheckpoints(store).captureController(id,checkpoint,__gpuSession.controller);}
      finally{await store.close();}
    };
    globalThis.__collectGpuSession=async()=>{
      const store=await SessionStore.open(db);
      try{return await store.collectGarbage();}finally{await store.close();}
    };
    globalThis.__gpuSessionFingerprint=async()=>{
      const {checkpointHash}=await import('/session-checkpoints.js');
      const store=await SessionStore.open(db);
      try{const opened=await store.openSession(id);return {sha256:checkpointHash(opened.manifest),revision:String(opened.revision),
        manifest:JSON.parse(new TextDecoder().decode(opened.manifest))};}
      finally{await store.close();}
    };
    globalThis.__gpuSessionManifest=async()=>{
      const store=await SessionStore.open(db);
      try{const opened=await store.openSession(id);return JSON.parse(new TextDecoder().decode(opened.manifest));}
      finally{await store.close();}
    };
  });
  report.cold=await page.evaluate(()=>__startGpuSession(null));assert.equal(report.cold.restored,false);
  await page.waitForFunction(()=>__gpuSession.serial.includes('PAIR_FRAME_M')||__gpuSession.serial.includes('PAIR_FAIL'),null,{timeout:45000});
  await page.waitForFunction(()=>__gpuSession.presentation.snapshot().drawnPresents>=2||__gpuSession.serial.includes('PAIR_FAIL'),null,{timeout:45000});
  const cold=await state('cold');assert.ok(!cold.serial.includes('PAIR_FAIL'));assert.deepEqual(cold.errors,[]);assert.deepEqual(cold.pixel,[0,255,0,255]);
  report.captures.push(await page.evaluate(()=>__captureGpuSession('green')));
  report.green=await page.evaluate(()=>__startGpuSession('green'));assert.equal(report.green.restored,true);
  const green=await state('green-restored');assert.deepEqual(green.pixel,[0,255,0,255]);assert.deepEqual(green.errors,[]);
  assert.notEqual(green.gpu.epoch,cold.gpu.epoch);assert.ok(green.gpu.scanout.retirements.some(r=>r.epoch===green.gpu.epoch&&r.status==='drawn'));
  await page.locator('#display').focus();await page.keyboard.press('a');
  await page.waitForFunction(()=>__gpuSession.serial.includes('PAIR_KEY_RED'),null,{timeout:15000});
  await page.waitForFunction(()=>{const p=document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data;return p[0]===255&&p[1]===0;},null,{timeout:15000});
  const red=await state('green-post-input');assert.ok(red.gpu.renderer.work.draws>green.gpu.renderer.work.draws);
  report.captures.push(await page.evaluate(()=>__captureGpuSession('red')));
  report.manifest=await page.evaluate(()=>__gpuSessionManifest());
  assert.deepEqual(report.manifest.checkpoints.map(c=>c.id),['green','red']);
  assert.notEqual(report.manifest.checkpoints[0].gpu.sha256,report.manifest.checkpoints[1].gpu.sha256);
  report.fingerprintBeforeAttacks=await page.evaluate(()=>__gpuSessionFingerprint());
  report.attacks=await page.evaluate(async()=>{
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuCheckpoints}=await import('/session-gpu-checkpoints.js');
    const {encodeGpuCheckpointPair,GPU_PAIR_MAX_BYTES}=await import('/gpu-checkpoint.js');
    const {readCheckpointObject,checkpointReference,checkpointChunks}=await import('/session-checkpoints.js');
    const {sessionValidateManifest}=await import('/session-pkg/wasm_vm_session.js');
    const {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256}=await import('/gpu-checkpoint-build.js');
    const store=await SessionStore.open('wasm-vm-sessions-v1-e9-gpu-probe');
    const result={};
    try{
      const helper=new SessionGpuCheckpoints(store);
      const green=await helper.admit('accelerated-positions','green',GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256);
      const red=await helper.admit('accelerated-positions','red',GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256);
      const mixed=await encodeGpuCheckpointPair({...red.pair,native:green.pair.native});
      let writer=await store.writer('bad-crosswire');
      try{await helper.save(writer,'mixed',mixed,red.configuration,'1');result.crosswire={accepted:true};}
      catch(error){result.crosswire={accepted:false,error:String(error)};}
      finally{await writer.release();}
      const intact=await readCheckpointObject(store,red.checkpoint.gpu,GPU_PAIR_MAX_BYTES);
      const foreign=structuredClone(red.configuration);foreign.profile.hostWords[0]^=1;
      writer=await store.writer('bad-profile');
      try{await helper.save(writer,'foreign',intact,foreign,'1');result.profile={accepted:true};}
      catch(error){result.profile={accepted:false,error:String(error)};}
      finally{await writer.release();}
      try{await helper.admit('accelerated-positions','green','0'.repeat(64),SOFTWARE_CHECKPOINT_WASM_SHA256);result.build={accepted:true};}
      catch(error){result.build={accepted:false,error:String(error)};}
      const wrongBoot=structuredClone(red.configuration);wrongBoot.bootargs+=' verifier_incompatible_boot=1';
      writer=await store.writer('bad-boot-options');
      try{await helper.save(writer,'foreign',intact,wrongBoot,'1');result.bootSave={accepted:true};}
      catch(error){result.bootSave={accepted:false,error:String(error)};}
      finally{await writer.release();}
      // Build an independently malformed persisted candidate without using helper.save.
      // Admission must revalidate options too, preserving the original session and owner.
      const bad=JSON.parse(new TextDecoder().decode((await store.openSession('accelerated-positions')).manifest));
      bad.id='bad-imported-boot';
      const configBytes=new TextEncoder().encode(JSON.stringify(wrongBoot)),vm=checkpointReference(configBytes);
      bad.machine.vm_build=vm.sha256;bad.assets.find(asset=>asset.role==='vm').content=vm;
      writer=await store.writer(bad.id);
      try{await writer.put(vm,checkpointChunks(configBytes));
        await writer.publish(sessionValidateManifest(new TextEncoder().encode(JSON.stringify(bad))));}
      finally{await writer.release();}
      try{await helper.admit(bad.id,'red',GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256);result.bootAdmission={accepted:true};}
      catch(error){result.bootAdmission={accepted:false,error:String(error)};}
      await store.deleteSession(bad.id);
      result.sessions=await store.list();
      return result;
    }finally{await store.close();}
  });
  assert.equal(report.attacks.crosswire.accepted,false);assert.match(report.attacks.crosswire.error,/witness/);
  assert.equal(report.attacks.profile.accepted,false);assert.match(report.attacks.profile.error,/profile/);
  assert.equal(report.attacks.build.accepted,false);assert.deepEqual(report.attacks.sessions.sessions.map(row=>row.id),['accelerated-positions']);
  assert.equal(report.attacks.bootSave.accepted,false);assert.match(report.attacks.bootSave.error,/configuration identity/);
  assert.equal(report.attacks.bootAdmission.accepted,false);assert.match(report.attacks.bootAdmission.error,/configuration identity/);
  report.fingerprintAfterAttacks=await page.evaluate(()=>__gpuSessionFingerprint());
  assert.deepEqual(report.fingerprintAfterAttacks,report.fingerprintBeforeAttacks);
  report.gc=await page.evaluate(()=>__collectGpuSession());
  report.red=await page.evaluate(()=>__startGpuSession('red'));assert.equal(report.red.restored,true);
  const redRestored=await state('red-restored');assert.deepEqual(redRestored.pixel,[255,0,0,255]);assert.deepEqual(redRestored.errors,[]);
  assert.notEqual(redRestored.gpu.epoch,red.gpu.epoch);assert.ok(redRestored.gpu.scanout.retirements.some(r=>r.epoch===redRestored.gpu.epoch&&r.status==='drawn'));
  await page.locator('#display').focus();await page.keyboard.press('b');
  await page.waitForFunction(()=>__gpuSession.serial.includes('PAIR_KEY_BLUE'),null,{timeout:15000});
  await page.waitForFunction(()=>{const p=document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data;return p[2]===255&&p[0]===0;},null,{timeout:15000});
  const blue=await state('red-post-input');assert.ok(blue.gpu.renderer.work.draws>redRestored.gpu.renderer.work.draws);
  report.repeat=await page.evaluate(()=>__startGpuSession('green'));assert.equal(report.repeat.restored,true);
  const repeat=await state('green-reopened');assert.deepEqual(repeat.pixel,[0,255,0,255]);
  await page.evaluate(()=>{__gpuSession.deferNextFrame=true;});
  await page.locator('#display').focus();await page.keyboard.press('a');
  await page.waitForFunction(()=>Boolean(__gpuSession.pendingFrame),null,{timeout:15000});
  report.stale=await page.evaluate(async()=>{
    const p=__gpuSession,before=await p.controller.gpuStats();
    const token={sequence:before.scanout.presenter.queued,generation:before.scanout.presenter.generation};
    const stale={...token,generation:(BigInt('0x'+token.generation)-1n).toString(16).padStart(16,'0')};
    const accepted=await p.controller.acknowledgeGpuFrame(stale,'drawn',{backend:'canvas2d'});
    const held=await p.controller.gpuStats();
    const frame=p.pendingFrame;p.pendingFrame=null;
    const presented=p.presentation.present(frame),after=p.presentation.snapshot();
    frame.onRetired?.(presented?'drawn':'failed',{backend:after.backend});
    return {token,stale,accepted,before:before.scanout.presenter,held:held.scanout.presenter,presented};
  });
  assert.ok(report.stale.before.retainedFrames>=1);assert.equal(report.stale.accepted,false);
  assert.equal(report.stale.held.retainedFrames,report.stale.before.retainedFrames);
  assert.equal(report.stale.presented,true);
  // Preserve an authentic completion on the old channel, then activate a new owner
  // with its own pending frame. Equal numeric tokens across workers never share ownership.
  await page.evaluate(()=>{__gpuSession.deferNextFrame=true;});
  await page.locator('#display').focus();await page.keyboard.press('b');
  await page.waitForFunction(()=>Boolean(__gpuSession.pendingFrame),null,{timeout:15000});
  report.retiredOwner=await page.evaluate(async()=>{
    const p=__gpuSession;globalThis.__retiredGpuSession=p;
    const gpu=await p.controller.gpuStats();p.pendingToken={sequence:gpu.scanout.presenter.queued,generation:gpu.scanout.presenter.generation};globalThis.__holdNextGpuSessionFrame=true;
    return {epoch:gpu.epoch,presenter:gpu.scanout.presenter};
  });
  await page.evaluate(()=>__startGpuSession('red'));
  await page.waitForFunction(()=>Boolean(__gpuSession.pendingFrame),null,{timeout:15000});
  report.authenticStale=await page.evaluate(async()=>{
    const old=__retiredGpuSession,p=__gpuSession;
    const snapshot=async()=>({gpu:(await p.controller.gpuStats()).scanout,
      pixels:[...document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data]});
    const before=await snapshot();
    old.pendingFrame.onRetired?.('drawn',{backend:'canvas2d'});
    let rejected;
    try{rejected=(await old.controller.acknowledgeGpuFrame(old.pendingToken,'drawn',{backend:'canvas2d'}))===false;}
    catch(error){rejected=true;}
    const after=await snapshot();
    const frame=p.pendingFrame;p.pendingFrame=null;
    const presented=p.presentation.present(frame);
    frame.onRetired?.(presented?'drawn':'failed',{backend:p.presentation.snapshot().backend});
    return {before,after,rejected,presented};
  });
  assert.ok(report.authenticStale.before.gpu.presenter.retainedFrames>=1);
  assert.equal(report.authenticStale.rejected,true);assert.deepEqual(report.authenticStale.after,report.authenticStale.before);
  assert.equal(report.authenticStale.presented,true);
  await page.waitForFunction(async()=>{const g=await __gpuSession.controller.gpuStats();return g.scanout.retirements.some(r=>r.epoch===g.epoch&&r.status==='drawn');},null,{timeout:15000});
  report.fingerprintBeforeLoss=await page.evaluate(()=>__gpuSessionFingerprint());
  report.lossRace=await page.evaluate(async()=>{
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuCheckpoints}=await import('/session-gpu-checkpoints.js');
    const actual=__gpuSession.controller;let injected=false;
    const controller={};
    for(const name of ['isPaused','pause','resume','gpuSessionConfiguration','saveGpuCheckpoint'])controller[name]=(...args)=>actual[name](...args);
    controller.gpuSessionPosition=async()=>{
      const position=await actual.gpuSessionPosition();
      if(!injected){injected=true;await actual.loseGpuContext('now');
        const deadline=Date.now()+15000;
        while(!(await actual.gpuStats()).lost){if(Date.now()>deadline)throw Error('context loss injection timed out');await new Promise(r=>setTimeout(r,10));}}
      return position;
    };
    const store=await SessionStore.open('wasm-vm-sessions-v1-e9-gpu-probe');
    try{await new SessionGpuCheckpoints(store).captureController('accelerated-positions','lost-race',controller);
      return {accepted:true,injected,lost:(await actual.gpuStats()).lost};}
    catch(error){return {accepted:false,injected,lost:(await actual.gpuStats()).lost,error:String(error)};}
    finally{await store.close();}
  });
  assert.equal(report.lossRace.injected,true);assert.equal(report.lossRace.lost,true);
  assert.equal(report.lossRace.accepted,false,'loss during persistence must refuse publication');
  report.loss=await page.evaluate(async()=>{
    try{await __captureGpuSession('already-lost');return {accepted:true};}
    catch(error){return {accepted:false,error:String(error)};}
  });
  assert.equal(report.loss.accepted,false);
  report.fingerprintAfterLoss=await page.evaluate(()=>__gpuSessionFingerprint());
  assert.deepEqual(report.fingerprintAfterLoss,report.fingerprintBeforeLoss);
  report.afterLoss=await page.evaluate(()=>__startGpuSession('red'));assert.equal(report.afterLoss.restored,true);
  const afterLoss=await state('red-after-loss');assert.deepEqual(afterLoss.pixel,[255,0,0,255]);
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);
  if(page)try{report.partial=await page.evaluate(()=>({serial:globalThis.__gpuSession?.serial,errors:globalThis.__gpuSession?.errors,states:globalThis.__gpuSession?.states}));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch(capture){report.captureFailure=String(capture);}
}finally{
  report.served=served;report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(page)await page.context().tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
