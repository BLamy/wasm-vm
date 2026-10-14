#!/usr/bin/env node
// Owned headed Chrome; original Linux, production worker, and actual visible canvas.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]),mode=process.argv[3]??'qualify';
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
  if(mode==='qualify') {
    const result=await page.evaluate(async()=>{
      const {attachProductionVirgl,createWorkerScanoutPresenter}=await import('/renderer/virgl-command/production.mjs');
      let profile;
      const machine={attachVirgl:(...args)=>{profile={limits:[...args[0]],roles:[...args[1]],renderer:args[2]};}};
      const presenter=createWorkerScanoutPresenter(()=>{}),gpu=await attachProductionVirgl(machine,{presenter});
      const result={profile,inspection:gpu.inspect()};gpu.dispose();return result;
    });
    await fs.writeFile(path.join(output,'qualification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result.profile));
  } else {
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
        ramMib:1024,bootargs:'root=/dev/vda rw console=ttyS0 init=/bin/bash',virgl:true,gpuTrace:true,guestClock:'icount',icountDivider:64,jit:true,quantum:500000});
    });
    console.log('production worker running');
    for(let i=0;i<1200;i++){
      await new Promise(r=>setTimeout(r,1000));
      if(i%15===0){const state=await page.evaluate(()=>({serial:__production.serial.slice(-300),errors:__production.errors,stats:__production.controller.schedulerStats()}));console.log(JSON.stringify(state));}
      const state=await page.evaluate(()=>({ready:/\[root@.*\]#/.test(__production.serial.slice(-400)),errors:__production.errors}));
      if(state.errors.length)throw Error(state.errors.join('\n'));
      if(state.ready){console.log('guest shell ready');break;}
    }
    await fs.writeFile(path.join(output,'state.json'),JSON.stringify(await page.evaluate(async()=>({serial:__production.serial,errors:__production.errors,gpu:await __production.controller.gpuStats(),display:__production.presentation.snapshot(),scheduler:await __production.controller.schedulerStats(),clock:await __production.controller.guestClockState()})),null,2));
    assert.equal(await page.evaluate(()=>/\[root@.*\]#/.test(__production.serial.slice(-400))),true,'cold guest shell deadline');
    if (mode==='accept') { const {runProductionAcceptance}=await import('./acceptance.mjs');await runProductionAcceptance(page,output); }
    if (mode==='recover') { const {runProductionRecovery}=await import('./recovery.mjs');await runProductionRecovery(page,output); }
    // Keep this owned live session available while the next guest command is prepared.
    await fs.writeFile(path.join(output,'ready'),String(Date.now()));
    if(process.env.VIRGL_INTERACTIVE_HOLD==='1')for(let i=0;i<1800;i++){
      await new Promise(r=>setTimeout(r,1000));const request=path.join(output,'guest-command');
      try{const command=await fs.readFile(request,'utf8');await fs.unlink(request);
        if(command.trim()==='@stop')break;
        if(command.trim()==='@snapshots'){const results=await page.evaluate(async()=>{const out={};for(const method of ['saveDesktopSnapshot','snapshotSave','snapshotRestore','snapshotImport'])try{await __production.controller[method](new Uint8Array());out[method]='unexpected success';}catch(e){out[method]=String(e.message);}return out;});await fs.writeFile(path.join(output,'snapshot-rejections.json'),JSON.stringify(results,null,2));continue;}
        if(command.trim()==='@lose'){
          const before=await page.evaluate(async()=>({gpu:await __production.controller.gpuStats(),display:__production.presentation.snapshot()}));
          await fs.writeFile(path.join(output,'loss-before.json'),JSON.stringify(before,null,2));
          assert.equal(await page.evaluate(()=>__production.controller.loseGpuContext('pending')),true);
        }else if(command.trim()==='@snapshot'){
          await fs.writeFile(path.join(output,'live-state.json'),JSON.stringify(await page.evaluate(async()=>({serial:__production.serial,errors:__production.errors,gpu:await __production.controller.gpuStats(),display:__production.presentation.snapshot(),scheduler:await __production.controller.schedulerStats(),clock:await __production.controller.guestClockState()})),null,2));
          await page.screenshot({path:path.join(output,'live-browser.png'),fullPage:true});
        }else await page.evaluate(text=>__production.controller.sendInput(new TextEncoder().encode(text)),command);
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await page.evaluate(()=>__production.controller.stop());
  }
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});
  assert.deepEqual(errors,[]);
}catch(error){process.exitCode=1;await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,errors},null,2));console.error(error.stack);}
finally{await recording;await fs.writeFile(path.join(output,'served-source.json'),JSON.stringify([...served.values()],null,2));await originalImage?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
