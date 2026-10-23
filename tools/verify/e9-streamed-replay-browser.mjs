#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options={};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];
 if(key==='--development'){options.development=true;continue;}
 assert(['--output','--web-root'].includes(key)&&!options[key]&&process.argv[i+1]);
 options[key]=process.argv[++i];
}
assert(options['--output']);
assert(['web','web/dist'].includes(options['--web-root']??'web/dist'));
const out=path.resolve(options['--output']),web=path.resolve(root,options['--web-root']??'web/dist');
await fs.mkdir(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const status=()=>execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22g',status:'running',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 development:!!options.development,dirty:status(),webRoot:path.relative(root,web),started:new Date().toISOString(),
 errors:[],missing:[],external:[],served:[]};
if(!options.development)assert.equal(report.dirty,'','exact-head browser proof requires a clean checkout');
await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'executed-browser.mjs'));
let browser,context,page;
const origin='http://127.0.0.1:';
const seen=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  if(name==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store',
   'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Streamed replay proof</title><h1>Streamed exact replay</h1>');return;}
  const source=name.startsWith('/releases/')?path.join(root,'web'):web;
  const file=path.resolve(source,'.'+name);assert(file.startsWith(source+path.sep));
  const bytes=await fs.readFile(file),digest=sha(bytes);
  assert(!seen.has(name)||seen.get(name).sha256===digest,'served file changed');
  if(!seen.has(name)){
   const ref={path:name,source:path.relative(root,source),bytes:bytes.length,sha256:digest};seen.set(name,ref);report.served.push(ref);
   const retained=path.join(out,'served',name);await fs.mkdir(path.dirname(retained),{recursive:true});await fs.writeFile(retained,bytes);
  }
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
   'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.missing.push({url:req.url,error:String(error)});res.writeHead(404).end();}
});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));report.origin=origin+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 report.browser=browser.version();context=await browser.newContext({serviceWorkers:'block',viewport:{width:1100,height:800}});
 await context.tracing.start({screenshots:true,sources:true});page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('pageerror',error=>report.errors.push(error.stack));
 page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==report.origin)report.external.push(request.url());});
 page.on('websocket',socket=>report.external.push(socket.url()));
 await page.goto(report.origin+'/');
 report.result=await page.evaluate(async()=>{
  const {default:init}=await import('/pkg/wasm_vm_wasm.js');await init();
  const {runSessionStreamedReplayProbe}=await import('/session-streamed-replay-probe.js');
  return runSessionStreamedReplayProbe();
 });
 assert.equal(report.result.status,'passed');assert(report.result.pendingBytes>0);
 assert.equal(report.result.attacks.length,6);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);
 for(const ref of report.served)assert.equal(sha(await fs.readFile(path.join(root,ref.source,ref.path))),ref.sha256,'served source mutated');
 if(!options.development)assert.equal(status(),'','source changed during proof');
 report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
 await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
}finally{
 await context?.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
}
