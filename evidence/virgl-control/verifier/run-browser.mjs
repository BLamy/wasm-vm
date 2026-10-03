import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
const repo=process.cwd(), out=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['renderer/virgl-command/control-bridge.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','crates/wasm/src/virgl_control_proof.rs','crates/core/src/dev/virtio/gpu/control3d.rs','crates/core/src/dev/virtio/gpu/mod.rs','crates/core/src/lib.rs','crates/core/src/desktop_restore.rs','crates/core/src/dev/virtio/gpu/snapshot.rs'];
async function collect(dir){for(const e of await fs.readdir(path.join(repo,dir),{withFileTypes:true})){const f=`${dir}/${e.name}`;if(e.isDirectory())await collect(f);else if(/\.(js|wasm)$/.test(f))files.push(f);}}
const report={task:'E6-T11a',status:'running',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started:new Date().toISOString(),sources:[],variants:[]};
let server,browser,variant='baseline';
try{
  await collect('target/virgl-control/pkg');const modules=new Map();for(const file of files){const bytes=await fs.readFile(path.join(repo,file));modules.set('/'+file,bytes);report.sources.push({path:file,sha256:hash(bytes)});}
  for(const name of ['predictions.md','supplemental-predictions.md','reference-notes.md','browser-attacks.mjs','run-browser.mjs'])report.sources.push({path:path.relative(repo,path.join(out,name)),sha256:hash(await fs.readFile(path.join(out,name)))});
  const sourcePath='/renderer/virgl-command/control-bridge.mjs',original=modules.get(sourcePath).toString(),variants=new Map([['baseline',original]]);report.sabotages=[];
  for(const [name,before,after]of[
    ['skip-backing',"case 'attachBacking': unwrap(store.attachBacking(resource.id, event.segments.map((s) => s.data))); break;","case 'attachBacking': /* verifier sabotage: report success without store backing */ break;"],
    ['preserve-highwater',"highestGeneration = '0000000000000000'; poisoned = false; return ok();","/* verifier sabotage: retain stale highwater */ poisoned = false; return ok();"],
  ]){assert.equal(original.split(before).length,2,'unique sabotage anchor '+name);const modified=original.replace(before,after);variants.set(name,modified);report.sabotages.push({name,before,after,sha256:hash(modified)});}
  modules.set('/browser-attacks.mjs',await fs.readFile(path.join(out,'browser-attacks.mjs')));modules.set('/',Buffer.from('<!doctype html><meta charset="utf-8"><title>Independent control verification</title><style>body{font:16px system-ui;max-width:1000px;margin:32px;background:#14202a;color:#eaf0fa}pre{white-space:pre-wrap}</style><h1>Independent virtio 3D control attacks</h1><p>Real Wasm guest queues and WebGL resource ownership; isolated proof only.</p><canvas width="64" height="64"></canvas><pre id="result">Running</pre>'));
  server=createServer((req,res)=>{if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}const b=req.url===sourcePath?Buffer.from(variants.get(variant)):modules.get(req.url);if(!b){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':req.url.endsWith('.wasm')?'application/wasm':/\.(m?js)$/.test(req.url)?'text/javascript':'text/html','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(b);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
  const bs=await browser.newBrowserCDPSession();report.browser={version:browser.version(),system:await bs.send('SystemInfo.getInfo'),commandLine:await bs.send('Browser.getBrowserCommandLine')};
  assert.equal(report.browser.system.gpu.featureStatus.webgl2??report.browser.system.gpu.featureStatus.webgl,'enabled');assert.ok(!report.browser.commandLine.arguments.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(a)));
  for(const name of variants.keys()){
    variant=name;const errors={console:[],page:[],request:[]},context=await browser.newContext({viewport:{width:1050,height:900}}),page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error')errors.console.push(m.text());});page.on('pageerror',e=>errors.page.push(e.message));page.on('requestfailed',r=>errors.request.push(r.url()));await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const session=await context.newCDPSession(page);await session.send('Profiler.enable');await session.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    const result=await page.evaluate(async()=>{try{const {independentControlAttacks}=await import('/browser-attacks.mjs');const r=await independentControlAttacks();document.querySelector('#result').textContent=JSON.stringify({...r,records:r.records.length},null,2);return r;}catch(e){document.querySelector('#result').textContent=e.stack;return{status:'failed',error:{message:e.message,stack:e.stack}};}});
    const record={variant,servedBridgeSha256:hash(variants.get(variant)),errors,result};report.variants.push(record);
    if(name==='baseline'){
      const coverage=await session.send('Profiler.takePreciseCoverage');const scripts=coverage.result.filter(s=>s.url.endsWith('/renderer/virgl-command/control-bridge.mjs')||s.url.includes('/target/virgl-control/pkg/snippets/'));
      await fs.writeFile(path.join(out,'browser-coverage.json'),JSON.stringify({scripts},null,2)+'\n');record.coverageSha256=hash(await fs.readFile(path.join(out,'browser-coverage.json')));await page.screenshot({path:path.join(out,'browser.png'),fullPage:true});record.screenshotSha256=hash(await fs.readFile(path.join(out,'browser.png')));
      assert.equal(result.status,'passed',result.error?.message);assert.deepEqual(errors,{console:[],page:[],request:[]});
    }else{assert.equal(result.status,'failed','sabotage escaped');assert.match(result.error.message,name==='skip-backing'?/initial owned backing/:/same generation retry after reset/);}
    await context.close();
  }
  for(const s of report.sources)assert.equal(hash(await fs.readFile(path.join(repo,s.path))),s.sha256,'source drift '+s.path);report.status='passed';
}catch(e){report.status='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;}
finally{report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({status:report.status,variants:report.variants.map(v=>({variant:v.variant,status:v.result.status,assertions:v.result.assertions,attacks:v.result.attacks?.length,records:v.result.records?.length,error:v.result.error?.message})),error:report.error},null,2));
