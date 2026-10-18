#!/usr/bin/env node
// Record the visible exact-boundary probe against real shipped Wasm, without guest/VM mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argument=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(argument('--output'));
const output=path.resolve(argument('--output')),development=process.argv.includes('--development'),remote=argument('--url');
if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const web=path.join(root,development?'web':'web/dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T09',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),errors:[],checks:{}};
await fs.mkdir(output,{recursive:false});let server,browser,context,page;
try{
  if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
  if(!remote){
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{try{
      let pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      if(development&&pathname==='/app.html')pathname='/index.html';
      const file=path.resolve(web,'.'+pathname);if(!file.startsWith(web+path.sep))throw Error('outside root');
      const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
        'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  report.url=new URL('app.html?noAutoBoot&testHooks=1',remote||`http://127.0.0.1:${server.address().port}/`).href;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();await page.coverage.startJSCoverage({resetOnNavigation:false});
  page.on('console',message=>{if(message.type()==='error'&&!(/\/favicon\.ico$/.test(message.location().url)&&/\b404\b/.test(message.text())))report.errors.push(message.text());});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  if(remote){report.assets=[];for(const name of ['app.html','main.js','event-clock-probe.js','roadmap.js','gpu-checkpoint-build.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){
    const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,name))),name);report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
  }}
  await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});
  const panel=page.locator('#event-clock-panel');await panel.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await panel.getAttribute('open'),'');
  const run=page.locator('#event-clock-run');await run.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>['passed','failed'].includes(document.querySelector('#event-clock-status')?.dataset.status),null,{timeout:240000});
  const probe=await page.evaluate(()=>{const r=window.__eventClockReport;return {...r,frames:r.frames?.map(frame=>({name:frame.name,bytes:Array.from(frame.bytes)}))};});
  await fs.writeFile(path.join(output,'probe.json'),JSON.stringify({...probe,frames:probe.frames?.map(frame=>({name:frame.name,bytes:frame.bytes.length,sha256:sha(Buffer.from(frame.bytes))}))},null,2)+'\n');
  assert.equal(probe.status,'passed',probe.failure);assert.equal(probe.cases.length,16);assert.equal(probe.refusals.length,10);
  report.checks.frames=[];
  for(const frame of probe.frames){assert.match(frame.name,/^[a-z0-9-]+$/);const bytes=Buffer.from(frame.bytes),name=frame.name+'.resume';await fs.writeFile(path.join(output,name),bytes);report.checks.frames.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  for(const trace of probe.traces){assert.match(trace.name,/^[a-z0-9-]+$/);assert.ok(trace.text.length);await fs.writeFile(path.join(output,trace.name+'.trace'),trace.text);}
  report.checks.probe={cases:probe.cases,refusals:probe.refusals};
  assert.match(await page.locator('#event-clock-pip').getAttribute('class'),/\blive\b/);
  assert.match(await page.locator('.cap',{hasText:'Exact event clock and bounded execution'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
  await panel.screenshot({path:path.join(output,'desktop.png')});
  await page.setViewportSize({width:390,height:844});report.checks.mobile=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttonWidth:document.querySelector('#event-clock-run').getBoundingClientRect().width}));
  assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width+1);await panel.screenshot({path:path.join(output,'mobile.png')});
  assert.deepEqual(report.errors,[]);
  const oracle=execFileSync('python3',['-B','tools/verify/e9-event-clock-files.py','--directory',output],{cwd:root,stdio:'pipe'});
  await fs.writeFile(path.join(output,'clock-oracle.log'),oracle);
  assert.equal(JSON.parse(await fs.readFile(path.join(output,'clock-oracle.json'),'utf8')).status,'passed');report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  if(page)await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage().catch(()=>[])));
  if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
  await context?.close();await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  report.source_sha256={};for(const name of ['web/index.html','web/main.js','web/event-clock-probe.js','web/roadmap.js','web/pkg/wasm_vm_wasm_bg.wasm','crates/core/src/lib.rs','crates/core/src/session_clock.rs','crates/core/src/resume.rs','crates/wasm/src/event_clock.rs','tools/verify/e9-event-clock-browser.mjs','tools/verify/e9-event-clock-files.py'])report.source_sha256[name]=sha(await fs.readFile(path.join(root,name)));
  report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,frames:report.checks.frames?.length}));
}
