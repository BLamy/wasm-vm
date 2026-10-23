#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import{createServer}from'node:http';
import{createWriteStream}from'node:fs';
import{pipeline}from'node:stream/promises';
import{Transform}from'node:stream';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{fileURLToPath}from'node:url';
import{chromium}from'../../web/node_modules/playwright/index.mjs';
import{retainSessionStore}from'./e9-retain-session-store.mjs';
import{readGpuHistoryWindows,attackGpuHistoryReader,checkGpuReaderBoundaryCodecs}from'./e9-gpu-reader-stream-attacks.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),opts={};
for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--development'||key==='--mutate-middle'){assert(!opts[key]);opts[key]=true;if(key==='--development')opts.development=true;}else{assert(['--output','--events','--block-bytes','--web-root'].includes(key)&&!opts[key]&&process.argv[i+1]);opts[key]=process.argv[++i];}}
assert.equal(opts['--events']??'4100','4100');assert.equal(opts['--block-bytes']??'67125760','67125760');assert(['web','web/dist'].includes(opts['--web-root']??'web/dist'));

const web=path.join(root,opts['--web-root']??'web/dist'),out=path.resolve(opts['--output']??path.join(root,'target/evidence/e9-t22f-reader-'+new Date().toISOString().replace(/[:.]/g,'-')));await fs.mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex'),git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22f',scope:'Actual native UART/block production GPU-journal storage boundary; no full Linux/desktop/replay/performance qualification',development:!!opts.development,status:'running',head:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),started:new Date().toISOString(),errors:[],missing:[],external:[],raw:[],served:[]};if(!opts.development)assert.equal(report.dirty,'','freeze source before acceptance');
await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'executed-browser.mjs'));
await fs.copyFile(path.join(root,'tools/verify/e9-gpu-reader-stream-attacks.mjs'),path.join(out,'executed-attacks.mjs'));
let browser,context,page;const seen=new Map(),types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(req.method==='POST'){assert(/^\/__retain__\/(count|bytes|physical)-(batch-\d{5}\.json|body-[0-9a-f]{64}\.bin|(final|failure)\.state)$/.test(name));const file=path.basename(name),hash=createHash('sha256');let bytes=0;const tap=new Transform({transform(part,encoding,done){bytes+=part.length;if(bytes>32*1048576)return done(Error('raw transfer bound'));hash.update(part);done(null,part);}});await pipeline(req,tap,createWriteStream(path.join(out,file),{flags:'wx'}));const ref={file,bytes,sha256:hash.digest('hex')};report.raw.push(ref);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(ref));return;}
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}
 if(name==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Bounded GPU journal storage proof</title><h1>GPU journal storage</h1><p>Small native UART/block guests. Full Linux, desktop, playback and performance qualification remain separate.</p><pre>Starting…</pre>');return;}
 const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));const sourceGitRef=undefined;const bytes=sourceGitRef?execFileSync('git',['show',sourceGitRef+':web/session-gpu-journal.js'],{cwd:root}):await fs.readFile(file),digest=sha(bytes);assert(!seen.has(name)||seen.get(name).sha256===digest,'served source changed');if(!seen.has(name)){const ref={path:name,bytes:bytes.length,sha256:digest,...(sourceGitRef?{sourceGitRef}:{} )};seen.set(name,ref);report.served.push(ref);const copy=path.join(out,'executed-web',name);await fs.mkdir(path.dirname(copy),{recursive:true});await fs.writeFile(copy,bytes);}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.missing.push({url:req.url,error:String(error.stack??error)});if(!res.headersSent)res.writeHead(500);res.end();}});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;report.origin=origin;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});report.browser=browser.version();const cdp=await browser.newBrowserCDPSession();const hardware=await cdp.send('SystemInfo.getInfo');report.hardware={gpu:hardware.gpu,modelName:hardware.modelName,modelVersion:hardware.modelVersion,commandLine:hardware.commandLine};context=await browser.newContext({viewport:{width:1100,height:800},serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:false,sources:true});page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)report.external.push(r.url());});page.on('websocket',s=>report.external.push(s.url()));
 await page.exposeFunction('__journalProgress',async row=>{await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(row,null,2)+'\n');console.log(JSON.stringify(row));});
 await page.goto(origin+'/');report.result=await page.evaluate(async()=>{const{runGpuHistoryReaderRecording}=await import('/gpu-history-reader-probe.js');return runGpuHistoryReaderRecording({database:'wasm-vm-sessions-v1-e9-t22f-reader',idPrefix:'gpu-stream',notify:async row=>{document.querySelector('pre').textContent=JSON.stringify(row,null,2);await globalThis.__journalProgress(row);},retain:async(name,bytes)=>{const r=await fetch('/__retain__/'+name,{method:'POST',body:bytes});if(!r.ok)throw Error('raw transfer');return r.json();}});});
 if(report.result.status==='recorded')report.result.physical=await page.evaluate(async database=>{const {recordGpuReaderPhysical}=await import('/gpu-history-physical-probe.js');return recordGpuReaderPhysical({database,notify:row=>globalThis.__journalProgress(row),retain:async(name,bytes)=>{const r=await fetch('/__retain__/'+name,{method:'POST',body:bytes});if(!r.ok)throw Error('physical raw transfer');return r.json();}});},report.result.database);
 if(report.result.status==='recorded')report.read=await readGpuHistoryWindows(page,report.result);
 if(report.result.status==='recorded')report.codecs=await checkGpuReaderBoundaryCodecs(page,report.result);
 if(report.result.status==='recorded')report.retained=await retainSessionStore(page,report.result.database,path.join(out,'saved'));
 if(opts['--mutate-middle']&&report.result.status==='recorded')report.attacks=await attackGpuHistoryReader(page,report.result);
 await page.screenshot({path:path.join(out,'journal.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);assert.equal(report.result.status,'recorded',report.result.cases.map(row=>row.error).filter(Boolean).join('\n'));
 assert.equal(report.read.cases.length,3);assert.equal(report.read.candidates,0);assert.equal(report.read.smallV1.receipts,2048);if(opts['--mutate-middle'])assert(report.attacks.checks.length>=15);
 const[count,bytes]=report.result.cases;assert(count.receipts>4096&&count.channels[1]===4100);assert(bytes.envelopeBytes>67108864&&bytes.blocks===256);assert.equal(bytes.channels[19],256);
 for(const c of report.result.cases){assert(c.maxPendingRows<=256&&c.maxPendingBytes<=4194304);assert(c.maxIntervalRows<=4096&&c.maxIntervalBytes<=67108864);assert.equal(c.status,'recorded');}
 for(const row of report.served){const bytes=row.sourceGitRef?execFileSync('git',['show',row.sourceGitRef+':web/session-gpu-journal.js'],{cwd:root}):await fs.readFile(path.join(web,'.'+row.path));assert.equal(sha(bytes),row.sha256,'source changed after serve');}assert.equal(git('rev-parse','HEAD'),report.head);report.status='recorded';
}catch(error){report.partialAttacks=await page?.evaluate(()=>globalThis.__gpuReaderAttackReport??null).catch(()=>null);report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}finally{
 if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
