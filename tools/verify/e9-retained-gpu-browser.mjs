#!/usr/bin/env node
// Actual retained factory boot, retired guest instructions and fresh physical GPU presentation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(arg('--output'));const out=path.resolve(arg('--output')),remote=arg('--url'),development=process.argv.includes('--development'),web=path.join(root,'web/dist');
if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
await fs.mkdir(out,{recursive:false});const sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E9-T09',scope:'Unchanged retained GPU factory regression through the current launcher; no event-replay admission for GPU',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),errors:[],assets:[]};
let server,context,page;
try{
  if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
  if(!remote){
    const fallback=new Map();for(const asset of Object.values(JSON.parse(await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json'),'utf8')).artifacts)){
      const pathname='/'+asset.url.replace(/^\.\//,'');fallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{try{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      const base=pathname.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+pathname);if(!file.startsWith(base+path.sep))throw Error('outside root');
      let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'&&fallback.has(pathname)){response.writeHead(302,{Location:fallback.get(pathname)}).end();return;}throw error;}
      response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  const url=remote||`http://127.0.0.1:${server.address().port}/`;report.url=url;
  context=await chromium.launchPersistentContext(path.join(out,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0];await page.coverage.startJSCoverage({resetOnNavigation:false});
  page.on('console',m=>{if(m.type()==='error'&&!(/\/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url+'app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true&&window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading');
  const manifest=JSON.parse(await fs.readFile(path.join(web,'gpu-runtime/manifest.json'),'utf8'));assert.equal(manifest.files.length,47);
  for(const name of ['app.html','main.js','event-clock-probe.js','session-store.js','session-library.js','session-library.css','loader.js','gpu-runtime-worker.js','linux-worker-host.js','gpu-checkpoint-build.js','gpu-runtime/manifest.json',...manifest.files.map(e=>manifest.directory+'/'+e.path)]){
    const response=await context.request.get(new URL(name,url).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,name))),name);report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
  }
  console.log('All58 current/archive assets match; booting actual retained GPU factory');
  await page.locator('#desktop-graphics').selectOption('gpu');report.boot=await page.evaluate(()=>wvmDemo.bootOmarchy());assert.equal(report.boot.ok,true,JSON.stringify(report.boot));
  await page.waitForFunction(()=>wvmDemo.isGuestReady()&&__linux.restoredFromBootSnapshot(),null,{timeout:600000});
  const value=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
  report.gpu={qualified:value.gpu.qualified,lost:value.gpu.lost,poisoned:value.gpu.poisoned,epoch:value.gpu.epoch,retired:value.scheduler.retiredInstructions,drawn:value.gpu.scanout.retirements.filter(e=>e.epoch===value.gpu.epoch&&e.status==='drawn')};
  assert.ok(report.gpu.qualified&&!report.gpu.lost&&!report.gpu.poisoned&&report.gpu.retired>0&&report.gpu.drawn.length);assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(out,'gpu-factory-ready.png')});report.status='passed';console.log('Retired guest instructions and fresh physical GPU draw passed.');
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
  if(page)await fs.writeFile(path.join(out,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage().catch(()=>[])));
  if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')});await context.close();}
  await new Promise(resolve=>server?server.close(resolve):resolve());
  report.driver_sha256=sha(await fs.readFile(fileURLToPath(import.meta.url)));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,gpu:report.gpu}));
}
