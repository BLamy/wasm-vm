import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../..');
const root = path.join(repo, 'web/dist');
const sha = x => createHash('sha256').update(x).digest('hex');
const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
if (!process.argv.includes('--sabotage-only')) {
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + '/')) { res.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {'Content-Type': ({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page = await browser.newPage({serviceWorkers:'block'});
  const errors = [], workers = [];
  page.on('pageerror', e=>errors.push(String(e)));
  page.on('worker', w=>workers.push(w.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/display-hotplug.html`);
  const result = await page.evaluate(async () => {
    const {fixtureOptions} = await import('./display-hotplug.js');
    const {startLinuxBootWorker,stopLinuxController} = await import('./linux-worker-host.js');
    const ctl = await startLinuxBootWorker(await fixtureOptions());
    const must = (ok,label) => {if(!ok) throw Error(label);};
    let seed = 0x22a5c019;
    const next = () => {seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return seed>>>0;};
    const normalize = s=>({...s,edid:[...s.edid]});
    const samples=[];
    for(let i=0;i<65;i++) {
      const width=1+2*(next()%2048), height=1+2*(next()%2048);
      must(await ctl.setDisplay(width,height)===true,'odd request rejected');
      const s=normalize(await ctl.displayStats());
      must(s.advertisedWidth===width && s.advertisedHeight===height,'advertised mode');
      must((s.edid[56]+256*(s.edid[58]>>4))===width,'EDID width');
      must((s.edid[59]+256*(s.edid[61]>>4))===height,'EDID height');
      must(s.edid.length===128 && s.edid.reduce((a,b)=>a+b,0)%256===0,'EDID checksum');
      must(s.pendingEvents===1 && s.resourceCount===0 && s.resourceBytes===0,'event/allocation');
      must(s.scanoutResource===null && s.scanoutWidth===null && s.scanoutHeight===null,'false guest adoption');
      const invalid=[NaN,Infinity,4096,0,-0,0.25,'901',false,null,undefined,{},[],new Number(901),901n][i%14];
      let error;
      try {await ctl.setDisplay(width===4095?1:width+2,invalid);} catch(e){error=String(e);}
      must(error?.includes('display dimension'),'invalid second arg accepted');
      must(JSON.stringify(normalize(await ctl.displayStats()))===JSON.stringify(s),'invalid request mutated state');
      const copy=await ctl.displayStats(); copy.edid.fill(0); copy.advertisedWidth=0;
      must(JSON.stringify(normalize(await ctl.displayStats()))===JSON.stringify(s),'stats alias or read ACK');
      samples.push({index:i,width,height,error,stats:s});
    }
    must(await ctl.isPaused(),'guest ran unexpectedly');
    await stopLinuxController(ctl);
    let stopped;
    try {await ctl.setDisplay(997,613);} catch(e){stopped=String(e);}
    must(stopped,'stopped request accepted');
    return {seed:'0x22a5c019',samples,stopped};
  });
  assert.equal(workers.filter(u=>u.endsWith('/linux-worker.js')).length,1);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'odd-mode-result.json'),JSON.stringify({browser:browser.version(),workers,errors,
    wasmSha256:sha(await readFile(path.join(root,'pkg/wasm_vm_wasm_bg.wasm'))),...result},null,2)+'\n');
  console.log('A1 HELD: 65 odd modes, invalid second arguments, copied EDID, pending events, stopped worker');
} finally {await browser.close(); await new Promise(r=>server.close(r));}
}

// Execute the new acceptance harness with an in-memory HTTP-response mutation only.
const original = await readFile(path.join(repo,'tools/verify/e5-t22a-display-hotplug.mjs'),'utf8');
const marker = original.match(/const data = await readFile\([\s\S]*?\);/)?.[0];
assert.ok(marker,'HTTP response read must exist');
assert.equal(original.split(marker).length,2);
const injected = original
  .replace('const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");',`const repo = ${JSON.stringify(repo)};`)
  .replace(marker, `${marker.replace('const data', 'let data')} if (file === path.join(root, "loader.js")) {
    const old = "!stopped && machine.setDisplay(width, height)";
    if (!data.toString().includes(old)) throw new Error("sabotage target missing");
    data = Buffer.from(data.toString().replace(old, "!stopped"));
  }`);
const child = spawn(process.execPath,['--input-type=module','-e',injected],{cwd:repo,
  env:{...process.env,E5_T22A_EVIDENCE_DIR:out},stdio:['ignore','pipe','pipe']});
let log=''; child.stdout.on('data',b=>log+=b); child.stderr.on('data',b=>log+=b);
const timer=setTimeout(()=>child.kill('SIGTERM'),90000);
const code=await new Promise(r=>child.on('close',r));clearTimeout(timer);
await writeFile(path.join(out,'sabotage.log'),log);
assert.notEqual(code,0,'sabotage escaped new acceptance harness');
assert.match(log,/1280 !== 1367/,'must fail on stale advertised mode, not unrelated setup');
await writeFile(path.join(out,'sabotage-result.json'),JSON.stringify({originalHarnessSha256:sha(original),
  injectedHarnessSha256:sha(injected),mutation:'HTTP loader.js: setDisplay returns !stopped without calling WasmLinux',
  exitCode:code,expected:'1280 !== 1367',logSha256:sha(log)},null,2)+'\n');
console.log('S1 HELD: new acceptance harness rejects no-op setDisplay sabotage');
