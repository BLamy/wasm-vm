// Real software-network and paged physical-GPU recordings through the shipped UI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),web=path.join(root,'web/dist'),o={};
for(let i=2;i<process.argv.length;i+=2){assert(['--software','--gpu','--output','--url'].includes(process.argv[i])&&process.argv[i+1]&&!o[process.argv[i]]);o[process.argv[i]]=process.argv[i+1];}
assert(o['--software']&&o['--gpu']&&o['--output']);const out=path.resolve(o['--output']);await fs.mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T24',status:'running',head:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),cases:[],errors:[],blocked:[],started:new Date().toISOString()},contexts=new Set();
let base=o['--url'],server;
try{
 if(base)assert.equal(base,'https://wasm-vm.pages.dev/');
 else{const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml'};
  server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);}catch{res.writeHead(404).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/';}
 report.base=base;
 for(const kind of ['software','gpu']){
  const directory=path.resolve(o['--'+kind]),bytes=await fs.readFile(path.join(directory,'report.json')),source=JSON.parse(bytes),storageBytes=await fs.readFile(path.join(directory,'saved/storage.json')),saved=JSON.parse(storageBytes),parts=new Map();
  assert.equal(source.status,kind==='software'?'software-full-workload-replay-passed':'passed');
  for(const row of saved.stores.chunks){const chunk=await fs.readFile(path.join(directory,'saved/chunks',row.key+'.bin'));assert.equal(sha(chunk),row.key);assert.equal(chunk.length,row.bytes);parts.set(row.key,chunk);}
  const id=kind==='software'?source.result.sessionId:source.recording.id,end=kind==='software'?source.result.final:source.recording.end;
  const row=saved.stores.sessions.find(row=>row.key===id);assert(row);const manifest=JSON.parse(Buffer.from(row.value.manifest)),expectedNative=await fs.readFile(path.join(directory,kind==='software'?'final.resume':end.state.file));
  const result={kind,id,source:{directory,reportSha256:sha(bytes),storageSha256:sha(storageBytes)},positions:[],profiles:[]};
  const newProfile=async label=>{const profile=await fs.mkdtemp(path.join(os.tmpdir(),'e9-capstone-'+label+'-'));
   const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',serviceWorkers:'block',acceptDownloads:true,viewport:{width:1440,height:1000},args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});contexts.add(context);
   await context.tracing.start({screenshots:true,snapshots:true,sources:true});const page=context.pages()[0]??await context.newPage();
   page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&!/favicon.ico/.test(m.location().url??''))report.errors.push(m.text());});
   await context.route('**/*',route=>{const u=new URL(route.request().url()),fixture=/^\/__capstone_fixture__\/([a-f0-9]{64})\.bin$/.exec(u.pathname);if(fixture&&label==='source'&&u.origin===new URL(base).origin){const body=parts.get(fixture[1]);assert(body);return route.fulfill({status:200,contentType:'application/octet-stream',body});}if(fixture||u.origin!==new URL(base).origin||/\/releases\/|\/__chunk__\/|kernel\.bin|image\.json|\/assets\/session-/.test(u.pathname)){report.blocked.push(u.href);return route.abort();}return route.continue();});
   await context.routeWebSocket('**/*',socket=>{report.blocked.push(socket.url());socket.close();});
   await page.goto(new URL('app.html?noAutoBoot=1&testHooks=1',base).href);await page.waitForFunction(()=>globalThis.__ready&&globalThis.__sessionTimeline?.store,null,{timeout:90000});
   const initial=await page.evaluate(async()=>({stats:await __sessionTimeline.store.statistics(),caches:await caches.keys()}));assert.equal(initial.stats.sessions,0);assert.equal(initial.stats.payloadBytes,0);assert.deepEqual(initial.caches,[]);
   result.profiles.push({label,path:profile,createdEmpty:true});return{context,page,profile,label};};
  const close=async p=>{await p.page.screenshot({path:path.join(out,kind+'-'+p.label+'.png'),fullPage:true});await p.context.tracing.stop({path:path.join(out,kind+'-'+p.label+'-trace.zip')});await p.context.close();contexts.delete(p.context);await fs.rm(p.profile,{recursive:true,force:true});};
  const settled=async page=>page.waitForFunction(()=>!__sessionTimeline.operation&&!__sessionTimeline.snapshot.pending,null,{timeout:180000});
  const open=async page=>{await page.evaluate(id=>__sessionTimeline.refresh(id),id);assert.equal(await page.locator('[data-timeline="open"]').isDisabled(),false);await page.locator('[data-timeline="open"]').click();await settled(page);assert.equal(await page.evaluate(()=>__sessionTimeline.active?.id),id);};
  const seek=async(page,target,label)=>{const got=await page.evaluate(async target=>{const t=__sessionTimeline;const result=await t.request(()=>t.owner.controller.seekPosition(target));return{status:result.status,active:t.snapshot.active,visible:t.c.digest.textContent};},target);assert.equal(got.status,'ready');assert.deepEqual(got.active.position,target);assert.equal(got.visible,got.active.digest);result.positions.push({label,...got});return got;};
  const original=await newProfile('source');
  // Hydrate the retained original only; imports below have no fixture endpoint or cache.
  await original.page.evaluate(async saved=>{const stores={};for(const[name,rows]of Object.entries(saved.stores)){stores[name]=[];for(const row of rows){let value=row.value;if(name==='chunks'){const response=await fetch('/__capstone_fixture__/'+row.key+'.bin');if(!response.ok)throw Error('original retained chunk');value=new Blob([await response.arrayBuffer()]);}if(name==='sessions')value={...value,manifest:Uint8Array.from(value.manifest)};stores[name].push([row.key,value]);}}
   const req=indexedDB.open(__sessionTimeline.store.databaseName),db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(stores),'readwrite',{durability:'strict'});for(const[name,rows]of Object.entries(stores))for(const[key,value]of rows)tx.objectStore(name).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}}, saved);
  await open(original.page);const position=end.position??end,target=Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(k=>[k,position[k]]));
  await seek(original.page,target,'source-end');
  await original.page.evaluate(()=>{const t=__sessionTimeline,exportLocal=t.exportLocal.bind(t);t.exportLocal=(...args)=>{t.__capstoneExport=exportLocal(...args);return t.__capstoneExport;};});
  const download=original.page.waitForEvent('download',{timeout:180000});download.catch(()=>{});await original.page.locator('[data-timeline="bundle-export"]').click();const outcome=await original.page.evaluate(async()=>{const t=__sessionTimeline;if(!t.__capstoneExport)throw Error('actual export did not start');return t.__capstoneExport;});assert.equal(outcome.status,'done',JSON.stringify(outcome));const archive=await download,file=path.join(out,kind+'.wvsession');await archive.saveAs(file);await original.page.waitForFunction(()=>!__sessionTimeline.transfer);const archiveBytes=await fs.readFile(file);result.archive={file:path.basename(file),bytes:archiveBytes.length,sha256:sha(archiveBytes)};await close(original);
  const imported=await newProfile('import');
  await imported.page.locator('[data-timeline="bundle-file"]').setInputFiles(file);await imported.page.waitForFunction(()=>!__sessionTimeline.transfer,null,{timeout:180000});
  assert(await imported.page.evaluate(id=>__sessionTimeline.store.openSession(id).then(Boolean),id),'actual import not published');
  await imported.page.reload();await imported.page.waitForFunction(()=>globalThis.__ready&&globalThis.__sessionTimeline?.store,null,{timeout:90000});await open(imported.page);
  const middle=manifest.checkpoints[Math.max(0,Math.floor(manifest.checkpoints.length/2))].position;
  const selected=await seek(imported.page,middle,'reloaded-middle');
  await imported.page.locator('[data-timeline="forward"]').click();await settled(imported.page);assert.equal(await imported.page.evaluate(()=>__sessionTimeline.active.position.transition),String(BigInt(middle.transition)+1n));
  await imported.page.locator('[data-timeline="back"]').click();await settled(imported.page);assert.equal(await imported.page.evaluate(()=>__sessionTimeline.active.digest),selected.active.digest);
  const final=await seek(imported.page,target,'imported-end');assert.equal(final.active.digest,position.digest);
  const raw=await imported.page.evaluate(async kind=>{const controller=__sessionTimeline.owner.controller;const bytes=kind==='gpu'?(await controller.inspectSelected()).state:(await controller.captureSelectedBranch()).capture.native;return [...bytes];},kind);
  assert.deepEqual(Buffer.from(raw),expectedNative,'fresh profile full native/device/disk state');const native=Buffer.from(raw);await fs.writeFile(path.join(out,kind+'.native'),native);result.native={file:kind+'.native',bytes:native.length,sha256:sha(native),sourceSha256:sha(expectedNative)};
  await close(imported);report.cases.push(result);
 }
 {
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});contexts.add(context);await context.tracing.start({screenshots:true,snapshots:true,sources:true});const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(new URL('docs.html?page=time-travel',base).href);await page.getByRole('heading',{name:'Record, rewind, and branch',exact:true}).waitFor({timeout:60000});
  assert((await page.locator('body').innerText()).includes('Full Omarchy cold-boot qualification'));
  const response=await page.request.get(new URL('docs-content/time-travel.md',base).href);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,'docs-content/time-travel.md'))));
  await page.screenshot({path:path.join(out,'guide-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'guide-phone.png'),fullPage:true});
  report.guide={url:page.url(),sha256:sha(bytes)};await context.tracing.stop({path:path.join(out,'guide-trace.zip')});await context.close();contexts.delete(context);await browser.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);assert.equal(git('rev-parse','HEAD'),report.head);assert.equal(git('status','--porcelain'),report.dirty);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);report.failureUI=[];for(const context of contexts)for(const page of context.pages()){report.failureUI.push(await page.evaluate(()=>({snapshot:globalThis.__sessionTimeline?.snapshot,details:globalThis.__sessionTimeline?.c['bundle-details'].textContent})).catch(()=>null));}process.exitCode=1;}
finally{for(const context of contexts){await context.tracing.stop({path:path.join(out,'failure-trace.zip')}).catch(()=>{});await context.close();}if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,failure:report.failure,out}));}
