#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,sha256} from '../virgl-command/fixtures.mjs';
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert.ok(['--output','--chrome','--seeds','--sabotage'].includes(args[i])&&args[i+1]);options[args[i].slice(2)]=args[i+1];}
assert.ok(options.output,'--output required');
const seeds=options.seeds?.split(',').map(Number)??[14241,33485,58393];
assert.ok(seeds.length===3&&new Set(seeds).size===3&&seeds.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff));
assert.ok(options.sabotage===undefined||options.sabotage==='cube-async-layer');
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sourceList=JSON.parse(await fs.readFile(path.join(repo,'tools/virgl-native-dimensional/sources.json')));
async function collect(dir){for(const item of await fs.readdir(path.join(repo,dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())await collect(name);else if(/\.(js|wasm)$/.test(item.name))sourceList.push(name);}}
await collect('target/virgl-desktop-submit/pkg');
const html='<!doctype html><meta charset="utf-8"><title>Original dimensional storage</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Original volume, cube and array RGBA8 storage</h1><p>Isolated host selection; production acceleration remains disabled.</p><canvas id="gpu" width="64" height="64"></canvas><p id="status">Running original byte and hardware checks...</p><pre id="results"></pre>';
const report={schema:1,task:'E6-T11d56',status:'running',command:[process.execPath,...process.argv.slice(1)],
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
 trackedChanges:execFileSync('git',['status','--porcelain','--',...sourceList],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean),
 host:{platform:process.platform,architecture:process.arch,release:os.release(),node:process.version},
 startedAt:new Date().toISOString(),seeds,productionAuthority:false,actualLinuxGuest:false,sources:[],servedFiles:[],browserErrors:{console:[],page:[],requests:[]}};
const sources=new Map(),served=new Map();let browser,page,server;
try{
 for(const name of sourceList){const bytes=await fs.readFile(path.join(repo,name));sources.set(name,bytes);report.sources.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});}
 const servedSources=new Map(sources);
 if(options.sabotage){
  const name='renderer/virgl-command/resources.mjs',before=sources.get(name).toString(),anchor='gl.TEXTURE_CUBE_MAP_POSITIVE_X + layout.box.z + layer';
  assert.equal(before.split(anchor).length,2,'unique actual cube read attachment');
  const body=Buffer.from(before.replace(anchor,'gl.TEXTURE_CUBE_MAP_POSITIVE_X + ((layout.box.z + layer + (gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) ? 1 : 0)) % 6)'));
  servedSources.set(name,body);await fs.writeFile(path.join(output,'mutant-resource-source.mjs'),body);
  report.sabotage={kind:options.sabotage,path:name,originalSha256:sha256(sources.get(name)),servedSha256:sha256(body)};
 }
 const endpoints=new Map([['/',{bytes:Buffer.from(html),type:'text/html'}],
  ...sourceList.filter(name=>/\.(m?js|wasm)$/.test(name)).map(name=>['/'+name,{bytes:servedSources.get(name),type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
 server=createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const item=endpoints.get(pathname);if(!item){response.writeHead(404).end('not found');return;}
  served.set(pathname,{path:pathname,bytes:item.bytes.length,sha256:sha256(item.bytes)});
  response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const chrome=options.chrome??process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const{chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
 browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
 const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),commandLine=await session.send('Browser.getBrowserCommandLine');
 const feature=Object.hasOwn(system.gpu.featureStatus,'webgl2')?'webgl2':'webgl';
 assert.equal(system.gpu.featureStatus[feature],'enabled');
 assert.ok(!commandLine.arguments.some(arg=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(arg)));
 report.browser={executable:chrome,sha256:sha256(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:commandLine.arguments,webglFeature:feature};
 const context=await browser.newContext({viewport:{width:1120,height:920},deviceScaleFactor:1});page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});
 page.on('pageerror',e=>report.browserErrors.page.push(e.message));
 page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
 const coverage=await context.newCDPSession(page);await coverage.send('Profiler.enable');await coverage.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 const begin=performance.now();let timer;
 try{
  report.browserResult=await Promise.race([page.evaluate(async seeds=>{
   try{
    const wasm=await import('/target/virgl-desktop-submit/pkg/wasm_vm_wasm.js');await wasm.default();
    const{createVirglStandardDimensionalSubmitBridge,createVirglSubmitBridge}=await import('/renderer/virgl-command/control-bridge.mjs');
    const{runNativeDimensionalAcceptance}=await import('/renderer/virgl-command/tests/native-dimensional-acceptance.mjs');
    const result=await runNativeDimensionalAcceptance({seeds,WasmVirglSubmitProof:wasm.WasmVirglSubmitProof,createVirglStandardDimensionalSubmitBridge,createVirglSubmitBridge});document.querySelector('#status').textContent='Passed: original dimensional words and actual GPU output';
    document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return{status:'passed',result};
   }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;document.querySelector('#results').textContent=error.stack;
    return{status:'failed',error:{message:error.message,stack:error.stack},partial:window.__desktopProof??null,point:window.__desktopActive?.()??null};}
  },seeds),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('dimensional proof exceeded180seconds')),180000);})]);
 }finally{clearTimeout(timer);}
 report.browserMs=performance.now()-begin;
 const rawCoverage=await coverage.send('Profiler.takePreciseCoverage');
 const scripts=['renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/control-bridge.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/tests/native-dimensional-acceptance.mjs','tools/virgl-dimensional-storage/fixtures.mjs'].map(name=>{
  const matches=rawCoverage.result.filter(script=>script.url.endsWith('/'+name));assert.equal(matches.length,1,'served coverage '+name);
  return{source:name,sha256:sha256(servedSources.get(name)),coverage:matches[0]};
 });
 const coverageBytes=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),coverageBytes);
 report.browserCoverage={path:'browser-coverage.json',sha256:sha256(coverageBytes)};await coverage.send('Profiler.stopPreciseCoverage');
 report.browserResultSha256=sha256(JSON.stringify(report.browserResult));
 assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);assert.equal(report.browserResult.result.status,'passed');
 assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
 await page.screenshot({path:path.join(output,'browser.png'),fullPage:true,timeout:10000});report.screenshot={path:'browser.png',sha256:sha256(await fs.readFile(path.join(output,'browser.png')))};
 for(const source of report.sources)assert.equal(sha256(await fs.readFile(path.join(repo,source.path))),source.sha256,'source changed during capture '+source.path);
 report.status='passed';console.log('Hardware original dimensional storage passed ('+report.browserMs.toFixed(0)+'ms)');
}catch(error){
 report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);
 if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true,timeout:3000}).then(async()=>{report.failureScreenshot={path:'failure.png',sha256:sha256(await fs.readFile(path.join(output,'failure.png')))};}).catch(()=>{});
}finally{
 for(const[name,bytes]of sources){const destination=path.join(output,'source',name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);}
 report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
}
