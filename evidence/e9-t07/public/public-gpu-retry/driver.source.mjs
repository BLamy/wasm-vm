import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const root=process.cwd(),out=path.join(root,'target/evidence/e9-t07-public-gpu-retry'),url='https://wasm-vm.pages.dev/';
await fs.mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex');
const r={task:'E9-T07',scope:'Missing public GPU regression after a recorded R2 connection reset; no storage claims retested',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started:new Date().toISOString(),errors:[],assets:[]};
let context,page;
try{
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}),'');
 context=await chromium.launchPersistentContext(path.join(out,'chromium-profile'),{headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0];await page.coverage.startJSCoverage({resetOnNavigation:false});
 page.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))r.errors.push(m.text());});page.on('pageerror',e=>r.errors.push(e.message));
 await page.goto(url+'app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ready===true&&window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading');
 const manifest=JSON.parse(await fs.readFile('web/gpu-runtime/manifest.json','utf8'));
 for(const name of ['app.html','main.js','session-store.js','session-library.js','session-library.css','loader.js','gpu-runtime-worker.js','linux-worker-host.js','gpu-checkpoint-build.js','gpu-runtime/manifest.json',...manifest.files.map(e=>manifest.directory+'/'+e.path)]){
  const response=await context.request.get(new URL(name,url).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(root,'web/dist',name))),name);r.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 console.log('All57 current/archive public assets match; booting actual retained GPU factory');
 await page.locator('#desktop-graphics').selectOption('gpu');r.boot=await page.evaluate(()=>wvmDemo.bootOmarchy());assert.equal(r.boot.ok,true,JSON.stringify(r.boot));
 await page.waitForFunction(()=>wvmDemo.isGuestReady()&&__linux.restoredFromBootSnapshot(),null,{timeout:600000});
 const value=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
 r.gpu={qualified:value.gpu.qualified,lost:value.gpu.lost,poisoned:value.gpu.poisoned,epoch:value.gpu.epoch,retired:value.scheduler.retiredInstructions,drawn:value.gpu.scanout.retirements.filter(e=>e.epoch===value.gpu.epoch&&e.status==='drawn')};
 assert.ok(r.gpu.qualified&&!r.gpu.lost&&!r.gpu.poisoned&&r.gpu.retired>0&&r.gpu.drawn.length);assert.deepEqual(r.errors,[]);
 await page.screenshot({path:path.join(out,'gpu-factory-ready.png')});r.status='passed';console.log('Actual public retained GPU retired instructions and fresh physical draw passed.');
}catch(error){r.status='failed';r.failure={message:error.message,stack:error.stack};console.error(error.stack);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(page)await fs.writeFile(path.join(out,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage().catch(()=>[])));
 if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')});await context.close();}
 r.driver_sha256=sha(await fs.readFile('target/e9-t07-public-gpu-retry.mjs'));r.files=[];
 async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await visit(f);else if(e.isFile()&&f!==path.join(out,'report.json')){const b=await fs.readFile(f);r.files.push({path:path.relative(out,f),bytes:b.length,sha256:sha(b)});}}}
 await visit(out);r.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(r,null,2)+'\n');
}
