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
import {chromium} from '../web/node_modules/playwright/index.mjs';
const root=process.cwd();
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
 await page.evaluate(async()=>{const{startLinuxBoot}=await import('./loader.js'),f=await(await fetch('./session-software-fixture.json')).json();
  globalThis.__raceCtl=await startLinuxBoot({manifestUrl:f.boot_manifest,mode:'chunked',imageManifestUrl:f.image_manifest,baseUrl:f.base_url,bootProfileUrl:null,persist:false,bootSnapshot:false,ramMib:256,bootargs:f.bootargs,guestClock:'icount',icountDivider:10,slirpNet:false,slirpProvider:'offline',slirpDoh:'',enableMic:false,startPaused:true,quantum:100000,onOutput:()=>{},onError:e=>{throw e;}});
  await __raceCtl.pause();await __raceCtl.startInputRecording({database:'wasm-vm-sessions-v1-race-precheck',id:'race'});
 });console.log('direct paused recorder ready');
 const quota=await page.evaluate(async()=>{const{SessionStore}=await import('./session-store.js'),{checkpointHash}=await import('./session-checkpoints.js');const store=await SessionStore.open('wasm-vm-sessions-v1-race-precheck');
  try{const before=await store.openSession('race'),limits=(await store.statistics()).limits;await store.setRetention({maxBytes:4194304,maxCheckpoints:limits.maxCheckpoints});__raceCtl.sendKeyboardEvent(1,48,1);__raceCtl.syncKeyboard();let failure;try{await __raceCtl.flushInputRecording();}catch(error){failure=String(error);}const after=await store.openSession('race');await store.setRetention(limits);await __raceCtl.flushInputRecording();__raceCtl.sendKeyboardEvent(1,48,0);__raceCtl.syncKeyboard();await __raceCtl.flushInputRecording();return{failure,before:checkpointHash(before.manifest),after:checkpointHash(after.manifest),position:__raceCtl.inputPosition()};}finally{await store.close();}
 });assert.match(quota.failure,/RetentionLimit/);assert.equal(quota.before,quota.after);console.log('quota retry passed',quota);
 const result=await page.evaluate(async()=>{
  const id="race";let observed;const stored=new Promise(resolve=>{observed=resolve;});
  globalThis.__e9SessionStoreProbe=event=>{if(event.id===id&&event.phase==='chunk-durable')observed();};
  try{__raceCtl.sendKeyboardEvent(1,46,1);__raceCtl.syncKeyboard();const saving=__raceCtl.flushInputRecording();
   await stored;__raceCtl.sendKeyboardEvent(1,46,0);__raceCtl.syncKeyboard();const tail=__raceCtl.flushInputRecording(),stopping=__raceCtl.stopInputCapture();await Promise.all([saving,tail,stopping]);
   const{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js');const store=await SessionStore.open('wasm-vm-sessions-v1-race-precheck');
   try{const saved=await SessionInputJournal.read(store,id);return{position:__raceCtl.inputPosition(),end:saved.manifest.end,receipts:saved.receipts.map(r=>({...r,bytes:[...r.bytes]}))};}finally{await store.close();}
  }finally{delete globalThis.__e9SessionStoreProbe;}
 });assert.equal(result.end.sequence,result.position.sequence);assert.equal(result.receipts.at(-1).channel,16);assert.deepEqual(result.receipts.at(-1).bytes,[2]);assert.ok(result.receipts.some(r=>r.channel===3&&r.bytes[4]===0));
 console.log(JSON.stringify({status:'passed',...result}));await save('result.json',result);assert.deepEqual(report.errors,[]);
}finally{await context?.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));}
