#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const development=process.argv.includes('--development');
const web=path.join(root,development?'web':'web/dist');
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
const report={task:'E9-T16',status:'running',errors:[],notFound:[],badMimes:[],development};
await fs.mkdir(output,{recursive:true});
let server,browser,context,page;
try{
 server=createServer(async(request,response)=>{
  try{let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
   if(name==='/favicon.ico'){response.writeHead(204).end();return;}
   if(development&&name==='/app.html')name='/index.html';
   if(name==='/artifacts.json'){
    const artifacts=JSON.parse(await fs.readFile(path.join(web,'artifacts.json'),'utf8'));
    artifacts.artifacts.kernel.url='/__r2_kernel';
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(artifacts));return;
   }
   if(name.startsWith('/releases/kernel/')){response.writeHead(404).end();return;}
   if(name==='/__r2_kernel')name='/releases/kernel/6.6.63/Image';
   const release=name.startsWith('/releases/');
   const file=release?path.resolve(root,'.'+name):path.resolve(web,'.'+name);
   if(release?!file.startsWith(path.join(root,'releases')+path.sep):!file.startsWith(web+path.sep))throw Error('path');
   const bytes=await fs.readFile(file);
   response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}).end(bytes);
  }catch(error){report.notFound.push({path:request.url,error:String(error)});response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page=await context.newPage();
 page.on('response',response=>{const type=response.headers()['content-type'];
  if(type==='application/octet-stream'&&/\.m?js(?:\?|$)/.test(response.url()))report.badMimes.push(response.url());});
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__ready===true,null,{timeout:60000});
 if(!process.argv.includes('--probe-only')){
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.suite,{passed:127,failed:0});
 }
 const panel=page.locator('#session-seek-panel');
 await panel.locator('summary').click();await panel.locator('#session-seek-run').click();
 await page.waitForFunction(()=>!!globalThis.__sessionSeekReport,null,{timeout:600000});
 report.probe=await page.evaluate(()=>globalThis.__sessionSeekReport);
 assert.equal(report.probe.status,'passed');
 assert.deepEqual(report.probe.checked.map(value=>value.label),
  ['before-event','after-event','after-second-event','first-gap','post-rebase-gap']);
 assert.ok(report.probe.checked.every(value=>/^[0-9a-f]{64}$/.test(value.expectedDigest)));
 assert.equal(report.probe.seededRequests,100);
 assert.equal(report.probe.cancelled,100);
 assert.ok(report.probe.cancellationMs<=250);
 assert.equal(report.probe.restoreCancelled,'cancelled');
 assert.ok(report.probe.restoreCancelMs<=250);
 assert.equal(report.probe.publicationsDuringOverlap,1);
 assert.ok(/^[0-9a-f]{64}$/.test(report.probe.winnerDigest));
 assert.equal(report.probe.winner.transition,report.probe.winnerTarget);
 assert.equal(await panel.locator('#session-seek-render').textContent(),report.probe.latestRender);
 assert.match(await page.locator('#session-seek-pip').getAttribute('class'),/\blive\b/);
 assert.match(await page.locator('.cap',{hasText:'Seeking and reverse-step'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 assert.deepEqual(report.errors,[]);
 assert.deepEqual(report.notFound,[]);
 assert.deepEqual(report.badMimes,[]);
 await panel.screenshot({path:path.join(output,'browser.png')});
 report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await context?.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
 await context?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,probe:report.probe,failure:report.failure,errors:report.errors,notFound:report.notFound,badMimes:report.badMimes}));}
