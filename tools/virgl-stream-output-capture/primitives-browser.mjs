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
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--chrome','--seeds','--fault','--authority','--smoke'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);for(const key of ['smoke','fault','boundaries','attacks','mrt','refresh','historical'])assert.ok(options[key]===undefined||options[key]==='true');
const authority=options.authority?path.resolve(options.authority):null;const origins=new Map();
const seeds=options.seeds?.split(',').map(Number)??[1779033703,3144134277,1013904242];assert.ok(seeds.length>=1&&seeds.length<=3&&new Set(seeds).size===seeds.length&&seeds.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff));
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sources=new Map(),served=new Map(),runs=[];
async function source(name){
  if(sources.has(name))return;
  const generated=name.startsWith('target/virgl-desktop-submit/pkg/')||name.startsWith('renderer/virgl-shader/build/wasm/');const file=authority&&generated?path.join(authority,'source',name):path.join(repo,name);const bytes=await fs.readFile(file);origins.set(name,file);if(authority&&!generated&&!name.endsWith('native-stream-output-primitives.mjs')&&!name.endsWith('primitives-browser.mjs'))assert.equal(sha(bytes),sha(await fs.readFile(path.join(authority,'source',name))),'unchanged runtime/fixture byte '+name);sources.set(name,bytes);
  if(/\.m?js$/.test(name))for(const m of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
}
for(const name of ['renderer/virgl-command/tests/native-stream-output-primitives.mjs','renderer/virgl-command/control-bridge.mjs',
  'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','tools/virgl-stream-output-capture/primitives-browser.mjs'])await source(name);
async function pkg(dir){for(const item of await fs.readdir(path.join(authority??repo,authority?'source/'+dir:dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())await pkg(name);else if(/\.(js|wasm)$/.test(name))await source(name);}}
await pkg('target/virgl-desktop-submit/pkg');
const report={schema:'stream-output-capture-browser-v1',task:'E6-T11d66',status:'running',command:[process.execPath,...process.argv.slice(1)],
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),
  authority, runtimeSourceHead:null, actualLinuxGuest:false,productionAuthority:false,host:{platform:process.platform,architecture:process.arch,node:process.version,release:os.release()},
  startedAt:new Date().toISOString(),seeds,sources:[...sources].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),browserErrors:{console:[],page:[],requests:[]}};
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Original stream-output buffers</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Original GPU stream-output buffers</h1><p>Selected proof consumer; production acceleration remains partial.</p><canvas id="gpu" width="32" height="32"></canvas><p id="status">Testing original commands on native hardware…</p><pre id="results"></pre>');
let server,browser,page;
try{
  const endpoints=new Map([['/',{bytes:html,type:'text/html'}],...[...sources].filter(([name])=>/\.(m?js|wasm)$/.test(name)).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
  server=createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
    served.set(name,{path:name,bytes:item.bytes.length,sha256:sha(item.bytes),...(name==='/'?{bodyPath:'served/root.html'}:{})});
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
  await page.exposeFunction('__recordCaptureRun',async(index,body)=>{
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
        const {createVirglStandardStreamOutputSubmitBridge}=await import('/renderer/virgl-command/control-bridge.mjs'),{runCapture}=await import('/renderer/virgl-command/tests/native-stream-output-primitives.mjs');
        const result=await runCapture({...options,WasmVirglSubmitProof:wasm.WasmVirglSubmitProof,createVirglStandardStreamOutputSubmitBridge});
        document.querySelector('#status').textContent='Passed original GPU capture, fences and complete guest output';document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return {status:'passed',result};
      }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return {status:'failed',error:{message:error.message,stack:error.stack},partial:window.__captureReport??null,point:window.__captureActive?.()??null};}
    },{seeds,smoke:Boolean(options.smoke),fault:Boolean(options.fault),boundaries:Boolean(options.boundaries),attacks:Boolean(options.attacks),mrt:Boolean(options.mrt),refresh:Boolean(options.refresh),historical:Boolean(options.historical),sabotage:options.sabotage??'layer'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('original GPU capture exceeded900 seconds')),900000);})]);
  }finally{clearTimeout(timer);}
  const coverage=await profiler.send('Profiler.takePreciseCoverage'),scripts=[];
  for(const [name,bytes]of sources)if(/\.m?js$/.test(name)){
    const matches=coverage.result.filter(s=>s.url.endsWith('/'+name));if(!matches.length)continue;assert.equal(matches.length,1);
    scripts.push({source:name,sha256:sha(bytes),sourceBody:bytes.toString(),coverage:matches[0]});
  }
  const raw=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),raw);report.browserCoverage={path:'browser-coverage.json',sha256:sha(raw)};
  await profiler.send('Profiler.stopPreciseCoverage');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(path.join(output,'browser.png')))};
  assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
  for(const [name,bytes]of sources)assert.equal(sha(await fs.readFile(origins.get(name))),sha(bytes),'source drift '+name);
  report.status='passed';console.log(JSON.stringify(report.browserResult.result.summary));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
 try{
  report.runs=runs;report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();
  await fs.mkdir(path.join(output,'served'),{recursive:true});await fs.writeFile(path.join(output,'served/root.html'),html);
  for(const[name,bytes]of sources){const file=path.join(output,'source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }finally{
  await browser?.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
}
