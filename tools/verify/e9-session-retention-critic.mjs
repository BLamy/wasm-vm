#!/usr/bin/env node
// Portable, bounded fresh-critic regressions. Runtime comes from the current committed dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {retentionFixture,checkRetentionStorage,checkCleanupCrashes} from './e9-session-retention-storage.mjs';
import {checkRetentionLibraryCritic} from './e9-session-retention-critic-ui.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),web=path.join(root,'web/dist');
const argument=flag=>{const i=process.argv.indexOf(flag);return i<0?null:process.argv[i+1];};
assert.ok(argument('--recording-report')&&argument('--output'),'--recording-report and --output required');
const recordingPath=path.resolve(argument('--recording-report')),out=path.resolve(argument('--output'));
const recording=JSON.parse(await fs.readFile(recordingPath,'utf8'));
assert.equal(recording.status,'passed');assert.equal(recording.development,false);assert.deepEqual(recording.errors,[]);
await fs.mkdir(out,{recursive:false});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>({ref:{sha256:hash(bytes),length:String(bytes.length)},bytes:[...bytes]});
for(const [name,digest]of Object.entries(recording.source_sha256))if(name.startsWith('web/'))assert.equal(hash(await fs.readFile(path.join(root,name))),digest,name+' changed since the recording');
const originalStore=await fs.readFile(path.join(web,'session-store.js'),'utf8');
const html=await fs.readFile(path.join(web,'app.html'),'utf8');
const controls=html.match(/<details\b[^>]*id="session-library"[\s\S]*?<\/details>/)?.[0];assert.ok(controls);
const fixture0=await retentionFixture(root);
function independent(seed){
  const f=structuredClone(fixture0);
  const leaves=[0,1].map(index=>blob(Buffer.from(Array.from({length:4096},(_,n)=>(seed*31+n*13+index*97)%256))));
  const privateLeaf=blob(Buffer.from(Array.from({length:4096},(_,n)=>(seed*79+n*17+9)%256)));
  const diskRoot=(generation,values)=>blob(Buffer.from(JSON.stringify({version:{major:1,minor:0},base:f.template.machine.base_image,image_len:'8192',generation:String(generation),blocks:values.map((leaf,index)=>({index:String(index),sha256:leaf.ref.sha256}))})));
  const sharedMachine=blob(Buffer.from('independent machine '+seed)),privateMachine=blob(Buffer.from('private verifier machine '+seed));
  const sharedRoot=diskRoot(1,leaves),privateRoot=diskRoot(2,[leaves[0],privateLeaf]);
  const payload=blob(Buffer.from('verifier indirect payload '+seed));
  const events=JSON.parse(Buffer.from(f.shared.at(-1).bytes).toString());events[0].payload.content=payload.ref;
  const eventChunk=blob(Buffer.from(JSON.stringify(events)));
  f.template.checkpoints[0].machine=sharedMachine.ref;f.template.checkpoints[0].disk_root=sharedRoot.ref.sha256;f.template.events[0].content=eventChunk.ref;
  f.shared=[...f.shared.slice(0,4),sharedMachine,...leaves,sharedRoot,payload,eventChunk];f.unique=[privateMachine,privateLeaf,privateRoot];
  Object.assign(f,{sharedMachine,privateMachine,sharedRoot,privateRoot,payload,expectedSharedBytes:f.shared.reduce((n,x)=>n+x.bytes.length,0)});
  return f;
}
const mutants={
  'disk-sabotage':originalStore.replace('add(await this.#object(block));','void await this.#object(block);'),
  'event-sabotage':originalStore.replace('for (const object of await this.#references(decoded)) add(object);',`for (const object of await this.#references(decoded)) if (object.sha256 !== '${fixture0.payload.ref.sha256}') add(object);`),
};
assert.ok(Object.values(mutants).every(source=>source!==originalStore));

