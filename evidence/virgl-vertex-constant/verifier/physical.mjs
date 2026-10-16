import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const mutation=process.argv[3]==='sabotage';const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=new Map(),errors={console:[],page:[],requests:[]};
const state='renderer/virgl-command/state.mjs',original=await fs.readFile(state);
const needle='const uploadCount = Math.min(activeCount, guestConstantLimit);',replacement='const uploadCount = Math.min(activeCount, 93);';
assert.equal(original.toString().split(needle).length,2);
const servedState=mutation?Buffer.from(original.toString().replace(needle,replacement)):original;
if(mutation)await fs.writeFile(path.join(out,'mutated-state.mjs'),servedState);
const html=Buffer.from('<!doctype html><title>Fresh vertex constant critic</title><h1>High swizzle and active-prefix proof</h1><canvas id="gpu" width="16" height="16"></canvas><pre id="result"></pre>');
const server=createServer(async(req,res)=>{
  const name=new URL(req.url,'http://127.0.0.1').pathname;
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
  if(!/^\/renderer\/[A-Za-z0-9_./-]+\.(mjs|wasm)$/.test(name)||name.includes('..')){res.writeHead(404).end();return;}
  try {
    const file=name.slice(1),raw=file===state?servedState:await fs.readFile(path.join(root,file));
    sources.set(file,{path:file,sha256:sha(raw),bytes:raw.length});
    res.writeHead(200,{'Content-Type':file.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store'}).end(raw);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
const report={task:'E6-T11d1',role:'fresh-verifier',sourceHead:'92c98c7361cad2518200bfa99765ed5895ef4f95',verificationHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mutation,errors};
try {
  const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');
  assert.ok(!command.arguments.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/i.test(a)));
  report.browser={version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
  const page=await browser.newPage({viewport:{width:950,height:750}});
  page.on('console',m=>{if(m.type()==='error')errors.console.push(m.text());});page.on('pageerror',e=>errors.page.push(e.message));page.on('requestfailed',r=>errors.requests.push(r.url()));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  report.result=await page.evaluate(async()=>{
    try {
      const {runVertexConstantBoundaries}=await import('/renderer/virgl-command/tests/vertex-constant-boundaries.mjs');
      const r=await runVertexConstantBoundaries(document.querySelector('#gpu').getContext('webgl2',{antialias:false,alpha:false}));
      document.querySelector('#result').textContent='Passed '+r.frames.length+' frames, '+r.assertions.length+' assertions';return r;
    } catch(e) {document.querySelector('#result').textContent=e.message;return{status:'failed',failure:{message:e.message,stack:e.stack}};}
  });
  await fs.writeFile(path.join(out,'coverage.json'),JSON.stringify(await cdp.send('Profiler.takePreciseCoverage'),null,2)+'\n');
  await page.screenshot({path:path.join(out,'browser.png'),fullPage:true});
  assert.deepEqual(errors,{console:[],page:[],requests:[]});
  if(mutation) {assert.equal(report.result.status,'failed');assert.match(report.result.failure.message,/high swizzle phase0 literal pixels/);}
  else assert.equal(report.result.status,'passed',report.result.failure?.message);
  report.status='passed';
} catch(e) {report.status='failed';report.failure={message:e.message,stack:e.stack};process.exitCode=1;}
finally {
  report.sources=[...sources.values()];report.mutationBinding=mutation?{path:state,originalSha256:sha(original),servedSha256:sha(servedState),needle,replacement}:null;
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({status:report.status,mutation,frames:report.result?.frames?.length,failure:report.failure??report.result?.failure}));
