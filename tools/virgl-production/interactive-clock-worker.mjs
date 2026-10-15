#!/usr/bin/env node
// Owned headed Chrome; original Linux, production worker, and actual visible canvas.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertInteractivePauseProbe} from './critic-fast-boots-final.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(process.argv.length,3);
const output=path.resolve(process.argv[2]);
const webRoot=process.env.VIRGL_WEB_ROOT ? path.resolve(process.env.VIRGL_WEB_ROOT) : path.join(repo,'web');
const wasmPackage=process.env.VIRGL_WASM_PACKAGE ? path.resolve(process.env.VIRGL_WASM_PACKAGE) : path.join(webRoot,'pkg');
await fs.mkdir(output,{recursive:true});
const html='<!doctype html><meta charset="utf-8"><title>Production guest graphics</title><style>body{background:#10151c;color:#eee;font:14px monospace}pre{white-space:pre-wrap}canvas{border:1px solid #567}</style><h1>Production guest graphics</h1><canvas id="display" width="1024" height="768"></canvas><pre id="serial"></pre>';
const kernel='releases/kernel/6.6.63-omarchy-evdev1024/Image';
const manifest=JSON.stringify({artifacts:{kernel:{url:'/'+kernel,sha256:'3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d',size:24208896}}});
const errors=[],gpu=[],serial=[],served=new Map();let recording=Promise.resolve();
const imageDirectory=process.env.VIRGL_GUEST_IMAGE ? path.resolve(process.env.VIRGL_GUEST_IMAGE) : null;
const publicBase='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev';
const artifact=JSON.parse(await fs.readFile(path.join(webRoot,'artifacts-omarchy-virgl.json'),'utf8'));
let manifestBytes;
if (imageDirectory) manifestBytes=await fs.readFile(path.join(imageDirectory,'manifest.json'));
else { const response=await fetch(publicBase+'/'+artifact.chunkedImage.key);assert.ok(response.ok,'immutable production manifest');manifestBytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),artifact.chunkedImage.sha256); }
const imageManifest=JSON.parse(manifestBytes);
const chunkIndices=new Map(imageManifest.chunks.map((digest,index)=>[digest,index]));
const originalImage=imageDirectory ? await fs.open(path.join(imageDirectory,'guest.ext4'),'r') : null;
const chunkCache=new Map();
await fs.writeFile(path.join(output,'image-identity.json'),JSON.stringify({manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),imageLength:imageManifest.image_len,source:imageDirectory??publicBase+'/'+artifact.chunkedImage.key},null,2));
let browser;
const server=createServer(async(req,res)=>{
  try {
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    if(name==='/guest-boot.json'){res.setHeader('Content-Type','application/json');res.end(manifest);return;}
    let file;
    if(name==='/guest/manifest.json'){res.setHeader('Content-Type','application/json');res.end(manifestBytes);return;}
    else if(/^\/guest\/chunks\/[a-f0-9]{64}\.bin$/.test(name)) {
      const digest=path.basename(name,'.bin'),index=chunkIndices.get(digest);
      if(index===undefined)throw Error('Unknown pinned chunk');
      let bytes=chunkCache.get(digest);
      if(!bytes){
        if(originalImage){bytes=Buffer.alloc(imageManifest.chunk_size);const read=await originalImage.read(bytes,0,bytes.length,index*bytes.length);assert.equal(read.bytesRead,bytes.length);}
        else {const response=await fetch(publicBase+'/chunked-omarchy/chunks/'+digest+'.bin');assert.ok(response.ok,'pinned production chunk');bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,imageManifest.chunk_size);}
        assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);chunkCache.set(digest,bytes);if(chunkCache.size>64)chunkCache.delete(chunkCache.keys().next().value);
      }
      res.end(bytes);return;
    }
    else if(name.startsWith('/releases/'))file=path.join(repo,name);
    else if(name.startsWith('/pkg/'))file=path.join(wasmPackage,name.slice(5));
    else file=path.join(webRoot,name);
    if(!file.startsWith(repo+'/')&&!file.startsWith('/Users/blamy/Documents/Codex/wasm-vm/releases/chunked-omarchy/'))throw Error('Invalid asset path');
    res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    const body=await fs.readFile(file);
    served.set(name,{path:path.relative(repo,file),bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
    res.end(body);
  }catch(error){console.error('asset',req.url,String(error));res.writeHead(404).end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
  const info=await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  await fs.writeFile(path.join(output,'hardware.json'),JSON.stringify(info,null,2));
  assert.equal(info.gpu.featureStatus.webgl2??info.gpu.featureStatus.webgl,'enabled');
  const page=await browser.newPage({viewport:{width:1280,height:960}});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.stack));
  await page.exposeFunction('recordGpu',async event=>{gpu.push(event);const body=JSON.stringify(event)+'\n';recording=recording.then(()=>fs.appendFile(path.join(output,'gpu.ndjson'),body));await recording;});
  await page.exposeFunction('recordSerial',async text=>{serial.push(text);recording=recording.then(()=>fs.appendFile(path.join(output,'serial.log'),text));await recording;});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true,'actual production document isolation');
    await page.evaluate(async()=>{
      const {createLinuxWorkerClient}=await import('/linux-worker-protocol.js');
      const {PresentationController}=await import('/src/sink/presentation.js');
      const canvas=document.querySelector('#display'),presentation=new PresentationController(canvas,{scheduleFrames:false});
      const worker=new Worker('/linux-worker.js',{type:'module'}),decoder=new TextDecoder();
      globalThis.__production={worker,presentation,serial:'',errors:[],gpu:[]};
      const client=createLinuxWorkerClient(worker,{
        bootTimeoutMs:300000,
        onOutput(bytes){const text=decoder.decode(bytes,{stream:true});__production.serial+=text;document.querySelector('#serial').textContent=__production.serial.slice(-10000);void recordSerial(text);},
        onGpuEvent(event){__production.gpu.push(event);void recordGpu(event);},
        onDisplayFrame(frame){if(frame.type==='clear'){presentation.clear();return;}requestAnimationFrame(()=>{try{const before=presentation.snapshot().drawnPresents;const accepted=presentation.present(frame);const after=presentation.snapshot();frame.onRetired?.(accepted&&after.drawnPresents>before?'drawn':'failed',{backend:after.backend});}catch(error){frame.onRetired?.('failed');__production.errors.push(String(error));}});},
        onError(error){__production.errors.push(String(error));},
      });
      __production.controller=await client.boot({mode:'chunked',manifestUrl:'/guest-boot.json',imageManifestUrl:'/guest/manifest.json',baseUrl:'/guest/',bootProfileUrl:null,persist:false,bootSnapshot:false,
        ramMib:1024,bootargs:'root=/dev/vda rw console=ttyS0 init=/bin/bash',virgl:true,gpuTrace:true,startPaused:true,interactiveClock:'paced-on-keyboard',guestClock:'icount',icountDivider:64,jit:true,quantum:500000});
    });

    const clock = await page.evaluate(async () => {
      const c=__production.controller, rows=[], sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const read=()=>c.guestClockState();
      const initialJit=await c.jitStats(),paused=await c.isPaused(), before=await read(), retiredBefore=initialJit.guestRetired;
      const numericRows=[];
      const malformed=[[1,30.5,1],[1.5,30,1],[1,30,1.5],[65537,30,1],
        [1,65566,1],[1,30,0x100000001],[1,30,0x80000000],[1,30,-0x80000001],
        ['1',30,1],[1,'30',1],[1,30,'1'],[NaN,30,1],[1,Infinity,1],[1,30,null]];
      for(const frame of malformed) {
        const inputBefore=await c.inputDeviceStats();
        const accepted=await c.sendKeyboardEvent(...frame);await c.syncKeyboard();
        const inputAfter=await c.inputDeviceStats(),clock=await read();
        if(accepted!==false||JSON.stringify(inputAfter)!==JSON.stringify(inputBefore)||
          clock.mode!=='icount'||clock.mtime!==before.mtime)throw Error('Malformed native ABI frame reached staging/selection');
        numericRows.push({frame:frame.map(value=>Number.isNaN(value)?'NaN':value===Infinity?'Infinity':value),accepted,inputBefore,inputAfter,clock});
      }
      for(const value of [-0x80000000,-1,0x7fffffff]) {
        const inputBefore=await c.inputDeviceStats(),accepted=await c.sendKeyboardEvent(4,4,value);
        await c.syncKeyboard();const inputAfter=await c.inputDeviceStats(),clock=await read();
        if(accepted!==true||inputAfter.pendingEvents!==inputBefore.pendingEvents+2||
          inputAfter.pendingFrames!==inputBefore.pendingFrames+1||clock.mode!=='icount'||clock.mtime!==before.mtime)
          throw Error('Signed original MSC_SCAN forwarding changed');
        numericRows.push({frame:[4,4,value],accepted,inputBefore,inputAfter,clock});
      }

      await c.sendKeyboardEvent(1,30,1);await c.syncKeyboard();
      const selected=await read(),stillPaused=await c.isPaused(), retiredSelected=(await c.jitStats()).guestRetired;
      await c.sendKeyboardEvent(1,30,0);await c.syncKeyboard();
      await c.resume();
      const deadline=performance.now()+30000;
      let running=await read();
      while(BigInt(running.mtime)<=BigInt(selected.mtime)&&performance.now()<deadline){await sleep(50);running=await read();}
      for(const wait of [1000,1500]){
        await c.pause();const beforePause=await read(),retiredBeforePause=(await c.jitStats()).guestRetired,pauseStarted=performance.now();
        await sleep(wait);const afterPause=await read(),retiredAfterPause=(await c.jitStats()).guestRetired,pauseFinished=performance.now();
        const resumeSent=performance.now();await c.resume();
        const resumed=await read(),retiredResumed=(await c.jitStats()).guestRetired;await sleep(250);
        const progressed=await read(),retiredProgressed=(await c.jitStats()).guestRetired,progressReceived=performance.now();
        rows.push({wait,beforePause,afterPause,pauseStarted,pauseFinished,resumeSent,resumed,progressed,progressReceived,retired:{beforePause:retiredBeforePause,afterPause:retiredAfterPause,resumed:retiredResumed,progressed:retiredProgressed}});
      }
      return {initialJit,numericRows,paused,before,retiredBefore,selected,retiredSelected,stillPaused,running,rows,input:await c.inputDeviceStats(),gpu:await c.gpuStats(),errors:__production.errors};
    });
    await fs.writeFile(path.join(output,'clock.json'),JSON.stringify(clock,null,2)+'\n');
    assert.equal(clock.initialJit.hasExecutor,true);assert.equal(clock.initialJit.guestRetired,0);
    assert.deepEqual(errors,[]);
    assert.equal(clock.paused,true);assert.equal(clock.stillPaused,true);
    assert.equal(clock.before.mode,'icount');assert.equal(clock.before.clockDiv,64);
    assert.equal(clock.selected.mode,'paced-icount');assert.equal(clock.retiredSelected,clock.retiredBefore);assert.equal(clock.selected.mtime,clock.before.mtime);
    assert.equal(clock.selected.clockDiv,64);assert.equal(clock.selected.timebaseHz,10000000);
    assert.ok(BigInt(clock.running.mtime)>BigInt(clock.selected.mtime),'original paced-mode guest actually ran');
    for(const row of clock.rows){
      row.pauseMillis=row.pauseFinished-row.pauseStarted;
      row.bound=assertInteractivePauseProbe(row);
    }
    assert.deepEqual(clock.errors,[]);assert.equal(clock.gpu.qualified,true);assert.equal(clock.gpu.lost,false);
    await fs.writeFile(path.join(output,'clock.json'),JSON.stringify({...clock,status:'passed'},null,2)+'\n');
    await page.screenshot({path:path.join(output,'worker-clock.png'),fullPage:true});

} finally {
  await browser?.close();await recording;await originalImage?.close();
  server.closeAllConnections();await new Promise(r=>server.close(r));
  await fs.writeFile(path.join(output,'served.json'),JSON.stringify([...served.values()],null,2)+'\n');
  await fs.writeFile(path.join(output,'errors.json'),JSON.stringify(errors,null,2)+'\n');
}
