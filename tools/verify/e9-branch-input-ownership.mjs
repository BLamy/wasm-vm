// Permanent E9-T20 owned-input race against an authenticated retained GPU history.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),options={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--source','--output','--web-root','--chrome'].includes(key)||!value||options[key])throw Error('arguments');
  options[key]=value;
}
if(!options['--source']||!options['--output'])throw Error('--source and --output required');
const source=path.resolve(root,options['--source']),saved=path.join(source,'saved'),out=path.resolve(root,options['--output']);
const web=path.resolve(root,options['--web-root']??'web/dist');
const chrome=options['--chrome']??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const app=await fs.access(path.join(web,'app.html')).then(()=>'app.html',()=>'index.html');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashFile=async file=>sha(await fs.readFile(file));
await fs.mkdir(out);

const sourceReportBytes=await fs.readFile(path.join(source,'report.json')),sourceReport=JSON.parse(sourceReportBytes);
assert.equal(sourceReport.status,'passed');
const storageBytes=await fs.readFile(path.join(saved,'storage.json')),storage=JSON.parse(storageBytes);
assert.equal(storage.stores.sessions.length,1);
for(const chunk of storage.stores.chunks){
  const bytes=await fs.readFile(path.join(saved,'chunks',chunk.key+'.bin'));
  assert.equal(bytes.length,chunk.bytes);assert.equal(sha(bytes),chunk.key);
}
for(const object of storage.stores.objects){
  const parts=[];
  for(const part of object.value.parts){
    const value=await fs.readFile(path.join(saved,'chunks',part.sha256+'.bin'));
    assert.equal(value.length,Number(part.length));assert.equal(sha(value),part.sha256);parts.push(value);
  }
  const value=Buffer.concat(parts);assert.equal(value.length,Number(object.value.length));assert.equal(sha(value),object.key);
}
const counterFiles=['counter-0.bin','counter-1.bin'];
const counterBefore=Object.fromEntries(await Promise.all(counterFiles.map(async name=>[name,await hashFile(path.join(source,name))])));
const report={task:'E9-T20',test:'owned GPU input is copied before queued execution',status:'running',
  source:{directory:source,reportSha256:sha(sourceReportBytes),head:sourceReport.head,storageSha256:sha(storageBytes),
    chunks:storage.stores.chunks.length,objects:storage.stores.objects.length,counterBefore},
  runtime:{webRoot:web,wasmSha256:await hashFile(path.join(web,'pkg/wasm_vm_wasm_bg.wasm')),
    branchWorkerSha256:await hashFile(path.join(web,'session-gpu-branch-worker.js')),
    branchControllerSha256:await hashFile(path.join(web,'session-gpu-branches.js'))},
  testSha256:await hashFile(fileURLToPath(import.meta.url)),external:[],sockets:[],consoleErrors:[],httpErrors:[],started:new Date().toISOString()};
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{
  let name=new URL(req.url,'http://localhost').pathname;if(name==='/app.html')name='/'+app;
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  let data,mime;
  if(name==='/'){data=Buffer.from('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/session-library.css"><main id="mount"></main>');mime='text/html';}
  else{
    const evidence=name.startsWith('/__evidence__/'),base=evidence?saved:web,relative=evidence?name.slice('/__evidence__'.length):name;
    const file=path.resolve(base,'.'+decodeURIComponent(relative));if(!file.startsWith(base+path.sep))throw Error('path escape');
    data=await fs.readFile(file);mime=types[path.extname(file)]??'application/octet-stream';
  }
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(data);
}catch(error){report.httpErrors.push({url:req.url,error:String(error)});res.writeHead(404).end();}});

