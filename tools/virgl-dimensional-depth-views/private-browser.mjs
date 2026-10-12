import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const options={};for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--seed'].includes(process.argv[i])&&process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);const output=path.resolve(options.output),seed=Number(options.seed??0x7e8193a5);assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim(),expectedHead=git('rev-parse','HEAD');
await fs.mkdir(output,{recursive:false});const sources=new Map(),served=new Map();
async function collect(name){
 if(sources.has(name))return;const bytes=await fs.readFile(path.join(root,name));sources.set(name,bytes);
 if(/\.m?js$/.test(name))for(const m of bytes.toString().matchAll(/(?:from|import)\s*['"](\.\.?\/[^'"]+)['"]/g))await collect(path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1])));
}
for(const name of ['renderer/virgl-command/control-bridge.mjs','renderer/virgl-command/tests/submit-acceptance.mjs','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','crates/core/src/dev/virtio/gpu/control3d.rs','crates/core/src/dev/virtio/gpu/submit3d.rs','crates/wasm/src/virgl_control_proof.rs','crates/wasm/src/lib.rs','web/linux-worker.js'])await collect(name);
async function pkg(dir){for(const item of await fs.readdir(root+'/'+dir,{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())await pkg(name);else if(/\.(js|wasm)$/.test(name))await collect(name);}}
await pkg('target/virgl-desktop-submit/pkg');
const primary=JSON.parse(await fs.readFile(root+'/tools/virgl-floating-depth/primary.json'));await collect('tools/virgl-floating-depth/primary.json');
for(const pin of primary.sources.filter(s=>/\/(version|st_extensions|virgl_screen)\.c$|\/u_format\.yaml$|\/es-3\.0\.6\.pdf$|\/webgl2\.html$/.test(s.path))){const bytes=await fs.readFile(root+'/'+pin.path);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);sources.set(pin.path,bytes);}
await collect('tools/virgl-dimensional-depth-views/private-body.mjs');const body=await fs.readFile(root+'/tools/virgl-dimensional-depth-views/private-body.mjs'),runner=await fs.readFile(fileURLToPath(import.meta.url));
await fs.writeFile(output+'/readiness-body.mjs',body);await fs.writeFile(output+'/readiness-runner.mjs',runner);
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Private dimensional depth inverses</title><style>body{background:#111720;color:#e7edf6;font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Native private cube and array depth views</h1><p>Selected proof facet. Production acceleration remains gated.</p><canvas id="gpu" width="32" height="32"></canvas><p id="status">Running original packets…</p><pre id="results"></pre>');
const report={schema:'dimensional-depth-view-private-browser-v1',task:'E6-T11d60',seed,trackedChanges:git('status','--porcelain','--untracked-files=no'),head:expectedHead,status:'running',command:[process.execPath,...process.argv.slice(1)],startedAt:new Date().toISOString(),actualLinuxGuest:false,positiveCapsetAuthority:false,primary,host:{platform:process.platform,architecture:process.arch,node:process.version,release:os.release()},sources:[...sources].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),probe:{bodyBytes:body.length,bodySha256:sha(body),runnerBytes:runner.length,runnerSha256:sha(runner)},browserErrors:{console:[],page:[],requests:[]}};
let server,browser,page;
try{
 const endpoints=new Map([['/',{bytes:html,type:'text/html'}],['/readiness.mjs',{bytes:body,type:'text/javascript'}],...[...sources].filter(([name])=>/\.(m?js|wasm)$/.test(name)).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
 server=createServer((request,response)=>{const name=new URL(request.url,'http://localhost').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}served.set(name,{path:name,bytes:item.bytes.length,sha256:sha(item.bytes)});response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',{chromium}=await import(pathToFileURL(root+'/web/node_modules/playwright/index.mjs'));
 browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
 const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
 assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));
 report.browser={executable:chrome,sha256:sha(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
 const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
 const profiler=await context.newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 let timer;try{report.browserResult=await Promise.race([page.evaluate(async({seed})=>{try{const wasm=await import('/target/virgl-desktop-submit/pkg/wasm_vm_wasm.js');await wasm.default();const {run}=await import('/tools/virgl-dimensional-depth-views/private-body.mjs');const result=await run({seed});document.querySelector('#status').textContent='Passed: private depth and stencil inverses match original fields';document.querySelector('#results').textContent=JSON.stringify(result.summary,null,2);return {status:'passed',result};}catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return {status:'failed',error:{message:error.message,stack:error.stack},partial:window.__privateDepthReport??null,point:window.__privateDepthActive?.()??null};}},{seed}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('private depth inverses exceeded180seconds')),180000);})]);}finally{clearTimeout(timer);}
 const coverage=await profiler.send('Profiler.takePreciseCoverage'),scripts=[];for(const [name,bytes]of sources)if(/\.m?js$/.test(name)){const matches=coverage.result.filter(s=>s.url.endsWith('/'+name));if(!matches.length)continue;assert.equal(matches.length,1);scripts.push({source:name,sha256:sha(bytes),coverage:matches[0]});}
 const coverageBytes=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(output+'/browser-coverage.json',coverageBytes);report.browserCoverage={path:'browser-coverage.json',sha256:sha(coverageBytes)};await profiler.send('Profiler.stopPreciseCoverage');
 await page.screenshot({path:output+'/browser.png',fullPage:true});report.screenshot={path:'browser.png',sha256:sha(await fs.readFile(output+'/browser.png'))};
 assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
 for(const[name,bytes]of sources)assert.equal(sha(await fs.readFile(root+'/'+name)),sha(bytes),'source drift '+name);
 assert.equal(git('rev-parse','HEAD'),expectedHead);report.status='passed';console.log(JSON.stringify({head:expectedHead,...report.browserResult.result.summary}));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{for(const[name,bytes]of sources){const destination=path.join(output,'source',name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);}report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));}
