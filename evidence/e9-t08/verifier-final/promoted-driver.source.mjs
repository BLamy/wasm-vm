#!/usr/bin/env node
// Promoted fresh-verifier attack: durable literal metadata must not change a saved tuple.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const argument=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(argument('--evidence')&&argument('--output'),'--evidence and --output are required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=path.resolve(argument('--evidence')),out=path.resolve(argument('--output'));
assert.notEqual(out,evidence);assert.ok(!out.startsWith(evidence+path.sep),'critic output must be outside original browser evidence');
const sha=data=>createHash('sha256').update(data).digest('hex');
const witnesses=JSON.parse(await fs.readFile(path.join(evidence,'milestone-witnesses.json'),'utf8')),witness=witnesses.beta,alpha=witnesses.alpha;
const alphaRaw=gunzipSync(await fs.readFile(path.join(evidence,alpha.evidence)));
assert.equal(sha(alphaRaw),alpha.frameHash);
const alphaPoint=alpha.manifest.checkpoints.find(point=>point.id===alpha.point);
let componentOffset=212;for(let i=0;i<2;i++)componentOffset+=Number(alphaRaw.readBigUInt64LE(12+i*40));
const diskLength=Number(alphaRaw.readBigUInt64LE(12+2*40)),alphaDisk=alphaRaw.subarray(componentOffset,componentOffset+diskLength);
assert.equal(alphaDisk.subarray(0,5).toString(),'WVOD1');
const leaves=[];for(let i=0;i<alphaDisk.readUInt32LE(57);i++){const at=61+i*4104;leaves.push({index:String(alphaDisk.readBigUInt64LE(at)),sha256:sha(alphaDisk.subarray(at+8,at+4104))});}
const alphaRoot={version:{major:1,minor:0},base:alphaDisk.subarray(17,49).toString('hex'),image_len:String(alphaDisk.readBigUInt64LE(9)),generation:String(alphaDisk.readBigUInt64LE(49)),blocks:leaves};
assert.equal(sha(Buffer.from(JSON.stringify(alphaRoot))),alphaPoint.disk_root);
const originalBytes=await fs.readFile(path.join(evidence,'report.json')),original=JSON.parse(originalBytes);
assert.equal(original.status,'passed');assert.equal(original.development,false);
const origin=new URL(original.url),port=Number(origin.port),web=path.join(root,'web/dist');
assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');assert.ok(Number.isInteger(port)&&port>0);
const report={task:'E9-T08',prediction:'N1',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),evidence_head:original.head,original_report_sha256:sha(originalBytes),witness_sha256:sha(await fs.readFile(path.join(evidence,'milestone-witnesses.json'))),source_sha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),origin:origin.origin,beta:witness.id,point:witness.point,expectedHash:witness.frameHash,checks:[],errors:[]};
await fs.mkdir(out,{recursive:false});
const profile=path.join(out,'cloned-profile');
console.log('Cloning closed original profile to isolated verifier directory');
await fs.cp(path.join(evidence,'chromium-profile'),profile,{recursive:true,filter:source=>!/^Singleton(?:Cookie|Lock|Socket)$/.test(path.basename(source))});
const fallback=new Map();
for(const name of ['artifacts-alpine.json','artifacts-omarchy-virgl.json'])for(const asset of Object.values(JSON.parse(await fs.readFile(path.join(web,name),'utf8')).artifacts)){
const pathname='/'+asset.url.replace(/^\.\//,'');fallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
}
let context;
const server=createServer(async(req,res)=>{try{
const pathname=new URL(req.url,origin).pathname;
if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
const base=pathname.startsWith('/releases/')?root:web,filename=path.resolve(base,'.'+decodeURIComponent(pathname));
if(!filename.startsWith(base+path.sep)){res.writeHead(404).end();return;}
let data;try{data=await fs.readFile(filename);}catch(error){if(error.code==='ENOENT'&&fallback.has(pathname)){res.writeHead(302,{Location:fallback.get(pathname)}).end();return;}throw error;}
const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'}[path.extname(filename)]??'application/octet-stream';
res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(data);
}catch(error){res.writeHead(404).end();}});
const check=(name,details)=>report.checks.push({check:name,...details});
const c=(page,name)=>page.locator(`[data-session="${name}"]`);
async function ready(page){await page.waitForFunction(()=>window.__ready===true&&window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading',null,{timeout:240000});}
function instrument(page){page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});}
async function openOriginal(page,label,selected=witness){
await c(page,'sessions').selectOption(selected.id);await ready(page);await c(page,'points').selectOption(selected.point);await c(page,'open').click();await ready(page);
const state=await page.evaluate(async(label)=>{
const raw=await __linuxCtl.captureSoftwareCheckpoint();
const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),contextLength=Number(view.getBigUint64(12,true));
const context=JSON.parse(new TextDecoder().decode(raw.subarray(212,212+contextLength)));
let inputAt=212;for(let i=0;i<3;i++)inputAt+=Number(view.getBigUint64(12+i*40,true));
const input=new TextDecoder().decode(raw.subarray(inputAt,inputAt+Number(view.getBigUint64(132,true))));
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
await fetch('./__e9-verifier-proof/'+label+'.checkpoint.gz',{method:'POST',body:compressed});
return {hash:digest,bytes:raw.length,held:context.held,input,paused:await __linuxCtl.isPaused(),scheduler:await __linuxCtl.schedulerStats(),id:document.querySelector('[data-session="active"]').dataset.id,point:document.querySelector('[data-session="active"]').dataset.point};
},label);
assert.equal(state.hash,selected.frameHash);assert.deepEqual(state.held,selected.held);assert.equal(state.input,selected.input);assert.equal(state.paused,true);assert.equal(state.scheduler.slices,0);assert.equal(state.id,selected.id);assert.equal(state.point,selected.point);check(label,state);
}
try{
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
await context.route('**/__e9-verifier-source/alpha.checkpoint.gz',async route=>route.fulfill({status:200,contentType:'application/gzip',body:await fs.readFile(path.join(evidence,alpha.evidence))}));
await context.route('**/__e9-verifier-proof/*',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^[a-z-]+\.checkpoint\.gz$/);await fs.writeFile(path.join(out,name),route.request().postDataBuffer());await route.fulfill({status:204,body:''});});
const page=context.pages()[0]??await context.newPage();instrument(page);await page.goto(original.url,{waitUntil:'domcontentloaded'});await ready(page);
assert.equal(await c(page,'active').getAttribute('data-id'),'');
const rehydrated=await page.evaluate(async({alpha,beta,expectedRoot})=>{
const store=__sessionLibrary.store,{SessionCheckpoints,readCheckpointObject}=await import('./session-checkpoints.js');
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const betaOpened=await store.openSession(beta.id),betaManifest=JSON.parse(new TextDecoder().decode(betaOpened.manifest));
const configuration=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,betaManifest.assets.find(asset=>asset.role==='vm').content)));
const response=await fetch('./__e9-verifier-source/alpha.checkpoint.gz'),frame=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
const before=await digest(frame);if(before!==alpha.frameHash)throw Error('original Alpha frame changed before rehydration');
const writer=await store.writer(alpha.id);try{await new SessionCheckpoints(store).save(writer,alpha.point,frame,configuration);}finally{await writer.release();}
const opened=await store.openSession(alpha.id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest)),point=manifest.checkpoints.find(point=>point.id===alpha.point),stored=await readCheckpointObject(store,point.machine),after=await digest(stored);
if(before!==after||point.disk_root!==expectedRoot)throw Error('rehydrated Alpha identity changed');
const next=new Map(__sessionLibrary.metadata);next.set(alpha.id,{id:alpha.id,name:'Rehydrated original Alpha',started:0,updated:0,points:[]});__sessionLibrary.persistMetadata(next);await __sessionLibrary.refresh(alpha.id);
return {before,after,disk_root:point.disk_root,shared_configuration:configuration.runtime};
},{alpha,beta:witness,expectedRoot:alphaPoint.disk_root});
assert.equal(rehydrated.before,alpha.frameHash);assert.equal(rehydrated.after,alpha.frameHash);assert.equal(rehydrated.disk_root,alphaPoint.disk_root);check('rehydrated-original-alpha',rehydrated);
async function checkGuest(page,label){
await c(page,'resume').click();await ready(page);
const observed=await page.evaluate(async()=>({file:await wvmDemo.exec('base64 /root/e9-milestone/state',180000,{quiet:true}),memory:await wvmDemo.exec('printf "%s/%s" "$e9_memory" "$e9_queue"',180000,{quiet:true})}));
assert.equal(observed.file.exit,0);assert.equal(observed.file.stdout.trim(),Buffer.from(label+'-file\n').toString('base64'));assert.equal(observed.memory.exit,0);assert.equal(observed.memory.stdout.trim(),label+'-memory/queued-'+label);check('guest-'+label,observed);
}
await openOriginal(page,'independent-alpha-first',alpha);await checkGuest(page,'alpha');
await openOriginal(page,'before-rename');await checkGuest(page,'beta');
const literal='Beta <b id="e9-novel-marker">Ω & "quoted"</b>';
await c(page,'name').fill(literal);await c(page,'rename').click();await ready(page);
assert.equal(await c(page,'name').inputValue(),literal);assert.equal(await page.locator('#e9-novel-marker').count(),0);
check('renamed-literal',{name:literal,visibleOption:await c(page,'sessions').locator(`option[value="${witness.id}"]`).textContent()});
await page.reload({waitUntil:'domcontentloaded'});await ready(page);await c(page,'sessions').selectOption(witness.id);await ready(page);assert.equal(await c(page,'name').inputValue(),literal);assert.equal(await page.locator('#e9-novel-marker').count(),0);
check('reload-literal',{name:await c(page,'name').inputValue(),active:await c(page,'active').getAttribute('data-id')});
const fresh=await context.newPage();instrument(fresh);await fresh.goto(original.url,{waitUntil:'domcontentloaded'});await ready(fresh);await c(fresh,'sessions').selectOption(witness.id);await ready(fresh);
assert.equal(await c(fresh,'name').inputValue(),literal);assert.equal(await fresh.locator('#e9-novel-marker').count(),0);
await openOriginal(fresh,'fresh-tab-after-rename');
await fresh.locator('#session-library').screenshot({path:path.join(out,'literal-name-exact-restore.png')});
assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')});await context.close();}
server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
report.files=[];for(const name of ['independent-alpha-first.checkpoint.gz','before-rename.checkpoint.gz','fresh-tab-after-rename.checkpoint.gz','browser-trace.zip','literal-name-exact-restore.png']){try{const bytes=await fs.readFile(path.join(out,name));report.files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}catch{}}
assert.equal(sha(await fs.readFile(path.join(evidence,'report.json'))),report.original_report_sha256,'original report changed');
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
