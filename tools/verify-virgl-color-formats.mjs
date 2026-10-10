#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,sha256} from './virgl-command/fixtures.mjs';
import {loadColorFixtures} from './virgl-command/color-fixtures.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--node-only','--sabotage'].includes(process.argv[i]));assert.ok(process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);assert.ok(!options.sabotage||['channel-order','destination-alpha'].includes(options.sabotage));
assert.ok(!options['node-only']||options['node-only']==='true');
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sourcePaths=[
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs',
  'renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/color-formats.mjs',
  'renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
  'renderer/virgl-shader/bridge.c','renderer/virgl-shader/UPSTREAM.json',
  'renderer/virgl-shader/vendor/src/virgl_protocol.h','renderer/virgl-shader/vendor/src/virgl_hw.h',
  'renderer/virgl-shader/vendor/src/gallium/auxiliary/util/u_format.yaml',
  'tools/virgl-command/fixtures.mjs','tools/virgl-command/resource-fixtures.mjs','tools/virgl-command/state-fixtures.mjs','tools/virgl-command/draw-fixtures.mjs',
  'tools/virgl-command/color-fixtures.mjs','tools/verify-virgl-color-formats.mjs',
  'tools/verify-virgl-color-formats.sh','tools/virgl-command/colors-receipt.py','tools/virgl-command/colors-cold.py',
  'Makefile','renderer/virgl-command/README.md','renderer/virgl-command/resources-README.md','renderer/virgl-command/state-README.md',
 'renderer/virgl-command/color-images.mjs'];
const report={schema:1,task:'E6-T12g2',status:'running',guestExecution:false,
  boundary:'Original selected color packets and independent synthetic physical GL sampling/draw/readback; no full guest offload.',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),command:[process.execPath,...process.argv.slice(1)],
  host:{platform:process.platform,arch:process.arch,release:os.release(),node:process.version},
  startedAt:new Date().toISOString(),sources:[],inputs:[],servedFiles:[],browserErrors:{console:[],page:[],requests:[]}};
