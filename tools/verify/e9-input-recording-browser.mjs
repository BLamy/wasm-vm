#!/usr/bin/env node
// Recorded real-device delivery, durable prefix reload, worker UI and actual Linux file ingress.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(arg('--output'));const output=path.resolve(arg('--output')),development=process.argv.includes('--development'),remote=arg('--url');
if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const web=path.join(root,development?'web':'web/dist'),sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E9-T10',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),checks:{},commands:[],errors:[]};
await fs.mkdir(output,{recursive:false});let server,context,page,filePage,progress,commandId=0;const coverage=[];
const save=(name,value)=>fs.writeFile(path.join(output,name),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
const receiptShape=r=>[r.transition,r.phase,r.ordinal,r.sequence,r.retired,r.channel,r.outcome,sha(Uint8Array.from(r.bytes))];
async function instrument(p){await p.coverage.startJSCoverage({resetOnNavigation:false});p.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});p.on('pageerror',e=>report.errors.push(e.message));}
async function seal(p){if(p&&!p.isClosed())coverage.push(...await p.coverage.stopJSCoverage().catch(()=>[]));}
async function idle(){await page.waitForFunction(()=>window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading',null,{timeout:240000});}
async function click(name){await page.locator(`[data-session="${name}"]`).click();await idle();}
async function inspect(p,database,id,label){
 const value=await p.evaluate(async({database,id})=>{const{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js');const store=await SessionStore.open(database);
  try{const opened=await store.openSession(id),r=await SessionInputJournal.read(store,id);return{revision:opened.revision,manifest:r.manifest,receipts:r.receipts.map(x=>({...x,bytes:[...x.bytes]}))};}finally{await store.close();}},{database,id});
 await save(label+'.json',value);assert.equal(value.manifest.policy.mode,'capture-prefix');
 const packet=await p.evaluate(async({database,id})=>{const{SessionStore}=await import('./session-store.js'),{readCheckpointObject}=await import('./session-checkpoints.js'),{sessionEventReferences}=await import('./session-pkg/wasm_vm_session.js');
  const store=await SessionStore.open(database);try{const opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest)),refs=new Map();
   for(const index of manifest.events){refs.set(index.content.sha256,index.content);const bytes=await readCheckpointObject(store,index.content,4194304);for(const ref of JSON.parse(new TextDecoder().decode(sessionEventReferences(opened.manifest,bytes))))refs.set(ref.sha256,ref);}
   refs.set(manifest.checkpoints[0].machine.sha256,manifest.checkpoints[0].machine);
   const files=[];for(const ref of refs.values()){try{const bytes=await readCheckpointObject(store,ref,302*1048576+28);
    const source=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
    const gzip=new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let data='';for(let at=0;at<gzip.length;at+=32766)data+=btoa(String.fromCharCode(...gzip.subarray(at,at+32766)));files.push({ref,gzip:data});
   }catch(error){throw Error('export object '+ref.sha256+' ('+ref.length+' bytes): '+String(error));}}
   return{manifest:[...opened.manifest],files};}finally{await store.close();}},{database,id});
 await save(label+'.manifest.json',Uint8Array.from(packet.manifest));await fs.mkdir(path.join(output,label+'-objects'),{recursive:true});
 for(const file of packet.files)await save(label+'-objects/'+file.ref.sha256+'.gz',Buffer.from(file.gzip,'base64'));
 let sequence=BigInt(value.manifest.begin.sequence);for(const r of value.receipts){assert.equal(BigInt(r.sequence),++sequence);assert.equal(r.phase,'before');}
 assert.equal(sequence,BigInt(value.manifest.end.sequence));return value;
}
async function command(text){
 const id='E9I'+(++commandId),start='\x1e'+id+'B\x1f',end='\x1e'+id+'E:';
 await filePage.evaluate(({text,id})=>__inputFileCtl.sendInput(new TextEncoder().encode(`printf '\\036${id}B\\037'; ${text}; e9_rc=$?; printf '\\036${id}E:%s\\037' "$e9_rc"\r`)),{text,id});
 await filePage.waitForFunction(end=>__inputFileOut.includes(end)&&__inputFileOut.slice(__inputFileOut.indexOf(end)+end.length).includes('\x1f'),end,{timeout:240000});
 const result=await filePage.evaluate(({start,end})=>{const from=__inputFileOut.indexOf(start)+start.length,to=__inputFileOut.indexOf(end,from),tail=__inputFileOut.slice(to+end.length);return{stdout:__inputFileOut.slice(from,to).replaceAll('\r\n','\n'),exit:Number(tail.slice(0,tail.indexOf('\x1f')))};},{start,end});
 report.commands.push({command:text,...result});console.log('guest command:',text,'exit',result.exit,'output bytes',result.stdout.length);assert.equal(result.exit,0,JSON.stringify(result).slice(0,512));return result.stdout;
}
try{
 if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
 if(!remote){
  const fallback=new Map();for(const name of ['artifacts-alpine.json','artifacts.json'])for(const a of Object.values(JSON.parse(await fs.readFile(path.join(web,name),'utf8')).artifacts)){const p='/'+a.url.replace(/^\.\//,'');fallback.set(p,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+a.sha256+p);}
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
  server=createServer(async(request,response)=>{try{let p=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(p==='/favicon.ico'){response.writeHead(204).end();return;}if(development&&p==='/app.html')p='/index.html';const file=path.resolve(web,'.'+p);if(!file.startsWith(web+path.sep))throw Error('path');
   let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'&&fallback.has(p)){response.writeHead(302,{Location:fallback.get(p)}).end();return;}throw error;}
   response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  }catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 }
 report.url=new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',remote||`http://127.0.0.1:${server.address().port}/`).href;
 context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0]??await context.newPage();await instrument(page);
 await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});await idle();
 if(remote){report.assets=[];for(const name of ['app.html','main.js','input-recording-probe.js','session-inputs.js','session-library.js','session-store.js','session-checkpoints.js','session-disk-roots.js','loader.js','linux-worker-protocol.js','roadmap.js','gpu-checkpoint-build.js','tasks.json','src/input/pointer.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){const r=await context.request.get(new URL(name,remote).href);assert.equal(r.status(),200,name);const b=await r.body();assert.equal(sha(b),sha(await fs.readFile(path.join(web,name))),name);report.assets.push({name,bytes:b.length,sha256:sha(b)});}}
 console.log('Running built-page suite and real delivery probe');
 await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});
 const clockPanel=page.locator('#event-clock-panel');await clockPanel.locator('summary').focus();await page.keyboard.press('Enter');await page.locator('#event-clock-run').click();
 await page.waitForFunction(()=>['passed','failed'].includes(document.querySelector('#event-clock-status')?.dataset.status),null,{timeout:240000});
 const clock=await page.evaluate(()=>{const r=__eventClockReport;return{...r,frames:r.frames?.map(f=>({...f,bytes:[...f.bytes]}))};});
 assert.equal(clock.status,'passed',clock.failure);assert.equal(clock.cases.length,16);assert.equal(clock.refusals.length,10);
 await fs.mkdir(path.join(output,'event-clock-regression'));for(const f of clock.frames)await save('event-clock-regression/'+f.name+'.resume',Uint8Array.from(f.bytes));for(const t of clock.traces)await save('event-clock-regression/'+t.name+'.trace',t.text);
 await save('event-clock-regression/probe.json',{...clock,frames:clock.frames.map(f=>({name:f.name,bytes:f.bytes.length,sha256:sha(Uint8Array.from(f.bytes))}))});
 report.checks.eventClock={cases:clock.cases,refusals:clock.refusals};
 const panel=page.locator('#input-recording-panel');await panel.locator('summary').focus();await page.keyboard.press('Enter');await page.locator('#input-recording-run').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!!window.__inputRecordingReport,null,{timeout:120000});
 const probe=await page.evaluate(()=>{const r=__inputRecordingReport;return{...r,initial:r.initial?{native:[...r.initial.native],disk:[...r.initial.disk]}:null,guestBytes:r.guestBytes?[...r.guestBytes]:null,receipts:r.receipts?.map(x=>({...x,bytes:[...x.bytes]}))};});assert.equal(probe.status,'passed',probe.failure);assert.equal(probe.receipts.length,24);assert.equal(probe.refusals.length,15);assert.equal(probe.gatedMutations.length,24);
 await save('probe-initial.resume',Uint8Array.from(probe.initial.native));await save('probe-initial.disk',Uint8Array.from(probe.initial.disk));await save('probe-guest.bin',Uint8Array.from(probe.guestBytes));
 report.checks.probe={...probe,initial:{native:probe.initial.native.length,disk:probe.initial.disk.length},guestBytes:{bytes:probe.guestBytes.length,sha256:sha(Uint8Array.from(probe.guestBytes))},receipts:probe.receipts.map(r=>({key:receiptShape(r),bytes:r.bytes.length}))};
 await save('probe.json',report.checks.probe);assert.match(await page.locator('#input-recording-pip').getAttribute('class'),/\blive\b/);assert.match(await page.locator('.cap',{hasText:'Delivered user input recording'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 await panel.screenshot({path:path.join(output,'input-desktop.png')});await page.setViewportSize({width:390,height:844});report.checks.mobile=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width+1);await panel.screenshot({path:path.join(output,'input-mobile.png')});await page.setViewportSize({width:1440,height:1000});
 const bulk=await inspect(page,probe.database,probe.bulk.id,'bulk-prefix');assert.equal(bulk.receipts.length,64);assert.ok(bulk.manifest.events.length>1);report.checks.bulk=probe.bulk;
 const persisted=await inspect(page,probe.database,probe.id,'probe-prefix');assert.deepEqual(persisted.receipts.map(receiptShape),probe.receipts.map(receiptShape));
 await seal(page);await instrument(page);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true);await idle();const reloaded=await inspect(page,probe.database,probe.id,'probe-prefix-after-reload');assert.deepEqual(reloaded,persisted);report.checks.reload={events:reloaded.receipts.length,end:reloaded.manifest.end};
 console.log('Exercising visible input recording on the actual whole-machine-worker guest');
 await click('new');const uiProgress=setInterval(()=>console.log('Waiting for the worker software guest shell'),20000);try{await page.waitForFunction(()=>window.wvmDemo?.isGuestReady(),null,{timeout:240000});}finally{clearInterval(uiProgress);}
 await page.evaluate(async()=>{await __linuxCtl.pause();__linuxCtl.sendInput(new TextEncoder().encode('e9_initial=queued-before-recording\n'));});await click('start');assert.equal(await page.locator('#session-library').getAttribute('data-state'),'ready');await click('stop');
 const legacy=await page.evaluate(()=>__sessionLibrary.preview.manifest.checkpoints.at(-1));await click('open');
 const restored=await page.evaluate(async()=>{const{checkpointHash}=await import('./session-checkpoints.js');return{hash:checkpointHash(await __linuxCtl.captureSoftwareCheckpoint()),paused:await __linuxCtl.isPaused(),scheduler:await __linuxCtl.schedulerStats()};});
 assert.equal(restored.hash,legacy.machine.sha256);assert.equal(restored.paused,true);assert.equal(restored.scheduler.slices,0);report.checks.checkpointRegression=restored;
 await click('input-start');assert.equal(await page.locator('#session-library').getAttribute('data-state'),'ready',await page.locator('[data-session="status"]').innerText());
 const uiId=await page.evaluate(()=>__sessionLibrary.inputRecording.id);assert.equal(await page.evaluate(()=>__linuxCtl.isPaused()),true);
 await click('resume');const uiCommand=await page.evaluate(()=>wvmDemo.exec("test \"$e9_initial\" = queued-before-recording && printf 'input-prefix-ui\\n' > /root/e9-input-ui && cat /root/e9-input-ui",180000,{quiet:true}));assert.equal(uiCommand.exit,0,JSON.stringify(uiCommand));assert.match(uiCommand.stdout,/input-prefix-ui/);
 await page.evaluate(async()=>{await __linuxCtl.pause();await __linuxCtl.sendKeyboardEvent(1,42,1);await __linuxCtl.syncKeyboard();await __linuxCtl.sendKeyboardEvent(1,30,1);await __linuxCtl.syncKeyboard();await __linuxCtl.sendKeyboardEvent(1,30,0);await __linuxCtl.syncKeyboard();await __linuxCtl.sendKeyboardEvent(1,42,0);await __linuxCtl.syncKeyboard();});await click('input-save');const uiPrefix=await inspect(page,undefined,uiId,'worker-ui-prefix');assert.ok(uiPrefix.receipts.some(r=>r.channel===2));assert.ok(uiPrefix.receipts.some(r=>r.channel===4));
 await click('input-stop');assert.equal(await page.evaluate(()=>__linuxCtl.isPaused()),true);assert.equal(await page.locator('[data-session="open"]').isDisabled(),true);assert.match(await page.locator('[data-session="details"]').innerText(),/Incomplete capture/);await page.locator('#session-library').screenshot({path:path.join(output,'worker-ui-stopped.png')});
 report.checks.workerUI={id:uiId,command:uiCommand,position:await page.evaluate(()=>__linuxCtl.inputPosition()),events:uiPrefix.receipts.length};await page.evaluate(async()=>{const{stopLinuxController}=await import('./linux-worker-host.js');await stopLinuxController(__linuxCtl);});
 console.log('Booting actual Linux WVFT peer; no host filesystem fixture is substituted');
 filePage=await context.newPage();await instrument(filePage);await filePage.goto(report.url,{waitUntil:'domcontentloaded'});await filePage.waitForFunction(()=>window.__ready===true);
 await filePage.evaluate(async()=>{const{startLinuxBoot}=await import('./loader.js'),fixture=await(await fetch('./session-software-fixture.json')).json();globalThis.__inputFileOut='';globalThis.__inputFileCtl=await startLinuxBoot({manifestUrl:fixture.boot_manifest,mode:'chunked',imageManifestUrl:fixture.image_manifest,baseUrl:fixture.base_url,bootProfileUrl:null,persist:false,bootSnapshot:false,ramMib:256,bootargs:fixture.bootargs,guestClock:'icount',icountDivider:10,slirpNet:true,slirpProvider:'offline',slirpDoh:'',enableMic:false,quantum:100000,onOutput:bytes=>{__inputFileOut+=new TextDecoder().decode(bytes);},onError:error=>{globalThis.__inputFileError=String(error);}});});
 progress=setInterval(()=>filePage.evaluate(()=>({tail:__inputFileOut.slice(-100),status:__inputFileCtl.fileTransferStatus(),position:__inputFileCtl.inputPosition()})).then(r=>console.log('guest progress',JSON.stringify(r))).catch(()=>{}),20000);
 await filePage.waitForFunction(()=>__inputFileOut.includes('/ #')||__inputFileOut.includes('~ #'),null,{timeout:240000});
 await command('mount -t proc proc /proc 2>/dev/null || true; mount -t sysfs sysfs /sys 2>/dev/null || true; mount -t devtmpfs devtmpfs /dev 2>/dev/null || true; ip link set lo up; ip link set eth0 up; ip addr add 10.0.2.15/24 dev eth0 2>/dev/null || true; mkdir -p /var/lib/wasm-vm/transfer/inbox /var/lib/wasm-vm/transfer/outbox; /usr/libexec/wasm-vm/wvft-agent service >/tmp/e9-wvft.log 2>&1 & e9_agent=$!');
 await filePage.waitForFunction(()=>__inputFileCtl.fileTransferReady(0),null,{timeout:240000});
 const database='wasm-vm-sessions-v1-e9-input-file-proof',id='file-input-proof';await filePage.evaluate(async({database,id})=>{await __inputFileCtl.pause();await __inputFileCtl.startInputRecording({database,id});__inputFileCtl.resume();},{database,id});
 const payload=Uint8Array.from({length:131129},(_,i)=>(i*37+71)&255),hash=sha(payload);
 const stream=await filePage.evaluate(({bytes,hash})=>{const source=Uint8Array.from(bytes),stream=__inputFileCtl.beginFileUpload(0,'e9-input-proof.bin',source.length,hash);__inputFileCtl.pushFileUpload(stream,source,true);source.fill(255);return stream;},{bytes:[...payload],hash});
 await filePage.waitForFunction(stream=>__inputFileCtl.fileTransferStatus().uploads.some(u=>u.id===stream&&u.state==='complete'),stream,{timeout:240000});
 const received=Buffer.from((await command('base64 /var/lib/wasm-vm/transfer/inbox/e9-input-proof.bin')).replace(/\s/g,''),'base64');assert.deepEqual(received,Buffer.from(payload));await save('linux-guest-file.bin',received);
 const cancelled=await filePage.evaluate(hash=>{const stream=__inputFileCtl.beginFileUpload(0,'e9-cancelled.bin',131129,hash);const chunk=Uint8Array.from({length:65528},(_,i)=>(i*37+71)&255);__inputFileCtl.pushFileUpload(stream,chunk,false);chunk.fill(255);return stream;},hash);
 const partial=Buffer.from((await command('while :; do set -- /var/lib/wasm-vm/transfer/inbox/.wvft-*.part; test -s "$1" && break; sleep 0.01; done; base64 "$1"')).replace(/\s/g,''),'base64');assert.deepEqual(partial,Buffer.from(payload.subarray(0,65528)));await save('linux-guest-partial.bin',partial);
 await filePage.evaluate(stream=>__inputFileCtl.cancelFileUpload(stream),cancelled);
 const cancelledPrivate=Buffer.from((await command('e9_open=1; e9_tries=0; while test "$e9_open" = 1 && test "$e9_tries" -lt 128; do e9_open=0; for e9_fd in /proc/$e9_agent/fd/*; do case "$(readlink "$e9_fd" 2>/dev/null)" in *.part) e9_open=1;; esac; done; test "$e9_open" = 0 || sleep 0.01; e9_tries=$((e9_tries+1)); done; test "$e9_open" = 0 && test ! -e /var/lib/wasm-vm/transfer/inbox/e9-cancelled.bin && set -- /var/lib/wasm-vm/transfer/inbox/.wvft-*.part && base64 "$1"')).replace(/\s/g,''),'base64');assert.deepEqual(cancelledPrivate,partial);await save('linux-cancelled-private.bin',cancelledPrivate);
 report.checks.cancelledLate=await filePage.evaluate(stream=>{try{__inputFileCtl.pushFileUpload(stream,new Uint8Array([1,2,3]),false);throw Error('late cancelled upload was admitted');}catch(error){if(String(error).includes('was admitted'))throw error;return String(error);}},cancelled);
 await filePage.evaluate(()=>__inputFileCtl.pause());
 const beforeQuota=await inspect(filePage,database,id,'file-prefix-before-quota');
 report.checks.quota=await filePage.evaluate(async({database,id})=>{const{SessionStore}=await import('./session-store.js'),{checkpointHash}=await import('./session-checkpoints.js');const store=await SessionStore.open(database);
  try{const before=await store.openSession(id),old=(await store.statistics()).limits;await store.setRetention({maxBytes:4194304,maxCheckpoints:old.maxCheckpoints});__inputFileCtl.sendKeyboardEvent(1,48,1);__inputFileCtl.syncKeyboard();let error;try{await __inputFileCtl.flushInputRecording();}catch(e){error=String(e);}if(!error)throw Error('retention pressure did not refuse');const after=await store.openSession(id),paused=__inputFileCtl.isPaused();await store.setRetention(old);await __inputFileCtl.flushInputRecording();__inputFileCtl.sendKeyboardEvent(1,48,0);__inputFileCtl.syncKeyboard();await __inputFileCtl.flushInputRecording();return{error,paused,before:checkpointHash(before.manifest),after:checkpointHash(after.manifest)};}finally{await store.close();}},{database,id});
 assert.equal(report.checks.quota.before,report.checks.quota.after);assert.equal(report.checks.quota.paused,true);assert.match(report.checks.quota.error,/RetentionLimit|Quota/);
 report.checks.concurrentStop=await filePage.evaluate(async id=>{
  let observed;const stored=new Promise(resolve=>{observed=resolve;});
  globalThis.__e9SessionStoreProbe=event=>{if(event.id===id&&event.phase==='chunk-durable')observed();};
  try{__inputFileCtl.sendKeyboardEvent(1,46,1);__inputFileCtl.syncKeyboard();const saving=__inputFileCtl.flushInputRecording();
   await stored;__inputFileCtl.sendKeyboardEvent(1,46,0);__inputFileCtl.syncKeyboard();const tail=__inputFileCtl.flushInputRecording(),stopping=__inputFileCtl.stopInputCapture();
   await Promise.all([saving,tail,stopping]);return __inputFileCtl.inputPosition();
  }finally{delete globalThis.__e9SessionStoreProbe;}
 },id);const final=await inspect(filePage,database,id,'file-prefix-final');
 assert.equal(final.manifest.end.sequence,report.checks.concurrentStop.sequence);assert.equal(final.receipts.at(-1).channel,16);assert.deepEqual(final.receipts.at(-1).bytes,[2]);
 assert.ok(final.receipts.some(r=>r.channel===3&&JSON.stringify(r.bytes)==='[1,0,46,0,0,0,0,0]'));

 const chunks=final.receipts.filter(r=>r.channel===13&&r.outcome[0]==='0');assert.ok(chunks.some(r=>sha(Uint8Array.from(r.bytes.slice(5)))===hash));assert.ok(final.receipts.some(r=>r.channel===14&&r.outcome[0]==='0'));assert.ok(final.receipts.some(r=>r.channel===13&&r.outcome[0]==='1'&&r.outcome[3]==='12'));
 assert.ok(BigInt(final.manifest.end.sequence)>BigInt(beforeQuota.manifest.end.sequence));
 report.checks.file={stream,cancelled,bytes:received.length,sha256:sha(received),partialBytes:partial.length,partialSha256:sha(partial),events:final.receipts.length,end:final.manifest.end,stateDigest:await filePage.evaluate(()=>__inputFileCtl.stateDigest())};
 await filePage.evaluate(()=>__inputFileCtl.stop());
 const other=await context.newPage();await instrument(other);await other.goto(report.url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.__ready===true);const tab=await inspect(other,database,id,'file-prefix-fresh-tab');assert.deepEqual(tab,final);await seal(other);await other.close();
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;
 if(page)report.uiDiagnostics=await page.evaluate(()=>({state:globalThis.__linuxBootStateForTest?.(),status:document.querySelector('[data-session="status"]')?.textContent,tail:globalThis.__consoleBytes?.slice(-1500)})).catch(e=>String(e));
 if(filePage)report.diagnostics=await filePage.evaluate(()=>({error:globalThis.__inputFileError,out:globalThis.__inputFileOut?.slice(-2000),status:globalThis.__inputFileCtl?.fileTransferStatus?.(),position:globalThis.__inputFileCtl?.inputPosition?.()})).catch(e=>String(e));
}
finally{
 clearInterval(progress);await seal(page);await seal(filePage);await save('javascript-coverage.json.gz',gzipSync(JSON.stringify(coverage)));
 if(filePage)await filePage.evaluate(()=>globalThis.__inputFileCtl?.stop?.()).catch(()=>{});
 if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context?.close();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 report.source_sha256={};for(const name of ['web/index.html','web/main.js','web/loader.js','web/linux-worker-protocol.js','web/input-recording-probe.js','web/session-inputs.js','web/session-library.js','web/gpu-checkpoint-build.js','web/pkg/wasm_vm_wasm_bg.wasm','web/session-pkg/wasm_vm_session_bg.wasm','crates/core/src/session_clock.rs','crates/core/src/dev/virtio/input/mod.rs','crates/wasm/src/lib.rs','crates/wasm/src/session_input.rs','crates/wasm/src/session_input/browser.rs','crates/storage/src/session.rs','tools/verify/e9-input-recording-browser.mjs'])report.source_sha256[name]=sha(await fs.readFile(path.join(root,name)));
 report.finished=new Date().toISOString();await save('report.json',report);console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,file:report.checks.file}));
}
