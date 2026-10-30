#!/usr/bin/env node
// Real Linux file continuation through the shipped timeline controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {retainSessionStore} from './e9-retain-session-store.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),options={};
for(let i=2;i<process.argv.length;i++){const key=process.argv[i];assert(!options[key]);if(key==='--include-deltas'){options[key]=true;continue;}assert(['--output','--web-root'].includes(key)&&process.argv[i+1]);options[key]=process.argv[++i];}
assert(options['--output']);const out=path.resolve(options['--output']),web=path.resolve(root,options['--web-root']??'web/dist');await fs.mkdir(out);
const app=await fs.access(path.join(web,'app.html')).then(()=>'app.html',()=>'index.html');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T20',scope:'real Linux/ext2 file and browser control acceptance; GPU and external-counter proof are separate',
 head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
 status:'running',started:new Date().toISOString(),errors:[],missing:[],external:[],sockets:[],raw:[],checks:[],inputs:{}};
for(const name of ['index.html','session-file-sample.js','session-branches.js','session-timeline.js','gpu-checkpoint-build.js','pkg/wasm_vm_wasm_bg.wasm','assets/session-branch-linux/image.json'])report.inputs[name]=sha(await fs.readFile(path.join(web,name)));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
let browser,context,page,progress,origin;
const server=createServer(async(request,response)=>{
 try{
  let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if(request.method==='POST'){
   assert(/^\/__proof__\/(past|P|A|B|D|discard|source-P|divergent-P)\.resume$/.test(name));const parts=[];let length=0;
   for await(const part of request){length+=part.length;assert(length<=512*1048576);parts.push(part);}
   const bytes=Buffer.concat(parts),file=path.basename(name);await fs.writeFile(path.join(out,file),bytes);
   report.raw.push({file,bytes:bytes.length,sha256:sha(bytes)});response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({sha256:sha(bytes)}));return;
  }
  if(name==='/favicon.ico'){response.writeHead(204).end();return;}
  let bytes,mime;
  if(name==='/'){bytes=Buffer.from('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/session-library.css"><main id="mount"></main>');mime='text/html';}
  else if(name==='/__verify__/branch-abi.mjs'){bytes=await fs.readFile(path.join(root,'tools/verify/e9-branch-abi.mjs'));mime='text/javascript';}
  else{
   if(name==='/app.html')name='/'+app;
   const base=name.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+name);assert(file.startsWith(base+path.sep));
   bytes=await fs.readFile(file);mime=types[path.extname(file)]??'application/octet-stream';
  }
  response.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.missing.push({url:request.url,error:String(error)});response.writeHead(404).end();}
});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});page.on('pageerror',error=>report.errors.push(error.stack));
 page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)report.external.push(request.url());});page.on('websocket',socket=>report.sockets.push(socket.url()));
 await page.goto(origin+'/');
 await page.evaluate(async()=>{
  const {SessionStore}=await import('/session-store.js'),{mountSessionTimeline}=await import('/session-timeline.js'),{checkpointHash}=await import('/session-checkpoints.js');
  const source=await(await fetch('/app.html')).text(),dom=new DOMParser().parseFromString(source,'text/html');document.querySelector('#mount').append(document.importNode(dom.querySelector('#session-timeline'),true));
  const store=await SessionStore.open('wasm-vm-sessions-v1-branch-files'),timeline=await mountSessionTimeline(document.querySelector('#session-timeline'),{store});
  window.proof={store,timeline,checkpointHash,children:{}};
  const {WasmLinux}=await import('/pkg/wasm_vm_wasm.js'),witness=WasmLinux.prototype.exactSessionWitness,run=WasmLinux.prototype.runExactReplayChunkTo;
  proof.uploads=[];
  const retain=(name,bytes)=>{proof.uploads.push(fetch('/__proof__/'+name+'.resume',{method:'POST',body:bytes}).then(response=>{if(!response.ok)throw Error('Raw native proof retention failed');}));};
  WasmLinux.prototype.exactSessionWitness=function(include){const value=witness.call(this,include);
   if(!include&&proof.timeline.recording&&!this.inputPosition().replay)retain('source-P',witness.call(this,true).resume);return value;};
  WasmLinux.prototype.runExactReplayChunkTo=function(...args){try{return run.apply(this,args);}catch(error){retain('divergent-P',witness.call(this,true).resume);throw error;}};
 });
 progress=setInterval(()=>{void page.evaluate(()=>proof.timeline.snapshot.status).then(status=>console.log(status)).catch(()=>{});},15000);
 const c=key=>page.locator('#session-timeline [data-timeline="'+key+'"]');
 await c('record-file').click();
 await page.waitForFunction(()=>proof.timeline.root.dataset.state==='error'||!proof.timeline.recording
  &&proof.timeline.active?.checkpointId==='before-file-change'&&!proof.timeline.operation,null,{timeout:600000});
 report.source=await page.evaluate(()=>{
  const t=proof.timeline;if(!t.owner||!t.active||t.snapshot.pending)throw Error('Source recording failed: '+t.snapshot.status);
  const past=t.owner.manifest.checkpoints.find(point=>point.id==='before-file-change');if(!past||past.position.transition!==t.active.position.transition)throw Error('Past checkpoint was not selected');
  proof.parent=t.owner.id;proof.past=past.position;return {id:proof.parent,past:proof.past,active:t.active,console:t.c.console.textContent};
 });assert(report.source.console.includes('BRANCH_READY'));assert(!report.source.console.includes('BRANCH_FILE_P'));
 await page.evaluate(()=>Promise.all(proof.uploads));
 const retain=async label=>page.evaluate(async label=>{
  const t=proof.timeline,selected=t.owner.controller.captureSelectedBranch(),opened=await proof.store.openSession(t.owner.id);
  const response=await fetch('/__proof__/'+label+'.resume',{method:'POST',body:selected.capture.native});if(!response.ok)throw Error('raw proof retention failed');
  return {id:t.owner.id,active:t.active,console:t.c.console.textContent,manifestSha256:proof.checkpointHash(opened.manifest),capture:await response.json()};
 },label);
 report.past=await retain('past');
 report.abi=await page.evaluate(async()=>{const {branchAbiAttacks}=await import('/__verify__/branch-abi.mjs');return branchAbiAttacks(proof);});
 await page.evaluate(async()=>{const t=proof.timeline,result=await t.request(()=>t.owner.controller.seekPosition(t.owner.manifest.end));await Promise.all(proof.uploads);if(result.status!=='ready')throw Error(t.snapshot.status);});report.parent=await retain('P');
 assert(report.parent.console.includes('BRANCH_FILE_P'));report.parent.expectedFileSha256=sha(Buffer.from('P\n'));
 assert(report.parent.console.includes(report.parent.expectedFileSha256+'  /state'));
 await page.evaluate(async()=>{const t=proof.timeline;await t.request(()=>t.owner.controller.seekPosition(proof.past));});
 for(const letter of ['A','B']){
  await c('branch-create').click();await page.waitForFunction(()=>proof.timeline.active?.continuation||proof.timeline.root.dataset.state==='error'&&!proof.timeline.branchCreation,null,{timeout:180000});
  const created=await page.evaluate(()=>({active:proof.timeline.active,status:proof.timeline.snapshot.status}));assert(created.active?.continuation,JSON.stringify(created));
  assert.equal(created.active.position.transition,report.source.past.transition);
  await c('branch-input').fill(letter);await c('branch-send').click();await c('branch-run').click();
  const expected=sha(Buffer.from(letter+'\n'));
  await page.waitForFunction(expected=>proof.timeline.c.console.textContent.includes(expected+'  /state')||proof.timeline.root.dataset.state==='error',expected,{timeout:300000});
  assert((await c('console').textContent()).includes(expected+'  /state'),await c('status').textContent());
  await c('branch-pause').click();await page.waitForFunction(()=>!proof.timeline.branchRunning&&!proof.timeline.branchRun);
  await c('branch-live').click();await page.waitForFunction(()=>/Historical connections stay offline/.test(proof.timeline.snapshot.status));
  const saved=await page.evaluate(()=>({id:proof.timeline.branch.id,active:proof.timeline.active,policy:proof.timeline.snapshot.status}));
  await c('branch-save').click();await page.waitForFunction(id=>proof.timeline.owner?.id===id&&!proof.timeline.operation&&!proof.timeline.branchBusy,saved.id,{timeout:120000});
  await page.evaluate(async()=>{const t=proof.timeline;await t.request(()=>t.owner.controller.seekPosition(t.owner.manifest.end));});
  const reopened=await retain(letter);assert.equal(reopened.active.digest,saved.active.digest);assert(reopened.console.includes('BRANCH_FILE_'+letter));
  assert(!reopened.console.includes('BRANCH_FILE_P'));assert(!reopened.console.includes('BRANCH_FILE_'+(letter==='A'?'B':'A')));
  report.checks.push({letter,expectedFileSha256:expected,saved,reopened});
  await page.evaluate(async({letter,id,parentHash})=>{
   proof.children[letter]=id;const t=proof.timeline;
   if(proof.checkpointHash((await proof.store.openSession(proof.parent)).manifest)!==parentHash)throw Error('Parent manifest changed');
   await t.refresh(proof.parent);await t.open();await t.request(()=>t.owner.controller.seekPosition(proof.past));
  },{letter,id:saved.id,parentHash:report.parent.manifestSha256});
 }
 assert.notEqual(report.checks[0].reopened.active.digest,report.checks[1].reopened.active.digest);
 report.publicationCancellation=await page.evaluate(async()=>{
  const {createSessionBranch}=await import('/session-branches.js'),{SessionInputJournal}=await import('/session-inputs.js');
  const t=proof.timeline,results=[];
  for(const phase of ['before-final-authorize','commit-durable']){
   const id=phase==='before-final-authorize'?'cancel-before-put':'cancel-after-commit',branch=await createSessionBranch({store:proof.store,parent:t.owner,id});
   await branch.sendInput(new TextEncoder().encode('A\n'));await branch.advance(64);
   const complete=SessionInputJournal.prototype.completeExact;let finalizing=false,hit=0,discard;
   SessionInputJournal.prototype.completeExact=function(...args){finalizing=true;return complete.apply(this,args);};
   globalThis.__e9SessionStoreProbe=event=>{if(finalizing&&event.id===id&&event.phase===phase&&!hit++){discard=branch.discard();}};
   let failure;try{await branch.finish();}catch(error){failure=error.message;}
   finally{delete globalThis.__e9SessionStoreProbe;SessionInputJournal.prototype.completeExact=complete;}
   if(!discard)throw Error('Final publication observer was never reached');await discard;
   const opened=await proof.store.openSession(id);if(phase==='before-final-authorize'&&opened)throw Error('Cancelled final put published a child');
   if(phase==='commit-durable'&&!opened)throw Error('Already durable child was lost');
   if(opened)await proof.store.deleteSession(id);results.push({phase,hit,childRetained:!!opened,failure});
  }
  return results;
 });
 // Unsaved discard revokes only its own private identity.
 await c('branch-create').click();await page.waitForFunction(()=>!!proof.timeline.branch&&!proof.timeline.branchCreation,null,{timeout:120000});
 const discarded=await page.evaluate(()=>proof.timeline.branch.id);await c('branch-input').fill('B');await c('branch-send').click();await c('branch-run').click();await c('branch-discard').click();
 await page.waitForFunction(()=>!proof.timeline.branch&&!proof.timeline.branchBusy);
 assert.equal(await page.evaluate(id=>proof.store.openSession(id),discarded),null);report.discarded=discarded;
 // Real reload, B before A, then delete the parent and A before reopening B.
 if(options['--include-deltas']){
  console.log('Recording a genuine Linux boot excerpt with full and incremental keyframes');
  report.deltaSample=await page.evaluate(async()=>{
   const {recordTimelineSample}=await import('/session-timeline-runtime.js');
   const {SessionInputJournal}=await import('/session-inputs.js'),capture=SessionInputJournal.prototype.captureKeyframe;
   let result;try{
    // Exercise the public full-capture option amid actual incremental Linux work.
    SessionInputJournal.prototype.captureKeyframe=function(store,machine,configuration,id,options){return capture.call(this,store,machine,configuration,id,id==='point-1000000'?{full:true}:options);};
    result=await recordTimelineSample({store:proof.store,id:'bundle-linux-deltas',onProgress:()=>{}});
   }finally{SessionInputJournal.prototype.captureKeyframe=capture;}
   const t=proof.timeline;
   await t.refresh(result.id);await t.open();const outcome=await t.request(()=>t.owner.controller.seekPosition(t.owner.manifest.end));if(outcome.status!=='ready')throw Error(t.snapshot.status);
   let deltas=0,fulls=0;for(const point of t.owner.manifest.checkpoints){for await(const part of proof.store.stream(point.machine)){const magic=new TextDecoder().decode(part.subarray(0,8));if(magic==='WVKEYF01')deltas++;if(magic==='WVKEYB01')fulls++;break;}}
   if(deltas===0||fulls===0||BigInt(t.active.position.retired)===0n)throw Error('real mixed full/incremental Linux work was not recorded');
   const captured=t.owner.controller.captureSelectedBranch(),response=await fetch('/__proof__/D.resume',{method:'POST',body:captured.capture.native});if(!response.ok)throw Error('incremental native retention');
   return {id:result.id,active:t.active,console:t.c.console.textContent,deltas,fulls,recipe:'public captureKeyframe full:true at point-1000000; default deltas elsewhere',manifestSha256:proof.checkpointHash((await proof.store.openSession(result.id)).manifest),capture:await response.json()};
  });
 }
 report.retained=await retainSessionStore(page,'wasm-vm-sessions-v1-branch-files',path.join(out,'saved'));
 await page.evaluate(async()=>{proof.timeline.close();await proof.store.close();});await page.reload();
 report.reloaded=await page.evaluate(async({parent,children})=>{
  const {SessionStore}=await import('/session-store.js'),{openTimelineReplay}=await import('/session-timeline-runtime.js'),{checkpointHash}=await import('/session-checkpoints.js');
  const store=await SessionStore.open('wasm-vm-sessions-v1-branch-files'),results=[];
  for(const id of [children.B,children.A,parent]){const replay=await openTimelineReplay({store,id});try{await replay.controller.seekPosition(replay.manifest.end);results.push({id,digest:replay.controller.selected.rendered.digest,console:replay.controller.selected.rendered.console,manifestSha256:checkpointHash((await store.openSession(id)).manifest)});}finally{replay.controller.close();}}
  await store.deleteSession(parent);await store.deleteSession(children.A);
  const replay=await openTimelineReplay({store,id:children.B});try{await replay.controller.seekPosition(replay.manifest.end);results.push({id:children.B,afterDeletion:true,digest:replay.controller.selected.rendered.digest,console:replay.controller.selected.rendered.console});}finally{replay.controller.close();}
  await store.close();return results;
 },{parent:report.parent.id,children:Object.fromEntries(report.checks.map(value=>[value.letter,value.saved.id]))});
 for(const check of report.checks)assert.equal(report.reloaded.find(value=>value.id===check.saved.id).digest,check.reopened.active.digest);
 assert.equal(report.reloaded.at(-1).digest,report.checks[1].reopened.active.digest);assert.equal(report.reloaded[2].manifestSha256,report.parent.manifestSha256);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.sockets,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;report.ui=await page?.evaluate(()=>window.proof?{snapshot:proof.timeline.snapshot,console:proof.timeline.c.console.textContent}:null).catch(()=>null);process.exitCode=1;}
finally{clearInterval(progress);await page?.screenshot({path:path.join(out,'screen.png'),fullPage:true});await context?.tracing.stop({path:path.join(out,'browser-trace.zip')});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,out,failure:report.failure}));}
