// Replay original Mesa resource lifetimes through the verified native store.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
assert.equal(head,process.argv[2]);
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const sources=new Map();
async function source(name){
 if(sources.has(name))return;
 const raw=await fs.readFile(path.join(repo,name));sources.set(name,raw);
 if(name.endsWith('.mjs'))for(const m of raw.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await source(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
}
await source('renderer/virgl-command/resources.mjs');
const workloads=[];
for(const name of ['compositor','glmark2-es2','kmscube']){
 const root='evidence/virgl-corpus/captures/'+name,manifestRaw=await fs.readFile(path.join(repo,root,'manifest.json')),manifest=JSON.parse(manifestRaw),raw=await fs.readFile(path.join(repo,root,manifest.events.path));
 assert.equal(raw.length,manifest.events.bytes);assert.equal(sha(raw),manifest.events.sha256);
 const events=raw.toString().trim().split('\n').map(JSON.parse),pending=new Map(),calls=[];
 for(const e of events){
  if(!['resource_create','resource_unref'].includes(e.type))continue;
  if(e.phase==='enter'){assert.ok(!pending.has(e.seq));pending.set(e.seq,e);}
  else{const enter=pending.get(e.callSeq);assert.ok(enter);assert.equal(e.result,0);pending.delete(e.callSeq);calls.push({enter,returned:e});}
 }
 assert.equal(pending.size,0);
 const bootstrap=calls.filter(c=>c.enter.type==='resource_create'&&c.enter.flags!==0);
 assert.equal(bootstrap.length,1);assert.equal(bootstrap[0].enter.seq,10);assert.equal(bootstrap[0].enter.resourceId,2);assert.equal(bootstrap[0].enter.flags,1);
 const live=new Set();let peak=0;
 for(const c of calls){if(c.enter.resourceId===2)continue;if(c.enter.type==='resource_create'){assert.ok(!live.has(c.enter.resourceId));live.add(c.enter.resourceId);peak=Math.max(peak,live.size);}else{assert.ok(live.delete(c.enter.resourceId));}}
 workloads.push({name,eventPath:root+'/'+manifest.events.path,eventSha256:sha(raw),manifestSha256:sha(manifestRaw),bootstrap2D:bootstrap[0],expectedPeak:peak,calls});
}
const record={schema:'original-resource-capacity-gap-v1',sourceHead:head,guestExecution:false,productionAuthority:false,sources:[...sources].map(([path,raw])=>({path,bytes:raw.length,sha256:sha(raw)})),workloads,browserErrors:[]};
let browser;
const server=createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Original resource capacity</title><canvas id="gpu"></canvas>');return;}if(p==='/favicon.ico'){res.writeHead(204).end();return;}const raw=sources.get(p.slice(1));if(!raw){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(raw);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
try{
 const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs'))),chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
 const cdp=await browser.newBrowserCDPSession(),system=await cdp.send('SystemInfo.getInfo'),command=await cdp.send('Browser.getBrowserCommandLine');
 assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(a)));
 record.browser={version:browser.version(),gpu:system.gpu,commandLine:command.arguments};
 const page=await browser.newPage();page.on('pageerror',e=>record.browserErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.browserErrors.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 record.results=await page.evaluate(async workloads=>{
  const m=await import('/renderer/virgl-command/resources.mjs'),gl=document.querySelector('#gpu').getContext('webgl2',{failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info'),rows=[];
  for(const w of workloads){
   const made=m.createStandardPackedDepthTransferBackend(gl);if(!made.ok)throw new Error(JSON.stringify(made));let allocations=0;
   const backend={...made.backend,allocate(...args){allocations++;return made.backend.allocate(...args);}},created=m.createStandardPackedDepthResourceStore({backend});if(!created.ok)throw new Error(JSON.stringify(created));
   const store=created.store,row={workload:w.name,operations:[],failure:null};
   for(const c of w.calls){
    const e=c.enter;if(e.resourceId===2)continue;
    const before=store.inspect(),beforeAllocations=allocations;
    const metadata=e.type==='resource_create'?{id:e.resourceId,...Object.fromEntries(['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'].map(k=>[k,e[k]]))}:null;
    const result=metadata?store.createResource(metadata):store.unref(e.resourceId),after=store.inspect();
    const step={seq:e.seq,type:e.type,resourceId:e.resourceId,metadata,result,before,after,allocationsBefore:beforeAllocations,allocationsAfter:allocations,glError:gl.getError()};row.operations.push(step);
    if(!result.ok){row.failure=step;break;}
   }
   row.dispose=store.dispose();row.final=store.inspect();rows.push(row);
  }
  return{gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),rows};
 },workloads);
 assert.deepEqual(record.browserErrors,[]);
 for(const row of record.results.rows){
  if(row.workload==='kmscube'){assert.equal(row.failure,null);continue;}
  assert.equal(row.failure.result.error.code,'limit-exceeded');assert.equal(row.failure.result.error.message,'Live/retained resource count limit exceeded.');assert.equal(row.failure.before.budgets.resources,16);assert.equal(row.failure.allocationsAfter,row.failure.allocationsBefore);
 }
 console.log(JSON.stringify({head,gpu:record.results.gpu,results:record.results.rows.map(r=>({workload:r.workload,failureSeq:r.failure?.seq??null,operations:r.operations.length}))}));
}finally{
 await fs.writeFile(process.argv[3],JSON.stringify(record,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));
}
