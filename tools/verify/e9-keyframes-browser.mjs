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
const report={task:'E9-T15',status:'running',errors:[],development};
await fs.mkdir(output,{recursive:true});
let server,browser,context,page;
try{
 server=createServer(async(request,response)=>{
  try{let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
   if(name==='/favicon.ico'){response.writeHead(204).end();return;}
   if(development&&name==='/app.html')name='/index.html';
   const release=name.startsWith('/releases/');
   const file=release?path.resolve(root,'.'+name):path.resolve(web,'.'+name);
   if(release?!file.startsWith(path.join(root,'releases')+path.sep):!file.startsWith(web+path.sep))throw Error('path');
   const bytes=await fs.readFile(file);
   response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}).end(bytes);
  }catch{response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('pageerror',error=>report.errors.push(error.message));
 const url=`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__ready===true,null,{timeout:60000});
 if(!process.argv.includes('--probe-only')){
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.suite,{passed:127,failed:0});
 }
 const panel=page.locator('#session-keyframe-panel');
 await panel.locator('summary').click();await panel.locator('#session-keyframe-run').click();
 await page.waitForFunction(()=>!!globalThis.__sessionKeyframeReport,null,{timeout:600000});
 report.probe=await page.evaluate(()=>globalThis.__sessionKeyframeReport);
 assert.equal(report.probe.status,'passed');assert.equal(report.probe.deltas.length,2);
 assert.deepEqual(report.probe.depths,[1,2,3,4,5,6,7,8]);
 assert.equal(report.probe.rebase.depth,0);
 assert.equal(report.probe.restore.depth,2);
 assert.equal(report.probe.liveReplay.status,'Completed');
 assert.equal(report.probe.liveReplay.eventCursor,2);
 assert.equal(report.probe.liveReplay.digest,report.probe.witnesses.at(-1).digest);
 assert.ok(report.probe.restore.restoreMs<=5000&&report.probe.restore.maxStagedBytes<=64*1048576);
 assert.equal(report.probe.shared,true);
 assert.deepEqual(report.probe.witnesses.map(value=>value.label),['initial','delta-1','delta-2','rebase']);
 assert.ok(report.probe.witnesses.every(value=>/^[0-9a-f]{64}$/.test(value.digest)));
 assert.equal(new Set(report.probe.witnesses.map(value=>value.digest)).size,4);
 assert.deepEqual(report.probe.attacks.map(attack=>attack.name),
  ['unfinished-replay','chain-limit','changed-initial','missing-ancestor','corrupt-ancestor']);
 assert.ok(report.probe.jitStore.executedBlocks>0&&report.probe.jitStore.retiredViaJit>0
  &&report.probe.jitStore.directMarks>0);
 assert.ok(report.probe.historyGrowthBytes<=256*1048576);
 assert.ok([...report.probe.deltas,report.probe.rebase].every(value=>value.pauseMs<=5000
  &&value.maxStagedBytes<=64*1048576));
 assert.match(await page.locator('#session-keyframe-pip').getAttribute('class'),/\blive\b/);
 assert.match(await page.locator('.cap',{hasText:'Incremental RAM keyframes'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 assert.deepEqual(report.errors,[]);
 await panel.screenshot({path:path.join(output,'browser.png')});
 report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await context?.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
 await context?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,probe:report.probe,failure:report.failure,errors:report.errors}));}
