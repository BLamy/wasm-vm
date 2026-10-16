#!/usr/bin/env node
// Owned headed hardware Chrome. The critic freezes served bytes, not mutable build outputs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--chrome','--schedules'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sources=new Map(),runs=[],served=new Map(),errors={console:[],page:[],requests:[]};
async function source(name){
  if(sources.has(name))return;const bytes=await fs.readFile(path.join(repo,name));sources.set(name,bytes);
  if(/\.m?js$/.test(name))for(const m of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
}
for(const name of ['renderer/virgl-command/tests/production-indexed-start.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'])await source(name);
for(const name of await fs.readdir(path.join(repo,'target/virgl-production/pkg')))if(/\.(m?js|wasm)$/.test(name))await source('target/virgl-production/pkg/'+name);
assert.ok(sources.has('target/virgl-production/pkg/wasm_vm_wasm.js'),'root-owned production proof build is required');
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Production GPU critic</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Production GPU critic</h1><p>Original qualified device, original DMA, indexed start hints and retained index spans.</p><canvas id="gpu" width="32" height="32"></canvas><p id="status">Running independent hardware probes…</p><pre id="results"></pre>');
const report={schema:'production-indexed-start-v1',task:'E6-T11d68',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),command:[process.execPath,...process.argv.slice(1)],startedAt:new Date().toISOString(),browserErrors:errors,sources:[...sources].map(([name,b])=>({path:name,bytes:b.length,sha256:sha(b)}))};
let server,browser,page;
try{
  const endpoints=new Map([['/',{bytes:html,type:'text/html'}],...[...sources].filter(([name])=>/\.(m?js|wasm)$/.test(name)).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
  server=createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
    served.set(name,{path:name,bytes:item.bytes.length,sha256:sha(item.bytes)});response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs'))),chrome=options.chrome??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));
  report.browser={executable:chrome,sha256:sha(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
  const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
  await page.exposeFunction('__recordProductionCriticRun',async(index,body)=>{assert.equal(index,runs.length);const bytes=Buffer.from(body),packed=gzipSync(bytes,{level:9}),name='run-'+String(index).padStart(4,'0')+'.json.gz';await fs.writeFile(path.join(output,name),packed);const pin={path:name,bytes:bytes.length,sha256:sha(bytes),gzipBytes:packed.length,gzipSha256:sha(packed)};runs.push(pin);return pin;});
  page.on('console',m=>{if(m.type()==='error')errors.console.push(m.text());});page.on('pageerror',e=>errors.page.push(e.message));page.on('requestfailed',r=>errors.requests.push({url:r.url(),error:r.failure()?.errorText}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  const profiler=await context.newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  report.result=await page.evaluate(async options=>{
    try{
      const wasm=await import('/target/virgl-production/pkg/wasm_vm_wasm.js');await wasm.default();
      const result=await(await import('/renderer/virgl-command/tests/production-indexed-start.mjs')).runProductionIndexedStart({...options,WasmVirglSubmitProof:wasm.WasmVirglSubmitProof});
      document.querySelector('#status').textContent='Original indexed-start hardware matrix '+result.status;document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return result;
    }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return {status:'failed',failure:{message:error.message,stack:error.stack},partial:window.__productionCriticReport??null,active:window.__productionCriticActive?.()??null};}
  },{schedules:options.schedules?.split(',').map(Number)??[0,1,2]});
  const coverage=await profiler.send('Profiler.takePreciseCoverage'),scripts=[];
  for(const [name,bytes]of sources)if(/\.m?js$/.test(name)){const matches=coverage.result.filter(s=>s.url.endsWith('/'+name));if(matches.length){assert.equal(matches.length,1);scripts.push({source:name,sha256:sha(bytes),sourceBody:bytes.toString(),coverage:matches[0]});}}
  const raw=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),raw);report.browserCoverage={path:'browser-coverage.json',sha256:sha(raw)};await profiler.send('Profiler.stopPreciseCoverage');
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(path.join(output,'browser.png')))};
  assert.deepEqual(errors,{console:[],page:[],requests:[]});if(report.result.status!=='passed')throw Error('Independent matrix failed: '+JSON.stringify({runs:report.result.summary?.runs,failures:report.result.summary?.failed?.map(r=>({name:r.name,message:r.failure?.message.slice(0,180)})),failure:report.result.failure}));report.status='passed';console.log(JSON.stringify(report.result.summary));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  try{report.runs=runs;report.served=[...served.values()];report.finishedAt=new Date().toISOString();for(const [name,bytes]of sources){const file=path.join(output,'source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
  finally{await browser?.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
