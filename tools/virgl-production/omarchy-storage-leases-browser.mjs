#!/usr/bin/env node
// Freeze the actual module graph and retain original native GPU test output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output,{recursive:false});
const sources=new Map(),served=new Set(),errors=[];
async function source(name) {
  if(sources.has(name))return;
  const bytes=await fs.readFile(path.join(repo,name));sources.set(name,bytes);
  if(/\.m?js$/.test(name))for(const match of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))
    await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));
}
const entry='renderer/virgl-command/tests/production-storage-leases.mjs';
await source(entry);
const report={status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),
  started:new Date().toISOString(),command:[process.execPath,...process.argv.slice(1)],errors};
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Production GPU storage leases</title><style>body{background:#16171d;color:#eee;font:16px system-ui;padding:30px}pre{white-space:pre-wrap}</style><h1>Production GPU storage leases</h1><canvas id="gpu" width="32" height="32"></canvas><pre id="result">Running…</pre>');
const server=createServer((request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname;
  if(name==='/favicon.ico'){response.writeHead(204).end();return;}
  const bytes=name==='/'?html:sources.get(name.slice(1));
  if(!bytes){response.writeHead(404).end();return;}
  served.add(name);response.writeHead(200,{'Content-Type':name==='/'?'text/html':'text/javascript','Cache-Control':'no-store'}).end(bytes);
});
let browser,page;
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  report.browser={version:browser.version(),headless:true};
  page=await browser.newPage({viewport:{width:1000,height:800}});
  page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  const session=await page.context().newCDPSession(page);await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  report.result=await page.evaluate(async entry=>{
    try {const result=await(await import('/'+entry)).runProductionStorageLeases();
      document.querySelector('#result').textContent=JSON.stringify(result,null,2);return result;
    }catch(error){document.querySelector('#result').textContent=error.stack;return {status:'failed',error:error.stack};}
  },entry);
  const coverage=await session.send('Profiler.takePreciseCoverage');await session.send('Profiler.stopPreciseCoverage');
  const bytes=Buffer.from(JSON.stringify(coverage,null,2)+'\n');await fs.writeFile(path.join(output,'coverage.json'),bytes);
  report.coverage={file:'coverage.json',sha256:sha(bytes)};
  await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(report.result.status,'passed',report.result.error);
  report.status='passed';console.log(JSON.stringify({status:report.status,assertions:report.result.assertions,hardware:report.result.hardware,rows:report.result.rows.map(row=>row.name)}));
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally {
  report.finished=new Date().toISOString();report.sources=[];
  for(const [name,bytes]of sources){const file=path.join(output,'source',name);await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,bytes);report.sources.push({name,bytes:bytes.length,sha256:sha(bytes),served:served.has('/'+name)});}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
