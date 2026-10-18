#!/usr/bin/env node
// Recorded saved-checkpoint milestone: two real boots and exact machine/disk/input witnesses.
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
const web=path.join(root,'web/dist'),sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E9-T08',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),checks:{},commands:[],errors:[]};
await fs.mkdir(output,{recursive:false});
let server,context,page;const instrumented=new Set(),coverage=[];
const control=(name,p=page)=>p.locator(`[data-session="${name}"]`);
async function idle(p=page){await p.waitForFunction(()=>window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading',null,{timeout:240000});}
async function click(name,p=page){await control(name,p).click();await idle(p);}
async function seal(p=page){
 if(!instrumented.has(p)||p.isClosed())return;
 const entries=await p.coverage.stopJSCoverage();instrumented.delete(p);coverage.push(...entries);
 const name=`javascript-coverage-segment-${(report.coverageSegments??[]).length+1}.json`;
 await fs.writeFile(path.join(output,name),JSON.stringify(entries));(report.coverageSegments??=[]).push({name,entries:entries.length});
}
async function instrument(p){
 await p.coverage.startJSCoverage({resetOnNavigation:false});instrumented.add(p);
 p.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});
 p.on('pageerror',e=>report.errors.push(e.message));
}
async function navigate(p,action){await seal(p);await p.coverage.startJSCoverage({resetOnNavigation:false});instrumented.add(p);await action();await p.waitForFunction(()=>window.__ready===true);await idle(p);}
async function command(text,p=page){const value=await p.evaluate(text=>wvmDemo.exec(text,180000,{quiet:true}),text);assert.equal(value.exit,0,JSON.stringify(value));report.commands.push({command:text,result:value});return value.stdout;}
async function details(id,name,point=null,p=page){return p.evaluate(async({id,name,point})=>{
 const {readCheckpointObject,checkpointHash,decodeSoftwareCheckpoint}=await import('./session-checkpoints.js');
 const store=__sessionLibrary.store,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
 const selected=manifest.checkpoints.find(item=>item.id===point)||manifest.checkpoints.at(-1),frame=await readCheckpointObject(store,selected.machine),parts=decodeSoftwareCheckpoint(frame);
 const compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 await fetch('./__e9-milestone-proof/'+name,{method:'POST',body:compressed});
 return {id,revision:opened.revision,manifest,point:selected.id,frameHash:checkpointHash(frame),bytes:frame.length,evidence:name,held:parts.context.held,input:new TextDecoder().decode(parts.input)};
},{id,name,point});}
async function activeFrame(name,p=page){return p.evaluate(async name=>{
 const {checkpointHash,decodeSoftwareCheckpoint}=await import('./session-checkpoints.js'),frame=await __linuxCtl.captureSoftwareCheckpoint(),parts=decodeSoftwareCheckpoint(frame);
 const compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 await fetch('./__e9-milestone-proof/'+name,{method:'POST',body:compressed});
 return {hash:checkpointHash(frame),bytes:frame.length,held:parts.context.held,input:new TextDecoder().decode(parts.input),paused:await __linuxCtl.isPaused(),scheduler:await __linuxCtl.schedulerStats(),active:document.querySelector('[data-session="active"]').dataset.id,point:document.querySelector('[data-session="active"]').dataset.point};
},name);}
async function restore(witness,label,p=page){
 await control('sessions',p).selectOption(witness.id);await idle(p);await control('points',p).selectOption(witness.point);await click('open',p);
 const state=await activeFrame(label+'.checkpoint.gz',p);assert.equal(state.hash,witness.frameHash);assert.equal(state.paused,true);assert.equal(state.scheduler.slices,0);assert.equal(state.active,witness.id);assert.equal(state.point,witness.point);assert.deepEqual(state.held,witness.held);assert.equal(state.input,witness.input);
 await click('resume',p);
 const encoded=(await command('base64 /root/e9-milestone/state',p)).trim(),memory=(await command('printf "%s/%s" "$e9_memory" "$e9_queue"',p)).trim();
 const expected=witness.input.includes('queued-alpha')?'alpha':'beta';assert.equal(encoded,Buffer.from(expected+'-file\n').toString('base64'));assert.equal(memory,expected+'-memory/queued-'+expected);
 return {state,file:Buffer.from(encoded,'base64').toString(),memory};
}
try{
 if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
 if(!remote){
    const fallback=new Map();
    for(const name of ['artifacts-alpine.json','artifacts-omarchy-virgl.json'])for(const asset of Object.values(JSON.parse(await fs.readFile(path.join(web,name),'utf8')).artifacts)){
      const pathname='/'+asset.url.replace(/^\.\//,'');fallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{try{
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      const base=pathname.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+decodeURIComponent(pathname));
      if(!file.startsWith(base+path.sep)){response.writeHead(404).end();return;}
      let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'&&fallback.has(pathname)){response.writeHead(302,{Location:fallback.get(pathname)}).end();return;}throw error;}
      response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
        'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
 report.url=new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',remote||`http://127.0.0.1:${server.address().port}/`).href;
 context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0]??await context.newPage();await instrument(page);
 await context.route('**/__e9-milestone-proof/*',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^[a-z0-9-]+\.checkpoint\.gz$/);assert.equal(route.request().method(),'POST');
  await fs.writeFile(path.join(output,name),route.request().postDataBuffer());await route.fulfill({status:204,body:''});
 });
 await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});await idle();console.log('Built page ready; running 127-test suite');
 if(remote){report.checks.publicBytes=[];for(const name of ['app.html','main.js','session-library.js','session-library.css','session-checkpoints.js','session-store.js','session-disk-roots.js','loader.js','roadmap.js','tasks.json','gpu-checkpoint-build.js','session-software-fixture.json','session-alpine-image.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm','docs-content/storage.md']){
  const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,name))),name);report.checks.publicBytes.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }}
 await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
 report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});
 report.checks.pip=await page.locator('.cap',{hasText:'Retention and reload milestone'}).locator('.cap-pip').getAttribute('class');assert.match(report.checks.pip,/\b(?:in-progress|verified)\b/);
 await page.locator('#panel-tests').screenshot({path:path.join(output,'suite.png')});
 const boots=[];
 for(const [label,key]of [['alpha',30],['beta',48]]){
  console.log('Booting independent actual guest:',label);await click('new');
  const progress=setInterval(()=>console.log('Waiting for fresh '+label+' shell'),20000);
  try{await page.waitForFunction(()=>wvmDemo.isGuestReady()||!wvmDemo.isGuestUp(),null,{timeout:900000});assert.equal(await page.evaluate(()=>wvmDemo.isGuestReady()),true,await page.locator('#status').textContent());}finally{clearInterval(progress);}
  boots.push(await command('test ! -e /root/e9-milestone/state && test -z "${e9_memory+x}" && printf fresh-'+label));
  await command(`mkdir -p /root/e9-milestone; printf '${label}-file\\n' > /root/e9-milestone/state; e9_memory=${label}-memory; unset e9_queue; sync`);
  await page.evaluate(async({label,key})=>{await __linuxCtl.pause();await __linuxCtl.sendKeyboardEvent(1,key,1);await __linuxCtl.syncKeyboard();await __linuxCtl.sendInput(new TextEncoder().encode('e9_queue=queued-'+label+'\n'));},{label,key});
  await click('start');const id=await control('sessions').inputValue(),witness=await details(id,label+'-original.checkpoint.gz');
  assert.deepEqual(witness.held.keyboard,[key]);assert.equal(witness.input,'e9_queue=queued-'+label+'\n');assert.equal(witness.manifest.policy.mode,'checkpoints-only');assert.equal(witness.manifest.events.length,0);
  await control('name').fill(label==='alpha'?'Checkpoint Alpha':'Checkpoint Beta');await control('name').press('Enter');await idle();assert.match(await control('status').innerText(),/Session renamed/);
  report.checks[label]=witness;
  if(label==='beta'){
   await click('resume');await command("printf 'beta-unsaved\\n' > /root/e9-milestone/state; e9_memory=beta-unsaved; sync");
   await control('limit-points').fill('1');await click('limits-save');await click('checkpoint');
   report.checks.quota={state:await page.locator('#session-library').getAttribute('data-state'),message:await control('status').innerText(),paused:await page.evaluate(()=>__linuxCtl.isPaused()),retry:!await control('retry').isDisabled()};
   assert.equal(report.checks.quota.state,'storage-error');assert.match(report.checks.quota.message,/Recording paused/);assert.equal(report.checks.quota.paused,true);assert.equal(report.checks.quota.retry,true);
   report.checks.betaPrefix=await details(id,'beta-after-quota.checkpoint.gz');assert.deepEqual(report.checks.betaPrefix.manifest,witness.manifest);
   report.checks.betaUnsaved=await activeFrame('beta-unsaved.checkpoint.gz');assert.notEqual(report.checks.betaUnsaved.hash,witness.frameHash);
   await page.locator('#session-library').screenshot({path:path.join(output,'quota-paused.png')});
  }
  await click('stop');
  if(label==='beta'){assert.match(await control('status').innerText(),/stopped at its committed prefix/);await control('limit-points').fill('4096');await click('limits-save');}
 }
 report.checks.freshBoots=boots;assert.notEqual(report.checks.alpha.id,report.checks.beta.id);assert.notEqual(report.checks.alpha.frameHash,report.checks.beta.frameHash);
 await navigate(page,()=>page.reload({waitUntil:'domcontentloaded'}));
 assert.equal(await control('active').getAttribute('data-id'),'');
 assert.match(await control('sessions').locator(`option[value="${report.checks.alpha.id}"]`).innerText(),/Checkpoint Alpha/);assert.match(await control('sessions').locator(`option[value="${report.checks.beta.id}"]`).innerText(),/Checkpoint Beta/);
 console.log('Restoring Beta after reload, Alpha in a fresh tab');
 report.checks.betaRestored=await restore(report.checks.beta,'beta-restored');
 const beforePreview=await control('active').getAttribute('data-id');await control('sessions').selectOption(report.checks.alpha.id);await idle();assert.equal(await control('active').getAttribute('data-id'),beforePreview);
 const other=await context.newPage();await instrument(other);await other.goto(report.url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.__ready===true);await idle(other);
 report.checks.alphaRestored=await restore(report.checks.alpha,'alpha-restored',other);await other.locator('#session-library').screenshot({path:path.join(output,'alpha-fresh-tab.png')});await seal(other);await other.close();
 // Deletion is visible and confirmed; the other history must remain byte-identical.
 await control('sessions').selectOption(report.checks.alpha.id);await idle();page.once('dialog',d=>d.accept());await click('delete');assert.match(await control('status').innerText(),/Saved session deleted/);
 assert.equal(await control('sessions').locator(`option[value="${report.checks.alpha.id}"]`).count(),0);
 report.checks.betaAfterDelete=await details(report.checks.beta.id,'beta-after-delete.checkpoint.gz');assert.deepEqual(report.checks.betaAfterDelete.manifest,report.checks.beta.manifest);
 await navigate(page,()=>page.reload({waitUntil:'domcontentloaded'}));report.checks.betaReopened=await restore(report.checks.beta,'beta-reopened');
 await control('name').focus();await control('name').press('Tab');report.checks.keyboardFocus=await page.evaluate(()=>document.activeElement?.dataset.session);assert.equal(report.checks.keyboardFocus,'rename');
 await page.locator('#session-library').screenshot({path:path.join(output,'milestone-desktop.png')});await page.setViewportSize({width:390,height:844});await page.locator('#session-library').scrollIntoViewIfNeeded();
 report.checks.mobile=await page.locator('#session-library').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width);await page.locator('#session-library').screenshot({path:path.join(output,'milestone-mobile.png')});
 const docs=await context.newPage();docs.on('pageerror',e=>report.errors.push(e.message));docs.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});
 await docs.goto(new URL('docs.html?page=storage',report.url).href,{waitUntil:'domcontentloaded'});const heading=docs.getByRole('heading',{name:'Local saved checkpoints',exact:true});await heading.waitFor({timeout:120000});await heading.scrollIntoViewIfNeeded();
 const text=await docs.locator('main').innerText();assert.match(text,/Checkpoints only/);assert.match(text,/Retry recording/);assert.match(text,/same browser origin/);report.checks.documentation={url:docs.url(),checkpointOnly:true,retention:true};await docs.screenshot({path:path.join(output,'checkpoint-docs.png')});await docs.close();
 await fs.writeFile(path.join(output,'milestone-witnesses.json'),JSON.stringify(report.checks,null,2)+'\n');
 report.checks.base=execFileSync('python3',['tools/verify/e9-disk-roots-files.py','prepare','--output',output],{cwd:root,encoding:'utf8'}).trim();
 report.checks.oracle=execFileSync('python3',['tools/verify/e9-checkpoint-milestone-files.py','--output',output],{cwd:root,encoding:'utf8'}).trim();
 assert.deepEqual(report.errors,[]);report.status='passed';console.log('Two fresh guests, exact input/RAM/disk restores, rename, quota and retained sibling passed.');
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
 for(const p of instrumented)await seal(p).catch(e=>{report.coverageFailure=e.message;report.status='failed';process.exitCode=1;});
 await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(coverage));
 if(page&&!page.isClosed()&&report.status==='failed')await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
 if(context){await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context.close().catch(()=>{});}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 report.source_sha256={};for(const name of ['web/session-store.js','web/session-library.js','web/session-library.css','web/main.js','web/index.html','web/loader.js','web/roadmap.js','web/session-checkpoints.js','web/session-disk-roots.js','web/gpu-checkpoint-build.js','web/docs-source/guides/storage.md','tools/verify/e9-checkpoint-milestone-browser.mjs','tools/verify/e9-checkpoint-milestone-files.py','tools/verify/e9-disk-roots-files.py'])report.source_sha256[name]=sha(await fs.readFile(path.join(root,name)));
 report.files=[];async function inventory(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await inventory(file);else if(entry.isFile()&&file!==path.join(output,'report.json')){const bytes=await fs.readFile(file);report.files.push({path:path.relative(output,file),bytes:bytes.length,sha256:sha(bytes)});}}}
 await inventory(output);report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
