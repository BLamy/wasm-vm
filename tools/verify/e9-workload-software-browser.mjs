#!/usr/bin/env node
// One full software qualification phase; whole C also requires the desktop and
// independent filesystem/wire oracles plus a fresh actual Daybreak critic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import{createServer}from'node:http';
import{createWriteStream}from'node:fs';
import{pipeline}from'node:stream/promises';
import{Transform}from'node:stream';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{chromium}from'../../web/node_modules/playwright/index.mjs';
import{WORKLOAD_ROOT as root,loadQualificationAssets,sha}from'./e9-workload-assets.mjs';
import{retainSessionStore}from'./e9-retain-session-store.mjs';
const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--development'){assert(!options.development);options.development=true;}else{assert(key==='--output'&&!options.output&&process.argv[i+1]);options.output=process.argv[++i];}}assert(options.output);
const out=path.resolve(options.output),web=path.join(root,'web/dist');await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22c',phase:'software',scope:'Complete original software workload/replay phase only; desktop, direct oracles and independent critic remain required',development:!!options.development,status:'running',head:null,dirty:null,started:new Date().toISOString(),errors:[],missing:[],external:[],raw:[],served:[]};
let assets,pageSource,scheduleSource;
try{
 report.head=git('rev-parse','HEAD');report.dirty=git('status','--porcelain');
 if(!options.development)assert.equal(report.dirty,'','freeze source before accepted phase');
 assets=await loadQualificationAssets('software');report.inputs=assets.receipt;
 pageSource=await fs.readFile(path.join(root,'tools/verify/e9-workload-software-page.mjs'));
 scheduleSource=await fs.readFile(path.join(root,'tools/verify/e9-workload-schedule.mjs'));report.executedSources=[];
 for(const name of ['tools/verify/e9-workload-software-browser.mjs','tools/verify/e9-workload-software-page.mjs','tools/verify/e9-workload-schedule.mjs','tools/verify/e9-workload-assets.mjs','tools/verify/e9-workload-software-files.py','docs/design/session-workload-qualification-v1.json','docs/design/session-workload-qualification-v2.json','docs/design/session-workload-qualification-v3.json','docs/design/session-workload-qualification-v4.json','docs/design/session-workload-qualification-v5.json']){const bytes=await fs.readFile(path.join(root,name));report.executedSources.push({path:name,sha256:sha(bytes)});const file=path.join(out,'executed-source',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
 await fs.writeFile(path.join(out,'image.json'),assets.imageBytes);await fs.writeFile(path.join(out,'contract.json'),assets.contractBytes);
}catch(error){report.status='failed';report.failure=String(error.stack??error);if(error.assetCloseError)report.assetCloseError=error.assetCloseError;
 try{await assets?.close();}catch(closeError){report.assetCloseError=String(closeError.stack??closeError);}
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');throw error;}
let browser,context,page,origin;const seen=new Map(),types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(req.method==='POST'){assert(/^\/__retain__\/[a-z0-9-]+\.(resume|json)$/.test(name));const file=path.basename(name),hash=createHash('sha256');let bytes=0;const tap=new Transform({transform(part,encoding,done){bytes+=part.length;if(bytes>320*1048576)return done(Error('raw phase bound'));hash.update(part);done(null,part);}});await pipeline(req,tap,createWriteStream(path.join(out,file),{flags:'wx'}));const row={file,bytes,sha256:hash.digest('hex')};report.raw.push(row);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(row));return;}
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}let bytes,mime='application/octet-stream';
 if(name==='/'){bytes=Buffer.from('<!doctype html><title>Full software workload qualification</title><link rel="stylesheet" href="/vendor/xterm/xterm.css"><script src="/vendor/xterm/xterm.js"></script><script src="/vendor/xterm/addon-fit.js"></script><div id="terminal" style="width:800px;height:320px"></div><pre>Untimed full software workload; no overall C/performance claim.</pre>');mime='text/html';}
 else if(name==='/kernel.bin')bytes=assets.kernel;else if(name==='/image.json'){bytes=assets.imageBytes;mime='application/json';}else if(name==='/software.mjs'){bytes=pageSource;mime='text/javascript';}else if(name==='/e9-workload-schedule.mjs'){bytes=scheduleSource;mime='text/javascript';}
 else if(/^\/__chunk__\/[a-f0-9]{64}\.bin$/.test(name))bytes=await assets.readChunk(path.basename(name,'.bin'));
 else{const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));bytes=await fs.readFile(file);mime=types[path.extname(file)]??mime;const digest=sha(bytes);assert(!seen.has(name)||seen.get(name)===digest,'served source changed');if(!seen.has(name)){seen.set(name,digest);report.served.push({name,bytes:bytes.length,sha256:digest});}}
 res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.missing.push({url:req.url,error:String(error.stack??error)});if(!res.headersSent)res.writeHead(500);res.end();}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();assert.equal('Chrome '+report.browser,assets.qualification.referenceAmendment.qualificationBrowser,'declared browser profile');context=await browser.newContext({serviceWorkers:'block',viewport:{width:1200,height:900}});await context.tracing.start({screenshots:true,snapshots:false,sources:true});page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)report.external.push(r.url());});page.on('websocket',s=>report.external.push(s.url()));
 await page.exposeFunction('workloadProgress',async p=>{await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(p,null,2)+'\n');console.log(JSON.stringify(p));let stop=false;try{await fs.access(path.join(out,'STOP'));stop=true;}catch{}return{continue:!stop};});
 await fs.writeFile(path.join(out,'sealed-before-execution.json'),JSON.stringify({...report,origin},null,2)+'\n');
 await page.goto(origin+'/');report.result=await page.evaluate(async contract=>{const{qualifySoftwareWorkload}=await import('/software.mjs');return qualifySoftwareWorkload(contract);},assets.contract);
 try{report.retained=await retainSessionStore(page,report.result.database,path.join(out,'saved'));}
 catch(error){report.retentionError=String(error.stack??error);}
 report.diagnosticErrors=[];
 try{await fs.writeFile(path.join(out,'console.txt'),report.result.console);}catch(error){report.diagnosticErrors.push('console: '+String(error.stack??error));}
 try{await page.screenshot({path:path.join(out,'software.png')});}catch(error){report.diagnosticErrors.push('screenshot: '+String(error.stack??error));}
 assert.equal(report.result.status,'software-full-workload-replay-passed',report.result.error);
 assert(report.retained,report.retentionError??'retained complete session');
 assert.deepEqual(report.diagnosticErrors,[],'complete software diagnostics');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);
 await assets.inspectCache();assert.equal(git('rev-parse','HEAD'),report.head);for(const row of report.executedSources)assert.equal(sha(await fs.readFile(path.join(root,row.path))),row.sha256);
 report.status='software-full-workload-replay-passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
 if(page&&!report.result){try{report.result=await page.evaluate(()=>globalThis.softwareWorkload??null);}
   catch(recovery){report.resultRecoveryError=String(recovery.stack??recovery);}}
 if(page&&report.result?.database&&!report.retained&&!report.retentionError){
   try{report.retained=await retainSessionStore(page,report.result.database,path.join(out,'saved'));}
   catch(retention){report.retentionError=String(retention.stack??retention);}}
}finally{
 const cleanup=[];
 try{if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}catch(error){cleanup.push('trace: '+String(error));}
 try{await browser?.close();}catch(error){cleanup.push('browser: '+String(error));}
 try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanup.push('server: '+String(error));}
 try{await assets.close();}catch(error){cleanup.push('assets: '+String(error));}
 if(cleanup.length){report.cleanupErrors=cleanup;report.status='failed';process.exitCode=1;}
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
