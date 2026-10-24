#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options={};
for(let i=2;i<process.argv.length;i+=2){
  assert(['--output','--url'].includes(process.argv[i])&&!options[process.argv[i]]&&process.argv[i+1]);
  options[process.argv[i]]=process.argv[i+1];
}
assert(options['--output']);
const out=path.resolve(options['--output']),web=path.join(root,'web/dist');
await fs.mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T22j',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:'running',started:new Date().toISOString(),errors:[],httpErrors:[],assets:[]};
await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'executed-demo.mjs'));
let server,browser,context,page,base=options['--url'];
try{
  if(base){
    const url=new URL(base);
    assert.equal(url.href,'https://wasm-vm.pages.dev/');
  }else{
    server=createServer(async(request,response)=>{
      try{
        const name=decodeURIComponent(new URL(request.url,'http://local').pathname);
        if(name==='/favicon.ico'){response.writeHead(204).end();return;}
        const file=path.resolve(web,'.'+name);
        assert(file.startsWith(web+path.sep));
        const bytes=await fs.readFile(file);
        const mime=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]??'application/octet-stream';
        response.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
      }catch{response.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${server.address().port}/`;
  }
  report.base=base;
  for(const name of ['app.html','main.js','roadmap.js','gpu-journal-stream-probe.js','pkg/wasm_vm_wasm_bg.wasm']){
    const response=await fetch(new URL(name+'?release='+report.head,base),{signal:AbortSignal.timeout(60000),headers:{'Cache-Control':'no-cache'}});
    assert.equal(response.status,200,name);
    const bytes=Buffer.from(await response.arrayBuffer()),digest=sha(bytes);
    assert.equal(digest,sha(await fs.readFile(path.join(web,name))),name);
    report.assets.push({name,bytes:bytes.length,sha256:digest});
  }
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  report.browser=browser.version();
  context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:false,sources:true});
  page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.stack));
  page.on('console',message=>{if(message.type()==='error'&&!message.location().url.endsWith('/favicon.ico'))report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
  await page.goto(new URL('app.html?noAutoBoot=1&testHooks=1&release='+report.head,base).href);
  await page.waitForFunction(()=>globalThis.__ready===true&&!document.querySelector('#suite-run')?.disabled,null,{timeout:60000});
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent.trim()==='127'&&!document.querySelector('#suite-run')?.disabled,null,{timeout:180000});
  report.suite=await page.evaluate(()=>({passed:Number(document.querySelector('#metric-pass').textContent),failed:Number(document.querySelector('#metric-fail').textContent)}));
  assert.deepEqual(report.suite,{passed:127,failed:0});
  const panel=page.locator('#gpu-journal-stream-panel');
  await panel.locator('summary').click();
  await page.locator('#gpu-journal-stream-run').click();
  await page.waitForFunction(()=>!!globalThis.__gpuJournalStreamReport,null,{timeout:360000});
  const result=await page.evaluate(()=>globalThis.__gpuJournalStreamReport);
  assert.equal(result.status,'passed',result.cases?.find(row=>row.error)?.error??result.failure);
  const count=result.cases.find(row=>row.variant==='count'),bytes=result.cases.find(row=>row.variant==='bytes');
  assert.equal(count.channels[1],4100);
  assert.equal(bytes.blocks,256);
  assert.equal(bytes.channels[19],256);
  assert(bytes.parkedAtFull?.parked>0&&bytes.parkedAtFull.pendingRequestRetired);
  assert(bytes.checkpoints.some(row=>row.full&&row.transition===bytes.parkedAtFull.position.transition));
  assert.equal(bytes.replayParked?.status,'passed');
  assert.equal(bytes.replayParked.checkpointId,'block-mid');
  assert.equal(bytes.replayParked.endDigest,bytes.final.digest);
  assert.match(bytes.physical.profile.identity,/Apple.*Metal/i);
  report.parked={position:bytes.parkedAtFull.position,parked:bytes.parkedAtFull.parked,completedChunk:bytes.parkedAtFull.completedChunk,checkpoints:bytes.checkpoints.map(({transition,full,frameBytes})=>({transition,full,frameBytes})),physical:bytes.physical.profile.identity};
  assert.match(await page.locator('#gpu-journal-stream-pip').getAttribute('class'),/\blive\b/);
  assert.match(await page.locator('.cap').filter({hasText:'Long GPU journal recording'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
  await panel.screenshot({path:path.join(out,'desktop.png')});
  await page.setViewportSize({width:390,height:844});
  report.mobile=await panel.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
  assert(report.mobile.scroll<=report.mobile.width+1);
  await panel.screenshot({path:path.join(out,'mobile.png')});
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.httpErrors,[]);
  report.status='passed';
}catch(error){
  report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
  await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
}finally{
  if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});
  await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.finished=new Date().toISOString();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,output:out,failure:report.failure}));
}
