#!/usr/bin/env node
// Adversarial legacy namespace/snapshot chain, isolated browser profile, no guest boot.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),web=path.join(root,'web/dist');
assert(process.argv.length===4&&process.argv[2]==='--output');const out=path.resolve(process.argv[3]);await fs.mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E9-T22a',scope:'OFF legacy history namespace and async persistence atomic refusals',status:'running',started:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),wasmSha256:sha(await fs.readFile(path.join(web,'pkg/wasm_vm_wasm_bg.wasm'))),errors:[],missing:[]};
await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'executed-browser.mjs'));
let browser,context,page;
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/favicon.ico'){res.writeHead(204).end();return;}let bytes,mime;if(name==='/'){bytes=Buffer.from('<!doctype html><pre>Legacy OFF history boundary</pre>');mime='text/html';}else{const base=name.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+decodeURIComponent(name));assert(file.startsWith(base+path.sep));bytes=await fs.readFile(file);mime=({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[path.extname(file)]??'application/octet-stream';}res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);}catch(error){report.missing.push({url:req.url,error:String(error)});res.writeHead(404).end();}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();context=await browser.newContext({serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.stack));await page.goto('http://127.0.0.1:'+server.address().port+'/');
 report.result=await page.evaluate(async()=>{
  const {default:init,WasmLinux}=await import('/pkg/wasm_vm_wasm.js');await init();
  const [kernel,image,fixture]=await Promise.all([fetch('/releases/kernel/6.6.63/Image').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),fetch('/session-alpine-image.json').then(r=>r.text()),fetch('/session-software-fixture.json').then(r=>r.json())]);
  const {AudioRingBuffer}=await import('/src/audio/ring.js');
  if(!crossOriginIsolated)throw Error('isolated valid SAB fixture required');
  const makeRing=()=>AudioRingBuffer.allocate({capacityFrames:128});
  const ordinary=new WasmLinux(64,kernel,new Uint8Array(),'console=ttyS0',()=>{},true);const ordinaryOutput=makeRing(),ordinaryCapture=makeRing();
  try{ordinary.attachAudioOutput(ordinaryOutput.sharedBuffer,new SharedArrayBuffer(4),128,48000);ordinary.attachAudioCapture(ordinaryCapture.sharedBuffer,128,48000);if(!ordinary.audioOutputReady()||!ordinary.audioCaptureReady())throw Error('ordinary control did not accept valid production rings');}finally{ordinary.free();}
  const vm=WasmLinux.newUnrecordedSession(kernel,image,fixture.bootargs,()=>{}),snapshot=()=>({work:vm.unrecordedControlState(),ram:vm.softwareRamDigest(),clock:vm.guestClockState(),generation:vm.overlayGeneration(),audio:{output:vm.audioOutputReady(),capture:vm.audioCaptureReady(),configuration:vm.virtioSndConfig(),captureState:vm.virtioSndCaptureState()}});
  const state={ordinaryValidRingControl:{output:true,capture:true},before:snapshot(),initialDatabases:await indexedDB.databases(),attempts:[]};
  try{
   for(const[name,call]of [['stamp identity',()=>vm.stampBootSnapshotIdentity(new Uint8Array(32).fill(0x55))],['advance generation',()=>vm.advanceOverlayGeneration()],['save legacy',()=>vm.saveSnapshot()],['load legacy',()=>vm.loadSnapshotBlob(new Uint8Array())],['persist legacy',()=>vm.persistSnapshot()],['read persistent legacy',()=>vm.readStoredSnapshot()],['restore persistent legacy',()=>vm.restoreStoredSnapshot()],['import persistent legacy',()=>vm.importStoredSnapshot(new Uint8Array())],['release persistent writer',()=>vm.relinquishSnapshotWriter()],['audio output provider',()=>vm.attachAudioOutput(makeRing().sharedBuffer,new SharedArrayBuffer(4),128,44100)],['microphone provider',()=>vm.attachAudioCapture(makeRing().sharedBuffer,128,48000)]]){
    let error=null,resolved=null;try{const value=await call();resolved=value===undefined?'undefined':value;}catch(failure){error=String(failure.message);}
    state.attempts.push({name,error,resolved});
   }
   state.after=snapshot();state.finalDatabases=await indexedDB.databases();
  }finally{vm.free();}
  state.status=state.attempts.every(row=>row.error)&&JSON.stringify(state.before)===JSON.stringify(state.after)&&state.initialDatabases.length===0&&state.finalDatabases.length===0?'passed':'failed';document.querySelector('pre').textContent=JSON.stringify(state,null,2);return state;
 });
 await page.screenshot({path:path.join(out,'legacy-history.png')});assert.equal(report.result.status,'passed',JSON.stringify(report.result.attempts));assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,error:report.error,output:out}));
