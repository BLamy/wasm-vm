import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd(), out=path.join(root,'target/evidence/e9-t03-verifier/supplement-final');
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
const profile=path.join(root,'target/evidence/e9-t03-verifier/independent/profile-copy');
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
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,serviceWorkers:'block'});
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
 await keeper.coverage.startJSCoverage({resetOnNavigation:false});
 const {checkSessionStoreCritic}=await import(pathToFileURL(path.join(root,'tools/verify/e9-session-store-critic.mjs')));
 const eventChunk=await fs.readFile('crates/storage/tests/session_manifest/fixtures/chunk-v1.json');
 const payloads=[Buffer.from('vm-runtime-v1'),Buffer.from('wasm-module-v1'),Buffer.from('kernel-v1'),Buffer.from('base-image-v1'),Buffer.from('checkpoint-v1'),Buffer.from('e9:before\n'),eventChunk];
 report.critic=await checkSessionStoreCritic(keeper,{name:'wasm-vm-sessions-v1-independent-supplement',fixture:{template,blobs:payloads.map(bytes=>({ref:ref(bytes),bytes:[...bytes]}))}});
 // Independently inspect all committed original large-object chunk bytes against a constant-pattern oracle.
 const largeLength=96*1024*1024+123,oracle=createHash('sha256'),part=Buffer.alloc(1024*1024);
 for(let index=0;index<97;index++){part.fill((17+Math.floor(index/4)*19)&255);oracle.update(part.subarray(0,index===96?123:part.length));}
 const largeRef={sha256:oracle.digest('hex'),length:String(largeLength)};
 report.large=await keeper.evaluate(async({name,ref})=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const read=(store,key)=>new Promise((resolve,reject)=>{const r=db.transaction([store]).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
   const object=await read('objects',ref.sha256),observed=[];
   for(let index=0;index<object.parts.length;index++){
    const entry=object.parts[index],blob=await read('chunks',entry.sha256),bytes=new Uint8Array(await blob.arrayBuffer());
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const pattern=(17+Math.floor(index/4)*19)&255;
    observed.push({index,length:bytes.length,sha256:entry.sha256,digestMatches:digest===entry.sha256,patternMatches:bytes.every(b=>b===pattern)});
   }
   return {object,parts:observed};
  }finally{db.close();}
 },{name:workerReport.namespace,ref:largeRef});
 assert.equal(report.large.object.sha256,largeRef.sha256);assert.equal(report.large.object.length,largeRef.length);assert.equal(report.large.parts.length,97);
 for(const p of report.large.parts){assert.equal(p.length,p.index===96?123:1024*1024);assert.ok(p.digestMatches&&p.patternMatches);}
 for(const [module,name]of [['./session-store.js','original'],['./verifier-sabotaged-session-store.js','sabotaged']]){
  // The narrow sabotage assertion uses existing committed objects in the copied original DB.
  const refused=await keeper.evaluate(async({module,name,namespace})=>{
   const {SessionStore}=await import(module),s=await SessionStore.open(namespace),id='sabotage-final-'+name,w=await s.writer(id);
   try{
    const original=manifest(id);await w.publish(encode(original));const extended=structuredClone(original);
    extended.end.transition=String(BigInt(extended.end.transition)+1n);extended.end.retired=String(BigInt(extended.end.retired)+1n);
    extended.checkpoints.push({...structuredClone(extended.checkpoints[0]),id:'second',position:extended.end,next_sequence:String(BigInt(extended.end.sequence)+1n)});
    await w.publish(encode(extended));
    try{await w.publish(encode(original));return 'accepted';}catch(error){return error.code;}
   }finally{await w.release();await s.close();}
  },{module,name,namespace:workerReport.namespace});
  let passed=true,message;
  try{assert.equal(refused,'NotAppend','committed checkpoint removal must fail');}catch(error){passed=false;message=error.message;}
  report.sabotage[name]={observed:refused,assertionPassed:passed,message};
 }
 assert.equal(report.sabotage.original.assertionPassed,true);assert.equal(report.sabotage.sabotaged.assertionPassed,false);assert.equal(report.sabotage.sabotaged.observed,'accepted');
 await fs.writeFile(path.join(out,'javascript-coverage.json'),JSON.stringify(await keeper.coverage.stopJSCoverage()));
 assert.equal(sha(await fs.readFile('web/dist/session-store.js')),report.source);
 assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await context.close().catch(()=>{});}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,crashes:report.crashes.length,tamper:report.tamper.length,sabotage:report.sabotage,failure:report.failure}));
}
