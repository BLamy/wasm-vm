#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,sha256} from './virgl-command/fixtures.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--node-only','--mutation'].includes(process.argv[i]));assert.ok(process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);assert.ok(!options.mutation||['upload-limit'].includes(options.mutation));
assert.ok(!options['node-only']||options['node-only']==='true');
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sourcePaths=[
  'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/float-images.mjs', 'renderer/virgl-command/packed-float-images.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/cache.mjs',
  'renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/vertex-constants.mjs',
  'renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
  'renderer/virgl-shader/bridge.c','renderer/virgl-shader/bridge.h','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/checked_upstream.c','renderer/virgl-shader/UPSTREAM.json',
  'tools/virgl-command/fixtures.mjs','tools/verify-virgl-vertex-constants.mjs',
 'renderer/virgl-command/color-images.mjs'];
const report={schema:1,task:'E6-T11d1',status:'running',guestExecution:false,productionNegotiation:false,
  boundary:'Physical ordinary128-vector vertex-bank prerequisite; production negotiation remains disabled.',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),command:[process.execPath,...process.argv.slice(1)],
  host:{platform:process.platform,arch:process.arch,release:os.release(),node:process.version},
  startedAt:new Date().toISOString(),sources:[],servedFiles:[],browserErrors:{console:[],page:[],requests:[]}};
const served=new Map();let browser,page,server;
try{
  const sources=new Map();
  for(const file of sourcePaths){const b=await fs.readFile(path.join(repo,file));sources.set(file,b);report.sources.push({path:file,bytes:b.length,sha256:sha256(b)});}
  if(!options['node-only']){
    if(options.mutation){
      const file='renderer/virgl-command/state.mjs',before=sources.get(file).toString();
      const changes={'upload-limit':['const uploadCount = Math.min(activeCount, guestConstantLimit);','const uploadCount = Math.min(activeCount, 46);']};
      const[needle,replacement]=changes[options.mutation];assert.equal(before.split(needle).length,2,'mutation must touch exactly one boundary');
      const bytes=Buffer.from(before.replace(needle,replacement));sources.set(file,bytes);await fs.writeFile(path.join(output,'mutation-source.mjs'),bytes);
      report.mutation={mode:options.mutation,path:file,originalSha256:sha256(Buffer.from(before)),servedSha256:sha256(bytes),needle,replacement};
    }
    const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Ordinary128-vector vertex constants</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Ordinary128-vector vertex constants</h1><p>Highest-slot MOV/ADD/MUL/MAD · complete active prefixes · owned banks and contexts · asynchronous physical GPU proof</p><p id="status">Checking high-index constants and independent physical pixels…</p><canvas id="gpu" width="16" height="16"></canvas><pre id="result"></pre>');
    const endpoints=new Map([['/',{bytes:html,type:'text/html'}],
      ...[...sources].filter(([name])=>name.startsWith('renderer/')&&(name.endsWith('.mjs')||name.endsWith('.wasm'))).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
    server=createServer((request,response)=>{const name=new URL(request.url,'http://localhost').pathname;
      if(name==='/favicon.ico'){response.writeHead(204).end();return;}
      const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
      served.set(name,{path:name,bytes:item.bytes.length,sha256:sha256(item.bytes)});response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
    });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const{chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
    const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
    assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(s=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(s)));
    report.browser={executable:chrome,sha256:sha256(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
    const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    let timer;try{
      report.browserResult=await Promise.race([page.evaluate(async()=>{
        try{const module=await import('/renderer/virgl-command/tests/vertex-constants.mjs'),result=await module.runBrowserVertexAcceptance();
          document.querySelector('#status').textContent='Passed: high vertex constants, exact pixels, isolated owners and actual fences';
          document.querySelector('#result').textContent=JSON.stringify({status:result.status,gpu:result.gpu,frames:result.records.length,jobs:result.jobs,assertions:result.assertions.length},null,2);
          return{status:'passed',result};
        }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return{status:'failed',error:{message:error.message,stack:error.stack}};}
      }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('vertex hardware proof exceeded240 seconds')),240000);})]);
    }finally{clearTimeout(timer);}
    if(report.browserResult.status==='passed'){
      const result=report.browserResult.result,pixels=Buffer.from(result.rawPixelsBase64,'base64');delete result.rawPixelsBase64;
      assert.equal(pixels.length,result.rawBytes);assert.equal(sha256(pixels),result.rawSha256);await fs.writeFile(path.join(output,'constants.rgba'),pixels);
      report.physicalPixels={path:'constants.rgba',bytes:pixels.length,sha256:sha256(pixels),format:'raw RGBA8, ordered16x16 high-constant draws'};
    }
    const coverage=await cdp.send('Profiler.takePreciseCoverage');const scripts=['resources.mjs','decoder.mjs','state.mjs','cache.mjs','constant-domain.mjs'].map(name=>{
      const source='renderer/virgl-command/'+name,matches=coverage.result.filter(s=>s.url.endsWith('/'+source));assert.equal(matches.length,1,'coverage must name served runtime '+source);return{source,sha256:sha256(sources.get(source)),coverage:matches[0]};
    });await fs.writeFile(path.join(output,'browser-coverage.json'),JSON.stringify({schema:1,scripts},null,2)+'\n');report.browserCoverage={path:'browser-coverage.json',sha256:sha256(await fs.readFile(path.join(output,'browser-coverage.json')))};
    await cdp.send('Profiler.stopPreciseCoverage');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha256(await fs.readFile(path.join(output,'browser.png')))};
    assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
  }
  for(const s of report.sources)assert.equal(sha256(await fs.readFile(path.join(repo,s.path))),s.sha256,'source drift '+s.path);
  report.status='passed';console.log('Ordinary vertex constant-bank acceptance passed'+(options['node-only']?' (native keys)':' (hardware WebGL2)'));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));}
