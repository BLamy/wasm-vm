#!/usr/bin/env node
// Real production worker + supervisor original MMIO guest. This is not a Linux/Mesa claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]),mode=process.argv[3]??'roundtrip';
const ramMib=Number(process.argv[4]??64);assert.ok([64,1024].includes(ramMib));
assert.ok(['cold','roundtrip'].includes(mode));await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=new Map(),served=new Map(),pairs=new Map(),errors=[];
async function freeze(directory){for(const entry of await fs.readdir(path.join(repo,directory),{withFileTypes:true})){
  const name=path.posix.join(directory,entry.name);
  if(entry.isDirectory()){if(!['node_modules','dist','test-results','tests'].includes(entry.name))await freeze(name);}
  else if(/\.(m?js|wasm)$/.test(entry.name))sources.set('/'+name.slice(4),{name,bytes:await fs.readFile(path.join(repo,name))});
}}
for(const entry of await fs.readdir(path.join(repo,'web'),{withFileTypes:true}))if(entry.isFile()&&/\.m?js$/.test(entry.name)){
  const name='web/'+entry.name;sources.set('/'+entry.name,{name,bytes:await fs.readFile(path.join(repo,name))});
}
for(const name of ['web/src','web/renderer','web/pkg'])await freeze(name);
const kernel=await fs.readFile(path.join(repo,'guest/prebuilt/production-gpu-pair.bin')),chunk=Buffer.alloc(262144),chunkHash=sha(chunk);
const image=Buffer.from(JSON.stringify({version:1,image_len:chunk.length,chunk_size:chunk.length,layout:'split',chunks:[chunkHash]}));
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Paired production GPU worker</title><style>body{background:#10151c;color:#eee;font:14px monospace}canvas{width:384px;height:384px;image-rendering:pixelated;border:1px solid #789}pre{white-space:pre-wrap}</style><h1>Paired production GPU worker</h1><p>Original MMIO supervisor guest; Linux/Mesa is verified separately.</p><canvas id="display" width="64" height="64" tabindex="0"></canvas><pre id="serial"></pre>');
const report={schema:'production-paired-worker-v1',status:'running',mode,ramMib,guest:'supervisor original-MMIO; not Linux/Mesa',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),sources:[...sources.values()].map(s=>({path:s.name,bytes:s.bytes.length,sha256:sha(s.bytes)})),kernel:{bytes:kernel.length,sha256:sha(kernel)},image:{bytes:image.length,sha256:sha(image)},errors,phases:[]};
let browser,page;
const server=createServer(async(req,res)=>{
  try{
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    if(req.method==='POST'&&/^\/pair\/[a-z0-9-]+$/.test(name)){
      const parts=[];let size=0;for await(const part of req){size+=part.length;assert.ok(size<=512*1024*1024);parts.push(part);}
      const bytes=Buffer.concat(parts);pairs.set(name,bytes);await fs.writeFile(path.join(output,name.slice(6)+'.wvgpair'),bytes);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:name,bytes:bytes.length,sha256:sha(bytes)}));return;
    }
    let bytes,type='application/octet-stream',source;
    if(name==='/'){bytes=html;type='text/html';}
    else if(name==='/kernel.bin')bytes=kernel;
    else if(name==='/guest/manifest.json'){bytes=image;type='application/json';}
    else if(name==='/guest/chunks/'+chunkHash+'.bin')bytes=chunk;
    else if(name==='/boot.json'){
      const pairName=url.searchParams.get('pair'),pair=pairName?pairs.get('/pair/'+pairName):null;
      assert.ok(!pairName||pair,'unknown saved pair');
      bytes=Buffer.from(JSON.stringify({artifacts:{kernel:{url:'/kernel.bin',size:kernel.length,sha256:sha(kernel)},...(pair?{gpuCheckpoint:{url:'/pair/'+pairName,size:pair.length,sha256:sha(pair)}}:{})}}));type='application/json';
    }else if(pairs.has(name))bytes=pairs.get(name);
    else if(sources.has(name)){source=sources.get(name);bytes=source.bytes;type=name.endsWith('.wasm')?'application/wasm':'text/javascript';}
    else throw Error('unknown frozen path '+name);
    served.set(name,{path:source?.name??name,bytes:bytes.length,sha256:sha(bytes)});res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length}).end(bytes);
  }catch(error){res.writeHead(404).end(String(error));}
});
async function state(label){
  const value=await page.evaluate(async()=>{
    const p=globalThis.__paired,c=p.controller,canvas=document.querySelector('#display'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
    const context=copy.getContext('2d');context.drawImage(canvas,0,0);const pixel=[...context.getImageData(32,32,1,1).data];
    return {serial:p.serial,errors:p.errors,states:p.states,events:p.events,gpu:await c.gpuStats(),clock:await c.guestClockState(),scheduler:await c.schedulerStats(),input:await c.inputDeviceStats(),restored:await c.restoredFromBootSnapshot(),paused:await c.isPaused(),display:p.presentation.snapshot(),cursor:p.cursor,frames:p.frames,pixel,trusted:p.trusted};
  });
  await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(value,null,2)+'\n');report.phases.push({label,sha256:sha(Buffer.from(JSON.stringify(value,null,2)+'\n'))});return value;
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));report.hardware={gpu:system.gpu,commandLine:command.arguments,version:browser.version()};
  page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:1});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.stack));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async ramMib=>{
    const {createLinuxWorkerClient}=await import('/linux-worker-protocol.js'),{PresentationController}=await import('/src/sink/presentation.js');
    const {createKeyboardBridge,createWasmKeyboardAdapter,attachKeyboardBridge}=await import('/src/input/keyboard.js');
    const {createPointerBridge,createWasmPointerAdapter,attachPointerBridge}=await import('/src/input/pointer.js');
    const canvas=document.querySelector('#display');
    globalThis.__startPair=async pair=>{
      const previous=globalThis.__paired;if(previous){for(const detach of previous.detach)detach();await previous.controller.stop();previous.worker.terminate();}
      const worker=new Worker('/linux-worker.js',{type:'module'}),presentation=new PresentationController(canvas,{scheduleFrames:false}),decoder=new TextDecoder();
      const p=globalThis.__paired={worker,presentation,serial:'',errors:[],states:[],cursor:[],frames:[],trusted:[],events:[],detach:[]};
      const client=createLinuxWorkerClient(worker,{bootTimeoutMs:90000,
        onOutput(bytes){p.serial+=decoder.decode(bytes,{stream:true});document.querySelector('#serial').textContent=p.serial.slice(-6000);},
        onState(value){p.states.push(value);},onCursorState(value){p.cursor.push(value);},onError(error){p.errors.push(String(error));},
        onGpuEvent(event){if(event.type==='context-lost')p.errors.push('context lost');if(['checkpoint-loaded','context-lost'].includes(event.type))p.events.push(event);},
        onDisplayFrame(frame){if(frame.type==='clear'){presentation.clear();return;}requestAnimationFrame(()=>{try{
          const before=presentation.snapshot().drawnPresents,accepted=presentation.present(frame),after=presentation.snapshot();
          p.frames.push({token:frame.token??frame.retirementToken,accepted,drawn:after.drawnPresents>before});
          frame.onRetired?.(accepted&&after.drawnPresents>before?'drawn':'failed',{backend:after.backend});
        }catch(error){p.errors.push(String(error));frame.onRetired?.('failed');}});},
      });
      const start=performance.now();p.controller=await client.boot({mode:'chunked',manifestUrl:'/boot.json'+(pair?'?pair='+pair:''),imageManifestUrl:'/guest/manifest.json',baseUrl:location.origin+'/guest/',bootProfileUrl:null,persist:false,bootSnapshot:!!pair,ramMib,bootargs:'console=ttyS0',virgl:true,gpuTrace:true,guestClock:'icount',icountDivider:64,interactiveClock:'paced-on-keyboard',jit:true,quantum:10000});p.bootMs=performance.now()-start;
      p.detach.push(attachKeyboardBridge(canvas,createKeyboardBridge(createWasmKeyboardAdapter(p.controller))));
      p.detach.push(attachPointerBridge(canvas,createPointerBridge(createWasmPointerAdapter(p.controller),{target:canvas,serializeTransport:true})));
      const trusted=event=>p.trusted.push({type:event.type,code:event.code??null,isTrusted:event.isTrusted});for(const name of ['keydown','keyup','pointermove']){canvas.addEventListener(name,trusted);p.detach.push(()=>canvas.removeEventListener(name,trusted));}
      return {bootMs:p.bootMs,restored:await p.controller.restoredFromBootSnapshot()};
    };
    globalThis.__savePair=async name=>{
      const c=__paired.controller;await c.pause();const before={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};
      const bytes=await c.saveGpuCheckpoint(),after={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};
      const response=await fetch('/pair/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('pair publication failed');
      return {before,after,pin:await response.json()};
    };
  },ramMib);
  report.cold=await page.evaluate(()=>__startPair(null));console.log('original worker cold started',JSON.stringify(report.cold));
  await page.waitForFunction(()=>__paired.serial.includes('PAIR_FRAME_M')||__paired.serial.includes('PAIR_FAIL'),null,{timeout:45000});
  await page.waitForFunction(()=>__paired.presentation.snapshot().drawnPresents>=2||__paired.serial.includes('PAIR_FAIL'),null,{timeout:45000});
  const cold=await state('cold');assert.ok(!cold.serial.includes('PAIR_FAIL'));assert.deepEqual(cold.errors,[]);assert.deepEqual(cold.pixel,[0,255,0,255]);assert.equal(cold.restored,false);
  if(mode==='roundtrip'){
    report.captureA=await page.evaluate(()=>__savePair('green'));assert.deepEqual(report.captureA.after.clock,report.captureA.before.clock);assert.equal(report.captureA.after.scheduler.retiredInstructions,report.captureA.before.scheduler.retiredInstructions);
    report.warm=await page.evaluate(()=>__startPair('green'));console.log('GPU warm ready',JSON.stringify(report.warm));assert.equal(report.warm.restored,true);
    const warm=await state('warm');assert.deepEqual(warm.errors,[]);assert.ok(!warm.serial.includes('PAIR_GUEST_START'));assert.ok(warm.gpu.renderer.work.draws>=cold.gpu.renderer.work.draws);assert.deepEqual(warm.pixel,[0,255,0,255]);assert.deepEqual(warm.events.find(e=>e.type==='checkpoint-loaded').clockState,report.captureA.before.clock);
    await page.locator('#display').focus();await page.keyboard.press('a');await page.waitForFunction(()=>__paired.serial.includes('PAIR_KEY_RED'),null,{timeout:15000});
    const bounds=await page.locator('#display').boundingBox();await page.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height*.3);
    await page.waitForFunction(()=>__paired.cursor.at(-1)?.state.pos.x<25,null,{timeout:15000});
    const firstCursor=await page.evaluate(()=>__paired.cursor.at(-1).state.pos);await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.6,{steps:3});
    await page.waitForFunction(()=>__paired.cursor.at(-1)?.state.pos.x>35,null,{timeout:15000});
    const secondCursor=await page.evaluate(()=>__paired.cursor.at(-1).state.pos);assert.notDeepEqual(secondCursor,firstCursor);report.cursorPoints=[firstCursor,secondCursor];
    await page.waitForFunction(()=>{const p=document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data;return p[0]===255&&p[1]===0&&p[2]===0&&p[3]===255;},null,{timeout:15000});
    const typed=await state('warm-input');assert.ok(typed.gpu.renderer.work.draws>warm.gpu.renderer.work.draws);assert.deepEqual(typed.pixel,[255,0,0,255]);assert.deepEqual(typed.errors,[]);assert.equal(typed.clock.mode,'paced-icount');assert.ok(typed.trusted.some(e=>e.type==='keydown'&&e.isTrusted));
    await page.keyboard.press('b');await page.waitForFunction(()=>__paired.serial.includes('PAIR_KEY_BLUE'),null,{timeout:15000});
    await page.waitForTimeout(100);report.captureB=await page.evaluate(()=>__savePair('blue'));assert.deepEqual(report.captureB.after.clock,report.captureB.before.clock);
    report.repeat=await page.evaluate(()=>__startPair('blue'));assert.equal(report.repeat.restored,true);
    const repeat=await state('repeat');assert.deepEqual(repeat.errors,[]);assert.equal(repeat.clock.mode,'paced-icount');assert.deepEqual(repeat.pixel,[0,0,255,255]);assert.ok(!repeat.serial.includes('PAIR_GUEST_START'));assert.ok(!repeat.serial.includes('PAIR_FAIL'));assert.deepEqual(repeat.events.find(e=>e.type==='checkpoint-loaded').clockState,report.captureB.before.clock);
  }
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);
  if(page)try{report.partial=await page.evaluate(()=>({serial:globalThis.__paired?.serial,errors:globalThis.__paired?.errors,states:globalThis.__paired?.states}));if(await page.evaluate(()=>!!globalThis.__paired?.controller))await state('failure');await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch(capture){report.captureFailure=String(capture);}
}finally{
  report.served=[...served.values()];report.finishedAt=new Date().toISOString();
  for(const item of sources.values()){const name=path.join(output,'source',item.name);await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,item.bytes);}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