const served=new Map();let browser,page,server;
try{
  const {fixtures,sources:inputs}=await loadColorFixtures();report.inputs=inputs;
  const fixtureBytes=Buffer.from(JSON.stringify(fixtures));report.fixtureTransport={bytes:fixtureBytes.length,sha256:sha256(fixtureBytes)};
  const sources=new Map();
  for(const file of sourcePaths){const b=await fs.readFile(path.join(repo,file));sources.set(file,b);report.sources.push({path:file,bytes:b.length,sha256:sha256(b)});}
  const {runNativeColorAcceptance}=await import(pathToFileURL(path.join(repo,'renderer/virgl-command/tests/color-formats.mjs')));
  report.native=runNativeColorAcceptance();assert.equal(report.native.status,'passed');
  if(!options['node-only']){
    if(options.sabotage){
      const file=options.sabotage==='channel-order'?'renderer/virgl-command/resources.mjs':'renderer/virgl-command/state.mjs';
      const before=sources.get(file).toString();
      const needle=options.sabotage==='channel-order'?'bytes[target] = r; bytes[target + 1] = g; bytes[target + 2] = b;':'gl.colorMask(...mask);';
      const replacement=options.sabotage==='channel-order'?'bytes[target] = b; bytes[target + 1] = g; bytes[target + 2] = r;':'gl.colorMask(mask[0], mask[1], mask[2], true);';
      assert.equal(before.split(needle).length,2,'source fault must touch exactly one boundary');
      const changed=Buffer.from(before.replace(needle,replacement));sources.set(file,changed);
      await fs.writeFile(path.join(output,'fault-source.mjs'),changed);
      report.sabotage={mode:options.sabotage,path:file,originalSha256:sha256(Buffer.from(before)),servedSha256:sha256(changed),needle,replacement};
    }
    const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Required color storage proof</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Required guest color storage</h1><p>Original packets · native BGRX8 / RGBA8 / 10-bit storage · physical sampling and alpha · isolated proof</p><p id="status">Checking hardware color storage…</p><canvas id="gpu" width="64" height="64"></canvas><pre id="result"></pre>');
    const endpoints=new Map([['/',{bytes:html,type:'text/html'}],['/fixtures.json',{bytes:fixtureBytes,type:'application/json'}],
      ...[...sources].filter(([name])=>name.startsWith('renderer/')&&(name.endsWith('.mjs')||name.endsWith('.wasm'))).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
    server=createServer((request,response)=>{
      const name=new URL(request.url,'http://localhost').pathname;
      if(name==='/favicon.ico'){response.writeHead(204).end();return;}
      const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
      served.set(name,{path:name,bytes:item.bytes.length,sha256:sha256(item.bytes)});
      response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
    browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
    const browserSession=await browser.newBrowserCDPSession(),system=await browserSession.send('SystemInfo.getInfo'),commandLine=await browserSession.send('Browser.getBrowserCommandLine');
    const feature=Object.hasOwn(system.gpu.featureStatus,'webgl2')?'webgl2':'webgl';assert.equal(system.gpu.featureStatus[feature],'enabled');
    assert.ok(!commandLine.arguments.some(s=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(s)));
    report.browser={executable:chrome,sha256:sha256(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:commandLine.arguments};
    const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
    const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    let timer;
    try{
      report.browserResult=await Promise.race([page.evaluate(async()=>{
        try{
          const module=await import('/renderer/virgl-command/tests/color-formats.mjs');
          const fixtures=await(await fetch('/fixtures.json')).json(),native=module.runNativeColorAcceptance(),result=await module.runBrowserColorAcceptance(fixtures);
          document.querySelector('#status').textContent='Passed: exact channels, native 10-bit precision and destination alpha';
          document.querySelector('#result').textContent=JSON.stringify({status:result.status,renderer:result.renderer,originals:result.originals.map(x=>({workload:x.workload??'kmscube RGBA upload',format:x.metadata?.format??67,event:x.citation.event})),formats:result.formats.map(x=>({format:x.format,bits:x.componentBits,physicalRgba:x.physicalRgba})),draws:result.draws.map(x=>({format:x.format,destinationAlphaBlend:x.destinationAlphaBlend})),assertions:result.assertions.length},null,2);
          return{status:'passed',native,result};
        }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return{status:'failed',error:{message:error.message,stack:error.stack}};}
      }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('color hardware proof exceeded 120 seconds')),120000);})]);
    }finally{clearTimeout(timer);}
    const coverage=await cdp.send('Profiler.takePreciseCoverage');
    const scripts=['resources.mjs','decoder.mjs','state.mjs'].map(name=>{
      const source='renderer/virgl-command/'+name,matches=coverage.result.filter(s=>s.url.endsWith('/'+source));
      assert.equal(matches.length,1,'coverage must name the served runtime '+source);
      return{source,sha256:sha256(sources.get(source)),coverage:matches[0]};
    });
    await fs.writeFile(path.join(output,'browser-coverage.json'),JSON.stringify({schema:1,scripts},null,2)+'\n');report.browserCoverage={path:'browser-coverage.json',sha256:sha256(await fs.readFile(path.join(output,'browser-coverage.json')))};
    await cdp.send('Profiler.stopPreciseCoverage');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha256(await fs.readFile(path.join(output,'browser.png')))};
    assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
    assert.deepEqual(report.browserResult.native,report.native,'Node and browser native guards differ');assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
  }
  for(const s of [...report.sources,...report.inputs])assert.equal(sha256(await fs.readFile(path.join(repo,s.path))),s.sha256,'source drift '+s.path);
  report.status='passed';console.log('Required color format proof passed'+(options['node-only']?' (Node guards)':' (hardware WebGL2)'));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));}
