#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),opts={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--mutation'].includes(process.argv[i]));opts[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(opts.output);assert.ok(!opts.mutation||opts.mutation==='vs-blue');
const output=path.resolve(opts.output);await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),runtimeHead='365b3cf3d076637c347c7e9802420f847d09fbed';
const test='renderer/virgl-command/tests/standard-state-boundaries.mjs';
const paths=[test,...['state','resources','decoder','constant-domain','cache'].map(n=>'renderer/virgl-command/'+n+'.mjs'),
 'renderer/virgl-shader/standard.mjs','renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'];
const sources=new Map(),report={schema:1,task:'E6-T11d5',runtimeHead,gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:'running',sources:[],served:[],browserErrors:[]};
let browser,server,page;
try{
 for(const p of paths){const b=await fs.readFile(path.join(root,p));sources.set(p,b);report.sources.push({path:p,bytes:b.length,sha256:sha(b)});if(p!==test&&!p.includes('/build/'))assert.equal(sha(execFileSync('git',['show',runtimeHead+':'+p],{cwd:root})),sha(b),'frozen runtime source');}
 const extra=await fs.readFile(path.join(root,'evidence/virgl-standard-state/verifier/omission-probe-addition.mjs')); sources.set(test,Buffer.concat([sources.get(test),extra])); report.probeHarness={originalSha256:report.sources.find(x=>x.path===test).sha256,servedSha256:sha(sources.get(test))};
 const {predict,metadataAttacks}=await import(pathToFileURL(path.join(root,test)));
 const plans=[0x38f27cd1,0xba29ad44].map(predict);await fs.writeFile(path.join(output,'predictions.json'),JSON.stringify(plans,null,2)+'\n');
 const {createVirglStandardShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/standard.mjs')));report.nodeAttacks=metadataAttacks(await createVirglStandardShaderBridge());
 if(opts.mutation){const p='renderer/virgl-command/state.mjs',before=sources.get(p).toString(),needle='const lanes = ["v.r", "v.g", "v.b", "v.a", "0.0", "1.0"];',replacement='const lanes = standard && stage === 0 ? ["v.r", "v.g", "v.r", "v.a", "0.0", "1.0"] : ["v.r", "v.g", "v.b", "v.a", "0.0", "1.0"];';assert.equal(before.split(needle).length,2);const changed=Buffer.from(before.replace(needle,replacement));sources.set(p,changed);await fs.writeFile(path.join(output,'mutation-source.mjs'),changed);report.mutation={path:p,needle,replacement,originalSha256:sha(Buffer.from(before)),servedSha256:sha(changed)};}
 const served=new Set();server=createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Fresh standard state critic</title><h1>Fresh standard state critic</h1><canvas width="8" height="8"></canvas><pre id="result">Running literal shader/texture predictions</pre>');return;}if(p==='/favicon.ico'){res.writeHead(204).end();return;}const name=p.slice(1),b=sources.get(name);if(!b){res.writeHead(404).end();return;}served.add(name);res.writeHead(200,{'Content-Type':name.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store'}).end(b);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs'))),executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await chromium.launch({executablePath:executable,headless:false,args:['--enable-gpu']});const session=await browser.newBrowserCDPSession(),sys=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');assert.equal(sys.gpu.featureStatus.webgl2??sys.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(a=>/swiftshader|llvmpipe|softpipe|--disable-gpu(?:$|=)/i.test(a)));report.browser={executable,sha256:sha(await fs.readFile(executable)),version:browser.version(),gpu:sys.gpu,commandLine:command.arguments};
 const context=await browser.newContext();page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.browserErrors.push(m.text());});await page.goto('http://127.0.0.1:'+server.address().port+'/');const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 report.browserResult=await page.evaluate(async({plans,test})=>{try{const t=await import('/'+test),r=await t.runOmissionProbe(plans);window.__criticStandardState=r;document.querySelector('#result').textContent=JSON.stringify({status:r.status,gpu:r.gpu,cases:r.cases.length},null,2);return {status:r.status,result:r};}catch(e){document.querySelector('#result').textContent=e.message;return {status:'failed',error:{message:e.message,stack:e.stack},partial:window.__criticStandardState};}}, {plans,test});
 const coverage=await cdp.send('Profiler.takePreciseCoverage');const rows=[];for(const p of paths.filter(p=>p.endsWith('.mjs'))){const found=coverage.result.filter(x=>x.url.endsWith('/'+p));if(found.length){assert.equal(found.length,1);rows.push({source:p,sha256:sha(sources.get(p)),coverage:found[0]});}}
 await fs.writeFile(path.join(output,'browser-coverage.json'),JSON.stringify({schema:1,scripts:rows},null,2)+'\n');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.coverageSha256=sha(await fs.readFile(path.join(output,'browser-coverage.json')));report.screenshotSha256=sha(await fs.readFile(path.join(output,'browser.png')));report.served=[...served].map(p=>({path:p,sha256:sha(sources.get(p))}));assert.deepEqual(report.browserErrors,[]);
 assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);report.status='passed';console.log('Omitted active native declarations were rejected before draw in both probes.');
}catch(e){report.status='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;console.error(e.message);}finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));}