const url=new URL('/__e9-retention-critic.html',recording.url).href;
async function serveCurrent(page,mode=null){
  await page.route('**/*',async route=>{try{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/favicon.ico'){await route.fulfill({status:204,body:''});return;}
    let bytes;if(pathname==='/__e9-retention-critic.html')bytes=Buffer.from('<!doctype html><meta charset="utf-8"><style>body{background:#0e131b;color:#e5e7eb;font-family:sans-serif}</style><link rel="stylesheet" href="./session-library.css"><script>window.__ready=true;</script>'+controls);
    else if(mode&&pathname==='/session-store.js')bytes=Buffer.from(mutants[mode]);
    else{const file=path.resolve(web,'.'+decodeURIComponent(pathname));assert.ok(file.startsWith(web+path.sep));bytes=await fs.readFile(file);}
    const type=pathname.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(pathname)?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.json')?'application/json':'text/html';
    await route.fulfill({status:200,body:bytes,contentType:type,headers:{'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}});
  }catch{await route.fulfill({status:404,body:''});}});
}
// Clone the CLOSED original profile. Never open or modify the evidence profile itself.
await fs.cp(path.join(path.dirname(recordingPath),'chromium-profile'),path.join(out,'profile'),{recursive:true,mode:constants.COPYFILE_FICLONE});
const context=await chromium.launchPersistentContext(path.join(out,'profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',serviceWorkers:'block'});
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
const report={status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),recording_head:recording.head,recording_report_sha256:hash(await fs.readFile(recordingPath)),checks:{}};
let criticBrowser,criticContext,page,other,direct,ui;
const coverage=[];
try{
  direct=await context.newPage();await serveCurrent(direct);await direct.coverage.startJSCoverage({resetOnNavigation:false});await direct.goto(url);
  const expected=recording.checks.siblingOriginal;
  report.checks.direct=await direct.evaluate(async expected=>{
    const {startLinuxBoot}=await import('./loader.js'),{checkpointHash}=await import('./session-checkpoints.js');let controller;
    try{controller=await startLinuxBoot({sessionCheckpoint:{id:expected.id,checkpoint:expected.point},slirpProvider:'offline'});
      const frame=await controller.captureSoftwareCheckpoint();return {hash:checkpointHash(frame),bytes:frame.length,paused:await controller.isPaused(),scheduler:await controller.schedulerStats(),locks:(await navigator.locks.query()).held};
    }finally{await controller?.stop();await controller?.releaseWriterLock();await controller?.closeStorage();}
  },expected);
  assert.equal(report.checks.direct.hash,expected.frameHash);assert.equal(report.checks.direct.bytes,expected.bytes);assert.equal(report.checks.direct.paused,true);assert.equal(report.checks.direct.scheduler.slices,0);assert.deepEqual(report.checks.direct.locks,[]);
  coverage.push(...await direct.coverage.stopJSCoverage());await direct.close();direct=null;
  // Synthetic storage/error-boundary probes use a fresh context, never the retained real guest.
  criticBrowser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});criticContext=await criticBrowser.newContext({serviceWorkers:'block'});await serveCurrent(criticContext);await criticContext.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await criticContext.newPage();other=await criticContext.newPage();await serveCurrent(page);await serveCurrent(other);await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.goto(url);await other.goto(url);
  for(const seed of [1013,9917]){console.log('Independent reference graph',seed);report.checks['graph-'+seed]=await checkRetentionStorage(page,{namespace:'wasm-vm-sessions-v1-critic-'+seed,fixture:independent(seed)});}

  // Rehashed descendants, both renderer crash cuts, then simultaneous varied schedules.
  report.checks.crashes=await checkCleanupCrashes(criticContext,page,url,{namespace:'wasm-vm-sessions-v1-critic-1013',fixture:independent(1013)});
  {
  const third=await criticContext.newPage();await serveCurrent(third);await third.goto(url);
  const pages=[page,other,third],namespace='wasm-vm-sessions-v1-critic-1013',fixture=independent(1013);
  for(const p of pages)await p.evaluate(async namespace=>{const {SessionStore}=await import('./session-store.js');window.raceStore=await SessionStore.open(namespace);},namespace);
  report.checks.schedules=[];
  let random=0xd4e12a79;const rng=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
  for(let round=0;round<32;round++){
    const start=[rng()%13,rng()%13,rng()%13],hold=8+rng()%13;
    const results=await Promise.all([
      pages[0].evaluate(async({round,start,hold,fixture})=>{
        await new Promise(resolve=>setTimeout(resolve,start));let writer;const began=Date.now();
        try{
          writer=await raceStore.writer('independent-race-'+round);await new Promise(resolve=>setTimeout(resolve,hold));
          const m={...fixture.template,id:writer.id};await writer.publish(new TextEncoder().encode(JSON.stringify(m)));return {kind:'writer',code:'saved',began,finished:Date.now()};
        }catch(e){return {kind:'writer',code:e.code,began,finished:Date.now()};}finally{await writer?.release();}
      },{round,start:start[0],hold,fixture}),
      pages[1].evaluate(async({start,hold})=>{
        await new Promise(resolve=>setTimeout(resolve,start));const began=Date.now();
        try{return await raceStore.withReadLease(async()=>{await new Promise(resolve=>setTimeout(resolve,hold));const m=await raceStore.openSession('retention-sibling');return {kind:'reader',code:'read',revision:m.revision,began,finished:Date.now()};});}
        catch(e){return {kind:'reader',code:e.code,began,finished:Date.now()};}
      },{start:start[1],hold}),
      pages[2].evaluate(async start=>{
        await new Promise(resolve=>setTimeout(resolve,start));const began=Date.now();
        try{return {kind:'collector',code:'collected',result:await raceStore.collectGarbage(),began,finished:Date.now()};}
        catch(e){return {kind:'collector',code:e.code,began,finished:Date.now()};}
      },start[2])
    ]);
    for(const r of results)assert.ok(['saved','read','collected','MaintenanceBusy'].includes(r.code),JSON.stringify(r));
    const after=await pages[0].evaluate(async fixture=>{
      const collected=await raceStore.collectGarbage(),hashes=[];
      for(const item of fixture.shared){const bytes=[];for await(const part of raceStore.stream(item.ref))bytes.push(...part);
        hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join(''));}
      const m=await raceStore.openSession('retention-sibling');return {collected,hashes,revision:m.revision,manifest:[...m.manifest]};
    },fixture);
    assert.deepEqual(after.hashes,fixture.shared.map(item=>item.ref.sha256));assert.equal(after.revision,'1');assert.deepEqual(after.manifest,report.checks.crashes[0].manifest);
    report.checks.schedules.push({round,start,hold,results,after});
  }

  for(const p of pages)await p.evaluate(()=>raceStore.close());await third.close();
  }
  console.log('Inverse exclusive-maintenance attack');
  const namespace='wasm-vm-sessions-v1-inverse-lock';
  await page.evaluate(async({namespace,f})=>{
    const {SessionStore}=await import('./session-store.js');const store=window.attackStore=await SessionStore.open(namespace),w=await store.writer('inverse-survivor');
    for(const item of f.shared)await w.put(item.ref,[new Uint8Array(item.bytes)]);await w.publish(new TextEncoder().encode(JSON.stringify({...f.template,id:'inverse-survivor'})));await w.release();
  },{namespace,f:fixture0});
  // Playwright coverage auto-resumes debugger pauses; seal it before the CDP hold.
  coverage.push(...await page.coverage.stopJSCoverage());
  const cdp=await criticContext.newCDPSession(page);await cdp.send('Debugger.enable');
  const paused=new Promise(resolve=>cdp.once('Debugger.paused',resolve));let pauseTimer;
  const collecting=page.evaluate(async()=>{window.__e9SessionStoreProbe=e=>{if(e.phase==='gc-marked'){window.cut=e;debugger;}};return await attackStore.collectGarbage();});
  const pause=await Promise.race([paused,new Promise((_,reject)=>pauseTimer=setTimeout(()=>reject(Error('missing pause')),10000))]);
  clearTimeout(pauseTimer);const cut=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:pause.callFrames[0].callFrameId,expression:'JSON.stringify(cut)',returnByValue:true});
  const inverse=await other.evaluate(async namespace=>{
    const {SessionStore}=await import('./session-store.js'),s=await SessionStore.open(namespace),results={};
    for(const [name,callback] of [['writer',()=>s.writer('inverse-survivor')],['newWriter',()=>s.writer('inverse-new')],['read',()=>s.withReadLease(()=>null)],['delete',()=>s.deleteSession('inverse-survivor')],['gc',()=>s.collectGarbage()]]){
      try{await callback();results[name]='accepted';}catch(e){results[name]=e.code;}
    }await s.close();return results;
  },namespace);
  assert.ok(Object.values(inverse).every(code=>code==='MaintenanceBusy'),JSON.stringify(inverse));
  await cdp.send('Debugger.resume');const collected=await collecting;await cdp.detach();await page.coverage.startJSCoverage({resetOnNavigation:false});
  const survived=await page.evaluate(async fixture=>{
    delete window.__e9SessionStoreProbe;const hashes=[];
    for(const item of fixture.shared){const chunks=[];for await(const bytes of attackStore.stream(item.ref))chunks.push(...bytes);
      hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(chunks))),b=>b.toString(16).padStart(2,'0')).join(''));}
    const m=await attackStore.openSession('inverse-survivor');await attackStore.close();return {hashes,manifest:[...m.manifest],revision:m.revision};
  },fixture0);
  assert.deepEqual(survived.hashes,fixture0.shared.map(x=>x.ref.sha256));
  report.checks.inverse={cut:JSON.parse(cut.result.value),inverse,collected,survived};
  console.log('Same-revision replacement attack');
  report.checks.replacement=await page.evaluate(async fixture=>{
    const {SessionStore}=await import('./session-store.js'),{mountSessionLibrary}=await import('./session-library.js'),{sessionValidateManifest}=await import('./session-pkg/wasm_vm_session.js');
    let calls=0;const controller={isPaused(){calls++;throw Error('owner must not be touched');}};
    const library=await mountSessionLibrary(document.querySelector('#session-library'),{current:()=>({controller,profile:true,ready:true})});
    const store=library.store,w=await store.writer('replacement-victim');
    for(const item of fixture.shared)await w.put(item.ref,[new Uint8Array(item.bytes)]);
    const value={...fixture.template,id:'replacement-victim'};await w.publish(new TextEncoder().encode(JSON.stringify(value)));await w.release();
    const original=await store.openSession(value.id);library.pausedRecording={id:value.id,controller,revision:original.revision,prefixHash:library.hash(original.manifest)};
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wasm-vm-sessions-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    value.checkpoints[0].id='independent-replaced-point';const replacement=sessionValidateManifest(new TextEncoder().encode(JSON.stringify(value)));
    await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite',{durability:'strict'});tx.objectStore('sessions').put({id:value.id,revision:original.revision,manifest:replacement},value.id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    let code;try{await library.retry();code='accepted';}catch(e){code=e.code;}
    const after=await store.openSession(value.id);db.close();const locks=(await navigator.locks.query()).held;await store.deleteSession(value.id);await store.close();
    return {code,calls,paused:!!library.pausedRecording,recording:!!library.recording,revision:after.revision,before:library.hash(original.manifest),after:library.hash(after.manifest),expected:library.hash(replacement),locks};
  },fixture0);
  assert.equal(report.checks.replacement.code,'HistoryChanged');assert.equal(report.checks.replacement.calls,0);assert.equal(report.checks.replacement.paused,false);assert.equal(report.checks.replacement.recording,false);assert.equal(report.checks.replacement.revision,'1');assert.equal(report.checks.replacement.after,report.checks.replacement.expected);assert.notEqual(report.checks.replacement.before,report.checks.replacement.after);
  console.log('Unique 1-MiB parts and concurrent accounting');
  report.checks.accounting=await page.evaluate(async()=>{
    const {SessionStore}=await import('./session-store.js'),store=await SessionStore.open('wasm-vm-sessions-v1-part-accounting');
    const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',x)),b=>b.toString(16).padStart(2,'0')).join('');
    const a=new Uint8Array(1048576).fill(103),b=new Uint8Array(1048576).fill(179),c=new Uint8Array(1048576).fill(211),pair=new Uint8Array(2097152);pair.set(a);pair.set(a,1048576);
    const w=await store.writer('two-identical-parts');await w.put({sha256:await digest(pair),length:String(pair.length)},[pair]);await w.release();const duplicate=await store.statistics();
    await store.setRetention({maxBytes:2097152,maxCheckpoints:4096});
    const writers=await Promise.all(['racer-b','racer-c'].map(id=>store.writer(id)));
    const refs=await Promise.all([b,c].map(async bytes=>({sha256:await digest(bytes),length:String(bytes.length)})));
    const outcomes=await Promise.all(writers.map(async(writer,i)=>{try{await writer.put(refs[i],[[b,c][i]]);return 'saved';}catch(e){return e.code;}finally{await writer.release();}}));
    const concurrent=await store.statistics(),gc=await store.collectGarbage(),after=await store.statistics();await store.close();return {duplicate,outcomes,concurrent,gc,after};
  });
  assert.equal(report.checks.accounting.duplicate.payloadBytes,1048576);assert.equal(report.checks.accounting.duplicate.objects,1);assert.equal(report.checks.accounting.duplicate.chunks,1);
  assert.deepEqual(report.checks.accounting.outcomes.sort(),['RetentionLimit','saved']);assert.equal(report.checks.accounting.concurrent.payloadBytes,2097152);assert.equal(report.checks.accounting.after.payloadBytes,0);
  report.checks.sabotage={};
  for(const mode of Object.keys(mutants)){
    console.log('Sabotage',mode);const mutantPage=await criticContext.newPage();await serveCurrent(mutantPage,mode);await mutantPage.goto(url);
    let failure;try{await checkRetentionStorage(mutantPage,{namespace:'wasm-vm-sessions-v1-'+mode,fixture:fixture0});}catch(e){failure={name:e.name,message:e.message,stack:e.stack};}
    assert.ok(failure,mode+' passed after deleting an indirect mark');const missingHash=mode==='disk-sabotage'?fixture0.shared[5].ref.sha256:fixture0.payload.ref.sha256;assert.ok(failure.message.includes('Corrupt: '+missingHash),failure.message);report.checks.sabotage[mode]={source_sha256:hash(mutants[mode]),missingHash,failure};await mutantPage.close();
  }

  ui=await criticContext.newPage();await serveCurrent(ui);await ui.coverage.startJSCoverage({resetOnNavigation:false});
  report.checks.ui=await checkRetentionLibraryCritic(ui,fixture0,{url,output:path.join(out,'ui')});
  coverage.push(...await ui.coverage.stopJSCoverage());await ui.close();ui=null;
  report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  if(page&&!page.isClosed())coverage.push(...await page.coverage.stopJSCoverage().catch(()=>[]));
  if(direct&&!direct.isClosed())coverage.push(...await direct.coverage.stopJSCoverage().catch(()=>[]));
  if(ui&&!ui.isClosed())coverage.push(...await ui.coverage.stopJSCoverage().catch(()=>[]));
  await fs.writeFile(path.join(out,'coverage.json'),JSON.stringify(coverage));
  if(criticContext){await criticContext.tracing.stop({path:path.join(out,'critic-trace.zip')});await criticContext.close();}if(criticBrowser)await criticBrowser.close();
  await context.tracing.stop({path:path.join(out,'direct-trace.zip')});await context.close();
  report.source_sha256={};for(const name of ['web/session-store.js','web/session-library.js','web/loader.js','tools/verify/e9-session-retention-critic.mjs','tools/verify/e9-session-retention-critic-ui.mjs'])report.source_sha256[name]=hash(await fs.readFile(path.join(root,name)));
  report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(report.status);
}
