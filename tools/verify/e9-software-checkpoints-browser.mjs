#!/usr/bin/env node
// E9-T05: exact software tuples, atomic publication and actual Linux reload recovery.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkSoftwareCheckpointIo} from './e9-software-checkpoints-io.mjs';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argument = flag => {const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1];};
assert.ok(argument('--output'));
const output = path.resolve(argument('--output')), development = process.argv.includes('--development');
const remote = argument('--url') ? new URL(argument('--url')) : null;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const web = path.join(root, 'web/dist');
const fixture = JSON.parse(await fs.readFile(path.join(web, 'session-software-fixture.json'), 'utf8'));
const imageText = await fs.readFile(path.join(web, 'session-alpine-image.json'), 'utf8');
assert.equal(sha(imageText), fixture.image_manifest_sha256);
const report = {task:'E9-T05', status:'running', development,
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  started:new Date().toISOString(),errors:[],checks:{},guests:{},served:[]};
let server,context,page;const served=new Map();
await fs.mkdir(output,{recursive:true});
const allowedExports=/^(?:before|after|restored)\.(?:checkpoint|context\.json|native|disk\.wvod|input|output|root\.json)$|^session-manifest\.json$/;
async function boot(id, checkpoint = null) {
  console.log('Booting actual guest:',id);
  await page.evaluate(async ({id, checkpoint, fixture}) => {
    const {startLinuxBootWorker} = await import('./linux-worker-host.js');
    const state = {id, output:'', events:[], errors:[]};
    window.guests[id] = state;
    state.controller = await startLinuxBootWorker({manifestUrl:fixture.boot_manifest, mode:'chunked',
      imageManifestUrl:fixture.image_manifest, baseUrl:fixture.base_url, bootProfileUrl:null,
      persist:false, sessionCheckpoint:checkpoint, bootSnapshot:false, ramMib:fixture.ram_mib,
      // Fenced RPC tolerates the PID-1 shell prompt; never inject terminal cursor replies.
      bootargs:fixture.bootargs, guestClock:'icount', icountDivider:10,
      jit:true, quantum:500000,
      onOutput:bytes => {state.output+=new TextDecoder().decode(bytes);state.parser?.feed(bytes);},
      onState:value => state.events.push(value), onError:error => state.errors.push(String(error))});
  }, {id,checkpoint,fixture});
  if(checkpoint)return;
  let sampling=false;
  const progress=setInterval(async()=>{
    if(sampling)return;sampling=true;
    try{
      const observed=await page.evaluate(async id=>({id,bytes:guests[id].output.length,tail:guests[id].output.slice(-2000),
        errors:guests[id].errors,scheduler:await guests[id].controller.schedulerStats()}),id);
      await fs.writeFile(path.join(output,'guest-'+id+'-progress.json'),JSON.stringify(observed,null,2)+'\n');
      console.log('Guest progress',id,observed.bytes,'UART bytes,',observed.scheduler.retiredInstructions,'retired:',observed.tail.slice(-100));
    }catch(error){console.log('Guest observation:',error.message);}finally{sampling=false;}
  },15000);
  try {
    await page.waitForFunction(id => {
      const state = guests[id];
      return state?.errors.length || (state?.output??'').includes('Run /bin/sh as init process');
    }, id, {timeout:900000});
  }finally{clearInterval(progress);}
  const guest = await page.evaluate(id => ({output:guests[id].output,events:guests[id].events,errors:guests[id].errors}), id);
  assert.deepEqual(guest.errors, []);
  report.guests[id] = guest;
  assert.equal((await command(id, 'printf E9_ROOT_"SHELL"')).stdout.trim(), 'E9_ROOT_SHELL');
  console.log('Guest shell ready:',id);
}

