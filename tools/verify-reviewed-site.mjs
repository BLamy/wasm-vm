#!/usr/bin/env node
// Record the assembled route boundary. Detailed unchanged UI witnesses live in design/reviews.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {expectedPublishedSource} from './virgl-production/published-source.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv[2],'--output');assert.ok(process.argv[3]);
assert.ok(process.argv.length===4||(process.argv.length===6&&process.argv[4]==='--url'));
const output=path.resolve(process.argv[3]),dist=path.join(repo,'web/dist');
const remote=process.argv[4]==='--url';
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const report={schema:'reviewed-site-assembled-route-record-v1',task:'E0-T27',head:git('rev-parse','HEAD'),
 command:[process.execPath,...process.argv.slice(1)],startedAt:new Date().toISOString(),status:'running',
 actualGuestGpu:false,performanceAuthority:false,errors:[],originalRouteBodies:[],interruptedResponseBodies:[],canceledRequests:[],requests:[],screenshots:[],served:[],steps:[]};
await fs.mkdir(output,{recursive:true});
let browser,server,legacyTransition=null;
const served=new Map(),bodyReads=[];
const screenshot=async(page,name)=>{const destination=path.join(output,name);await page.screenshot({path:destination,fullPage:false});report.screenshots.push({path:name,sha256:hash(await fs.readFile(destination))});};
try{
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','record from a clean committed source');
 const catalog=JSON.parse(await fs.readFile(path.join(dist,'docs-content/catalog.json')));
 const ledger=JSON.parse(await fs.readFile(path.join(dist,'docs-content/migration-ledger.json')));
 assert.equal(catalog.docstreamVersion,'1.8.0');assert.equal(catalog.pages.length,154);assert.equal(ledger.documents.length,1995);
 report.corpus={pages:catalog.pages.length,records:ledger.documents.length,version:catalog.docstreamVersion};
 let base=process.argv[5];
 if(!base){
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
   '.wasm':'application/wasm','.md':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
  server=createServer(async(request,response)=>{
   try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const servedPath=pathname==='/'?'/index.html':path.extname(pathname)?pathname:`${pathname}.html`;
    const file=path.resolve(dist,'.'+decodeURIComponent(servedPath));
    if(!file.startsWith(dist+path.sep)){response.writeHead(404).end();return;}
    const bytes=await fs.readFile(file);served.set(pathname,{path:path.relative(dist,file),bytes:bytes.length,sha256:hash(bytes)});
    response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
     'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
   }catch{response.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}/`;
 }
 report.base=base;
 const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
 browser=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
 report.browserVersion=browser.version();
 // Read the original HTTP response before forwarding the unchanged routing
 // module. An immediate client redirect may otherwise destroy Chrome's CDP
 // response handle before the recorder can retrieve this changed source.
 const captureRouteSource=async context=>{
  for(const name of ['tabs.js','ide.js'])await context.route('**/'+name,async route=>{
   const original=await route.fetch();assert.equal(original.status(),200);
   const bytes=await original.body();const expected=await fs.readFile(path.join(dist,name));
   assert.equal(hash(bytes),hash(expected),'original routing module drift');
   const bodyPath='original-routes/'+name;await fs.mkdir(path.dirname(path.join(output,bodyPath)),{recursive:true});
   await fs.writeFile(path.join(output,bodyPath),bytes);
   report.originalRouteBodies.push({url:route.request().url(),path:name,bodyPath,status:original.status(),bytes:bytes.length,sha256:hash(bytes),forwardedUnchanged:true});
   await route.fulfill({response:original,body:bytes});
  });
 };
 const watch=page=>{
  page.on('console',m=>{if(m.type()!=='error')return;const location=m.location().url;if(location===new URL('favicon.ico',base).href&&/404/.test(m.text()))(report.allowedFavicon404??=[]).push({url:location,message:m.text()});else report.errors.push({url:page.url(),source:location,message:m.text()});});
  page.on('pageerror',e=>report.errors.push({url:page.url(),message:e.message}));
  page.on('requestfailed',r=>{const item={url:r.url(),message:r.failure()?.errorText};
   if(item.message==='net::ERR_ABORTED')report.canceledRequests.push(item);else report.errors.push(item);});
  page.on('response',r=>{const transition=legacyTransition;bodyReads.push((async()=>{try{const url=new URL(r.url());if(url.origin!==new URL(base).origin||r.status()!==200)return;
   const bytes=await r.body();const rawName=url.pathname==='/'?'index.html':url.pathname.slice(1);
   const name=path.extname(rawName)?rawName:`${rawName}.html`;
   const raw=await fs.readFile(path.join(dist,name)),expected=remote?expectedPublishedSource(name,raw):raw;assert.equal(hash(bytes),hash(expected),'served body drift '+name);
   const bodyPath='served/'+name;await fs.mkdir(path.dirname(path.join(output,bodyPath)),{recursive:true});await fs.writeFile(path.join(output,bodyPath),bytes);
   report.requests.push({url:r.url(),path:name,status:r.status(),bodyPath,bytes:bytes.length,sha256:hash(bytes)});
  }catch(error){
   const item={url:r.url(),message:error.message};
   if(transition&&/Network.getResponseBody.*No resource with given identifier found/.test(error.message))report.interruptedResponseBodies.push({...item,legacyTransition:transition});
   else if(r.request().failure()?.errorText!=='net::ERR_ABORTED')report.errors.push(item);
  }})());});
 };
 const desktop=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
 await captureRouteSource(desktop);
 const page=await desktop.newPage();watch(page);
 await page.goto(base,{waitUntil:'load'});
 await page.waitForFunction(()=>document.querySelector('#machine-canvas')?.dataset.modelReady==='true');
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#hero-canvas').getAttribute('data-hero-background'),'shader-active');
 assert.ok(Number(await page.locator('#machine-canvas').getAttribute('data-model-triangles'))>0);
 await page.locator('[data-layer="devices"]').click();
 await page.waitForFunction(()=>document.querySelector('#machine-canvas')?.dataset.selectedLayer==='devices');
 assert.equal(await page.locator('[data-layer="devices"]').getAttribute('aria-pressed'),'true');
 await screenshot(page,'desktop-hero.png');report.steps.push({name:'assembled real mesh/background/selection',status:'passed'});
 const launcher=async()=>{
  await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  assert.equal(new URL(page.url()).hash,'#ide');
  assert.equal(await page.locator('#os-launcher').isVisible(),true);
  assert.equal(await page.locator('#os-launcher-title').innerText(),'Choose an operating system');
  assert.equal(await page.locator('#panel-ide').getAttribute('data-os-selected'),null);
  assert.equal(await page.locator('#rm-lanes, #panel-docs, #docs-mount, iframe').count(),0);
 };
 await page.locator('.nav-cta').click();await launcher();
 assert.equal(await page.locator('nav[aria-label="Primary navigation"] a[href="./docs.html"]').count(),1);
 await screenshot(page,'desktop-launcher.png');
 await page.goto(new URL('app.html',base).href,{waitUntil:'load'});await launcher();
 report.steps.push({name:'Open demo and bare app land on the unselected launcher',status:'passed'});
 await page.locator('nav[aria-label="Primary navigation"] a[href="./roadmap.html"]').click();
 await page.waitForFunction(()=>document.querySelector('#rm-headline')?.textContent.includes('tasks verified'));
 const tasks=JSON.parse(await fs.readFile(path.join(dist,'tasks.json')));
 const queue=await fs.readFile(path.join(repo,'tasks/QUEUE.md'),'utf8');
 const counts=queue.match(/\*\*(\d+) \/ (\d+) tasks verified\.\*\*/);assert.ok(counts,'canonical queue headline');
 assert.deepEqual(tasks.headline,{verified:Number(counts[1]),total:Number(counts[2])},'published task counts match canonical queue');
 for(const id of ['E6-T11d70','E6-T11d71','E6-T11d72','E6-T11d73'])assert.equal(tasks.tasks.find(task=>task.id===id)?.status,'verified','published prerequisite '+id);
 report.taskLedger={...tasks.headline,verifiedGraphicsPrerequisites:['E6-T11d70','E6-T11d71','E6-T11d72','E6-T11d73']};
 assert.equal(await page.locator('#rm-headline').innerText(),`${tasks.headline.verified} / ${tasks.headline.total} tasks verified across ${tasks.epics.length} epics`);
 assert.equal(await page.locator('.site-header .brand[href="./"]').count(),1);
 assert.equal(await page.locator('#panel-ide, #docs-mount').count(),0);
 await page.waitForFunction(()=>document.querySelector('#hero-canvas')?.dataset.heroBackground==='shader-active');
 await page.locator('#rm-motion').click();
 await page.waitForFunction(()=>document.querySelector('#hero-canvas')?.dataset.motion==='paused');
 await page.locator('#rm-motion').click();
 await page.waitForFunction(()=>document.querySelector('#hero-canvas')?.dataset.motion==='animated');
 await screenshot(page,'desktop-roadmap.png');
 await page.locator('#rm-search').fill('E6-T11d63');
 assert.match(await page.locator('#rm-count').innerText(),/^1 of /);
 await page.locator('#rm-view-timeline').focus();
 await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('#rm-view-board').getAttribute('aria-selected'),'true');
 await page.locator('.rm-card').click();
 await page.locator('#rm-detail:not([hidden])').waitFor();
 assert.equal(await page.locator('.rm-detail-id').innerText(),'E6-T11d63');
 const sourceTask=await fs.readFile(path.join(repo,tasks.tasks.find(task=>task.id==='E6-T11d63').file),'utf8');
 const authored=heading=>sourceTask.match(new RegExp(`^## ${heading}[^\\S\\n]*\\n.*?(?=^## |(?![\\s\\S]))`, 'ms'))?.[0];
 assert.equal(await page.locator('.rm-boundary').textContent(),authored('Boundary'));
 assert.equal(await page.locator('.rm-acceptance-contract').textContent(),authored('Deterministic acceptance'));
 assert.match(await page.locator('.rm-acceptance-contract').innerText(),/make verify-E6-T11d63/);
 assert.match(await page.locator('.rm-detail-body').innerText(),/VERDICT: verified/);
 assert.equal(await page.locator('main').getAttribute('inert'),'');
 await page.keyboard.press('Tab');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.locator('.rm-detail-close').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#rm-detail').isHidden(),true);
 assert.equal(await page.locator('.rm-card').evaluate(el=>el===document.activeElement),true);
 await page.locator('#rm-search').fill('');
 await page.locator('#rm-epic').selectOption('6');
 await page.locator('#rm-status').selectOption('verified');
 assert.ok(await page.locator('.rm-card').count()>0);
 assert.equal(await page.locator('.rm-card:not(.st-verified)').count(),0);
 await page.locator('#rm-view-timeline').click();
 assert.equal(await page.locator('#rm-view-timeline').getAttribute('aria-selected'),'true');
 report.steps.push({name:'marketing roadmap current ledger, Gantt/Kanban, search/filter and recorded detail',status:'passed',headline:tasks.headline});
 legacyTransition='workbench-roadmap-bookmark';
 await page.goto(new URL('app.html#roadmap',base).href,{waitUntil:'load'});
 await page.waitForURL(/\/roadmap(?:\.html)?$/);
 await page.waitForFunction(()=>document.querySelector('#rm-headline')?.textContent.includes('tasks verified'));
 await Promise.all(bodyReads);
 legacyTransition='workbench-docs-bookmark';
 await page.goto(new URL('app.html?page=graphics#docs',base).href,{waitUntil:'load'});
 await page.locator('.reader-document h1').waitFor();
 assert.equal(new URL(page.url()).searchParams.get('page'),'graphics');
 assert.match(new URL(page.url()).pathname,/\/docs(?:\.html)?$/);
 assert.equal(await page.locator('iframe').count(),0);
 await page.waitForLoadState('networkidle');await Promise.all(bodyReads);legacyTransition=null;
 report.steps.push({name:'retired workbench deep links use the canonical marketing roadmap and docs',status:'passed'});
 await page.goto(base,{waitUntil:'load'});
 await page.locator('a[href="./docs.html?page=quickstart"]').first().click();
 await page.locator('.reader-document h1').waitFor();
 assert.equal(new URL(page.url()).searchParams.get('page'),'quickstart');
 assert.equal(await page.locator('.reader-header a[href="./app.html#ide"]').count(),1);
 assert.equal(await page.locator('.reader-header a[href="./"]').count(),1);
 await page.goto(new URL('docs.html?page=graphics',base).href,{waitUntil:'load'});await page.locator('.reader-document h1').waitFor();
 const graphicsText=await page.locator('.reader-document').innerText();
 assert.match(graphicsText,/GPU rendering starts from a cold boot/);
 assert.match(graphicsText,/Software rendering/);
 assert.match(graphicsText,/WebGL2/);
 assert.match(graphicsText,/300-MIPS/);
 await screenshot(page,'desktop-reader.png');report.steps.push({name:'production reader routes and truthful graphics boundary',status:'passed'});
 for(const [entry,id] of [['docs-embedding.html','embedding'],['docs-guest.html','storage'],['docs-containers.html','containers'],['docs-verification.html','verification'],['docs-explainers.html','explainers']]){
  for(const address of [entry,entry.slice(0,-5)]){
  await page.goto(new URL(address,base).href,{waitUntil:'load'});await page.locator('.reader-document h1').waitFor();
  assert.equal(await page.locator(`.reader-sidebar a[aria-current="page"][href="./docs.html?page=${id}"]`).count(),1);
  }
 }
 report.steps.push({name:'legacy published entry routes',status:'passed'});
 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
 await captureRouteSource(mobile);
 const phone=await mobile.newPage();watch(phone);await phone.goto(base,{waitUntil:'load'});
 await phone.waitForFunction(()=>document.querySelector('#machine-canvas')?.dataset.modelReady==='true');
 assert.equal(await phone.locator('#machine-canvas').getAttribute('data-motion'),'paused');
 assert.equal(await phone.locator('#hero-canvas').getAttribute('data-motion'),'paused');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.equal(await phone.locator('.site-header a[href="./docs.html"]').isVisible(),true);
 assert.equal(await phone.locator('.site-header a[href="./roadmap.html"]').isVisible(),true);
 await phone.locator('#machine-canvas').scrollIntoViewIfNeeded();await screenshot(phone,'mobile-hero.png');
 await phone.locator('.nav-cta').click();
 await phone.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 assert.equal(await phone.locator('#os-launcher').isVisible(),true);
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await screenshot(phone,'mobile-launcher.png');
 await phone.locator('nav[aria-label="Primary navigation"] a[href="./roadmap.html"]').click();
 await phone.waitForFunction(()=>document.querySelector('#rm-headline')?.textContent.includes('tasks verified'));
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await phone.locator('#rm-search').fill('E6-T11d64');
 await phone.locator('#rm-view-board').click();
 await phone.locator('.rm-card').click();
 await phone.locator('#rm-detail:not([hidden])').waitFor();
 assert.equal(await phone.locator('.rm-detail-id').innerText(),'E6-T11d64');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await phone.keyboard.press('Escape');
 await screenshot(phone,'mobile-roadmap.png');
 report.steps.push({name:'mobile launcher and marketing roadmap reflow/detail',status:'passed'});
 await phone.goto(new URL('docs.html?page=overview',base).href,{waitUntil:'load'});await phone.locator('.reader-document h1').waitFor();
 await phone.getByRole('button',{name:'Browse docs'}).click();await phone.locator('#docs-search').fill('dimensional');
 assert.ok(await phone.locator('.reader-sidebar nav a').count()>0);
 await phone.locator('.reader-sidebar nav a').first().click();assert.equal(await phone.getByRole('button',{name:'Browse docs'}).getAttribute('aria-expanded'),'false');
 await phone.locator('.reader-document h1').waitFor();assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await screenshot(phone,'mobile-reader.png');report.steps.push({name:'assembled mobile motion/search/navigation/reflow',status:'passed'});
 await Promise.all([page.waitForLoadState('networkidle'),phone.waitForLoadState('networkidle')]);
 await Promise.all(bodyReads);
 // A redirect may retire an unchanged module's CDP resource before its body
 // can be read. Keep that diagnostic, and require a successful original-body
 // capture from the normal initialized app plus unchanged baseline bytes.
 const unchangedRedirectModules=new Set(['ide.js','vendor/xterm/xterm.js','omarchy-startup-state.js','coi-serviceworker-register.js','cpu-isolation.js']);
 for(const item of report.interruptedResponseBodies){
  const name=new URL(item.url).pathname.slice(1);
  const original=report.originalRouteBodies.find(row=>row.url===item.url&&row.forwardedUnchanged);
  if(original){
   item.originalBodyPath=original.bodyPath;item.sha256=original.sha256;
   assert.equal(hash(await fs.readFile(path.join(output,original.bodyPath))),hash(await fs.readFile(path.join(dist,name))));
   continue;
  }
  assert.ok(unchangedRedirectModules.has(name),'unproven interrupted response '+name);
  const current=await fs.readFile(path.join(dist,name));
  const baseline=execFileSync('git',['show',`2aca65e9328aa1433fb516511ca554fdd96b422d:web/dist/${name}`],{cwd:repo,maxBuffer:16*1024*1024});
  assert.equal(hash(current),hash(baseline),'interrupted response is changed routing code '+name);
  const captured=report.requests.find(row=>row.path===name&&row.sha256===hash(current));
  assert.ok(captured,'no complete original body for interrupted unchanged module '+name);
  item.heldBodyPath=captured.bodyPath;item.sha256=captured.sha256;item.baselineHead='2aca65e9328aa1433fb516511ca554fdd96b422d';
 }
 await Promise.all([desktop.close(),mobile.close()]);
 assert.deepEqual(report.errors,[]);assert.equal(git('rev-parse','HEAD'),report.head);assert.equal(git('status','--porcelain','--untracked-files=no'),'');
 report.status='passed';console.log(JSON.stringify({status:report.status,task:report.task,head:report.head,pages:154,records:1995,steps:report.steps.length,errors:0}));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
 await Promise.all(bodyReads);
 await browser?.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 report.served=[...served.values()];report.finishedAt=new Date().toISOString();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
