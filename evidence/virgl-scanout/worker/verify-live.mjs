import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const repo=process.cwd(), output=path.resolve(process.argv[2]), deploymentUrl=process.argv[3];
assert.ok(deploymentUrl?.startsWith('https://')); await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E6-T11c',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),url:'https://wasm-vm.pages.dev/app.html?noAutoBoot&testHooks=1',deploymentUrl,errors:[],faviconErrors:[],httpErrors:[],startedAt:new Date().toISOString(),expectedWasmSha256:sha(await fs.readFile('web/dist/pkg/wasm_vm_wasm_bg.wasm'))};
let browser;
try {
 const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error'){const item={text:m.text(),location:m.location()}; if(new URL(item.location.url||report.url).pathname==='/favicon.ico')report.faviconErrors.push(item);else report.errors.push(item);}});
 page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('requestfailed',r=>report.errors.push(r.url()+': '+r.failure()?.errorText));
 await page.goto(report.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch('./pkg/wasm_vm_wasm_bg.wasm',{cache:'no-store'})).arrayBuffer())));
 report.actualWasmSha256=sha(Buffer.from(bytes)); assert.equal(report.actualWasmSha256,report.expectedWasmSha256);
 report.proofExportAbsent=await page.evaluate(async()=>{const m=await import('./pkg/wasm_vm_wasm.js'); return !Object.hasOwn(m,'WasmVirglControlProof')&&!Object.hasOwn(m,'WasmVirglSubmitProof')&&!Object.hasOwn(m,'WasmVirglScanoutProof');}); assert.equal(report.proofExportAbsent,true);
 await page.locator('#suite-run').click();
 await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
 report.passed=Number(await page.locator('#metric-pass').textContent()); report.failed=Number(await page.locator('#metric-fail').textContent());
 assert.equal(report.passed,127);assert.equal(report.failed,0);assert.deepEqual(report.errors,[]);assert.ok(report.httpErrors.every(r=>new URL(r.url).pathname==='/favicon.ico'&&r.status===404));
 const graphics=page.locator('.cap',{hasText:'Guest GPU offload'}); report.graphicsRoadmapPip=await graphics.locator('.cap-pip').getAttribute('class'); assert.match(report.graphicsRoadmapPip,/\bpartial\b/); assert.match(await graphics.textContent(),/production acceleration disabled/);
 await page.locator('#panel-tests').screenshot({path:path.join(output,'live-browser.png')});
 report.screenshot={path:'live-browser.png',sha256:sha(await fs.readFile(path.join(output,'live-browser.png')))};
 report.status='passed'; console.log('Live default bundle: 127/127, exact Wasm hash, proof exports absent, zero errors.');
} catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};process.exitCode=1;console.error(e.stack);}
finally {report.finishedAt=new Date().toISOString();report.deployLogSha256=sha(await fs.readFile(path.join(output,'deploy.log')));await fs.writeFile(path.join(output,'live-report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();}
