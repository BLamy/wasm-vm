#!/usr/bin/env node
// IndexedDB recovery fixtures exercise storage boundaries, not guest execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {retentionFixture,checkRetentionStorage,checkMaintenanceSchedules,checkCleanupCrashes} from './e9-session-retention-storage.mjs';
import {retainSessionStore} from './e9-retain-session-store.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argument=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
assert(argument('--output'));const out=path.resolve(argument('--output'));await fs.mkdir(out,{recursive:false});
const seeds=(argument('--seeds')??'17,47,71').split(',').map(Number);
assert(seeds.length>=3&&seeds.every(seed=>Number.isSafeInteger(seed)&&seed>0&&seed<=0xffffffff));
const web=path.join(root,'web/dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>({ref:{sha256:sha(bytes),length:String(bytes.length)},bytes:[...bytes]});
const report={task:'E9-T23',scope:'bounded strict-IDB crash, retention and multi-tab recovery; no full-guest or performance claim',
 status:'running',started:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),seeds,served:[],errors:[],rows:[],crashes:[]};
const served=new Set();let browser,context,page;
const server=createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}
 let bytes,type='text/javascript';
 if(name==='/'){bytes=Buffer.from('<!doctype html><title>Session recovery</title><h1>Bounded session recovery</h1><pre id="result">Checking durable storage…</pre><script>window.__ready=true</script>');type='text/html';}
 else{const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));bytes=await fs.readFile(file);if(name.endsWith('.wasm'))type='application/wasm';
  if(!served.has(name)){served.add(name);report.served.push({path:path.relative(root,file),bytes:bytes.length,sha256:sha(bytes)});}}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.errors.push(String(error));res.writeHead(404).end();}});
