#!/usr/bin/env node
// Original full Omarchy cold workload and initial-to-end replay; no timing claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import{createServer}from'node:http';
import{createWriteStream}from'node:fs';
import{pipeline}from'node:stream/promises';
import{Transform}from'node:stream';
import{createHash}from'node:crypto';
import{gzipSync}from'node:zlib';
import{execFileSync}from'node:child_process';
import{chromium}from'../../web/node_modules/playwright/index.mjs';
import{WORKLOAD_ROOT as root,loadQualificationAssets,sha}from'./e9-workload-assets.mjs';
import{retainSessionStore}from'./e9-retain-session-store.mjs';
import{sealReplayStaticAssets}from'./e9-replay-static-assets.mjs';
const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--development'){assert(!options.development);options.development=true;}else{assert(key==='--output'&&!options.output&&process.argv[i+1]);options.output=process.argv[++i];}}assert(options.output);
const out=path.resolve(options.output),web=path.join(root,'web/dist');await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22c',phase:'desktop',scope:'Original cold Omarchy workload, RV64 EGL/GLES probe and whole-history replay; no timing claim',development:!!options.development,status:'running',head:null,dirty:null,started:new Date().toISOString(),errors:[],missing:[],external:[],raw:[],served:[],baseRequests:{record:0,replay:0},replayBlockedRequests:[],replayBlockedSockets:[],replayStaticRequests:[],workerFactoryAudits:[]};
let assets,probe,busyboxTransport,pageSource,scheduleSource,replayStaticAllow;
try{
 report.head=git('rev-parse','HEAD');report.dirty=git('status','--porcelain');
 if(!options.development)assert.equal(report.dirty,'','freeze source before accepted phase');
 assets=await loadQualificationAssets('desktop');report.inputs=assets.receipt;
 const tool=assets.qualification.auxiliaryDesktopTool;
 busyboxTransport=gzipSync(assets.busybox,{level:9});
 assert.equal(busyboxTransport.length,tool.transportBytes);assert.equal(sha(busyboxTransport),tool.transportSha256);
 report.auxiliaryTool={source:tool.sourcePath,sourceBytes:assets.busybox.length,sourceSha256:sha(assets.busybox),
   transportBytes:busyboxTransport.length,transportSha256:sha(busyboxTransport),guestPath:tool.guestPath};
 const probeDir=path.join(out,'probe-build');execFileSync('python3',['tools/verify/e9-build-performance-probe.py','--output',probeDir],{cwd:root,stdio:['ignore','pipe','pipe']});
 probe=await fs.readFile(path.join(probeDir,'session-gpu-probe-riscv64.elf'));
 const probeBuildBytes=await fs.readFile(path.join(probeDir,'report.json')),probeBuild=JSON.parse(probeBuildBytes);
 assert.equal(probeBuild.status,'built-not-executed');assert.equal(probeBuild.sourceSha256,'822b258f329ee2d16d7f25fa676684e02227531dbdf8bf5edbf7dc8b45868155');
 assert.equal(probeBuild.containerImage,'sha256:986b9aec6385491294c550e1a95275e05f56fa76b0581b606527f7871daefce8');
 assert.equal(probeBuild.binary.sha256,sha(probe));assert.equal(probeBuild.binary.bytes,probe.length);
 assert.match(probeBuild.elf,/Class:\s+ELF64/);assert.match(probeBuild.elf,/Machine:\s+RISC-V/);
 for(const soname of ['libEGL.so.1','libGLESv2.so.2'])assert(probeBuild.dynamic.includes('Shared library: ['+soname+']'),'linked '+soname);
 for(const pin of ['686d69940e99357eabbea48b5cccea1ae513c43773e033d48debfd83cddac897','9d57a842bdb448f7896bbaab81c3e438f123ff65eb2f222cf3ebab1a5dbed204'])assert(probeBuild.headersAndLibraries.includes(pin),'qualified sysroot library '+pin);
 report.probe={bytes:probe.length,sha256:sha(probe),build:sha(probeBuildBytes),buildDetails:probeBuild};
 pageSource=await fs.readFile(path.join(root,'tools/verify/e9-workload-desktop-page.mjs'));scheduleSource=await fs.readFile(path.join(root,'tools/verify/e9-workload-schedule.mjs'));report.executedSources=[];
 for(const name of ['tools/verify/e9-workload-desktop-browser.mjs','tools/verify/e9-workload-desktop-page.mjs','tools/verify/e9-workload-desktop-files.py','tools/verify/e9-workload-retained-closure.mjs','tools/verify/e9-replay-static-assets.mjs','tools/verify/e9-workload-schedule.mjs','tools/verify/e9-workload-assets.mjs','tools/verify/e9-build-performance-probe.py','docs/design/session-workload-qualification-v1.json','docs/design/session-workload-qualification-v2.json','docs/design/session-workload-qualification-v3.json','docs/design/session-workload-qualification-v4.json','docs/design/session-workload-qualification-v5.json','docs/design/session-workload-qualification-v6.json','docs/design/session-workload-qualification-v7.json','docs/design/session-workload-qualification-v8.json','docs/design/session-workload-qualification-v9.json','docs/design/session-gpu-probe.c','releases/initramfs/busybox']){const bytes=await fs.readFile(path.join(root,name));report.executedSources.push({path:name,sha256:sha(bytes)});const file=path.join(out,'executed-source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
 report.replayStaticAssets=await sealReplayStaticAssets(web);replayStaticAllow=new Map(report.replayStaticAssets.map(row=>[row.name,row]));
 assert.equal(report.executedSources.find(row=>row.path==='tools/verify/e9-workload-desktop-page.mjs').sha256,sha(pageSource),'served page is copied proof source');
 assert.equal(report.executedSources.find(row=>row.path==='tools/verify/e9-workload-schedule.mjs').sha256,sha(scheduleSource),'served schedule is copied proof source');
 await fs.writeFile(path.join(out,'image.json'),assets.imageBytes);await fs.writeFile(path.join(out,'contract.json'),assets.contractBytes);
}catch(error){report.status='failed';report.failure=String(error.stack??error);if(error.assetCloseError)report.assetCloseError=error.assetCloseError;
 try{await assets?.close();}catch(closeError){report.assetCloseError=String(closeError.stack??closeError);}
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');throw error;}
let browser,context,page,origin,currentPhase='record';const seen=new Map(),types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(req.method==='POST'){assert(/^\/__retain__\/[a-z0-9-]+\.(state|resume|json|bin)$/.test(name));const file=path.basename(name),hash=createHash('sha256');let bytes=0;const tap=new Transform({transform(part,encoding,done){bytes+=part.length;if(bytes>320*1048576)return done(Error('raw phase bound'));hash.update(part);done(null,part);}});await pipeline(req,tap,createWriteStream(path.join(out,file),{flags:'wx'}));const row={file,bytes,sha256:hash.digest('hex')};report.raw.push(row);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(row));return;}
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}let bytes,mime='application/octet-stream';
 if(name==='/'){bytes=Buffer.from('<!doctype html><title>Full Omarchy workload qualification</title><link rel="stylesheet" href="/vendor/xterm/xterm.css"><script src="/vendor/xterm/xterm.js"></script><script src="/vendor/xterm/addon-fit.js"></script><canvas width="640" height="480"></canvas><div id="terminal" style="width:800px;height:320px"></div><pre>Untimed original desktop workload; no timing claim.</pre>');mime='text/html';}
 else if(name==='/kernel.bin')bytes=assets.kernel;else if(name==='/image.json'){bytes=assets.imageBytes;mime='application/json';}else if(name==='/probe.elf')bytes=probe;else if(name==='/busybox.gz')bytes=busyboxTransport;else if(name==='/desktop.mjs'){bytes=pageSource;mime='text/javascript';}else if(name==='/contract.json'){bytes=assets.contractBytes;mime='application/json';}else if(name==='/e9-workload-schedule.mjs'){bytes=scheduleSource;mime='text/javascript';}
 else if(/^\/__chunk__\/[a-f0-9]{64}\.bin$/.test(name)){report.baseRequests[currentPhase]++;bytes=await assets.readChunk(path.basename(name,'.bin'));}
 else{const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));bytes=await fs.readFile(file);mime=types[path.extname(file)]??mime;const digest=sha(bytes);assert(!seen.has(name)||seen.get(name)===digest,'served source changed');if(!seen.has(name)){seen.set(name,digest);report.served.push({name,bytes:bytes.length,sha256:digest});}}
 res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.missing.push({url:req.url,error:String(error.stack??error)});if(!res.headersSent)res.writeHead(500);res.end();}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const profileDirectory=path.join(out,'chrome-profile');
 await assert.rejects(fs.stat(profileDirectory),{code:'ENOENT'},'fresh persistent profile');
 const hostBefore=await fs.statfs(out);report.hostFreeBytesBefore=String(BigInt(hostBefore.bavail)*BigInt(hostBefore.bsize));
 assert(BigInt(report.hostFreeBytesBefore)>=8n*1024n**3n,'host reserve before long browser capture');
 context=await chromium.launchPersistentContext(profileDirectory,{headless:true,
   executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],serviceWorkers:'block',viewport:{width:1200,height:900}});
 report.browserContext={mode:'fresh-persistent-user-data-dir',directory:profileDirectory};
 await context.route('**/*',route=>{const request=route.request(),url=request.url(),parsed=new URL(url);
   if(currentPhase==='replay'){const allowed=parsed.origin===origin&&request.method()==='GET'&&!parsed.search&&replayStaticAllow.has(parsed.pathname);
     if(!allowed){report.replayBlockedRequests.push({url,method:request.method()});return route.abort();}
     report.replayStaticRequests.push(replayStaticAllow.get(parsed.pathname));}
   return route.continue();});await context.routeWebSocket('**/*',socket=>{const url=socket.url();report.replayBlockedSockets.push({url,phase:currentPhase});socket.close();});await context.tracing.start({screenshots:true,snapshots:false,sources:true});page=await context.newPage();
 report.chromeVersion=await(await context.newCDPSession(page)).send('Browser.getVersion');
 assert.match(report.chromeVersion.product,/^Chrome\/[0-9.]+$/);
 report.browser=report.chromeVersion.product.slice('Chrome/'.length);
 assert.equal('Chrome '+report.browser,assets.qualification.referenceAmendment.qualificationBrowser,'declared browser profile');
 const replayWorkers=[],closedReplayWorkers=new Set();page.on('worker',worker=>{if(new URL(worker.url()).pathname==='/session-gpu-replay-worker.js'){replayWorkers.push(worker);worker.on('close',()=>closedReplayWorkers.add(worker));}});
 await page.exposeFunction('auditReplayWorker',async()=>{const live=replayWorkers.filter(worker=>!closedReplayWorkers.has(worker));const rows=await Promise.all(live.map(async worker=>({url:worker.url(),factoryEntries:await worker.evaluate(async()=>{const {WasmLinux}=await import('/pkg/wasm_vm_wasm.js');return WasmLinux.ownedLocalHttpFactoryEntries();})})));
   report.workerFactoryAudits.push(rows);return rows;});
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)report.external.push(r.url());});page.on('websocket',s=>report.external.push(s.url()));
 await page.exposeFunction('workloadProgress',async p=>{if(p.phase==='replay')currentPhase='replay';if(p.phase==='post-replay')currentPhase='post';await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(p,null,2)+'\n');console.log(JSON.stringify({position:p.position,receipts:p.receipts,blocks:p.blocks,checkpoints:p.checkpoints,phase:p.phase,tail:p.tail}));let stop=false;try{await fs.access(path.join(out,'STOP'));stop=true;}catch{}return{continue:!stop};});
 await fs.writeFile(path.join(out,'sealed-before-execution.json'),JSON.stringify({...report,origin},null,2)+'\n');
 await page.goto(origin+'/');
 report.browserStorageBefore=await page.evaluate(async()=>{const estimate=await navigator.storage.estimate();
   return{usage:estimate.usage,quota:estimate.quota,persisted:await navigator.storage.persisted()};});
 assert(report.browserStorageBefore.quota>=assets.qualification.retention.maxBytes,'browser quota for declared retention');
 report.result=await page.evaluate(async input=>{const{qualifyDesktopWorkload}=await import('/desktop.mjs');return qualifyDesktopWorkload(input.contract,input.qualification);},{contract:assets.contract,qualification:assets.qualification});
 report.hardware={source:'production-virgl-inspection',profile:report.result.physical};
 try{report.browserStorageAfter=await page.evaluate(async()=>{const estimate=await navigator.storage.estimate();
   return{usage:estimate.usage,quota:estimate.quota,persisted:await navigator.storage.persisted()};});}
 catch(error){report.browserStorageError=String(error.stack??error);}
 try{report.retained=await retainSessionStore(page,report.result.database,path.join(out,'saved'));}
 catch(error){report.retentionError=String(error.stack??error);}
 report.diagnosticErrors=[];
 try{await fs.writeFile(path.join(out,'console.txt'),report.result.console);}catch(error){report.diagnosticErrors.push('console: '+String(error.stack??error));}
 try{await page.screenshot({path:path.join(out,'desktop.png')});}catch(error){report.diagnosticErrors.push('screenshot: '+String(error.stack??error));}
 assert.equal(report.result.status,'desktop-full-workload-replay-passed',report.result.error);
 assert(report.retained,report.retentionError??'retained complete session');
 assert.deepEqual(report.diagnosticErrors,[],'complete desktop diagnostics');
 const archive=JSON.parse(await fs.readFile(path.join(out,'saved/storage.json'))),chunks=new Set();
 for(const row of archive.stores.chunks){const bytes=await fs.readFile(path.join(out,'saved/chunks',row.key+'.bin'));assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.key);chunks.add(row.key);}
 const objects=new Map(archive.stores.objects.map(row=>[row.key,row.value]));
 const objectBytes=async(ref,{materialize=false}={})=>{const descriptor=objects.get(ref.sha256);assert(descriptor,'retained object '+ref.sha256);
   assert.equal(String(descriptor.length),String(ref.length));const pieces=[],hash=createHash('sha256');let length=0;
   for(const part of descriptor.parts){assert(chunks.has(part.sha256));const bytes=await fs.readFile(path.join(out,'saved/chunks',part.sha256+'.bin'));
     assert.equal(bytes.length,Number(part.length));assert.equal(sha(bytes),part.sha256);hash.update(bytes);if(materialize)pieces.push(bytes);length+=bytes.length;}
   assert.equal(length,Number(ref.length));assert.equal(hash.digest('hex'),ref.sha256);return materialize?Buffer.concat(pieces,length):null;};
 for(const [key,value]of objects)await objectBytes({sha256:key,length:value.length});
 for(const block of report.result.blocks)assert(objects.has(block.sha256),'retained original base chunk '+block.sha256);
 for(const body of report.result.payloads)assert(objects.has(body.sha256),'retained original GPU body '+body.sha256);
 const session=archive.stores.sessions.find(row=>row.key===report.result.sessionId);assert(session,'retained complete session');
 const manifest=JSON.parse(Buffer.from(session.value.manifest).toString());
 assert.equal(sha(Buffer.from(session.value.manifest)),report.result.authenticatedHistory.manifestSha256,'exported manifest equals authenticated live reader');
 const references=[];const walk=value=>{if(Array.isArray(value)){for(const child of value)walk(child);return;}
   if(value&&typeof value==='object'){if(/^[a-f0-9]{64}$/.test(value.sha256??'')&&typeof value.length==='string')references.push(value);
     for(const child of Object.values(value))walk(child);}};walk(manifest);
 for(const ref of references)assert(objects.has(ref.sha256),'retained manifest graph '+ref.sha256);
 const base=manifest.assets.find(row=>row.role==='base');assert(base&&objects.has(base.content.sha256),'retained original base manifest');
 const points=manifest.checkpoints.map(row=>BigInt(row.position.transition));
 assert.equal(points[0],0n);assert.equal(points.length,report.result.checkpoints.length+1);
 for(let index=1;index<points.length;index++)assert(points[index]>points[index-1]&&points[index]-points[index-1]<=50000000n,'saved keyframe cadence '+index);
 assert(BigInt(manifest.end.transition)>=points.at(-1)&&BigInt(manifest.end.transition)-points.at(-1)<=50000000n,'saved terminal cadence');
 const extension=manifest.extensions.find(value=>value.kind==='e9-exact-witness-pages-v2');assert(extension?.required,'required paged witness commitment');
 const commitment=JSON.parse(Buffer.from(extension.bytes).toString());assert.equal(commitment.finished,true);
 let cursor=commitment.tail,remaining=commitment.count,pages=0;const witnessPositions=new Set();
 while(cursor){const payload=JSON.parse((await objectBytes(cursor,{materialize:true})).toString());assert.equal(payload.before+payload.rows.length,remaining);
   for(const row of payload.rows)witnessPositions.add(JSON.stringify([row.transition,row.phase,row.ordinal,row.sequence,row.retired]));
   remaining=payload.before;cursor=payload.previous;pages++;assert(pages<=4096);}
 assert.equal(remaining,0);assert.equal(pages,commitment.pages);
 for(const point of manifest.checkpoints)assert(witnessPositions.has(JSON.stringify([point.position.transition,point.position.phase,point.position.ordinal,point.position.sequence,point.position.retired])),'saved checkpoint witness');
 report.savedClosure={chunks:chunks.size,objects:objects.size,manifestReferences:references.length,checkpoints:points.length,witnessPages:pages,sessionSha256:sha(Buffer.from(session.value.manifest))};
 assert.equal(report.baseRequests.replay,0,'zero live base fetch during replay');assert.deepEqual(report.replayBlockedRequests,[]);assert.deepEqual(report.replayBlockedSockets,[]);assert.equal(report.workerFactoryAudits.length,1);assert.equal(report.workerFactoryAudits[0].length,1);assert.equal(report.workerFactoryAudits[0][0].factoryEntries,'0');assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);
 await assets.inspectCache();assert.equal(git('rev-parse','HEAD'),report.head);
 assert.equal(git('status','--porcelain'),report.dirty,'source worktree changed during qualification');
 for(const row of report.executedSources)assert.equal(sha(await fs.readFile(path.join(root,row.path))),row.sha256);
 for(const row of report.served)assert.equal(sha(await fs.readFile(path.join(web,'.'+row.name))),row.sha256,'served runtime changed '+row.name);
 for(const row of report.replayStaticAssets)assert.equal(sha(await fs.readFile(path.join(web,'.'+row.name))),row.sha256,'sealed replay module changed '+row.name);
 report.status='desktop-full-workload-replay-passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
 if(page&&!report.result){try{report.result=await page.evaluate(()=>globalThis.desktopWorkload??null);}
   catch(recovery){report.resultRecoveryError=String(recovery.stack??recovery);}}
 if(page&&report.result?.database&&!report.retained&&!report.retentionError){
   try{report.retained=await retainSessionStore(page,report.result.database,path.join(out,'saved'));}
   catch(retention){report.retentionError=String(retention.stack??retention);}}
}finally{
 const cleanup=[];
 try{if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}catch(error){cleanup.push('trace: '+String(error));}
 try{await context?.close();}catch(error){cleanup.push('browser context: '+String(error));}
 try{await browser?.close();}catch(error){cleanup.push('browser: '+String(error));}
 try{const hostAfter=await fs.statfs(out);report.hostFreeBytesAfter=String(BigInt(hostAfter.bavail)*BigInt(hostAfter.bsize));}
 catch(error){cleanup.push('host space: '+String(error));}
 try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanup.push('server: '+String(error));}
 try{await assets.close();}catch(error){cleanup.push('assets: '+String(error));}
 if(cleanup.length){report.cleanupErrors=cleanup;report.status='failed';process.exitCode=1;}
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
