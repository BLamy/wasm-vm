#!/usr/bin/env node
// Record the assembled route boundary. Detailed unchanged UI witnesses live in design/reviews.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv[2],'--output');assert.ok(process.argv[3]);
assert.ok(process.argv.length===4||(process.argv.length===6&&process.argv[4]==='--url'));
const output=path.resolve(process.argv[3]),dist=path.join(repo,'web/dist');
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const report={schema:'reviewed-site-assembled-route-record-v1',task:'E0-T27',head:git('rev-parse','HEAD'),
 command:[process.execPath,...process.argv.slice(1)],startedAt:new Date().toISOString(),status:'running',
 actualGuestGpu:false,performanceAuthority:false,errors:[],canceledRequests:[],requests:[],screenshots:[],served:[],steps:[]};
await fs.mkdir(output,{recursive:true});
let browser,server;
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
    const file=path.resolve(dist,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
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
 browser=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
 report.browserVersion=browser.version();
 const watch=page=>{
  page.on('console',m=>{if(m.type()==='error')report.errors.push({url:page.url(),message:m.text()});});
  page.on('pageerror',e=>report.errors.push({url:page.url(),message:e.message}));
  page.on('requestfailed',r=>{const item={url:r.url(),message:r.failure()?.errorText};
   if(item.message==='net::ERR_ABORTED')report.canceledRequests.push(item);else report.errors.push(item);});
  page.on('response',r=>{bodyReads.push((async()=>{try{const url=new URL(r.url());if(url.origin!==new URL(base).origin||r.status()!==200)return;
   const bytes=await r.body();const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
   const expected=await fs.readFile(path.join(dist,name));assert.equal(hash(bytes),hash(expected),'served body drift '+name);
   const bodyPath='served/'+name;await fs.mkdir(path.dirname(path.join(output,bodyPath)),{recursive:true});await fs.writeFile(path.join(output,bodyPath),bytes);
   report.requests.push({url:r.url(),path:name,status:r.status(),bodyPath,bytes:bytes.length,sha256:hash(bytes)});
  }catch(error){if(r.request().failure()?.errorText!=='net::ERR_ABORTED')report.errors.push({url:r.url(),message:error.message});}})());});
 };
 const desktop=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
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
 await page.locator('a[href="./docs.html?page=quickstart"]').first().click();
 await page.locator('.reader-document h1').waitFor();
 assert.equal(new URL(page.url()).searchParams.get('page'),'quickstart');
 assert.equal(await page.locator('.reader-header a[href="./app.html"]').count(),1);
 assert.equal(await page.locator('.reader-header a[href="./"]').count(),1);
 await page.goto(new URL('docs.html?page=graphics',base).href,{waitUntil:'load'});await page.locator('.reader-document h1').waitFor();
 assert.match(await page.locator('.reader-document').innerText(),/production acceleration disabled|production acceleration.*disabled/);
 await screenshot(page,'desktop-reader.png');report.steps.push({name:'production reader routes and truthful graphics boundary',status:'passed'});
 for(const [entry,id] of [['docs-embedding.html','embedding'],['docs-guest.html','storage'],['docs-containers.html','containers'],['docs-verification.html','verification'],['docs-explainers.html','explainers']]){
  await page.goto(new URL(entry,base).href,{waitUntil:'load'});await page.locator('.reader-document h1').waitFor();
  assert.equal(await page.locator(`.reader-sidebar a[aria-current="page"][href="./docs.html?page=${id}"]`).count(),1);
 }
 report.steps.push({name:'legacy published entry routes',status:'passed'});
 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
 const phone=await mobile.newPage();watch(phone);await phone.goto(base,{waitUntil:'load'});
 await phone.waitForFunction(()=>document.querySelector('#machine-canvas')?.dataset.modelReady==='true');
 assert.equal(await phone.locator('#machine-canvas').getAttribute('data-motion'),'paused');
 assert.equal(await phone.locator('#hero-canvas').getAttribute('data-motion'),'paused');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await phone.locator('#machine-canvas').scrollIntoViewIfNeeded();await screenshot(phone,'mobile-hero.png');
 await phone.goto(new URL('docs.html?page=overview',base).href,{waitUntil:'load'});await phone.locator('.reader-document h1').waitFor();
 await phone.getByRole('button',{name:'Browse docs'}).click();await phone.locator('#docs-search').fill('dimensional');
 assert.ok(await phone.locator('.reader-sidebar nav a').count()>0);
 await phone.locator('.reader-sidebar nav a').first().click();assert.equal(await phone.getByRole('button',{name:'Browse docs'}).getAttribute('aria-expanded'),'false');
 await phone.locator('.reader-document h1').waitFor();assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await screenshot(phone,'mobile-reader.png');report.steps.push({name:'assembled mobile motion/search/navigation/reflow',status:'passed'});
 await Promise.all([page.waitForLoadState('networkidle'),phone.waitForLoadState('networkidle')]);
 await Promise.all(bodyReads);
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
