#!/usr/bin/env node
// One bounded built-app software warm launch. Never opts into a cold boot/replay.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/web/node_modules/playwright/index.mjs';
const repo='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const out=path.resolve(process.argv[2] || 'target/evidence/software-snapshot-warm-ui');
await fs.mkdir(out,{recursive:false});
const report={head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),started:new Date().toISOString(),passed:false,errors:[],httpErrors:[],events:[],logs:[]};
const server={kill(){}};
const baseSourceSha256='d113b336edf84ece081b744733a9993a68241eb3423281fa2a4ba4e7fba15e76';
let browser;
try {
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  report.browser=browser.version();
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1050}});
  await page.exposeFunction('recordGuestEvent',event=>{report.events.push(event);if(event.type!=='wvm:guest-progress'||String(event.detail.phase).includes('staged'))console.log(JSON.stringify(event));});
  await page.addInitScript(()=>{for(const type of ['wvm:guest-state','wvm:guest-error','wvm:guest-ready','wvm:guest-progress'])addEventListener(type,e=>{void window.recordGuestEvent({type,detail:e.detail,time:Date.now()});});});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{const url=m.location().url;report.logs.push({type:m.type(),text:m.text(),url});if(m.type()==='error'){if(url==='https://wasm-vm.pages.dev/favicon.ico'){(report.waivedFaviconErrors??=[]).push({text:m.text(),url});}else report.errors.push({text:m.text(),url});}});
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))report.httpErrors.push({url:r.url(),status:r.status()});});
  report.baseSourceSha256=baseSourceSha256;
  report.url='https://wasm-vm.pages.dev/app?guest=omarchy&desktop=1&gpu=0&testHooks=1&startPaused=1#ide';
  await page.goto(report.url);
  await page.waitForFunction(()=>window.__linux?.restoredFromBootSnapshot?.(),null,{timeout:180000});
  report.restored=await page.evaluate(async()=>({restored:window.__linux.restoredFromBootSnapshot(),paused:await window.__linux.isPaused(),status:document.querySelector('#status')?.textContent}));
  assert.equal(report.restored.restored,true);
  assert.ok(report.events.some(e=>e.type==='wvm:guest-progress'&&e.detail.phase==='bootSnapshot: staged'&&e.detail.loaded===634769246));
  report.screenshotSha256=createHash('sha256').update(await page.screenshot({path:path.join(out,'software-warm-restored.png')})).digest('hex');
  await page.evaluate(()=>window.__linux.resume());
  const canvas=page.locator('#ide-display-canvas'); await canvas.focus();
  if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on') {
    await page.locator('#ide-keyboard-toggle').click(); await canvas.focus();
  }
  await page.evaluate(()=>{window.__streamTrustedKeys=[];addEventListener('keydown',e=>window.__streamTrustedKeys.push({key:e.key,trusted:e.isTrusted}),true);});
  const command='echo stream-restore-ok | tee /tmp/stream-restore-proof';
  report.typed=command;
  for(const c of command) {
    if(c==='|') await page.keyboard.press('Shift+Backslash',{delay:80});
    else await page.keyboard.type(c,{delay:80});
  }
  await page.keyboard.press('Enter',{delay:100});
  report.trustedKeys=await page.evaluate(()=>window.__streamTrustedKeys);
  await page.screenshot({path:path.join(out,'software-warm-typed.png')});
  report.readbacks=[];
  const deadline=Date.now()+60000;
  do {
    report.echo=await page.evaluate(()=>window.wvmDemo.run('cat /tmp/stream-restore-proof',20000,{quiet:true}));
    report.readbacks.push(report.echo);
    if(report.echo.exit===0) break;
    await page.waitForTimeout(1000);
  } while(Date.now()<deadline);
  assert.equal(report.echo.exit,0);assert.equal(report.echo.stdout.trim(),'stream-restore-ok');
  report.trustedKeys=await page.evaluate(()=>window.__streamTrustedKeys);
  assert.ok(report.trustedKeys.length>20 && report.trustedKeys.every(e=>e.trusted));
  report.echoScreenshotSha256=createHash('sha256').update(await page.screenshot({path:path.join(out,'software-warm-echo.png')})).digest('hex');
  report.canvases=await page.locator('canvas').evaluateAll(nodes=>nodes.map(n=>({id:n.id,width:n.width,height:n.height,rect:{width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}})));
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.passed=true;
} catch(e){report.failure=String(e);report.stack=e.stack;process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,restored:report.restored}));}
