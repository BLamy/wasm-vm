import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const root=process.cwd(),out=path.join(root,'target/evidence/e9-t07-public-metadata'),deployment=process.argv[2];
assert.ok(/^https:\/\/[a-f0-9]+\.wasm-vm\.pages\.dev\/?$/.test(deployment));
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}),'');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T07',scope:'Publication of verified task catalog and service-worker metadata only; full product proof carried from public-final recording.',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'running',deployment,production:'https://wasm-vm.pages.dev/',errors:[],assets:[],started:new Date().toISOString()};
await fs.mkdir(out,{recursive:true});let browser,context,page;
try {
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
 context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});page=await context.newPage();
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!(message.location().url==='https://wasm-vm.pages.dev/favicon.ico'&&/\b404\b/.test(message.text())))report.errors.push(message.text());});
 for(const origin of [deployment,report.production])for(const name of ['session-library.js','session-library.css','session-checkpoints.js','session-disk-roots.js','session-store.js','session-alpine-image.json','session-software-fixture.json','loader.js','linux-worker-protocol.js','linux-worker-host.js','gpu-runtime-worker.js','gpu-checkpoint-build.js','roadmap.js','tasks.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm','sw.js']) {
  const response=await context.request.get(new URL(name,origin.endsWith('/')?origin:origin+'/').href,{headers:{'Cache-Control':'no-cache'}});assert.equal(response.status(),200,name);
  const bytes=await response.body(),expected=sha(await fs.readFile(path.join(root,'web/dist',name)));assert.equal(sha(bytes),expected,name);
  report.assets.push({origin,name,status:response.status(),bytes:bytes.length,sha256:expected});
 }
 await page.goto('https://wasm-vm.pages.dev/app.html?noAutoBoot&testHooks=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 await page.locator('#suite-run').click();
 await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
 report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.suite,{passed:127,failed:0});
 report.pip=await page.locator('.cap',{hasText:'Storage limits and shared-data deletion'}).locator('.cap-pip').getAttribute('class');assert.match(report.pip,/\bverified\b/);
 const catalog=await page.evaluate(async()=>{const value=await(await fetch('./tasks.json',{cache:'no-store'})).json();return {task:value.tasks.find(t=>t.id==='E9-T07'),headline:value.headline};});
 assert.equal(catalog.task.status,'verified');report.catalog=catalog;
 await page.locator('#panel-tests').screenshot({path:path.join(out,'browser.png')});
 assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally {
 if(context)await context.tracing.stop({path:path.join(out,'trace.zip')}).catch(()=>{});
 await context?.close();await browser?.close();report.finished=new Date().toISOString();
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,suite:report.suite,assets:report.assets.length}));
}
