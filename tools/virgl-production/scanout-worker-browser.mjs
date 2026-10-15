#!/usr/bin/env node
// Actual production worker/native MMIO frames, delivered through the exact main UI callback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]),sabotage=process.argv[3]==='old-clear';
await fs.mkdir(output,{recursive:false});
const sha=body=>createHash('sha256').update(body).digest('hex'),sources=new Map(),served=new Map();
async function freeze(directory){for(const entry of await fs.readdir(path.join(repo,directory),{withFileTypes:true})){
  const name=path.posix.join(directory,entry.name);
  if(entry.isDirectory()){if(!['node_modules','dist','tests','test-results'].includes(entry.name))await freeze(name);}
  else if(/\.(m?js|wasm)$/.test(name))sources.set('/'+name.slice(4),{path:name,body:await fs.readFile(path.join(repo,name))});
}}
for(const directory of ['web/src','web/renderer','web/pkg'])await freeze(directory);
for(const entry of await fs.readdir(path.join(repo,'web'),{withFileTypes:true}))if(entry.isFile()&&/\.m?js$/.test(entry.name)){
  const name='web/'+entry.name;sources.set('/'+entry.name,{path:name,body:await fs.readFile(path.join(repo,name))});
}
const main=sources.get('/main.js').body.toString(),handler=main.match(/function handleDisplayFrame\(frame\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(handler,'exact production UI callback');
if(sabotage){const source=sources.get('/renderer/virgl-command/production.mjs'),needle="send({type:preserveDisplay?'invalidate':'clear'})";assert.equal(source.body.toString().split(needle).length,2);source.originalSha256=sha(source.body);source.body=Buffer.from(source.body.toString().replace(needle,"send({type:'clear'})"));}
const kernel=await fs.readFile(path.join(repo,'guest/prebuilt/production-gpu-scanout.bin')),chunk=Buffer.alloc(262144),digest=sha(chunk);
const image=Buffer.from(JSON.stringify({version:1,image_len:chunk.length,chunk_size:chunk.length,layout:'split',chunks:[digest]}));
const descriptor=Buffer.from(JSON.stringify({artifacts:{kernel:{url:'/kernel.bin',size:kernel.length,sha256:sha(kernel)}}}));
const report={task:'E6-T11d74d1',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  scope:'Original MMIO supervisor + production worker + physical GPU + exact main presentation callback; not Linux/Mesa',
  sabotage,handlerSha256:sha(Buffer.from(handler)),kernel:{bytes:kernel.length,sha256:sha(kernel)},phases:[],errors:[],
  sources:[...sources.values()].map(s=>({path:s.path,bytes:s.body.length,sha256:sha(s.body),originalSha256:s.originalSha256}))};
let browser,page,recording=Promise.resolve();
const server=createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname;
  if(name==='/favicon.ico'){response.writeHead(204).end();return;}
  const source=sources.get(name),body=source?.body??({'/':Buffer.from('<!doctype html><title>GPU scanout continuity</title><canvas id="display" width="64" height="64" tabindex="0" style="width:256px;height:256px"></canvas><pre id="serial"></pre>'),'/kernel.bin':kernel,'/boot.json':descriptor,'/guest/manifest.json':image,['/guest/chunks/'+digest+'.bin']:chunk})[name];
  if(!body){response.writeHead(404).end();return;}
  served.set(name,{path:source?.path??name,bytes:body.length,sha256:sha(body)});
  response.writeHead(200,{'Content-Type':name==='/'?'text/html':name.endsWith('.json')?'application/json':name.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(name)?'text/javascript':'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(body);
});
async function record(label){
  const value=await page.evaluate(async()=>{
    const p=__continuity;return {serial:p.serial,events:p.events,frames:p.frames,receipts:p.receipts,ui:p.presentation.snapshot(),
      pixels:[...p.presentation.readPixels()],gpu:await p.controller.gpuStats(),clock:await p.controller.guestClockState(),
      scheduler:await p.controller.schedulerStats(),delayed:p.delayed.size};
  });
  await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(value,null,2)+'\n');report.phases.push({label,sha256:sha(Buffer.from(JSON.stringify(value,null,2)+'\n'))});return value;
}
function pixels(state,rgba,label){assert.equal(state.pixels.length,64*64*4,label+' byte length');const first=state.pixels.findIndex((v,i)=>v!==rgba[i%4]);assert.equal(first,-1,label+'; first differing byte '+first);}
async function key(text,marker){const count=await page.evaluate(marker=>__continuity.serial.split(marker).length,marker);await page.locator('#display').focus();await page.keyboard.press(text,{delay:50});await page.waitForFunction(({marker,count})=>__continuity.serial.split(marker).length>count,{marker,count},{timeout:20000});}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(a)));report.hardware={gpu:system.gpu,commandLine:command.arguments,version:browser.version()};
  page=await browser.newPage({viewport:{width:900,height:700},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.exposeFunction('__recordContinuityGpu',event=>{recording=recording.then(()=>fs.appendFile(path.join(output,'gpu.ndjson'),JSON.stringify(event)+'\n'));return recording;});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async handler=>{
    const {createLinuxWorkerClient}=await import('/linux-worker-protocol.js'),{PresentationController}=await import('/src/sink/presentation.js');
    const {createKeyboardBridge,createWasmKeyboardAdapter,attachKeyboardBridge}=await import('/src/input/keyboard.js');
    const canvas=document.querySelector('#display'),p=globalThis.__continuity={serial:'',events:[],frames:[],receipts:[],hold:false,delayed:new Map(),callbacks:new Map(),presentation:new PresentationController(canvas,{scheduleFrames:false})};
    p.presentation.setViewport(64,64);
    const raf=fn=>{const id=requestAnimationFrame(time=>{if(p.hold)p.delayed.set(id,()=>fn(time));else fn(time);});p.callbacks.set(id,fn);return id;};
    const cancel=id=>{cancelAnimationFrame(id);p.delayed.delete(id);};
    p.handle=new Function('presentation','displayViewport','displayStatusEl','requestAnimationFrame','cancelAnimationFrame',"let pendingGpuFrame=null,gpuFrameRequest=null;\n"+handler+"\nreturn handleDisplayFrame;")(p.presentation,null,null,raf,cancel);
    const worker=p.worker=new Worker('/linux-worker.js',{type:'module'}),decoder=new TextDecoder();
    const client=createLinuxWorkerClient(worker,{bootTimeoutMs:60000,onOutput(bytes){p.serial+=decoder.decode(bytes,{stream:true});document.querySelector('#serial').textContent=p.serial;},onError(error){p.events.push({error:String(error)});},
      onGpuEvent(event){void __recordContinuityGpu(event);},onDisplayFrame(frame){p.frames.push({type:frame.type??'pixels',token:frame.presentationToken??null,time:performance.now()});
        const retire=frame.onRetired;if(retire)frame.onRetired=(status,record)=>{p.receipts.push({status,record,time:performance.now()});retire(status,record);};p.handle(frame);}});
    p.controller=await client.boot({manifestUrl:'/boot.json',mode:'chunked',imageManifestUrl:'/guest/manifest.json',baseUrl:location.origin+'/guest/',bootProfileUrl:null,persist:false,bootSnapshot:false,ramMib:64,bootargs:'console=ttyS0',virgl:true,gpuTrace:true,guestClock:'icount',icountDivider:64,jit:true,quantum:10000});
    p.detach=attachKeyboardBridge(canvas,createKeyboardBridge(createWasmKeyboardAdapter(p.controller)));
  },handler);
  await page.waitForFunction(()=>__continuity.serial.includes('CONTINUITY_GREEN')&&__continuity.presentation.snapshot().drawnPresents>=1,null,{timeout:45000});
  const green=await record('green');pixels(green,[0,255,0,255],'literal original guest green');assert.equal(green.gpu.counters.failed,0);
  await page.evaluate(()=>{__continuity.hold=true;});
  await key('n','CONTINUITY_RED');await page.waitForFunction(()=>__continuity.delayed.size===1,null,{timeout:10000});
  const queued=await record('queued-old-red');pixels(queued,[0,255,0,255],'pending original red cannot paint before its page callback');
  await page.evaluate(()=>{__continuity.oldCallbacks=[...__continuity.callbacks.values()];});
  await key('r','CONTINUITY_REBOUND');
  const rebound=await record('rebound-before-replacement');pixels(rebound,[0,255,0,255],'no-blank: valid page flip retains displayed original green');assert.equal(rebound.delayed,0);assert.equal(rebound.ui.latest,null);
  await key('b','CONTINUITY_BLUE');await page.waitForFunction(()=>__continuity.delayed.size===1,null,{timeout:10000});
  await page.evaluate(()=>{for(const callback of __continuity.oldCallbacks)callback(performance.now());});
  const stale=await record('stale-callback-before-blue');pixels(stale,[0,255,0,255],'revoked old callback cannot consume a new binding frame');
  await page.evaluate(()=>{const p=__continuity;p.hold=false;for(const callback of p.delayed.values())callback();p.delayed.clear();});
  await page.waitForFunction(()=>__continuity.presentation.snapshot().drawnPresents>=2);
  const blue=await record('fresh-blue');pixels(blue,[0,0,255,255],'literal fresh original blue');
  await key('d','CONTINUITY_DISABLED');const disabled=await record('disabled');pixels(disabled,[0,0,0,0],'explicit native display disable erases visible pixels');
  await key('e','CONTINUITY_ENABLED');const enabled=await record('enabled-without-frame');pixels(enabled,[0,0,0,0],'enable cannot replay revoked pixels');
  await page.evaluate(()=>{__continuity.serial='';});await key('n','CONTINUITY_RED');await page.waitForFunction(()=>__continuity.presentation.snapshot().drawnPresents>=3);
  const red=await record('fresh-red');pixels(red,[255,0,0,255],'literal original red after re-enable');
  assert.equal(red.gpu.counters.failed,0);assert.equal(red.gpu.counters.cancelled,0);assert.equal(red.gpu.scanout.failed,0);assert.ok(red.gpu.scanout.cancelled>=1);assert.deepEqual(red.events,[]);assert.deepEqual(report.errors,[]);
  report.finalDigest=await page.evaluate(()=>__continuity.controller.stateDigest());
  await key('r','CONTINUITY_REBOUND');const beforeLoss=await record('rebound-before-context-loss');pixels(beforeLoss,[255,0,0,255],'preserve original red before actual worker context loss');assert.equal(beforeLoss.ui.latest,null);
  assert.equal(await page.evaluate(()=>__continuity.controller.loseGpuContext('now')),true);
  await page.waitForFunction(async()=>!(await __continuity.controller.gpuStats()).qualified,null,{timeout:10000});
  const lost=await record('actual-worker-context-lost');pixels(lost,[0,0,0,0],'actual owner loss clears and cannot replay revoked red');assert.equal(lost.ui.latest,null);assert.equal(lost.ui.replayedFrames,0);assert.deepEqual(lost.events,[]);assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});
  await page.evaluate(async()=>{__continuity.detach();await __continuity.controller.stop();});report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);if(page)await record('failure').catch(()=>{});}
finally{
  await recording;report.served=[...served.values()];
  for(const source of sources.values()){const filename=path.join(output,'source',source.path);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,source.body);}
  await fs.writeFile(path.join(output,'driver-executed.mjs'),await fs.readFile(fileURLToPath(import.meta.url)));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
