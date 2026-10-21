// One built-page pass for the native-only GPU result slice, or its published bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert.ok(['--output','--url','--capability-status','--pending-status','--gpu-status'].includes(args[i])&&args[i+1]);assert.equal(options[args[i]],undefined);options[args[i]]=args[i+1];}
assert.ok(options['--output']);const expectedStatus=options['--capability-status']??'verified';assert.ok(['in-progress','verified'].includes(expectedStatus));
const taskText=await fs.readFile(path.join(root,'tasks/epic-9-session-time-travel/E9-T18c-browser-gpu-result-replay.md'),'utf8'),gpuStatus=options['--gpu-status']??(/^status: verified$/m.test(taskText)?'verified':'in-progress');assert.ok(['in-progress','verified'].includes(gpuStatus));
const output=path.resolve(options['--output']),dist=path.join(root,'web/dist');await fs.mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T18a',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),errors:[],httpErrors:[],assets:[],started:new Date().toISOString()};
let server,browser,context,page;
await fs.copyFile(fileURLToPath(import.meta.url),path.join(output,'executed-browser-check.mjs'));
try{
  let base=options['--url'];
  if(base){const url=new URL(base);assert.equal(url.protocol,'https:');assert.equal(url.pathname,'/');assert.equal(url.search+url.hash+url.username+url.password,'');}
  else{
    const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    server=createServer(async(request,response)=>{try{
      const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      const file=path.resolve(dist,'.'+pathname);assert.ok(file.startsWith(dist+path.sep));
      const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream',
        'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    base=`http://127.0.0.1:${server.address().port}/`;
  }
  report.base=base;
  for(const name of ['app.html','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','main.js','roadmap.js','tasks.json',
    'session-gpu-checkpoints.js','session-replay-probe.js','case-studies.html','case-study-riscv-os.html','marketing.css']){
    const response=await fetch(new URL(name+'?release='+report.head,base),{signal:AbortSignal.timeout(60000),headers:{'Cache-Control':'no-cache'}});
    assert.equal(response.status,200,name);const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes),sha(await fs.readFile(path.join(dist,name))),'served bytes: '+name);
    report.assets.push({path:name,bytes:bytes.length,sha256:sha(bytes),url:response.url});
  }
  const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));
  const {RISCV_TESTS}=await import(pathToFileURL(path.join(dist,'riscv-tests.js')));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url||''))report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400&&!/favicon\.ico/.test(response.url()))report.httpErrors.push({url:response.url(),status:response.status()});});
  await page.goto(new URL('app.html?noAutoBoot=1&release='+report.head,base).href);
  await page.waitForFunction(()=>globalThis.__ready===true&&document.querySelector('#suite-run')?.disabled===false,null,{timeout:60000});
  await page.locator('#suite-run').evaluate(button=>button.click());
  await page.waitForFunction(total=>document.querySelector('#metric-done')?.textContent.trim()===String(total)&&document.querySelector('#suite-run')?.disabled===false,RISCV_TESTS.length,{timeout:180000});
  report.suite=await page.evaluate(()=>({passed:Number(document.querySelector('#metric-pass').textContent),failed:Number(document.querySelector('#metric-fail').textContent)}));
  assert.deepEqual(report.suite,{passed:RISCV_TESTS.length,failed:0});assert.equal(RISCV_TESTS.length,127);
  report.capabilities=await page.evaluate(async()=>{
    const {ROADMAP}=await import('./roadmap.js');return ROADMAP.find(epic=>epic.epic==='E9').caps.filter(cap=>['Native owned GPU results','Guest-visible GPU replay','Accelerated desktop keyframes','Pending GPU result keyframes'].includes(cap.name));
  });
  assert.equal(report.capabilities.find(c=>c.name==='Native owned GPU results').status,expectedStatus);
  assert.equal(report.capabilities.find(c=>c.name==='Guest-visible GPU replay').status,gpuStatus);
  assert.equal(report.capabilities.find(c=>c.name==='Accelerated desktop keyframes').status,'verified');
  report.nativePip=await page.locator('.cap').filter({hasText:'Native owned GPU results'}).locator('.cap-pip').getAttribute('class');assert.ok(report.nativePip.split(/\s+/).includes(expectedStatus));
  await page.screenshot({path:path.join(output,'built-demo.png'),fullPage:true});
  if(options['--pending-status']){assert.equal(report.capabilities.find(c=>c.name==='Pending GPU result keyframes').status,options['--pending-status']);report.pendingPip=await page.locator('.cap').filter({hasText:'Pending GPU result keyframes'}).locator('.cap-pip').getAttribute('class');assert.ok(report.pendingPip.split(/\s+/).includes(options['--pending-status']));}
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='passed';report.browser=browser.version();
}catch(error){report.status='failed';report.failure=error.stack??String(error);process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
  await context?.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
