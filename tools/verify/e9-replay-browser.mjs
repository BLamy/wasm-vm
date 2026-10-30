#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const development=process.argv.includes('--development');
const output=path.resolve(arg('--output')??path.join(root,'e9-replay-browser-precheck'));
const web=path.join(root,development?'web':'web/dist');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
const report={task:'E9-T14',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),errors:[],started:new Date().toISOString(),checks:{}};
await fs.mkdir(output,{recursive:true});
let server,browser,context,page;
try{
 server=createServer(async(req,res)=>{
  try{
   let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(p==='/favicon.ico'){res.writeHead(204).end();return;}
   if(development&&p==='/app.html')p='/index.html';
   const release=p.startsWith('/releases/');
   let file=release?path.resolve(root,'.'+p):path.resolve(web,'.'+p);
   if(release?!file.startsWith(path.join(root,'releases')+path.sep):!file.startsWith(web+path.sep))throw Error('path');
   let bytes=await fs.readFile(file);
   res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 report.url=`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(report.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 report.assets=[];
 for(const name of ['app.html','main.js','session-replay-probe.js','session-inputs.js','roadmap.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session_bg.wasm']){
  const response=await context.request.get(new URL(name,new URL('./',report.url)).href);assert.equal(response.status(),200,name);
  const bytes=await response.body(),file=path.join(web,development&&name==='app.html'?'index.html':name);
  assert.equal(sha(bytes),sha(await fs.readFile(file)),name);report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 if(!process.argv.includes('--probe-only')){
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite,{passed:127,failed:0});
 }else assert.ok(development);
 const panel=page.locator('#session-replay-panel');await panel.locator('summary').click();await panel.locator('#session-replay-run').click();
 await page.waitForFunction(()=>!!window.__sessionReplayReport,null,{timeout:600000});
 const data=await page.evaluate(()=>window.__sessionReplayReport);
 report.probe=data;
 assert.equal(data.status,'passed');
 assert.equal(data.replays.length,2);
 assert.equal(data.events,47);assert.equal(data.blockCompletions,1);
 assert.equal(data.attacks.length,4);
 assert.deepEqual(data.abiChecks.map(check=>check.name),[
  'provider-profile','network-unknown-lease','network-malformed-completion','network-foreign-lease',
  'device-unknown-lease','device-dropped-lease','device-invalid-status','device-invalid-frames',
  'device-foreign-lease','device-duplicate-completion','immutable-witness-commitment'
 ]);
 assert.deepEqual(data.uartTimeout,{
  pending:{latched:false,idleTicks:320,rxLength:1},
  latched:{latched:true,idleTicks:1024,rxLength:1}
 });
 assert.ok(data.replays[1].retiredViaJit>1000000);
 assert.match(await page.locator('#session-replay-pip').getAttribute('class'),/\blive\b/);
 assert.match(await page.locator('.cap',{hasText:'Saved full Linux replay'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 assert.deepEqual(report.errors,[]);
 await panel.screenshot({path:path.join(output,'browser.png')});
 const reloaded=await context.newPage();try{
  await reloaded.goto(report.url,{waitUntil:'domcontentloaded'});await reloaded.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  report.checks.reopen=await reloaded.evaluate(async()=>{const {SessionStore}=await import('./session-store.js');const {SessionInputJournal}=await import('./session-inputs.js');const {REPLAY_PROBE_DATABASE,REPLAY_PROBE_ID}=await import('./session-replay-probe.js');const store=await SessionStore.open(REPLAY_PROBE_DATABASE);try{const recording=await SessionInputJournal.readExact(store,REPLAY_PROBE_ID);return {events:recording.receipts.length,witnesses:recording.witnesses.length,end:recording.manifest.end.transition};}finally{await store.close();}});
  assert.equal(report.checks.reopen.events,data.events);assert.equal(report.checks.reopen.end,data.end.transition);
  report.checks.durableTamper=await reloaded.evaluate(async()=>{
   const {SessionStore}=await import('./session-store.js');
   const {SessionInputJournal}=await import('./session-inputs.js');
   const {REPLAY_PROBE_DATABASE:database,REPLAY_PROBE_ID:id}=await import('./session-replay-probe.js');
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(database);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const get=(table,key)=>new Promise((resolve,reject)=>{const tx=db.transaction(table,'readonly'),request=tx.objectStore(table).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const change=(table,operation,key,value)=>new Promise((resolve,reject)=>{const tx=db.transaction(table,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);if(operation==='delete')tx.objectStore(table).delete(key);else tx.objectStore(table).put(value,key);});
   const read=async()=>{const store=await SessionStore.open(database);try{const result=await SessionInputJournal.readExact(store,id);return {accepted:true,events:result.receipts.length};}catch(error){return {accepted:false,code:error.code??null,message:error.message};}finally{await store.close();}};
   try{
    const session=await get('sessions',id),manifest=JSON.parse(new TextDecoder().decode(session.manifest));
    const object=await get('objects',manifest.events[0].content.sha256),chunkKey=object.parts[0].sha256;
    const originalChunk=await get('chunks',chunkKey);
    await change('chunks','delete',chunkKey);
    const missingChunk=await read();
    await change('chunks','put',chunkKey,originalChunk);
    const bytes=new Uint8Array(await originalChunk.arrayBuffer());bytes[0]^=1;
    await change('chunks','put',chunkKey,new Blob([bytes]));
    const changedDigest=await read();
    await change('chunks','put',chunkKey,originalChunk);
    await change('sessions','put',id,{...session,revision:'0'});
    const changedRevision=await read();
    await change('sessions','put',id,session);
    const abortedTransaction=await new Promise(resolve=>{const tx=db.transaction('sessions','readwrite');tx.onabort=()=>resolve('aborted');tx.onerror=event=>event.preventDefault();tx.objectStore('sessions').put({...session,revision:'0'},id);tx.abort();});
    const restored=await read();
    return {missingChunk,changedDigest,changedRevision,abortedTransaction,restored};
   }finally{db.close();}
  });
  for(const name of ['missingChunk','changedDigest','changedRevision'])assert.equal(report.checks.durableTamper[name].accepted,false,name);
  assert.equal(report.checks.durableTamper.abortedTransaction,'aborted');
  assert.deepEqual(report.checks.durableTamper.restored,{accepted:true,events:data.events});
 }finally{await reloaded.close();}
 report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 await context?.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
 await context?.close();await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,probe:report.probe}));
}
