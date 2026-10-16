#!/usr/bin/env node
// Independent attack: coexist retained/public generations, fail allocation,
// exhaust both count/bytes and try foreign opaque identities on native buffers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(process.argv[2],'--output');assert.ok(process.argv[3]);
const output=path.resolve(process.argv[3]);await fs.mkdir(output,{recursive:true});
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex'),sources=new Map(),served=new Map();
async function add(name){if(sources.has(name))return;const raw=await fs.readFile(path.join(root,name));sources.set(name,raw);for(const match of raw.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await add(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));}
await add('renderer/virgl-command/resources.mjs');
const report={schema:'resource-capacity-critic-native-v1',task:'E6-T11d50',gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:'running',sources:[...sources].map(([path,raw])=>({path,bytes:raw.length,sha256:sha(raw)})),browserErrors:{console:[],page:[],requests:[]}};
for(const [name,raw] of sources){await fs.mkdir(path.join(output,'source',path.dirname(name)),{recursive:true});await fs.writeFile(path.join(output,'source',name),raw);}
let browser,server;
try{
 server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;if(name==='/favicon.ico'){res.writeHead(204).end();return;}if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta charset="utf-8"><title>Retained generation attack</title><h1>Retained generation attack</h1><canvas id="gpu"></canvas><pre id="result"></pre>');return;}const raw=sources.get(name.slice(1));if(!raw){res.writeHead(404).end();return;}served.set(name,{path:name,bytes:raw.length,sha256:sha(raw)});res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(raw);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs'))),chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
 const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
 assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(a)));
 report.browser={version:browser.version(),headless:false,executable:chrome,sha256:sha(await fs.readFile(chrome)),gpu:system.gpu,commandLine:command.arguments};
 const page=await browser.newPage();page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push(r.url()));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report.browserResult=await page.evaluate(async()=>{
  const body={steps:[],fences:[],nativePlanes:[],guestExecution:false,productionAuthority:false};window.__critic=body;
  const same=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify({expected:b,observed:a}));};
  const need=(condition,label)=>{if(!condition)throw Error(label);},ok=(value,label)=>{need(value.ok,label+': '+JSON.stringify(value));return value;};
  const meta=(id,width=128)=>({id,target:0,format:64,bind:16,width,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
  const gl=document.querySelector('#gpu').getContext('webgl2',{failIfMajorPerformanceCaveat:true});need(gl,'hardware WebGL2');body.gpu=gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);need(/Metal.*M4 Max/.test(body.gpu),'native M4 Metal');
  const m=await import('/renderer/virgl-command/resources.mjs'),a=ok(m.createStandardPackedDepthTransferBackend(gl),'backendA'),b=ok(m.createStandardPackedDepthTransferBackend(gl),'backendB');
  let calls=0,destroyed=0,failNext=false;
  const backend={...a.backend,allocate(input){calls++;if(failNext){failNext=false;throw Error('one-shot allocation failure');}return a.backend.allocate(input);},destroy(storage){destroyed++;return a.backend.destroy(storage);}};
  const r=ok(m.createStandardDesktopResourceStore({backend,limits:{resources:2,gpuBytes:512}}),'storeA'),foreign=ok(m.createStandardDesktopResourceStore({backend:b.backend,limits:{resources:2}}),'storeB');
  const counts=()=>({calls,destroyed}),step=(label,input,fn)=>{const before=r.store.inspect(),nativeBefore=counts(),result=fn();body.steps.push({label,input,result,before,after:r.store.inspect(),nativeBefore,nativeAfter:counts()});return result;};
  const refuse=(label,code,input,fn)=>{const before=r.store.inspect(),nativeBefore=counts(),value=step(label,input,fn);same(value.error?.code,code,label);same(r.store.inspect(),before,label+' atomic store state');same(counts(),nativeBefore,label+' before native allocation');return value;};
  const write=(entry,input)=>{gl.bindBuffer(gl.COPY_WRITE_BUFFER,entry.storage.buffer);gl.bufferSubData(gl.COPY_WRITE_BUFFER,0,new Uint8Array(input));gl.bindBuffer(gl.COPY_WRITE_BUFFER,null);same(gl.getError(),0,'physical upload');};
  const read=entry=>{const bytes=new Uint8Array(entry.metadata.byteLength);gl.bindBuffer(gl.COPY_READ_BUFFER,entry.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);same(gl.getError(),0,'physical read');return [...bytes];};
  const fence=async label=>{const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(sync,'native fence');gl.flush();const polls=[];for(let n=0;n<1000;n++){const p=gl.clientWaitSync(sync,0,0);polls.push(p);if(p===gl.ALREADY_SIGNALED||p===gl.CONDITION_SATISFIED){gl.deleteSync(sync);body.fences.push({label,polls,completed:true});return;}same(p,gl.TIMEOUT_EXPIRED,'native fence wait');await new Promise(resolve=>setTimeout(resolve,1));}throw Error('native fence timeout');};
  const poll=async(ticket,discard=false)=>{for(let n=0;n<1000;n++){const result=ok(r.asyncAccess.poll(ticket,discard),'native asynchronous poll');if(result.status==='ready')return result;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('read timeout');};
  try{
   ok(r.store.createContext(77),'contextA');ok(foreign.store.createContext(77),'contextB');
   const first=ok(step('old allocation',meta(71),()=>r.store.createResource(meta(71))),'old allocation'),other=ok(step('other allocation',meta(72),()=>r.store.createResource(meta(72))),'other allocation');
   ok(r.store.attachContext(77,71),'old attach');const oldLease=ok(r.store.retainStorage(77,71,'vertex'),'old lease').lease,old=ok(r.bindings.resolve(oldLease),'old resolve');
   const oldBytes=Array.from({length:128},(_,j)=>(0x71+61*j)&255);write(old,oldBytes);await fence('old native bytes');same(read(old),oldBytes,'old independent bytes');
   const oldRead=ok(r.asyncAccess.beginStorageRead(oldLease,{x:0,y:0,z:0,width:128,height:1,depth:1}),'old actual asynchronous read');
   ok(step('unref retained old',71,()=>r.store.unref(71)),'old unref');refuse('same ID at full retained count','limit-exceeded',meta(71),()=>r.store.createResource(meta(71)));
   ok(step('unref other',72,()=>r.store.unref(72)),'other unref');same(r.store.inspect().budgets.resources,1,'old generation still counts');
   const beforeFailure=r.store.inspect(),countBefore=calls;failNext=true;const failed=step('fail reused ID native allocation',meta(71,256),()=>r.store.createResource(meta(71,256)));same(failed.error.code,'backend-error','host failure observed');same(r.store.inspect(),beforeFailure,'failed generation not installed');same(calls,countBefore+1,'actual host allocation attempted');need(gl.isBuffer(old.storage.buffer),'old native allocation survives failure');
   const replacement=ok(step('coexisting reused ID',meta(71,256),()=>r.store.createResource(meta(71,256))),'replacement');need(replacement.resource.generation!==first.resource.generation,'distinct generation');same(r.store.inspect().resources.map(x=>x.id),[71,71],'same ID has two actual generations');same(r.store.inspect().budgets.resources,2,'retained and public both count');same(r.store.inspect().budgets.gpuBytes,512,'both native allocations and read staging charged');
   ok(r.store.attachContext(77,71),'replacement attach');const newLease=ok(r.store.retainStorage(77,71,'vertex'),'replacement lease').lease,newer=ok(r.bindings.resolve(newLease),'replacement resolve');need(newer.storage.buffer!==old.storage.buffer,'distinct actual native buffers');
   const newBytes=Array.from({length:256},(_,j)=>(0xc3+37*j)&255);write(newer,newBytes);await fence('coexisting native generations');same(read(old),oldBytes,'replacement does not alias old');same(read(newer),newBytes,'new independent bytes');same([...ok(await poll(oldRead.ticket),'old read complete').bytes],oldBytes,'asynchronous old generation bytes');
   body.nativePlanes.push({label:'old retained',id:71,generation:first.resource.generation,input:oldBytes,observed:read(old)},{label:'new public',id:71,generation:replacement.resource.generation,input:newBytes,observed:read(newer)});
   ok(foreign.store.createResource(meta(71)),'foreign same ID');ok(foreign.store.attachContext(77,71),'foreign attach');const foreignLease=ok(foreign.store.retainStorage(77,71,'vertex'),'foreign lease').lease;
   for(const [label,token] of [['foreign lease',foreignLease],['forged empty lease',Object.freeze({})]]){
    refuse(label+' resolve','invalid-lease',label,()=>r.bindings.resolve(token));refuse(label+' read','invalid-lease',label,()=>r.asyncAccess.beginStorageRead(token,{x:0,y:0,z:0,width:1,height:1,depth:1}));refuse(label+' release','invalid-lease',label,()=>r.store.releaseStorage(token));
   }
   refuse('old count remains exhausted','limit-exceeded',meta(73),()=>r.store.createResource(meta(73)));
   ok(step('release old lease',null,()=>r.store.releaseStorage(oldLease)),'release old');same(r.store.inspect().budgets.resources,2,'old read retains allocation after lease release');
   refuse('released token cannot resolve replacement','invalid-lease',null,()=>r.bindings.resolve(oldLease));refuse('released token cannot release replacement','invalid-lease',null,()=>r.store.releaseStorage(oldLease));
   refuse('old read lease is stale','stale-storage',null,()=>r.asyncAccess.poll(oldRead.ticket));ok(await poll(oldRead.ticket,true),'discard old read');ok(step('release final old read',null,()=>r.asyncAccess.release(oldRead.ticket)),'release final old read');
   same(r.store.inspect().budgets.resources,1,'one native slot reclaimed');same(r.store.inspect().budgets.gpuBytes,256,'only replacement bytes remain');need(!gl.isBuffer(old.storage.buffer)&&gl.isBuffer(newer.storage.buffer),'only old native allocation destroyed');same(read(newer),newBytes,'replacement bytes preserved after old destroy');
   refuse('bytes bind independently below count','limit-exceeded',meta(73,257),()=>r.store.createResource(meta(73,257)));ok(step('one exact replacement slot',meta(73,256),()=>r.store.createResource(meta(73,256))),'one exact replacement');refuse('one replacement only','limit-exceeded',meta(74,1),()=>r.store.createResource(meta(74,1)));ok(step('release capacity probe before native read',73,()=>r.store.unref(73)),'capacity probe release');
   const outstanding=ok(r.asyncAccess.beginStorageRead(newLease,{x:0,y:0,z:0,width:256,height:1,depth:1}),'new outstanding read');ok(step('dispose with outstanding native read',null,()=>r.store.dispose()),'dispose');need(Object.values(r.store.inspect().budgets).every(x=>x===0),'all final budgets zero');ok(r.asyncAccess.release(outstanding.ticket),'one revoked ticket release');same(r.asyncAccess.release(outstanding.ticket).error.code,'invalid-ticket','revoked ticket single-use');body.final=r.store.inspect();body.nativeCalls=counts();body.oldGeneration=first.resource.generation;body.newGeneration=replacement.resource.generation;body.status='passed';same(gl.getError(),0,'final GL error');return body;
  }finally{r.store.dispose();foreign.store.dispose();}
 }).catch(error=>({status:'failed',error:{message:error.message,stack:error.stack}}));
 assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
 await page.evaluate(result=>{document.querySelector('#result').textContent=JSON.stringify({status:result.status,gpu:result.gpu,steps:result.steps.length,fences:result.fences.length,oldGeneration:result.oldGeneration,newGeneration:result.newGeneration,final:result.final.budgets},null,2);},report.browserResult);
 await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(path.join(output,'browser.png')))};
 for(const source of report.sources)assert.equal(sha(await fs.readFile(path.join(root,source.path))),source.sha256);
 report.status='passed';console.log(JSON.stringify({status:'passed',steps:report.browserResult.steps.length,nativeCalls:report.browserResult.nativeCalls,oldGeneration:report.browserResult.oldGeneration,newGeneration:report.browserResult.newGeneration}));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{report.servedFiles=[...served.values()];await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