async function seededFixture(seed){
 const f=await retentionFixture(root),assets=f.shared.slice(0,4);let state=seed>>>0;
 const bytes=index=>Buffer.from(Array.from({length:4096},()=>{state=(Math.imul(state,1664525)+1013904223+index)>>>0;return state>>>24;}));
 const leaves=[blob(bytes(1)),blob(bytes(2))],privateLeaf=blob(bytes(3));
 const rootBlob=(generation,values)=>blob(Buffer.from(JSON.stringify({version:{major:1,minor:0},base:f.template.machine.base_image,
  image_len:'8192',generation:String(generation),blocks:values.map((leaf,index)=>({index:String(index),sha256:leaf.ref.sha256}))})));
 const sharedMachine=blob(Buffer.from('recovery checkpoint '+seed)),privateMachine=blob(Buffer.from('recovery private checkpoint '+seed));
 const sharedRoot=rootBlob(1,leaves),privateRoot=rootBlob(2,[leaves[0],privateLeaf]);
 const payload=blob(Buffer.from('recovery indirect event '+seed));
 const events=JSON.parse(Buffer.from(f.shared.at(-1).bytes).toString());events[0].payload.content=payload.ref;
 const chunk=blob(Buffer.from(JSON.stringify(events)));f.template.checkpoints[0].machine=sharedMachine.ref;
 f.template.checkpoints[0].disk_root=sharedRoot.ref.sha256;f.template.events[0].content=chunk.ref;
 Object.assign(f,{sharedMachine,privateMachine,sharedRoot,privateRoot,payload,
  shared:[...assets,sharedMachine,...leaves,sharedRoot,payload,chunk],unique:[privateMachine,privateLeaf,privateRoot]});
 f.expectedSharedBytes=f.shared.reduce((sum,row)=>sum+row.bytes.length,0);return f;
}
async function crashPublication(namespace,fixture,seed,cut){
 const id='publication-'+seed+'-'+cut;
 const before=await page.evaluate(async({namespace,fixture,id})=>{
  const {SessionStore}=await import('/session-store.js'),s=await SessionStore.open(namespace),w=await s.writer(id);
  try{for(const b of fixture.shared)await w.put(b.ref,[new Uint8Array(b.bytes)]);await w.publish(new TextEncoder().encode(JSON.stringify({...fixture.template,id})));}
  finally{await w.release();}
  const saved=await s.openSession(id),sibling=await s.openSession('retention-sibling');await s.close();
  return {revision:saved.revision,manifest:[...saved.manifest],sibling:[...sibling.manifest]};
 },{namespace,fixture,id});
 const child=await context.newPage();await child.goto(report.url);const cdp=await context.newCDPSession(child);await cdp.send('Debugger.enable');
 const paused=new Promise(resolve=>cdp.once('Debugger.paused',resolve));
 const bytes=Buffer.from('interrupted checkpoint '+seed+' '+cut),ref=blob(bytes).ref;
 const pending=child.evaluate(async({namespace,fixture,id,cut,ref,bytes})=>{
  const {SessionStore}=await import('/session-store.js'),s=await SessionStore.open(namespace),w=await s.writer(id);
  globalThis.__e9SessionStoreProbe=e=>{if(e.id===id&&e.phase===cut&&(!e.hash||e.hash===ref.sha256)){globalThis.cutState=e;debugger;}};
  const next={...structuredClone(fixture.template),id};next.end.transition=String(BigInt(next.end.transition)+1n);next.end.retired=String(BigInt(next.end.retired)+1n);
  next.checkpoints.push({id:'later',position:{...next.end},next_sequence:String(BigInt(next.end.sequence)+1n),machine:ref,disk_root:next.checkpoints[0].disk_root,gpu:null});
  await w.put(ref,[new Uint8Array(bytes)]);await w.publish(new TextEncoder().encode(JSON.stringify(next)));await w.release();await s.close();
 },{namespace,fixture,id,cut,ref,bytes:[...bytes]}).catch(error=>({interrupted:String(error)}));
 let timer;const state=await Promise.race([paused,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('missing durable cut '+cut)),15000);})]);clearTimeout(timer);
 const point=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:state.callFrames[0].callFrameId,expression:'JSON.stringify(cutState)',returnByValue:true});
 assert.equal(JSON.parse(point.result.value).phase,cut);
 const crashed=new Promise(resolve=>child.once('crash',resolve)),crash=cdp.send('Page.crash').catch(error=>({expected:String(error)}));
 await Promise.race([crashed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer crash did not complete')),10000);})]);clearTimeout(timer);
 await child.close();await crash;await pending;
 const after=await page.evaluate(async({namespace,id})=>{
  const {SessionStore}=await import('/session-store.js'),s=await SessionStore.open(namespace),value=await s.openSession(id),sibling=await s.openSession('retention-sibling');
  const w=await s.writer(id);await w.release();await s.close();return {revision:value.revision,manifest:[...value.manifest],sibling:[...sibling.manifest]};
 },{namespace,id});
 assert.deepEqual(after.sibling,before.sibling,'crash changed unaffected sibling');
 const expected=cut==='commit-durable'?'2':'1';assert.equal(after.revision,expected);
 if(expected==='1')assert.deepEqual(after.manifest,before.manifest,'uncommitted checkpoint became visible');
 report.crashes.push({seed,cut,prediction:expected,observed:after.revision,probe:JSON.parse(point.result.value),
  beforeManifestSha256:sha(Buffer.from(before.manifest)),afterManifestSha256:sha(Buffer.from(after.manifest)),
  siblingBeforeSha256:sha(Buffer.from(before.sibling)),siblingAfterSha256:sha(Buffer.from(after.sibling)),ownershipReacquired:true});
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));report.url='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.goto(report.url);report.browser=await browser.version();
 for(const seed of seeds){const namespace='wasm-vm-sessions-v1-e9-t23-'+seed,fixture=await seededFixture(seed);
  const input='fixture-'+seed+'.json',raw=Buffer.from(JSON.stringify(fixture));await fs.writeFile(path.join(out,input),raw);
  const storage=await checkRetentionStorage(page,{namespace,fixture});
  for(const cut of ['chunk-durable','object-durable','before-commit','before-final-authorize','commit-durable'])await crashPublication(namespace,fixture,seed,cut);
  const schedules=await checkMaintenanceSchedules(context,page,report.url,{namespace:namespace+'-schedules',fixture,firstSeed:seed});
  const garbageCollection=await checkCleanupCrashes(context,page,report.url,{namespace,fixture});
  const capture=await context.newPage();let retained;
  try{await capture.goto(report.url);retained=await retainSessionStore(capture,namespace,path.join(out,'saved-'+seed));}
  finally{await capture.close();}
  report.rows.push({seed,input:{file:input,bytes:raw.length,sha256:sha(raw)},storage,schedules,garbageCollection,retained});
  console.log(JSON.stringify({seed,status:'recovered',publicationCuts:5,gcCuts:garbageCollection.length,schedules:schedules.length}));
 }
 assert.deepEqual(report.errors,[]);report.status='passed';await page.locator('#result').textContent();
 await page.evaluate(summary=>document.querySelector('#result').textContent=summary,JSON.stringify({status:report.status,seeds,publicationCrashes:report.crashes.length},null,2));
 await page.screenshot({path:path.join(out,'recovery.png')});
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
 try{await context?.tracing.stop({path:path.join(out,'browser-trace.zip')});}catch(error){report.traceError=String(error);report.status='failed';process.exitCode=1;}
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,out,failure:report.failure}));