let context,page,profile,tracing=false;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'e9-t20-owned-input-'));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chrome,viewport:{width:1200,height:1000},serviceWorkers:'block',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  report.browser=context.browser()?.version()??'persistent-context';report.freshChromeProfile=true;
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});tracing=true;page=await context.newPage();
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('pageerror',error=>report.consoleErrors.push(error.stack));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)report.external.push(request.url());});
  page.on('websocket',socket=>report.sockets.push(socket.url()));await page.goto(origin+'/');
  report.result=await page.evaluate(async()=>{
    const saved=await(await fetch('/__evidence__/storage.json')).json(),{SessionStore}=await import('/session-store.js');
    const {checkpointHash}=await import('/session-checkpoints.js'),store=await SessionStore.open('wasm-vm-sessions-v1-e9-owned-input');
    const entries={};for(const [name,rows]of Object.entries(saved.stores)){entries[name]=[];for(const row of rows){
      let value=row.value;if(name==='chunks')value=new Blob([await(await fetch('/__evidence__/chunks/'+row.key+'.bin')).arrayBuffer()]);
      else if(name==='sessions')value={...value,manifest:Uint8Array.from(value.manifest)};entries[name].push([row.key,value]);}}
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(store.databaseName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(entries),'readwrite',{durability:'strict'});for(const [name,rows]of Object.entries(entries))for(const [key,value]of rows)tx.objectStore(name).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    const markup=await(await fetch('/app.html')).text(),dom=new DOMParser().parseFromString(markup,'text/html');
    document.querySelector('#mount').append(document.importNode(dom.querySelector('#session-timeline'),true));
    const {mountSessionTimeline}=await import('/session-timeline.js'),{createSessionBranch}=await import('/session-branches.js');
    const timeline=await mountSessionTimeline(document.querySelector('#session-timeline'),{store});await timeline.refresh('gpu-smoke');await timeline.open();
    const point=timeline.owner.manifest.checkpoints.find(value=>value.id==='before-gpu-change');if(!point)throw Error('authenticated branch point missing');
    const sought=await timeline.request(()=>timeline.owner.controller.seekPosition(point.position));if(sought.status!=='ready'||!timeline.owner.controller.canContinue)throw Error('authenticated branch point unavailable');
    const parentOpened=await store.openSession('gpu-smoke'),parentBefore={manifestSha256:checkpointHash(parentOpened.manifest),
      digest:timeline.owner.controller.selected.rendered.digest,pixel:[...timeline.owner.controller.selected.rendered.canvas.getContext('2d').getImageData(32,32,1,1).data],
      sessions:(await store.list()).sessions.map(row=>row.id).sort()};
    const id='e9-owned-input',branch=await createSessionBranch({store,parent:timeline.owner,id,onProgress:()=>{}}),blocker=branch.advance(32768);
    const input=new TextEncoder().encode('A\n'),inputBefore=[...input],sent=branch.sendInput(input);input[0]='B'.charCodeAt(0);const inputAfter=[...input];await Promise.all([blocker,sent]);
    let view;for(let iteration=0;iteration<48;iteration++){await branch.advance(32768);view=await branch.view();if(view.console.includes('BRANCH_GPU_DONE_A')||view.console.includes('BRANCH_GPU_DONE_B'))break;}
    if(!view?.console.includes('BRANCH_GPU_DONE_A')||view.console.includes('BRANCH_GPU_DONE_B'))throw Error('caller mutation aliased into owned branch input');
    const pixel=[...view.canvas.getContext('2d').getImageData(32,32,1,1).data];if(JSON.stringify(pixel)!=='[0,0,255,255]')throw Error('owned A command did not physically paint blue');
    let goLive;try{await branch.goLive();throw Error('historical network unexpectedly went live');}catch(error){goLive=error.message;}await branch.discard();
    const parentAfterOpened=await store.openSession('gpu-smoke'),parentAfter={manifestSha256:checkpointHash(parentAfterOpened.manifest),
      digest:timeline.owner.controller.selected.rendered.digest,pixel:[...timeline.owner.controller.selected.rendered.canvas.getContext('2d').getImageData(32,32,1,1).data],
      sessions:(await store.list()).sessions.map(row=>row.id).sort(),candidate:await store.openSession(id)};
    await timeline.close();await store.close();return {inputBefore,inputAfter,consoleTail:view.console.slice(-256),pixel,goLive,parentBefore,parentAfter};
  });
  assert.deepEqual(report.result.inputBefore,[65,10]);assert.deepEqual(report.result.inputAfter,[66,10]);assert.equal(report.result.parentAfter.candidate,null);
  assert.equal(report.result.parentAfter.manifestSha256,report.result.parentBefore.manifestSha256);assert.equal(report.result.parentAfter.digest,report.result.parentBefore.digest);
  assert.deepEqual(report.result.parentAfter.pixel,report.result.parentBefore.pixel);assert.deepEqual(report.result.parentAfter.sessions,report.result.parentBefore.sessions);
  assert.match(report.result.goLive,/Historical connections stay offline/);assert.deepEqual(report.external,[]);assert.deepEqual(report.sockets,[]);
  assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);
  report.source.counterAfter=Object.fromEntries(await Promise.all(counterFiles.map(async name=>[name,await hashFile(path.join(source,name))])));
  assert.deepEqual(report.source.counterAfter,counterBefore);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{
  if(page)await page.screenshot({path:path.join(out,'screen.png'),fullPage:true});
  if(tracing){await context.tracing.stop({path:path.join(out,'browser-trace.zip')});tracing=false;}await context?.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(profile)await fs.rm(profile,{recursive:true,force:true});report.finished=new Date().toISOString();
  report.outputs={screenSha256:await hashFile(path.join(out,'screen.png')),traceSha256:await hashFile(path.join(out,'browser-trace.zip'))};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,failure:report.failure,result:report.result},null,2));
}
