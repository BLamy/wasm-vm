#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--chrome','--seeds','--smoke','--fault','--boundaries','--sharing','--attacks'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);for(const key of ['smoke','fault','boundaries','sharing','attacks'])assert.ok(options[key]===undefined||options[key]==='true');
const seeds=options.seeds?.split(',').map(Number)??[27449,84131,176129];assert.ok(seeds.length>=1&&seeds.length<=3&&new Set(seeds).size===seeds.length&&seeds.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff));
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sources=new Map(),served=new Map(),runs=[];
async function source(name){
  if(sources.has(name))return;
  const bytes=await fs.readFile(path.join(repo,name));sources.set(name,bytes);
  if(/\.m?js$/.test(name))for(const m of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
}
for(const name of ['renderer/virgl-command/tests/native-dimensional-depth.mjs','renderer/virgl-command/control-bridge.mjs',
  'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','tools/virgl-dimensional-depth/browser.mjs'])await source(name);
async function pkg(dir){for(const item of await fs.readdir(path.join(repo,dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())await pkg(name);else if(/\.(js|wasm)$/.test(name))await source(name);}}
await pkg('target/virgl-desktop-submit/pkg');
const servedSources=new Map(sources);
let sabotage=null;
if(options.fault){
  const name='renderer/virgl-command/dimensional-depth-images.mjs',original=sources.get(name),anchor='storage.target,layout.box.z+layer);',replacement='storage.target,(layout.box.z+layer+1)%meta.arraySize);';
  assert.equal(original.toString().split(anchor).length,2,'unique completed physical layer selection');
  const mutated=Buffer.from(original.toString().replace(anchor,replacement));servedSources.set(name,mutated);
  sabotage={source:name,originalSha256:sha(original),servedSha256:sha(mutated),anchor,replacement,phase:'native source face/layer copy, before real PBO/fence/collection and original DMA'};
}
const report={schema:'dimensional-depth-browser-receipt-v1',task:'E6-T11d59',status:'running',command:[process.execPath,...process.argv.slice(1)],
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),
  actualLinuxGuest:false,productionAuthority:false,host:{platform:process.platform,architecture:process.arch,node:process.version,release:os.release()},
  startedAt:new Date().toISOString(),seeds,sources:[...sources].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),browserErrors:{console:[],page:[],requests:[]}};
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Original dimensional depth storage</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Original cube and array depth storage</h1><p>Selected proof consumer; production acceleration remains partial.</p><canvas id="gpu" width="32" height="32"></canvas><p id="status">Testing original commands on native hardware…</p><pre id="results"></pre>');
let server,browser,page;
try{
  const endpoints=new Map([['/',{bytes:html,type:'text/html'}],...[...servedSources].filter(([name])=>/\.(m?js|wasm)$/.test(name)).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
  server=createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
    served.set(name,{path:name,bytes:item.bytes.length,sha256:sha(item.bytes)});
    response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const chrome=options.chrome??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',{chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');
  assert.ok(!command.arguments.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));
  report.browser={executable:chrome,sha256:sha(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
  const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
  await page.exposeFunction('__recordDimensionalDepthRun',async(index,body)=>{
    assert.equal(index,runs.length);const bytes=Buffer.from(body),packed=gzipSync(bytes,{level:9}),name='run-'+String(index).padStart(4,'0')+'.json.gz';await fs.writeFile(path.join(output,name),packed);
    const pin={path:name,bytes:bytes.length,sha256:sha(bytes),gzipBytes:packed.length,gzipSha256:sha(packed),encoding:'gzip'};runs.push(pin);return pin;
  });
  page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));
  page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  const profiler=await context.newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  let timer;try{
    report.browserResult=await Promise.race([page.evaluate(async options=>{
      try{
        const wasm=await import('/target/virgl-desktop-submit/pkg/wasm_vm_wasm.js');await wasm.default();
        const {createVirglStandardDimensionalDepthSubmitBridge}=await import('/renderer/virgl-command/control-bridge.mjs'),{runAcceptance}=await import('/renderer/virgl-command/tests/native-dimensional-depth.mjs');
        const result=await runAcceptance({...options,WasmVirglSubmitProof:wasm.WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge});
        document.querySelector('#status').textContent='Passed original dimensional depth, fences and complete guest output';document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return {status:'passed',result};
      }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return {status:'failed',error:{message:error.message,stack:error.stack},partial:window.__dimensionalDepthReport??null,point:window.__desktopActive?.()??null};}
    },{seeds,smoke:Boolean(options.smoke),fault:Boolean(options.fault),boundaries:Boolean(options.boundaries),sharing:Boolean(options.sharing),attacks:Boolean(options.attacks)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('original dimensional depth exceeded420 seconds')),420000);})]);
  }finally{clearTimeout(timer);}
  const coverage=await profiler.send('Profiler.takePreciseCoverage'),scripts=[];
  for(const [name,bytes]of servedSources)if(/\.m?js$/.test(name)){
    const matches=coverage.result.filter(s=>s.url.endsWith('/'+name));if(!matches.length)continue;assert.equal(matches.length,1);
    scripts.push({source:name,sha256:sha(bytes),sourceBody:bytes.toString(),coverage:matches[0]});
  }
  const raw=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),raw);report.browserCoverage={path:'browser-coverage.json',sha256:sha(raw)};
  await profiler.send('Profiler.stopPreciseCoverage');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(path.join(output,'browser.png')))};
  assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
  for(const [name,bytes]of sources)assert.equal(sha(await fs.readFile(path.join(repo,name))),sha(bytes),'source drift '+name);
  report.status='passed';console.log(JSON.stringify(report.browserResult.result.summary));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  report.runs=runs;report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();
  report.sabotage=sabotage;
  for(const[name,bytes]of sources){const file=path.join(output,'source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  if(sabotage){const file=path.join(output,'served-source',sabotage.source);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,servedSources.get(sabotage.source));}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
}