async function command(id, commandText) {
  const result = await page.evaluate(async ({id,commandText}) => {
    const {createFencedRpc,formatRpcCommand} = await import('./guest-rpc.js');
    const state=guests[id], rid='e9root'+(++window.rpcSequence), parser=createFencedRpc(rid);
    const result=await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{state.parser=null;reject(Error('actual guest command timed out: '+id+'; UART tail: '+JSON.stringify(state.output.slice(-1000))));},180000);
      state.parser={feed(bytes) {const value=parser.feed(bytes);if(value){clearTimeout(timeout);state.parser=null;resolve(value);}}};
      Promise.resolve(state.controller.sendInput(new TextEncoder().encode(formatRpcCommand(commandText,rid)))).catch(reject);
    });
    state.events.push({command:commandText,result}); return result;
  }, {id,commandText});
  assert.equal(result.exit,0,JSON.stringify({id,commandText,result}));
  return result;
}
async function file(id, expected) {
  const result=await command(id,'base64 /root/e9-session/state');
  assert.equal(Buffer.from(result.stdout.trim(),'base64').toString(),expected);
  return {base64:result.stdout.trim(),sha256:sha(Buffer.from(expected)),hex:Buffer.from(expected).toString('hex')};
}
try {
  if (!development) assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'','frozen source must be clean');
  report.checks.base=execFileSync('python3',['tools/verify/e9-disk-roots-files.py','prepare','--output',output],{cwd:root,encoding:'utf8'}).trim();
  if (!remote) {
    const releaseFallback=new Map();
    for(const manifestName of ['artifacts-alpine.json','artifacts-omarchy-virgl.json']) {
      const manifest=JSON.parse(await fs.readFile(path.join(web,manifestName),'utf8'));
      for(const asset of Object.values(manifest.artifacts)) {
        const pathname='/'+asset.url.replace(/^\.\//,'');
        releaseFallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
      }
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{
      try {
        const pathname=new URL(request.url,'http://localhost').pathname;
        if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        const base=pathname.startsWith('/releases/')?root:web, file=path.resolve(base,'.'+decodeURIComponent(pathname));
        if(!file.startsWith(base+path.sep)){response.writeHead(404).end();return;}
        let bytes;
        try {bytes=await fs.readFile(file);} catch(error) {
          if(error.code==='ENOENT'&&releaseFallback.has(pathname)){response.writeHead(302,{Location:releaseFallback.get(pathname)}).end();return;}
          throw error;
        }
        served.set(pathname,{path:path.relative(root,file),bytes:bytes.length,sha256:sha(bytes)});
        response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
          'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
      } catch {response.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  } else assert.equal(remote.href,'https://wasm-vm.pages.dev/');
  report.url=remote?new URL('app.html?noAutoBoot&testHooks=1',remote).href:`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
  context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=context.pages()[0]??await context.newPage();
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.route('**/__e9-proof/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    assert.ok(allowedExports.test(name));assert.equal(route.request().method(),'POST');
    await fs.writeFile(path.join(output,name),route.request().postDataBuffer());
    await route.fulfill({status:204,body:''});
  });
  page.on('console',message=>{if(message.type()==='error'){
    if(message.location().url===new URL('/favicon.ico',report.url).href&&/\b404\b/.test(message.text())) (report.ignoredFaviconErrors??=[]).push(message.text());
    else report.errors.push(message.text());
  }});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  const version=await context.newCDPSession(page);report.browser=await version.send('Browser.getVersion');await version.detach();
  if(remote) {
    report.checks.publicBytes=[];
    for(const name of ['session-checkpoints.js','session-disk-roots.js','session-store.js','session-alpine-image.json','session-software-fixture.json',
      'loader.js','linux-worker-protocol.js','linux-worker-host.js','gpu-runtime-worker.js','gpu-checkpoint-build.js','roadmap.js','tasks.json',
      'pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']) {
      const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200);
      const bytes=await response.body(),expected=sha(await fs.readFile(path.join(web,name)));
      assert.equal(sha(bytes),expected,name);
      report.checks.publicBytes.push({name,bytes:bytes.length,sha256:expected,status:response.status()});
    }
  }
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite,{passed:127,failed:0});
  const pip=await page.locator('.cap',{hasText:'Coherent software machine checkpoints'}).locator('.cap-pip').getAttribute('class');
  assert.match(pip,development?/\b(?:in-progress|verified)\b/:/\bverified\b/);report.checks.roadmap=pip;
  await page.locator('#panel-tests').screenshot({path:path.join(output,'browser.png')});

  report.namespace='wasm-vm-sessions-v1-checkpoint-proof-'+Date.now().toString(36);
  await page.evaluate(async database=>{
    const {SessionStore}=await import('./session-store.js');
    const {SessionCheckpoints}=await import('./session-checkpoints.js');
    window.store=await SessionStore.open(database);window.checkpoints=new SessionCheckpoints(store);
    window.lease=await store.writer('software-proof');window.guests={};window.rpcSequence=0;
    window.saveEvidence=async(name,bytes)=>{const response=await fetch('./__e9-proof/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('evidence export failed');};
  },report.namespace);
  await boot('live');
  await command('live',"mkdir -p /root/e9-session; printf 'e9:before\\n' > /root/e9-session/state; e9_memory=memory-before; unset e9_queue; sync");
  report.checks.beforeFile=await file('live','e9:before\n');
  report.checks.before=await page.evaluate(async()=>{
    const {decodeSoftwareCheckpoint,checkpointHash}=await import('./session-checkpoints.js');
    const controller=guests.live.controller;await controller.pause();
    await controller.sendKeyboardEvent(1,30,1);await controller.syncKeyboard();
    await controller.sendInput(new TextEncoder().encode('e9_queue=queued-before\n'));
    const before={scheduler:await controller.schedulerStats(),clock:await controller.guestClockState(),ram:await controller.stateDigest()};
    window.beforeFrame=await controller.captureSoftwareCheckpoint();window.config=await controller.softwareCheckpointConfiguration();
    const parts=decodeSoftwareCheckpoint(beforeFrame);
    for(const [suffix,bytes] of Object.entries({checkpoint:beforeFrame,'context.json':parts.contextBytes,native:parts.native,'disk.wvod':parts.disk,input:parts.input,output:parts.output}))await saveEvidence('before.'+suffix,bytes);
    const committed=await checkpoints.save(lease,'before',beforeFrame,config);
    const opened=await store.openSession('software-proof');window.committedManifest=opened.manifest;
    await saveEvidence('session-manifest.json',opened.manifest);
    const after={scheduler:await controller.schedulerStats(),clock:await controller.guestClockState(),ram:await controller.stateDigest()};
    return {before,after,committed,held:parts.context.held,input:new TextDecoder().decode(parts.input),frameHash:checkpointHash(beforeFrame),bytes:beforeFrame.length,configuration:config};
  });
  assert.equal(report.checks.before.before.scheduler.retiredInstructions,report.checks.before.after.scheduler.retiredInstructions);
  assert.deepEqual(report.checks.before.before.clock,report.checks.before.after.clock);
  assert.equal(report.checks.before.before.ram,report.checks.before.after.ram);
  assert.deepEqual(report.checks.before.held.keyboard,[30]);assert.equal(report.checks.before.input,'e9_queue=queued-before\n');
  await page.evaluate(()=>guests.live.controller.resume());
  report.checks.queuedLive=await command('live','printf "%s/%s" "$e9_memory" "$e9_queue"');
  assert.equal(report.checks.queuedLive.stdout,'memory-before/queued-before');
  await command('live',"e9_memory=memory-after; e9_queue=queue-after; printf 'e9:after\\n' | dd of=/root/e9-session/state conv=notrunc 2>/dev/null; truncate -s 9 /root/e9-session/state; sync");
  report.checks.afterFile=await file('live','e9:after\n');
  report.checks.failures=await page.evaluate(async()=>{
    const {decodeSoftwareCheckpoint,checkpointHash}=await import('./session-checkpoints.js');
    const controller=guests.live.controller,results={};
    try{await controller.captureSoftwareCheckpoint();results.running='accepted';}catch(error){results.running=error.message;}
    await controller.pause();window.afterFrame=await controller.captureSoftwareCheckpoint();
    const afterConfig=await controller.softwareCheckpointConfiguration();
    const original=committedManifest;
    const broken=afterFrame.slice();broken[broken.length-1]^=1;
    try{await checkpoints.save(lease,'broken',broken,afterConfig);results.corruptCapture='accepted';}catch(error){results.corruptCapture=error.message;}
    const failing={id:lease.id,put:(...args)=>lease.put(...args),publish(){throw Error('injected-before-commit');}};
    try{await checkpoints.save(failing,'not-published',afterFrame,afterConfig);results.publication='accepted';}catch(error){results.publication=error.message;}
    const opened=await store.openSession('software-proof');
    results.committedSame=checkpointHash(opened.manifest)===checkpointHash(original);results.revision=opened.revision;
    const parts=decodeSoftwareCheckpoint(afterFrame);
    for(const [suffix,bytes] of Object.entries({checkpoint:afterFrame,'context.json':parts.contextBytes,native:parts.native,'disk.wvod':parts.disk,input:parts.input,output:parts.output}))await saveEvidence('after.'+suffix,bytes);
    return results;
  });
  assert.match(report.checks.failures.running,/pause the software guest/);assert.match(report.checks.failures.corruptCapture,/digest/);
  assert.equal(report.checks.failures.publication,'injected-before-commit');assert.equal(report.checks.failures.committedSame,true);assert.equal(report.checks.failures.revision,'1');
  report.checks.rejectedRestore=await page.evaluate(async database=>{
    const {startLinuxBootWorker}=await import('./linux-worker-host.js');
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(database);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const manifest=JSON.parse(new TextDecoder().decode(committedManifest)),hash=manifest.checkpoints[0].machine.sha256;
    const object=await new Promise((resolve,reject)=>{const request=db.transaction('objects').objectStore('objects').get(hash);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const part=object.parts[0].sha256;
    const original=await new Promise((resolve,reject)=>{const request=db.transaction('chunks').objectStore('chunks').get(part);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const write=blob=>new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite',{durability:'strict'});tx.objectStore('chunks').put(blob,part);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    const changed=new Uint8Array(await original.arrayBuffer());changed[Math.min(300,changed.length-1)]^=1;await write(new Blob([changed]));
    let result;try{const candidate=await startLinuxBootWorker({sessionCheckpoint:{database,id:'software-proof',checkpoint:'before'}});await candidate.stop();result='accepted';}
    catch(error){result=error.message;}finally{await write(original);db.close();}
    return result;
  },report.namespace);
  assert.match(report.checks.rejectedRestore,/Corrupt/);
  await page.evaluate(()=>guests.live.controller.resume());
  report.checks.liveSurvives=await command('live','printf "%s/%s" "$e9_memory" "$e9_queue"');
  assert.equal(report.checks.liveSurvives.stdout,'memory-after/queue-after');
  // Release the original owner, reload the built page, and recover through only committed IDs.
  await page.evaluate(async()=>{await guests.live.controller.stop();await lease.release();await store.close();});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true);
  await page.evaluate(()=>{window.guests={};window.rpcSequence=0;window.saveEvidence=async(name,bytes)=>{const response=await fetch('./__e9-proof/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('evidence export failed');};});
  await boot('restored',{database:report.namespace,id:'software-proof',checkpoint:'before'});
  report.checks.restored=await page.evaluate(async()=>{
    const {decodeSoftwareCheckpoint,checkpointHash}=await import('./session-checkpoints.js');
    const controller=guests.restored.controller,frame=await controller.captureSoftwareCheckpoint(),parts=decodeSoftwareCheckpoint(frame);
    for(const [suffix,bytes] of Object.entries({checkpoint:frame,'context.json':parts.contextBytes,native:parts.native,'disk.wvod':parts.disk,input:parts.input,output:parts.output}))await saveEvidence('restored.'+suffix,bytes);
    return {clock:await controller.guestClockState(),ram:await controller.stateDigest(),held:parts.context.held,
      input:new TextDecoder().decode(parts.input),hash:checkpointHash(frame),paused:await controller.isPaused(),scheduler:await controller.schedulerStats(),events:guests.restored.events};
  });
  assert.equal(report.checks.restored.paused,true);assert.equal(report.checks.restored.scheduler.retiredInstructions,0);
  assert.equal(report.checks.restored.ram,report.checks.before.before.ram);
  assert.deepEqual(report.checks.restored.clock,report.checks.before.before.clock);
  assert.deepEqual(report.checks.restored.held,report.checks.before.held);
  assert.equal(report.checks.restored.input,report.checks.before.input);
  assert.equal(report.checks.restored.hash,report.checks.before.frameHash,'reload changed the exact saved native/device/queue tuple');
  await page.evaluate(async()=>{await guests.restored.controller.sendKeyboardEvent(1,30,0);await guests.restored.controller.syncKeyboard();await guests.restored.controller.resume();});
  report.checks.restoredMemory=await command('restored','printf "%s/%s" "$e9_memory" "$e9_queue"');
  assert.equal(report.checks.restoredMemory.stdout,'memory-before/queued-before');
  report.checks.restoredFile=await file('restored','e9:before\n');
  await page.evaluate(()=>guests.restored.controller.stop());
  report.checks.io=await checkSoftwareCheckpointIo(page,fixture);
  report.checks.oracle=execFileSync('python3',['tools/verify/e9-software-checkpoints-files.py','--output',output],{cwd:root,encoding:'utf8'}).trim();
  await page.screenshot({path:path.join(output,'restored.png')});
  await page.unroute('**/__e9-proof/*');
  if(!development){
    await page.locator('#desktop-graphics').selectOption('gpu');
    report.checks.gpuBoot=await page.evaluate(()=>window.wvmDemo.bootOmarchy());
    assert.equal(report.checks.gpuBoot.ok,true,JSON.stringify(report.checks.gpuBoot));
    await page.waitForFunction(()=>window.wvmDemo?.isGuestReady?.()&&window.__linux?.restoredFromBootSnapshot?.(),null,{timeout:600000});
    report.checks.gpu=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
    assert.ok(report.checks.gpu.gpu.qualified&&!report.checks.gpu.gpu.lost&&!report.checks.gpu.gpu.poisoned);
    assert.ok(report.checks.gpu.scheduler.retiredInstructions>0);
    assert.ok(report.checks.gpu.gpu.scanout.retirements.some(r=>r.epoch===report.checks.gpu.gpu.epoch&&r.status==='drawn'));
    await page.screenshot({path:path.join(output,'gpu-factory-ready.png')});
  }
  assert.deepEqual(report.errors,[]);report.status='passed';
  console.log('Software checkpoint: exact tuple, atomic failure, page reload, guest RAM/UART/file and independent ext4 witness passed.');
} catch(error) {report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally {
  if(page&&!page.isClosed()) {
    try {report.finalGuests=await page.evaluate(()=>Object.fromEntries(Object.entries(window.guests??{}).map(([id,state])=>[id,{output:state.output,events:state.events,errors:state.errors}])));} catch{}
    try {await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));}catch{}
  }
  if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
  if(context)await context.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.served=[...served.values()];report.finished=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
