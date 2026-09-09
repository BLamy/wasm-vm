import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)), repo=path.resolve(out,'../../..'), root=path.join(repo,'web/dist');
const sha=x=>createHash('sha256').update(x).digest('hex');
const bytes=Buffer.from([0x13,5,16,0,0x6f,0,0,0]);
const manifest={artifacts:{kernel:{url:'data:application/octet-stream;base64,'+bytes.toString('base64'),sha256:sha(bytes)},
  initramfs:{url:'data:application/octet-stream;base64,',sha256:sha(Buffer.alloc(0))}}};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+'/')){res.writeHead(404).end();return;}
  try{
    const body=pathname==='/artifacts.json'?JSON.stringify(manifest):await readFile(file);
    res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.wasm':'application/wasm','.json':'application/json'})[path.extname(file)]||'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base+'/display-hotplug.html');
  await page.locator('#backend').selectOption('direct');
  await page.locator('#start').evaluate(el=>{el.click();el.dispatchEvent(new MouseEvent('click'));});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Real GPU attached'));
  const initial=await page.locator('#stats').innerText();
  await page.locator('#width').fill('0');
  await page.locator('#mode').evaluate(el=>el.dispatchEvent(new Event('submit',{cancelable:true})));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('display dimension'));
  assert.equal(await page.locator('#stats').innerText(),initial);
  const uiError=await page.locator('#status').innerText();
  await page.locator('#stop').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Fixture stopped.');
  const reflect=await page.evaluate(async()=>{
    const {default:init,WasmLinux}=await import('./pkg/wasm_vm_wasm.js');await init();
    const vm=new WasmLinux(16,new Uint8Array([0x13,5,16,0,0x6f,0,0,0]),new Uint8Array(),'',()=>{},false);
    const before=JSON.stringify(vm.displayStats()), saved=Reflect.set;let error;
    try{Reflect.set=()=>{throw Error('verifier injected property failure');};vm.displayStats();}catch(e){error=String(e);}finally{Reflect.set=saved;}
    const after=JSON.stringify(vm.displayStats());vm.free();return {before,after,error};
  });
  assert.match(reflect.error,/display stats property failed/);assert.equal(reflect.before,reflect.after);
  await page.goto(base+'/app.html?noAutoBoot=1&testHooks=1&startPaused=1&jit=0');
  await page.waitForFunction(()=>typeof window.wvmDemo?.runBusybox==='function');
  const active=await page.evaluate(async()=>{
    const boot=await wvmDemo.runBusybox();
    if(!boot.ok)throw Error(JSON.stringify(boot));
    const changed=await wvmDemo.setDisplay(997,613);
    const stats=await wvmDemo.displayStats(),actual=await window.__linuxCtl.displayStats();
    const paused=await window.__linuxCtl.isPaused();
    const {stopLinuxController}=await import('./linux-worker-host.js');await stopLinuxController(window.__linuxCtl);
    return {boot,changed,stats:{...stats,edid:[...stats.edid]},actual:{...actual,edid:[...actual.edid]},paused};
  });
  assert.equal(active.changed,true);assert.equal(active.paused,true);assert.deepEqual(active.stats,active.actual);
  assert.equal(active.stats.advertisedWidth,997);assert.equal(active.stats.advertisedHeight,613);assert.equal(active.stats.scanoutResource,null);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'coverage-result.json'),JSON.stringify({uiError,reflect,active,errors,fixtureManifest:manifest},null,2)+'\n');
  console.log('C1-C3 HELD: direct diagnostic busy/error branch, active main wrapper, bounded stats property error');
}finally{await browser.close();await new Promise(r=>server.close(r));}
