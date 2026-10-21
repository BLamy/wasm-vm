#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const development=process.argv.includes('--development');
const web=path.join(root,development?'web':'web/dist');
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
const report={task:'E9-T19',status:'running',errors:[],notFound:[],badMimes:[],development};
await fs.mkdir(output,{recursive:true});
let server,browser,context,page;
try{
 server=createServer(async(request,response)=>{
  try{let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
   if(name==='/favicon.ico'){response.writeHead(204).end();return;}
   if(development&&name==='/app.html')name='/index.html';
   if(name==='/artifacts.json'){
    const artifacts=JSON.parse(await fs.readFile(path.join(web,'artifacts.json'),'utf8'));
    artifacts.artifacts.kernel.url='/__r2_kernel';
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(artifacts));return;
   }
   if(name.startsWith('/releases/kernel/')){response.writeHead(404).end();return;}
   if(name==='/__r2_kernel')name='/releases/kernel/6.6.63/Image';
   const release=name.startsWith('/releases/');
   const file=release?path.resolve(root,'.'+name):path.resolve(web,'.'+name);
   if(release?!file.startsWith(path.join(root,'releases')+path.sep):!file.startsWith(web+path.sep))throw Error('path');
   const bytes=await fs.readFile(file);
   response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}).end(bytes);
  }catch(error){report.notFound.push({path:request.url,error:String(error)});response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',hasTouch:true});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page=await context.newPage();
 page.on('response',response=>{const type=response.headers()['content-type'];
  if(type==='application/octet-stream'&&/\.m?js(?:\?|$)/.test(response.url()))report.badMimes.push(response.url());});
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('pageerror',error=>report.errors.push(error.message));
 // testHooks defaults to a 300 ms watchdog for fatal-protocol tests; restore the
 // production 10 s timeout while serializing real 256 MiB replay checkpoints.
 await page.goto(`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__ready===true,null,{timeout:60000});
 if(!process.argv.includes('--probe-only')){
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.suite,{passed:127,failed:0});
 }

 const panel=page.locator('#session-timeline'),c=key=>panel.locator(`[data-timeline="${key}"]`);
 const settled=async()=>page.waitForFunction(()=>globalThis.__sessionTimeline&&!globalThis.__sessionTimeline.recording&&!globalThis.__sessionTimeline.snapshot.pending,null,{timeout:180000});
 await page.waitForFunction(()=>globalThis.__sessionTimeline?.store,null,{timeout:60000});
 report.liveGuest=await page.evaluate(async()=>{
   const boot=await wvmDemo.runBusybox();if(!boot.ok)throw Error(boot.error||'Live guest did not start');
   globalThis.__timelineLiveController=__linuxCtl;return {boot,paused:await __linuxCtl.isPaused()};});
 assert.equal(report.liveGuest.paused,false);
 // Hold the first actual frame; a newer seek must survive the cancelled open continuation.
 await page.evaluate(()=>{
   const t=__sessionTimeline;globalThis.__timelineInitialHeld=false;
   t.beforeFrame=async()=>{t.beforeFrame=async()=>{};__timelineInitialHeld=true;await new Promise(resolve=>{globalThis.__timelineInitialRelease=resolve;});};
 });
 await c('record').click();
 await page.waitForFunction(()=>globalThis.__timelineInitialHeld,null,{timeout:300000});
 await c('target').fill('123');await c('target').press('Enter');
 await page.evaluate(()=>__timelineInitialRelease());
 await page.waitForFunction(()=>!!globalThis.__sessionTimeline?.active&&!globalThis.__sessionTimeline.recording&&!globalThis.__sessionTimeline.snapshot.pending,null,{timeout:300000});
 const recorded=await page.evaluate(()=>globalThis.__sessionTimeline.snapshot);
 report.liveGuest.afterRecording=await page.evaluate(async()=>({sameOwner:__timelineLiveController===__linuxCtl,paused:await __linuxCtl.isPaused()}));
 assert.deepEqual(report.liveGuest.afterRecording,{sameOwner:true,paused:true});
 assert.equal(recorded.mode,'replay');assert.equal(recorded.active.position.transition,'123');
 const id=recorded.active.id;
 report.checks={sample:id,initial:recorded.active,oracles:[]};
 // An independent private machine starts at the first checkpoint every time; it never
 // imports the timeline adapter, console renderer, keyframe reconstruction or seek owner.
 async function oracle(label){
  const result=await page.evaluate(async()=>{
   const t=globalThis.__sessionTimeline,s=t.snapshot.active;
   const {readCheckpointObject}=await import('./session-checkpoints.js');
   const {SessionInputJournal}=await import('./session-inputs.js');
   const {WasmLinux}=await import('./pkg/wasm_vm_wasm.js');
   const m=JSON.parse(new TextDecoder().decode((await t.store.openSession(s.id)).manifest));
   const config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(t.store,m.assets.find(a=>a.role==='vm').content,1048576)));
   const read=await SessionInputJournal.readExact(t.store,s.id,{configuration:config});
   const kernel=await readCheckpointObject(t.store,m.assets.find(a=>a.role==='kernel').content,64*1048576);
   const candidate=WasmLinux.newExactSession(kernel,config.imageManifest,config.bootargs,()=>{},true);
   try{
    candidate.beginExactReplay(read.initialResume,read.receipts,read.witnesses,m.end);
    let at,calls=0;do{at=candidate.runExactReplayChunkTo(s.position,65536);if(++calls>10000)throw Error('oracle work bound');}while(!at.reached);
    const observed=candidate.exactSessionWitness(false),hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
    const queues=candidate.exactSessionHostQueues(),parts=read.receipts.filter(r=>r.kind==='host'&&r.channel===21&&BigInt(r.sequence)<=BigInt(s.position.sequence)).map(r=>r.bytes);
    parts.push(queues.output);const all=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of parts){all.set(b,offset);offset+=b.length;}
    const consoleText=new TextDecoder().decode(all.subarray(Math.max(0,all.length-65536)))||'(No serial output at this position.)';
    return {active:s,observed:{transition:observed.transition,retired:observed.retired,sequence:observed.sequence,phase:observed.phase,ordinal:observed.ordinal,digest:hex(observed.digest)},
      consoleMatches:document.querySelector('[data-timeline="console"]').textContent===consoleText,
      visibleTransition:document.querySelector('[data-timeline="position"]').dataset.transition,
      visibleDigest:document.querySelector('[data-timeline="digest"]').textContent};
   }finally{candidate.free();}
  });
  assert.deepEqual(result.active.position,(({digest,...p})=>p)(result.observed));
  assert.equal(result.active.digest,result.observed.digest);assert.equal(result.visibleDigest,result.observed.digest);
  assert.equal(result.visibleTransition,result.active.position.transition);assert.equal(result.consoleMatches,true);
  report.checks.oracles.push({label,...result});
 }
 await oracle('scrub-during-first-open');
 await c('points').selectOption({index:0});await c('point-go').click();await settled();await oracle('open-beginning');
 await c('target').fill('1000123');await c('target').press('Enter');await settled();
 assert.equal(await c('target').evaluate(e=>document.activeElement===e),true);
 await oracle('keyboard-exact-transition');
 await c('forward').focus();await page.keyboard.press('Enter');await settled();
 assert.equal((await page.evaluate(()=>__sessionTimeline.snapshot.active.position.transition)),'1000124');
 await c('back').focus();await page.keyboard.press('Enter');await settled();await oracle('keyboard-reverse-step');
 await c('points').selectOption({index:1});await c('points').focus();await page.keyboard.press('Tab');await page.keyboard.press('Enter');await settled();
 assert.equal(await page.evaluate(()=>__sessionTimeline.snapshot.active.position.transition),'64');
 await oracle('keyboard-keyframe');
 const eventsBefore=await c('events').locator('option').count();await c('refresh').click();
 await page.waitForFunction(()=>__sessionTimeline.preview?.id===__sessionTimeline.active?.id&&document.querySelector('[data-timeline="events"]').options.length>0);
 assert.equal(await c('events').locator('option').count(),eventsBefore);
 await page.evaluate(async id=>{await __sessionTimeline.select('missing-session');await __sessionTimeline.select(id);},id);
 assert.equal(await c('events').locator('option').count(),eventsBefore);
 await c('events').selectOption({index:0});await c('event-go').click();await settled();await oracle('event-navigation');
 assert.deepEqual(await page.evaluate(()=>__sessionTimeline.snapshot.active.position),await page.evaluate(()=>{
   const e=__sessionTimeline.owner.events[0];return {transition:e.transition,retired:e.retired,phase:e.phase,ordinal:e.ordinal,sequence:e.sequence};}));
 assert.equal(await c('back').isDisabled(),true);
 report.checks.observationRoutingFixture=await page.evaluate(async()=>{
   const t=__sessionTimeline,rows=t.owner.events;
   try{t.owner.events=[{...rows[0],phase:'observe',transition:'63'}];t.fillEvents(t.owner);await t.navigate('events');
     return {syntheticMarker:true,recordedTapeChanged:false,target:t.snapshot.active.position.transition};
   }finally{t.owner.events=rows;t.fillEvents(t.owner);}
 });
 assert.equal(report.checks.observationRoutingFixture.target,'64');await oracle('observation-marker-route-to-real-state');
 await c('scrub').focus();await page.keyboard.press('Home');await settled();
 await page.keyboard.press('ArrowRight');await settled();
 assert.equal(await c('scrub').evaluate(e=>document.activeElement===e),true);
 assert.equal(await page.evaluate(()=>__sessionTimeline.snapshot.active.position.transition),'3000');await oracle('native-keyboard-scrub');
 const box=await c('scrub').boundingBox();await page.mouse.click(box.x+box.width*0.68,box.y+box.height/2);await settled();
 await oracle('mouse-scrub');
 // Hold a real computed frame so previews, cancellation and latest ownership are observable.
 await page.evaluate(()=>{
  const t=__sessionTimeline;globalThis.__timelineHeld=false;globalThis.__timelineRelease=null;
  t.beforeFrame=async()=>{t.beforeFrame=async()=>{};__timelineHeld=true;await new Promise(resolve=>{__timelineRelease=resolve;});};
  globalThis.__timelineOld=t.seek('1000125');
 });
 await page.waitForFunction(()=>__timelineHeld);
 const before=await page.evaluate(()=>__sessionTimeline.snapshot);
 assert.equal(before.pending,true);assert.notEqual(before.active.position.transition,'1000125');
 assert.match(await c('preview').textContent(),/Preview target/);
 report.checks.supersession=await page.evaluate(async()=>{
  const t=__sessionTimeline,old=t.snapshot.active,start=performance.now(),requests=[];let seed=17,target;
  for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;target=String(1000200+(seed%100));requests.push(t.seek(target));}
  const obsolete=await Promise.all([__timelineOld,...requests.slice(0,-1)]),cancelMs=performance.now()-start;
  const unchanged=JSON.stringify(old)===JSON.stringify(t.snapshot.active);__timelineRelease();const winner=await requests.at(-1);
  return {obsolete:obsolete.map(r=>r.status),cancelMs,unchanged,winner:winner.status,target,active:t.snapshot.active,status:t.snapshot.status};
 });
 assert.equal(report.checks.supersession.obsolete.length,100);assert.ok(report.checks.supersession.obsolete.every(s=>s==='cancelled'));
 assert.ok(report.checks.supersession.cancelMs<=250);assert.equal(report.checks.supersession.unchanged,true);
 assert.equal(report.checks.supersession.winner,'ready');assert.equal(report.checks.supersession.active.position.transition,report.checks.supersession.target);
 assert.match(report.checks.supersession.status,/Replay restored/);await oracle('latest-of-100');
 await c('target').fill('1000000');await c('seek').click();await settled();
 await c('play').click();await page.waitForFunction(()=>__sessionTimeline.playing&&BigInt(__sessionTimeline.snapshot.active.position.transition)>1000000n);await c('pause').click();await settled();
 const paused=await page.evaluate(()=>__sessionTimeline.snapshot);await page.waitForTimeout(150);
 assert.equal((await page.evaluate(()=>__sessionTimeline.snapshot.playing)),false);
 assert.deepEqual((await page.evaluate(()=>__sessionTimeline.snapshot.active)),paused.active);await oracle('play-pause');
 await c('target').fill('18446744073709551616');await c('seek').click();await settled();
 assert.match(await c('status').textContent(),/transition outside saved history/);assert.deepEqual((await page.evaluate(()=>__sessionTimeline.snapshot.active)),paused.active);
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
 const narrow=await c('scrub').boundingBox();await page.touchscreen.tap(narrow.x+narrow.width*0.3,narrow.y+narrow.height/2);await settled();await oracle('touch-scrub');
 report.checks.narrow=await panel.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:innerWidth,
   live:el.querySelector('[role="status"]').getAttribute('aria-live')}));
 assert.ok(report.checks.narrow.scroll<=report.checks.narrow.client+1);assert.ok(report.checks.narrow.right<=report.checks.narrow.viewport+1);assert.equal(report.checks.narrow.live,'polite');
 await panel.screenshot({path:path.join(output,'timeline-phone.png')});
 // Canonical stored metadata fixtures exercise admission, not GPU execution. The
 // existing recorded machine and console must remain intact when these are selected.
 report.checks.gates=await page.evaluate(async()=>{
  const t=__sessionTimeline,active=JSON.stringify(t.snapshot.active),consoleText=t.c.console.textContent;
  const original=JSON.parse(new TextDecoder().decode((await t.store.openSession(t.active.id)).manifest));
  const {readCheckpointObject,checkpointReference,checkpointChunks}=await import('./session-checkpoints.js');
  const results=[];
  for(const [id,edit] of [['e9-t19-incomplete',m=>{m.policy.mode='capture-prefix';m.extensions=m.extensions.filter(e=>e.kind!=='e9-exact-state-witnesses-v1');}],
    ['e9-t19-incompatible',()=>{}],['e9-t19-gpu',()=>{}]]){
    const m=structuredClone(original);m.id=id;edit(m);const writer=await t.store.writer(id);
    try{
      if(id==='e9-t19-incompatible'){const vm=m.assets.find(a=>a.role==='vm'),config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(t.store,vm.content,1048576)));
        config.runtime='incompatible-v1';const bytes=new TextEncoder().encode(JSON.stringify(config));vm.content=checkpointReference(bytes);m.machine.vm_build=vm.content.sha256;await writer.put(vm.content,checkpointChunks(bytes));}
      if(id==='e9-t19-gpu'){
        const renderer=new Uint8Array([71,80,85]),gpu=new Uint8Array([71,65,84,69]),rendererRef=checkpointReference(renderer),gpuRef=checkpointReference(gpu);
        await writer.put(rendererRef,checkpointChunks(renderer));await writer.put(gpuRef,checkpointChunks(gpu));
        m.machine.devices.find(d=>d.kind==='virtio-gpu2d').kind='virtio-gpu3d';m.machine.gpu={renderer_build:rendererRef.sha256,profile:'2'.repeat(64)};
        m.policy.mode='checkpoints-only';m.policy.profile='rv64-linux-gpu-v1';m.policy.required_inputs=[...new Set([...m.policy.required_inputs.filter(k=>k!=='software-gpu'),'gpu-results'])];
        m.events=[];m.begin.sequence='0';m.end.sequence='0';for(const p of m.checkpoints){p.position.sequence='0';p.next_sequence='1';}
        m.assets.push({role:'gpu-renderer',content:rendererRef});for(const point of m.checkpoints)point.gpu=gpuRef;
      }
      await writer.publish(new TextEncoder().encode(JSON.stringify(m)));
    }finally{await writer.release();}
    await t.refresh(id);let result;try{result=await t.open();}catch(error){result={status:'error',error:error.message};}
    results.push({id,result:result??null,status:t.snapshot.status,activeUnchanged:JSON.stringify(t.snapshot.active)===active,consoleUnchanged:t.c.console.textContent===consoleText,openDisabled:t.c.open.disabled});
  }
  await t.select('missing-session');results.push({id:'missing-session',status:t.snapshot.status,activeUnchanged:JSON.stringify(t.snapshot.active)===active});
  return results;
 });
 assert.ok(report.checks.gates.every(r=>r.activeUnchanged));assert.ok(report.checks.gates.slice(0,2).every(r=>r.consoleUnchanged));
 assert.equal(report.checks.gates[0].openDisabled,true);assert.match(report.checks.gates[1].status,/incompatible guest build/);
 assert.equal(report.checks.gates[2].openDisabled,true);assert.match(report.checks.gates[2].status,/GPU event replay is awaiting verification/);
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(id=>__sessionTimeline.select(id),id);
 const priorOpen=await page.evaluate(()=>__sessionTimeline.snapshot.active);
 await c('open').click();await c('pause').click();await settled();
 assert.deepEqual(await page.evaluate(()=>__sessionTimeline.snapshot.active),priorOpen);
 await c('open').click();await settled();
 await c('points').selectOption({index:3});await c('point-go').click();await settled();
 assert.equal(await page.evaluate(()=>__sessionTimeline.snapshot.active.position.transition),'3000000');
 assert.doesNotMatch(await c('console').textContent(),/^\(No serial output/);await oracle('genuine-linux-console-at-end');
 assert.equal(await c('forward').isDisabled(),true);
 await panel.screenshot({path:path.join(output,'timeline-desktop.png')});
 await c('record').click();await c('stop').click();
 await page.waitForFunction(previous=>__sessionTimeline.active?.id!==previous&&!__sessionTimeline.recording&&!__sessionTimeline.snapshot.pending,id,{timeout:300000});
 report.checks.early=await page.evaluate(async()=>{
   const t=__sessionTimeline,m=JSON.parse(new TextDecoder().decode((await t.store.openSession(t.active.id)).manifest));return {id:m.id,mode:m.policy.mode,end:m.end,checkpoints:m.checkpoints.length};});
 assert.equal(report.checks.early.mode,'exact-replay');assert.equal(report.checks.early.end.transition,'64');assert.equal(report.checks.early.checkpoints,2);
 await oracle('early-finish-sample');
 assert.match(await page.locator('.cap',{hasText:'Accessible session timeline'}).locator('.cap-pip').getAttribute('class'),/in-progress|verified/);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.notFound,[]);assert.deepEqual(report.badMimes,[]);
 report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await context?.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
 await context?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,checks:Object.keys(report.checks??{}),failure:report.failure,errors:report.errors,notFound:report.notFound,badMimes:report.badMimes}));}
