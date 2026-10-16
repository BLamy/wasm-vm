#!/usr/bin/env node
// Actual built renderer modules, original qualified Wasm queues and physical GPU bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--chrome','--runtime-root','--seed'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);const output=path.resolve(options.output),runtime=path.resolve(options['runtime-root']??path.join(repo,'web/dist')),seed=Number(options.seed??42);
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output);await fs.mkdir(path.join(output,'bytes'));
const sources=new Map(),origins=new Map(),runs=[],served=new Map(),artifacts=new Map(),errors={console:[],page:[],requests:[]};
async function source(name){
  if(sources.has(name))return;
  const shipped=name==='gpu-checkpoint-build.js'||name.startsWith('renderer/')&&!name.includes('/tests/');
  const filename=path.join(shipped?runtime:repo,name),bytes=await fs.readFile(filename);
  if(shipped&&name!=='gpu-checkpoint-build.js'){
    const original=await fs.readFile(path.join(repo,name)).catch(error=>{if(error.code==='ENOENT'&&name.startsWith('renderer/virgl-shader/build/wasm/'))return null;throw error;});
    if(original)assert.equal(sha(bytes),sha(original),'built module must match its current source: '+name);
  }
  sources.set(name,bytes);origins.set(name,shipped?'deployable web renderer':'owned test/proof source');
  if(/\.m?js$/.test(name))for(const match of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));
}
for(const name of ['renderer/virgl-command/tests/production-color-checkpoint.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','gpu-checkpoint-build.js'])await source(name);
for(const name of await fs.readdir(path.join(repo,'target/virgl-production/pkg')))if(/\.(m?js|wasm)$/.test(name))await source('target/virgl-production/pkg/'+name);
assert.ok(sources.has('target/virgl-production/pkg/wasm_vm_wasm.js'),'actual qualified proof build is required');
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Omarchy color checkpoint</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Omarchy color checkpoint</h1><p>Original Wasm queues, full physical R8 reads, a fresh GPU context and unchanged memory ceilings.</p><p id="status">Running…</p><pre id="results"></pre>');
const report={schema:'omarchy-color-checkpoint-hardware-v1',task:'E5.5-T05c1',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),command:[process.execPath,...process.argv.slice(1)],runtimeRoot:runtime,seed,startedAt:new Date().toISOString(),browserErrors:errors,sources:[...sources].map(([name,bytes])=>({path:name,origin:origins.get(name),bytes:bytes.length,sha256:sha(bytes)}))};
let server,browser,page;
try{
  const endpoints=new Map([['/',{bytes:html,type:'text/html'}],...[...sources].filter(([name])=>/\.(m?js|wasm|json)$/.test(name)).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'text/javascript'}])]);
  server=createServer((request,response)=>{
    const name=new URL(request.url,'http://localhost').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
    served.set(name,{path:name,bytes:item.bytes.length,sha256:sha(item.bytes)});response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs'))),chrome=options.chrome??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(value=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(value)));
  report.browser={executable:chrome,sha256:sha(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
  const context=await browser.newContext({viewport:{width:1100,height:850},deviceScaleFactor:1});page=await context.newPage();
  await page.exposeFunction('__recordColorCheckpointBytes',async request=>{
    const {name,offset,total,base64}=request;assert.match(name,/^[A-Za-z0-9-]+\.(bin|wvgjrn)$/);assert.ok(Number.isSafeInteger(total)&&total>0&&total<=128*1024*1024);assert.ok(Number.isSafeInteger(offset)&&offset>=0&&offset<total);assert.ok(typeof base64==='string'&&base64.length<=256*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(base64));
    let item=artifacts.get(name);
    if(!item){assert.equal(offset,0);item={name,path:'bytes/'+name,file:await fs.open(path.join(output,'bytes',name),'wx'),hash:createHash('sha256'),written:0,total};artifacts.set(name,item);}
    assert.equal(item.total,total);assert.equal(item.written,offset);assert.ok(item.file,'completed byte artifact cannot be changed');
    const bytes=Buffer.from(base64,'base64');assert.equal(bytes.toString('base64'),base64);assert.ok(bytes.length>0&&bytes.length<=total-offset);
    await item.file.writeFile(bytes);item.hash.update(bytes);item.written+=bytes.length;
    if(item.written!==total)return{complete:false,written:item.written};
    await item.file.close();item.file=null;item.sha256=item.hash.digest('hex');return{complete:true,path:item.path,bytes:total,sha256:item.sha256};
  });
  await page.exposeFunction('__recordProductionCriticRun',async(index,body)=>{
    assert.equal(index,runs.length);const bytes=Buffer.from(body),packed=gzipSync(bytes,{level:9}),name='run-'+String(index).padStart(4,'0')+'.json.gz';await fs.writeFile(path.join(output,name),packed);
    const pin={path:name,bytes:bytes.length,sha256:sha(bytes),gzipBytes:packed.length,gzipSha256:sha(packed)};runs.push(pin);return pin;
  });
  page.on('console',message=>{if(message.type()==='error')errors.console.push(message.text());});page.on('pageerror',error=>errors.page.push(error.message));page.on('requestfailed',request=>errors.requests.push({url:request.url(),error:request.failure()?.errorText}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  const profiler=await context.newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  report.result=await page.evaluate(async seed=>{
    try{
      const runtimeIdentity=await import('/gpu-checkpoint-build.js'),wasm=await import('/target/virgl-production/pkg/wasm_vm_wasm.js');await wasm.default();
      const result=await(await import('/renderer/virgl-command/tests/production-color-checkpoint.mjs')).runProductionColorCheckpoint({seed,WasmVirglSubmitProof:wasm.WasmVirglSubmitProof});
      document.querySelector('#status').textContent='Hardware color checkpoint '+result.status;document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return{...result,runtimeIdentity:{...runtimeIdentity}};
    }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return{status:'failed',failure:{message:error.message,stack:error.stack}};}
  },seed);
  const coverage=await profiler.send('Profiler.takePreciseCoverage'),scripts=[];
  for(const [name,bytes]of sources)if(/\.m?js$/.test(name)){const matches=coverage.result.filter(script=>script.url.endsWith('/'+name));if(matches.length){assert.equal(matches.length,1);scripts.push({source:name,sha256:sha(bytes),sourceBody:bytes.toString(),coverage:matches[0]});}}
  const raw=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),raw);report.browserCoverage={path:'browser-coverage.json',sha256:sha(raw)};await profiler.send('Profiler.stopPreciseCoverage');
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(path.join(output,'browser.png')))};
  assert.deepEqual(errors,{console:[],page:[],requests:[]});assert.equal(report.result.status,'passed','actual hardware color checkpoint matrix: '+JSON.stringify(report.result.summary??report.result.failure));assert.equal(report.result.summary.runs,3);report.status='passed';console.log(JSON.stringify(report.result.summary));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  try{
    for(const item of artifacts.values())if(item.file){await item.file.close();item.file=null;}
    report.artifacts=[...artifacts.values()].map(({name,path,total,written,sha256})=>({name,path,total,written,sha256,complete:written===total&&Boolean(sha256)}));
    report.runs=runs;report.served=[...served.values()];report.finishedAt=new Date().toISOString();
    for(const [name,bytes]of sources){const file=path.join(output,'source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  }finally{await browser?.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
