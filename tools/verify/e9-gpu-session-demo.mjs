#!/usr/bin/env node
// One built-page load: browser ISA suite, desktop checkpoint controls and roadmap.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(repo,'web/dist'),output=path.resolve(process.argv[2]??'target/evidence/e9-gpu-session-demo');
await fs.mkdir(output,{recursive:true});
const {RISCV_TESTS}=await import(pathToFileURL(path.join(root,'riscv-tests.js')));
const expected=RISCV_TESTS.length;
assert.ok(expected>=126);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
  '.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    assert.ok(file.startsWith(root+path.sep));
    const bytes=await fs.readFile(file);
    response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
      'Cache-Control':'no-store'}).end(bytes);
  }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
let browser;
try{
  browser=await chromium.launch({headless:true,
    executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],httpErrors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url||''))errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400&&!/favicon\.ico/.test(response.url()))httpErrors.push({url:response.url(),status:response.status()});});
  await page.goto(base+'/app.html?noAutoBoot=1');
  await page.waitForFunction(()=>window.__ready===true&&document.querySelector('#suite-run')?.disabled===false,
    null,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('[data-session="gpu-new"]')?.disabled===false,
    null,{timeout:60000});
  assert.equal(await page.locator('[data-session="gpu-capture"]').isDisabled(),true,
    'capture waits for a real accelerated desktop');
  await page.locator('#suite-run').evaluate(element=>element.click());
  await page.waitForFunction(total=>document.querySelector('#metric-done')?.textContent.trim()===String(total)
    &&document.querySelector('#suite-run')?.disabled===false,expected,{timeout:180000});
  const metrics=await page.evaluate(()=>Object.fromEntries(['metric-pass','metric-fail','metric-done']
    .map(id=>[id,Number(document.getElementById(id)?.textContent)])));
  assert.deepEqual(metrics,{'metric-pass':expected,'metric-fail':0,'metric-done':expected});
  await page.locator('#session-library').screenshot({path:path.join(output,'library.png')});
  await page.goto(base+'/roadmap.html');
  await page.locator('#rm-search').fill('E9-T17');
  await page.locator('.rm-g-label').filter({hasText:'E9-T17'}).first().click();
  await page.locator('#rm-detail').waitFor({state:'visible'});
  const detail=await page.locator('#rm-detail').innerText();
  assert.match(detail,/E9-T17/);
  await page.screenshot({path:path.join(output,'roadmap.png')});
  await page.setViewportSize({width:1280,height:850});
  await page.goto(base+'/app.html?guest=omarchy&gpu=1&desktop=1&noAutoBoot=1#ide');
  await page.waitForFunction(()=>window.__ready===true&&document.querySelector('#ide-display-canvas'));
  const desktopLayout=await page.evaluate(()=>{
    document.querySelector('#panel-ide').dataset.osSelected='true';
    document.querySelector('#omarchy-boot-overlay').hidden=true;
    const canvas=document.querySelector('#ide-display-canvas'),rect=canvas.getBoundingClientRect();
    return {canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      hit:document.elementFromPoint(431,413)?.id,
      libraryOpen:document.querySelector('#session-library').open,
      probeDisplay:getComputedStyle(document.querySelector('#event-clock-panel')).display};
  });
  assert.equal(desktopLayout.hit,'ide-display-canvas','trusted desktop input reaches the visible VM canvas');
  assert.equal(desktopLayout.libraryOpen,false,'session controls start as a compact desktop drawer');
  assert.equal(desktopLayout.probeDisplay,'none','verification panels do not cover the desktop');
  await page.screenshot({path:path.join(output,'desktop-layout.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  const report={task:'E9-T17',browser:browser.version(),expected,metrics,detail,desktopLayout,errors,httpErrors,
    screenshots:Object.fromEntries(await Promise.all(['library.png','roadmap.png','desktop-layout.png'].map(async name=>
      [name,createHash('sha256').update(await fs.readFile(path.join(output,name))).digest('hex')])))};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({metrics,errors,httpErrors,roadmap:detail.slice(0,150)}));
}finally{await browser?.close();server.close();}
