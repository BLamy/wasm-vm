#!/usr/bin/env node
// Drive visible T06 controls against real persisted guest checkpoints, never a model VM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argument=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
const output=path.resolve(argument('--output')),development=process.argv.includes('--development');
const remote=argument('--url'),web=path.join(root,'web/dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.ok(argument('--output'));if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const report={task:'E9-T06',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  started:new Date().toISOString(),checks:{},errors:[]};
await fs.mkdir(output,{recursive:true});
let server,context,page;
const coverage=[];
async function collectCoverage(){
  const entries=await page.coverage.stopJSCoverage(),name=`javascript-coverage-segment-${(report.coverageSegments??[]).length+1}.json`;
  coverage.push(...entries);await fs.writeFile(path.join(output,name),JSON.stringify(entries));
  (report.coverageSegments??=[]).push({name,entries:entries.length});
}
async function navigate(operation){
  // Playwright may replace same-URL script entries after a navigation even with reset disabled.
  // Seal the old document first; start before navigating so new module initialization is covered.
  await collectCoverage();await page.coverage.startJSCoverage({resetOnNavigation:false});
  await operation();
}
const control=name=>page.locator(`[data-session="${name}"]`);
async function idle(){await page.waitForFunction(()=>window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading',null,{timeout:240000});}
async function click(name){await control(name).click();await idle();}
async function command(text){
  const value=await page.evaluate(text=>wvmDemo.exec(text,180000,{quiet:true}),text);
  assert.equal(value.exit,0,JSON.stringify(value));return value.stdout;
}
async function details(id,point=null){return page.evaluate(async({id,point})=>{
  const {readCheckpointObject,checkpointHash}=await import('./session-checkpoints.js');
  const store=__sessionLibrary.store,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
  const selected=manifest.checkpoints.find(item=>item.id===point)||manifest.checkpoints.at(-1);
  const frame=await readCheckpointObject(store,selected.machine),compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const name=`${id}-${selected.id}.checkpoint.gz`;await fetch('./__e9-library-proof/'+name,{method:'POST',body:compressed});
  return {id,revision:opened.revision,manifest,point:selected.id,frameHash:checkpointHash(frame),bytes:frame.length,evidence:name};
},{id,point});}
async function activeFrame(name){return page.evaluate(async name=>{
  const {checkpointHash}=await import('./session-checkpoints.js');
  const frame=await __linuxCtl.captureSoftwareCheckpoint(),compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  await fetch('./__e9-library-proof/'+name,{method:'POST',body:compressed});
  return {hash:checkpointHash(frame),bytes:frame.length,paused:await __linuxCtl.isPaused(),scheduler:await __linuxCtl.schedulerStats(),
    active:document.querySelector('[data-session="active"]').dataset.id,point:document.querySelector('[data-session="active"]').dataset.point};
},name);}
try {
  if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
  if(!remote){
    const fallback=new Map();
    for(const name of ['artifacts-alpine.json','artifacts-omarchy-virgl.json'])for(const asset of Object.values(JSON.parse(await fs.readFile(path.join(web,name),'utf8')).artifacts)){
      const pathname='/'+asset.url.replace(/^\.\//,'');fallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{try{
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      const base=pathname.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+decodeURIComponent(pathname));
      if(!file.startsWith(base+path.sep)){response.writeHead(404).end();return;}
      let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'&&fallback.has(pathname)){response.writeHead(302,{Location:fallback.get(pathname)}).end();return;}throw error;}
      response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
        'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  report.url=new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000&enableMic=1&slirpNet&slirpProvider=websocket&slirpWebsocket=wss://invalid.example',remote||`http://127.0.0.1:${server.address().port}/`).href;
  context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0]??await context.newPage();
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.route('**/__e9-library-proof/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^[a-z0-9-]+\.checkpoint\.gz$/);assert.equal(route.request().method(),'POST');
    await fs.writeFile(path.join(output,name),route.request().postDataBuffer());await route.fulfill({status:204,body:''});
  });
  page.on('console',message=>{if(message.type()==='error'&&!(/favicon\.ico$/.test(message.location().url)&&/\b404\b/.test(message.text())))report.errors.push(message.text());});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true);await idle();
  console.log('Built page ready; running live compliance suite');
  if(remote){report.checks.publicBytes=[];for(const name of ['app.html','main.js','session-library.js','session-library.css','session-checkpoints.js','session-store.js','session-disk-roots.js',
    'gpu-checkpoint-build.js','gpu-runtime-worker.js','linux-worker-host.js','loader.js','roadmap.js','tasks.json','session-software-fixture.json','session-alpine-image.json',
    'pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){
    const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200);
    const bytes=await response.body(),expected=sha(await fs.readFile(path.join(web,name)));assert.equal(sha(bytes),expected,name);
    report.checks.publicBytes.push({name,sha256:expected,bytes:bytes.length});
  }}
  await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite,{passed:127,failed:0});
  report.checks.roadmap=await page.locator('.cap',{hasText:'Local saved-session library'}).locator('.cap-pip').getAttribute('class');
  assert.match(report.checks.roadmap,development?/\b(?:in-progress|verified)\b/:/\bverified\b/);
  await page.locator('#panel-tests').screenshot({path:path.join(output,'suite.png')});
  console.log('Starting actual offline guest through library control');
  await click('new');
  let sampling=false;
  const progress=setInterval(async()=>{if(sampling)return;sampling=true;try{
    const observed=await page.evaluate(async()=>({ready:wvmDemo.isGuestReady(),status:document.querySelector('[data-session="status"]').textContent,
      pageStatus:document.querySelector('#status').textContent,up:wvmDemo.isGuestUp(),scheduler:await window.__linuxCtl?.schedulerStats(),tail:window.__term?.term?.buffer?.active?.getLine(window.__term.term.buffer.active.cursorY)?.translateToString()}));
    await fs.writeFile(path.join(output,'guest-progress.json'),JSON.stringify(observed,null,2)+'\n');
    console.log('Guest progress',JSON.stringify(observed));
  }catch(error){console.log('Guest observation:',error.message);}finally{sampling=false;}},15000);
  try{await page.waitForFunction(()=>wvmDemo.isGuestReady()||!wvmDemo.isGuestUp(),null,{timeout:900000});
    assert.equal(await page.evaluate(()=>wvmDemo.isGuestReady()),true,await page.locator('#status').textContent());
  }finally{clearInterval(progress);}
  report.checks.profile=await page.evaluate(()=>__linuxCtl.softwareCheckpointConfiguration());
  assert.equal(report.checks.profile.clock.mode,'icount');
  await command("mkdir -p /root/e9-library; printf 'alpha-file\\n' > /root/e9-library/state; e9_label=alpha-memory; sync");
  await click('start');const alpha=await control('sessions').inputValue();report.checks.alphaInitial=await details(alpha);
  assert.equal(report.checks.alphaInitial.manifest.checkpoints.length,1);assert.equal(report.checks.alphaInitial.manifest.events.length,0);
  assert.equal(report.checks.alphaInitial.manifest.policy.mode,'checkpoints-only');
  await page.evaluate(async()=>{await __linuxCtl.pause();await __linuxCtl.sendInput(new TextEncoder().encode('e9_queue=alpha-queued\n'));});
  await click('checkpoint');const alphaPoint=await control('points').inputValue();report.checks.alpha=await details(alpha,alphaPoint);
  await click('resume');assert.equal((await command('printf "%s/%s" "$e9_label" "$e9_queue"')).trim(),'alpha-memory/alpha-queued');
  await click('stop');assert.equal((await details(alpha)).manifest.checkpoints.length,3);
  await command("printf 'beta-file\\n' > /root/e9-library/state; e9_label=beta-memory; e9_queue=beta-queued; sync");
  await click('start');const beta=await control('sessions').inputValue();assert.notEqual(beta,alpha);await click('stop');
  await control('name').fill('Beta saved session');await control('name').press('Enter');await idle();
  report.checks.beta=await details(beta);
  console.log('Two actual sessions saved; reloading and opening exact points');
  assert.equal(report.checks.beta.manifest.events.length,0);
  await navigate(()=>page.reload({waitUntil:'domcontentloaded'}));await page.waitForFunction(()=>window.__ready===true);await idle();
  report.checks.afterReload=await control('sessions').locator('option').evaluateAll(options=>options.map(option=>({id:option.value,text:option.textContent})));
  assert.equal(report.checks.afterReload.length,2);assert.ok(report.checks.afterReload.some(row=>row.id===beta&&row.text==='Beta saved session'));
  assert.equal(await control('active').getAttribute('data-id'),'');
  await control('sessions').selectOption(alpha);await idle();await control('name').fill('Alpha saved session');
  await control('name').press('Enter');await idle();await control('points').selectOption(alphaPoint);
  await control('open').focus();await control('open').press('Enter');await idle();
  report.checks.pausedRpc=await page.evaluate(async()=>{try{await wvmDemo.exec('printf should-not-run',1000,{quiet:true});return 'accepted';}catch(error){return {code:error.code,message:error.message};}});
  assert.equal(report.checks.pausedRpc.code,'GUEST_PAUSED');
  report.checks.alphaRestored=await activeFrame('alpha-restored.checkpoint.gz');
  assert.equal(report.checks.alphaRestored.hash,report.checks.alpha.frameHash);assert.equal(report.checks.alphaRestored.active,alpha);
  assert.equal(report.checks.alphaRestored.point,alphaPoint);assert.equal(report.checks.alphaRestored.scheduler.retiredInstructions,0);assert.equal(report.checks.alphaRestored.paused,true);
  // The older preview's async read must not overwrite a later selection or the actual owner.
  await control('sessions').selectOption(beta);await idle();
  await page.evaluate(alpha=>{
    const prototype=Object.getPrototypeOf(__sessionLibrary.store),original=prototype.openSession;
    let release;window.__previewDelay={entered:false,release:()=>release(),restore:()=>{prototype.openSession=original;}};
    const gate=new Promise(resolve=>{release=resolve;});
    prototype.openSession=async function(id){if(id===alpha){__previewDelay.entered=true;await gate;}return original.call(this,id);};
  },alpha);
  await control('sessions').selectOption(alpha);await page.waitForFunction(()=>__previewDelay.entered);
  await control('sessions').selectOption(beta);await idle();await page.evaluate(()=>{__previewDelay.release();__previewDelay.restore();});
  await page.waitForTimeout(100);report.checks.selection=await page.evaluate(()=>({selected:__sessionLibrary.selected,preview:__sessionLibrary.preview.id,active:__sessionLibrary.active.id}));
  assert.deepEqual(report.checks.selection,{selected:beta,preview:beta,active:alpha});
  assert.equal((await activeFrame('after-preview.checkpoint.gz')).hash,report.checks.alpha.frameHash);
  console.log('Exact alpha restore and stale-preview fence passed; checking unavailable rows');
  // Real unavailable rows: one structurally valid foreign runtime and one missing durable object.
  report.checks.unavailable=await page.evaluate(async alpha=>{
    const {checkpointReference,checkpointChunks,readCheckpointObject}=await import('./session-checkpoints.js');
    const store=__sessionLibrary.store,opened=await store.openSession(alpha),source=JSON.parse(new TextDecoder().decode(opened.manifest));
    const config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,source.assets.find(a=>a.role==='vm').content)));
    const result={};
    for(const [id,runtime] of [['library-incompatible','f'.repeat(64)],['library-incomplete',config.runtime]]){
      const changed={...config,runtime,library_fixture:id},bytes=new TextEncoder().encode(JSON.stringify(changed)),ref=checkpointReference(bytes);
      const manifest=structuredClone(source);manifest.id=id;manifest.machine.vm_build=ref.sha256;manifest.assets.find(a=>a.role==='vm').content=ref;
      const writer=await store.writer(id);try{await writer.put(ref,checkpointChunks(bytes));await writer.publish(new TextEncoder().encode(JSON.stringify(manifest)));}finally{await writer.release();}
      result[id]={ref};
      if(id==='library-incomplete'){
        const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('wasm-vm-sessions-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
        await new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite',{durability:'strict'});tx.objectStore('chunks').delete(ref.sha256);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
      }
    }
    return result;
  },alpha);
  await click('refresh');await control('sessions').selectOption('library-incompatible');await idle();
  assert.equal(await page.locator('#session-library').getAttribute('data-state'),'incompatible');assert.equal(await control('open').isDisabled(),true);
  await control('name').fill('Unavailable build');await control('name').press('Enter');await idle();
  assert.equal(await page.locator('#session-library').getAttribute('data-state'),'incompatible');
  assert.match(await control('details').innerText(),/Capture duration unavailable/);
  assert.equal((await activeFrame('after-incompatible.checkpoint.gz')).hash,report.checks.alpha.frameHash);
  await control('sessions').selectOption('library-incomplete');await idle();assert.equal(await page.locator('#session-library').getAttribute('data-state'),'incomplete');
  assert.equal(await control('open').isDisabled(),true);
  await control('sessions').selectOption(alpha);await idle();
  await page.evaluate(()=>{window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='wasm-vm.session-library.v1')throw new DOMException('test label quota','QuotaExceededError');return __setItem.call(this,key,value);};});
  await control('name').fill('Must not persist');await control('name').press('Enter');await idle();
  assert.equal(await page.locator('#session-library').getAttribute('data-state'),'storage-error');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__setItem;delete window.__setItem;});await click('refresh');
  assert.equal(await control('name').inputValue(),'Alpha saved session');
  report.checks.activeAfterErrors=await activeFrame('after-errors.checkpoint.gz');assert.equal(report.checks.activeAfterErrors.hash,report.checks.alpha.frameHash);
  await control('resume').focus();await control('resume').press('Enter');await idle();
  report.checks.alphaFile=(await command('cat /root/e9-library/state')).trim();
  report.checks.alphaMemory=(await command('printf "%s/%s" "$e9_label" "$e9_queue"')).trim();
  assert.equal(report.checks.alphaFile,'alpha-file');assert.equal(report.checks.alphaMemory,'alpha-memory/alpha-queued');
  await control('sessions').selectOption(beta);await idle();await control('open').focus();await control('open').press('Enter');await idle();
  report.checks.betaRestored=await activeFrame('beta-restored.checkpoint.gz');assert.equal(report.checks.betaRestored.hash,report.checks.beta.frameHash);
  assert.equal(report.checks.betaRestored.active,beta);assert.equal(report.checks.betaRestored.scheduler.retiredInstructions,0);
  await click('resume');report.checks.betaFile=(await command('cat /root/e9-library/state')).trim();
  report.checks.betaMemory=(await command('printf "%s/%s" "$e9_label" "$e9_queue"')).trim();
  assert.equal(report.checks.betaFile,'beta-file');assert.equal(report.checks.betaMemory,'beta-memory/beta-queued');
  await page.locator('#session-library').screenshot({path:path.join(output,'library-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  report.checks.mobile=await page.locator('#session-library').evaluate(el=>({width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth,viewport:innerWidth}));
  assert.ok(report.checks.mobile.right<=report.checks.mobile.viewport+1&&report.checks.mobile.scroll<=report.checks.mobile.client+1,JSON.stringify(report.checks.mobile));
  await page.locator('#session-library').screenshot({path:path.join(output,'library-mobile.png')});
  for(const name of (await fs.readdir(output)).filter(name=>name.endsWith('.checkpoint.gz'))){const bytes=gunzipSync(await fs.readFile(path.join(output,name)));(report.checks.rawTuples??=[]).push({name,bytes:bytes.length,sha256:sha(bytes)});}
  assert.equal(report.checks.rawTuples.find(x=>x.name==='alpha-restored.checkpoint.gz').sha256,report.checks.alpha.frameHash);
  assert.equal(report.checks.rawTuples.find(x=>x.name==='beta-restored.checkpoint.gz').sha256,report.checks.beta.frameHash);
  console.log('Both guest witnesses and responsive controls passed');
  const labels=await page.evaluate(()=>{const value=localStorage.getItem('wasm-vm.session-library.v1');localStorage.setItem('wasm-vm.session-library.v1','{');return value;});
  await navigate(()=>page.reload({waitUntil:'domcontentloaded'}));await page.waitForFunction(()=>window.__ready===true);await idle();
  report.checks.labelRecovery={state:await page.locator('#session-library').getAttribute('data-state'),rows:await control('sessions').locator('option').count()};
  assert.equal(report.checks.labelRecovery.state,'storage-error');assert.equal(report.checks.labelRecovery.rows,4);
  await page.locator('#session-library').screenshot({path:path.join(output,'metadata-error.png')});
  await page.evaluate(value=>localStorage.setItem('wasm-vm.session-library.v1',value),labels);
  await page.setViewportSize({width:1440,height:1000});
  await navigate(()=>page.goto(new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',report.url).href,{waitUntil:'domcontentloaded'}));await page.waitForFunction(()=>window.__ready===true);await idle();
  report.checks.namesAfterRecovery=await control('sessions').locator('option').allTextContents();
  assert.ok(report.checks.namesAfterRecovery.includes('Alpha saved session')&&report.checks.namesAfterRecovery.includes('Beta saved session'));
  await page.unroute('**/__e9-library-proof/*');
  if(!development){
    await page.locator('#desktop-graphics').selectOption('gpu');assert.equal((await page.evaluate(()=>wvmDemo.bootOmarchy())).ok,true);
    await page.waitForFunction(()=>wvmDemo.isGuestReady()&&__linux.restoredFromBootSnapshot(),null,{timeout:600000});
    const gpu=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
    report.checks.gpu={qualified:gpu.gpu.qualified,lost:gpu.gpu.lost,poisoned:gpu.gpu.poisoned,epoch:gpu.gpu.epoch,
      retired:gpu.scheduler.retiredInstructions,drawn:gpu.gpu.scanout.retirements.filter(r=>r.epoch===gpu.gpu.epoch&&r.status==='drawn')};
    assert.ok(report.checks.gpu.qualified&&!report.checks.gpu.lost&&!report.checks.gpu.poisoned&&report.checks.gpu.retired>0&&report.checks.gpu.drawn.length);
    await page.screenshot({path:path.join(output,'gpu-factory-ready.png')});
  }
  assert.deepEqual(report.errors,[]);report.status='passed';console.log('Library: persisted two real sessions, exact paused UI restores, preview fencing, error states and guest file/RAM witnesses passed.');
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  if(page&&!page.isClosed()){
    try{report.finalUi=await page.locator('#session-library').evaluate(el=>({state:el.dataset.state,text:el.innerText}));}catch{}
    try{await collectCoverage();await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(coverage));}
    catch(error){report.coverageFailure=error.message;if(report.status==='passed'){report.status='failed';process.exitCode=1;}}
    if(report.status==='failed')await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  }
  if(context){await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context.close().catch(()=>{});}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(report.status==='passed'&&report.coverageSegments?.length!==4){report.status='failed';report.coverageFailure='expected four sealed document coverage segments';process.exitCode=1;}
  report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
