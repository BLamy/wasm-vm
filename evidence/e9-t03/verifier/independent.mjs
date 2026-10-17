import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd(), out=path.join(root,'target/evidence/e9-t03-verifier/independent');
const worker=path.resolve(process.argv[2]??'target/evidence/e9-t03-worker-final');
const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));
const workerReport=JSON.parse(await fs.readFile(path.join(worker,'browser/report.json'),'utf8'));
const origin=new URL(workerReport.url).origin, port=Number(new URL(origin).port);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ref=bytes=>({sha256:sha(bytes),length:String(bytes.length)});
const template=JSON.parse(await fs.readFile('crates/storage/tests/session_manifest/fixtures/manifest-v1.json','utf8'));
const original=await fs.readFile('web/dist/session-store.js','utf8');
const replaced='try { sessionCheckAppend(previous.manifest, decoded.bytes); }';
assert.equal(original.split(replaced).length,2);
const sabotage=original.replace(replaced,'try { /* verifier sabotage: admit rewritten committed prefix */ }');
const report={task:'E9-T03',predictionFile:'../predictions.md',status:'running',origin,source:sha(original),
  sourceBytesUnchanged:true,crashes:[],tamper:[],sabotage:{},errors:[]};
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(worker,'browser/chromium-profile'),path.join(out,'profile-copy'),{recursive:true,force:false,errorOnExist:true});
let context,server;
const html='<!doctype html><title>E9-T03 verifier</title><h1>Independent IndexedDB challenge</h1>';
try {
 server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,origin).pathname;
  if(pathname==='/verifier.html'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
  if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(pathname==='/verifier-sabotaged-session-store.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(sabotage);return;}
  const base=path.join(root,'web/dist'),file=path.resolve(base,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(base+path.sep)){res.writeHead(404).end();return;}
  try{const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':'application/octet-stream','Cache-Control':'no-store'}).end(bytes);}
  catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 context=await chromium.launchPersistentContext(path.join(out,'profile-copy'),{executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 async function attach(page){
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(origin+'/verifier.html');
  await page.evaluate(async({name,template})=>{
   const {SessionStore}=await import('./session-store.js');
   window.store=await SessionStore.open(name);window.template=template;
   window.encode=value=>new TextEncoder().encode(JSON.stringify(value));
   window.manifest=id=>({...structuredClone(template),id});
  },{name:workerReport.namespace,template});
 }
 async function opened(page,id){return page.evaluate(async id=>{const v=await store.openSession(id);return v&&{id:v.id,revision:v.revision,manifest:[...v.manifest]};},id);}
 let keeper=context.pages()[0]??await context.newPage();await attach(keeper);
 for(const id of ['session-a','session-b']){
  const v=await opened(keeper,id);assert.equal(v.revision,'1');
  assert.deepEqual(JSON.parse(Buffer.from(v.manifest)),{...structuredClone(template),id});
 }
 report.originalReload={sessions:['session-a','session-b'],status:'passed'};
 const cuts=['chunk-durable','object-durable','before-commit','commit-durable'];
 for(let index=0;index<cuts.length;index++){
  const seed=13411+index,cut=cuts[index],id='verifier-race-'+seed;
  await keeper.evaluate(async id=>{const w=await store.writer(id);try{await w.publish(encode(manifest(id)));}finally{await w.release();}},id);
  const before=await opened(keeper,id);
  const a=await context.newPage(),b=await context.newPage();await attach(a);await attach(b);
  const pages=[a,b],results=await Promise.all(pages.map((page,i)=>page.evaluate(async({id,delay})=>{
   await new Promise(resolve=>setTimeout(resolve,delay));
   try{window.lease=await store.writer(id);return {granted:true};}catch(error){return {granted:false,code:error.code};}
  },{id,delay:(seed*(i+7))%5})));
  assert.equal(results.filter(r=>r.granted).length,1);const winner=results.findIndex(r=>r.granted),loser=1-winner;
  assert.equal(results[loser].code,'WriterBusy');
  const bytes=Buffer.alloc(2*1024*1024+129,seed%251),objectRef=ref(bytes);
  const debug=await context.newCDPSession(pages[winner]);await debug.send('Debugger.enable');
  const paused=new Promise(resolve=>debug.once('Debugger.paused',resolve));
  const pending=pages[winner].evaluate(async({id,cut,ref,bytes})=>{
   window.__e9SessionStoreProbe=event=>{if(event.id===id&&event.phase===cut){window.cutState=event;debugger;}};
   const next=manifest(id);next.end.transition=String(BigInt(next.end.transition)+1n);next.end.retired=String(BigInt(next.end.retired)+1n);
   next.checkpoints.push({id:'independent-'+cut,position:next.end,next_sequence:String(BigInt(next.end.sequence)+1n),machine:ref,disk_root:next.checkpoints[0].disk_root,gpu:null});
   await lease.put(ref,[new Uint8Array(bytes)]);await lease.publish(encode(next));await lease.release();
  },{id,cut,ref:objectRef,bytes:[...bytes]}).catch(error=>({closed:error.message}));
  let timer;const state=await Promise.race([paused,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('missing pause '+cut)),30000);})]);clearTimeout(timer);
  const point=await debug.send('Debugger.evaluateOnCallFrame',{callFrameId:state.callFrames[0].callFrameId,expression:'JSON.stringify(window.cutState)',returnByValue:true});
  assert.equal(JSON.parse(point.result.value).phase,cut);
  const crashed=new Promise(resolve=>pages[winner].once('crash',resolve));
  const command=debug.send('Page.crash').catch(error=>({expected:error.message}));
  await Promise.race([crashed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('renderer did not crash')),10000);})]);clearTimeout(timer);
  await pages[winner].close();await command;await pending;
  await attach(keeper);const after=await opened(keeper,id);
  if(cut!=='commit-durable')assert.deepEqual(after,before);
  else{
   assert.equal(after.revision,'2');const actual=JSON.parse(Buffer.from(after.manifest));
   assert.equal(actual.checkpoints.length,2);assert.equal(actual.checkpoints[1].machine.sha256,objectRef.sha256);
   assert.deepEqual(actual.checkpoints[0],template.checkpoints[0]);
  }
  const recovery=await keeper.evaluate(async id=>{const w=await store.writer(id);await w.release();const v=await store.openSession(id);return v.revision;},id);
  assert.equal(recovery,after.revision);
  report.crashes.push({seed,cut,results,winner,paused:JSON.parse(point.result.value),before:{revision:before.revision,manifestSha256:sha(Buffer.from(before.manifest))},after:{revision:after.revision,manifestSha256:sha(Buffer.from(after.manifest))},reacquired:true});
  await pages[loser].close();
 }
 // Novel fail-closed challenge: both durable descriptor and cursor metadata corruption.
 for(const fault of ['object-length','object-parts','cursor-zero','cursor-overflow']){
  const value=await keeper.evaluate(async({name,fault})=>{
   const id='session-a',before=await store.openSession(id),decoded=JSON.parse(new TextDecoder().decode(before.manifest)),hash=decoded.checkpoints[0].machine.sha256;
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const read=(store,key)=>new Promise((resolve,reject)=>{const r=db.transaction([store]).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const write=(store,key,value)=>new Promise((resolve,reject)=>{const tx=db.transaction([store],'readwrite',{durability:'strict'});tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   const storeName=fault.startsWith('object')?'objects':'sessions',key=storeName==='objects'?hash:id;
   const original=await read(storeName,key),bad=structuredClone(original);
   if(fault==='object-length')bad.length=String(BigInt(bad.length)+1n);
   if(fault==='object-parts')bad.parts=[];
   if(fault==='cursor-zero')bad.revision='0';
   if(fault==='cursor-overflow')bad.revision='18446744073709551616';
   let code,list,row;
   try{await write(storeName,key,bad);try{await store.openSession(id);code='accepted';}catch(error){code=error.code;}
    list=await store.list();row=await read('sessions',id);
   }finally{await write(storeName,key,original);db.close();}
   const restored=await store.openSession(id);
   return {fault,code,listed:list.sessions.some(v=>v.id===id),unavailable:list.unavailable.some(v=>v.id===id),rowRevision:row.revision,rowManifest:[...row.manifest],beforeRevision:before.revision,beforeManifest:[...before.manifest],restoredRevision:restored.revision,restoredManifest:[...restored.manifest]};
  },{name:workerReport.namespace,fault});
  assert.equal(value.code,'Corrupt');assert.equal(value.listed,false);assert.equal(value.unavailable,true);
  assert.deepEqual(value.rowManifest,value.beforeManifest);assert.equal(value.restoredRevision,value.beforeRevision);assert.deepEqual(value.restoredManifest,value.beforeManifest);
  if(fault.startsWith('object'))assert.equal(value.rowRevision,value.beforeRevision);
  report.tamper.push({...value,rowManifest:sha(Buffer.from(value.rowManifest)),beforeManifest:sha(Buffer.from(value.beforeManifest)),restoredManifest:sha(Buffer.from(value.restoredManifest))});
 }
 for(const [module,name]of [['./session-store.js','original'],['./verifier-sabotaged-session-store.js','sabotaged']]){
  // The narrow sabotage assertion uses existing committed objects in the copied original DB.
  const refused=await keeper.evaluate(async({module,name,namespace})=>{
   const {SessionStore}=await import(module),s=await SessionStore.open(namespace),id='sabotage-'+name,w=await s.writer(id);
   try{
    const original=manifest(id);await w.publish(encode(original));const extended=structuredClone(original);
    extended.end.transition=String(BigInt(extended.end.transition)+1n);extended.end.retired=String(BigInt(extended.end.retired)+1n);
    extended.checkpoints.push({...structuredClone(extended.checkpoints[0]),id:'second',position:extended.end});
    await w.publish(encode(extended));
    try{await w.publish(encode(original));return 'accepted';}catch(error){return error.code;}
   }finally{await w.release();await s.close();}
  },{module,name,namespace:workerReport.namespace});
  let passed=true,message;
  try{assert.equal(refused,'NotAppend','committed checkpoint removal must fail');}catch(error){passed=false;message=error.message;}
  report.sabotage[name]={observed:refused,assertionPassed:passed,message};
 }
 assert.equal(report.sabotage.original.assertionPassed,true);assert.equal(report.sabotage.sabotaged.assertionPassed,false);assert.equal(report.sabotage.sabotaged.observed,'accepted');
 assert.equal(sha(await fs.readFile('web/dist/session-store.js')),report.source);
 assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await context.close().catch(()=>{});}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,crashes:report.crashes.length,tamper:report.tamper.length,sabotage:report.sabotage,failure:report.failure}));
}
