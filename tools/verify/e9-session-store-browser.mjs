#!/usr/bin/env node
// Real Chromium/IndexedDB proof. Debugger pauses cut the production code between durable steps.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {checkSessionStoreCritic} from './e9-session-store-critic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputIndex = process.argv.indexOf('--output');
assert.ok(outputIndex >= 0 && process.argv[outputIndex + 1]);
const output = path.resolve(process.argv[outputIndex + 1]);
const development = process.argv.includes('--development');
const urlIndex = process.argv.indexOf('--url'), remote = urlIndex >= 0 ? new URL(process.argv[urlIndex + 1]) : null;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ref = bytes => ({sha256: digest(bytes), length: String(bytes.length)});
const fixturePath = 'crates/storage/tests/session_manifest/fixtures/';
const template = JSON.parse(await fs.readFile(path.join(root, fixturePath, 'manifest-v1.json'), 'utf8'));
const eventChunk = await fs.readFile(path.join(root, fixturePath, 'chunk-v1.json'));
const payloads = [Buffer.from('vm-runtime-v1'), Buffer.from('wasm-module-v1'), Buffer.from('kernel-v1'),
  Buffer.from('base-image-v1'), Buffer.from('checkpoint-v1'), Buffer.from('e9:before\n'), eventChunk];
const fixture = {template, blobs: payloads.map(bytes => ({ref: ref(bytes), bytes: [...bytes]}))};
const report = {task: 'E9-T03', status: 'running', development, command: [process.execPath, ...process.argv.slice(1)],
  head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), started: new Date().toISOString(),
  errors: [], checks: {}, crashes: [], races: [], served: []};
const served = new Map(), remoteReads = []; let server, context, page, sampler;
await fs.mkdir(output, {recursive: true});

async function attach(target, name) {
  await target.goto(report.url, {waitUntil: 'domcontentloaded'});
  await target.waitForFunction(() => window.__ready === true, null, {timeout: 60000});
  await target.evaluate(async ({name, fixture}) => {
    const {SessionStore} = await import('./session-store.js');
    window.store = await SessionStore.open(name);
    window.fixture = fixture;
    window.encode = value => new TextEncoder().encode(JSON.stringify(value));
    window.putFixture = async writer => {
      for (const blob of fixture.blobs) await writer.put(blob.ref, [new Uint8Array(blob.bytes)]);
    };
    window.newManifest = id => ({...structuredClone(fixture.template), id});
    window.createSession = async id => {
      const writer = await store.writer(id);
      try { await putFixture(writer); return await writer.publish(encode(newManifest(id))); }
      finally { await writer.release(); }
    };
  }, {name, fixture});
}

async function opened(target, id) {
  return target.evaluate(async id => {
    const result = await store.openSession(id);
    return result && {id: result.id, revision: result.revision, manifest: [...result.manifest]};
  }, id);
}

try {
  if (!development) assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: root, encoding: 'utf8'}), '', 'frozen source must be clean');
  const web = path.join(root, 'web/dist');
  if (!remote) {
    const releaseFallback = new Map();
    const manifest = JSON.parse(await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json'),'utf8'));
    for (const asset of Object.values(manifest.artifacts)) {
      const pathname = '/' + asset.url.replace(/^\.\//,'');
      releaseFallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
    }
    const types = {'.js':'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm', '.html':'text/html', '.css':'text/css', '.json':'application/json'};
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
        const base = pathname.startsWith('/releases/') ? root : web;
        const file = path.resolve(base, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(base + path.sep)) { response.writeHead(404).end(); return; }
        let bytes;
        try { bytes = await fs.readFile(file); }
        catch(error) {
          if(error.code==='ENOENT'&&releaseFallback.has(pathname)) {
            response.writeHead(302,{'Location':releaseFallback.get(pathname)}).end();return;
          }
          throw error;
        }
        served.set(pathname, {path: path.relative(root, file), bytes: bytes.length, sha256: digest(bytes)});
        response.writeHead(200, {'Content-Type':types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length':bytes.length, 'Cache-Control':'no-store',
          'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  } else {
    assert.equal(remote.protocol, 'https:'); assert.equal(remote.pathname, '/');
    assert.equal(remote.search + remote.hash + remote.username + remote.password, '');
  }
  report.url = remote ? new URL('app.html?noAutoBoot&testHooks=1', remote).href
    : `http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
  report.profile=path.join(output,'chromium-profile');
  context = await chromium.launchPersistentContext(report.profile, {executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
    args:['--enable-gpu', '--use-gl=angle', '--use-angle=metal'], viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const versionPage=context.pages()[0]??await context.newPage(), versionSession=await context.newCDPSession(versionPage);
  report.browser=(await versionSession.send('Browser.getVersion')).product.replace(/^Chrome\//,'');
  await versionSession.detach();
  await context.tracing.start({screenshots:true, snapshots:true, sources:true});
  page = versionPage;
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  if (remote) page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== remote.origin || !['/session-store.js','/roadmap.js','/pkg/wasm_vm_wasm.js','/pkg/wasm_vm_wasm_bg.wasm','/session-pkg/wasm_vm_session.js','/session-pkg/wasm_vm_session_bg.wasm'].includes(url.pathname)) return;
    remoteReads.push((async () => {
      try {
        if (response.status() === 304) {
          // This fresh profile has already authenticated the cached response body.
          assert.ok(served.has(url.pathname), '304 without a verified cached body: ' + url.pathname);
          (report.cacheRevalidations ??= []).push({url: response.url(), sha256: served.get(url.pathname).sha256});
          return;
        }
        assert.equal(response.status(),200);
        const bytes=await response.body(), file=path.join(web,url.pathname.slice(1));
        assert.equal(digest(bytes),digest(await fs.readFile(file)),'published source drift '+url.pathname);
        served.set(url.pathname,{path:path.relative(root,file),bytes:bytes.length,sha256:digest(bytes),url:response.url()});
      } catch(error) {report.errors.push(String(error));}
    })());
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.location().url === new URL('/favicon.ico', report.url).href && /\b404\b/.test(message.text())) {
      (report.ignoredFaviconErrors ??= []).push({url: message.location().url, text: message.text()});
    } else report.errors.push(message.text());
  });
  page.on('pageerror', error => report.errors.push(error.message));
  const name = 'wasm-vm-sessions-v1-proof-' + Date.now().toString(36);
  report.namespace = name;
  await attach(page, name);
  await page.locator('#suite-run').click();
  await page.waitForFunction(() => document.querySelector('#metric-done')?.textContent === '127', null, {timeout:600000});
  report.checks.suite = {passed:Number(await page.locator('#metric-pass').textContent()), failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite, {passed:127, failed:0});
  const pip = await page.locator('.cap', {hasText:'Durable multi-session history store'}).locator('.cap-pip').getAttribute('class');
  assert.match(pip, /\bverified\b/); report.checks.roadmap = pip;
  await page.locator('#panel-tests').screenshot({path:path.join(output, 'browser.png')});
  report.checks.noLocalStorage = await page.evaluate(() => JSON.stringify({...localStorage}));
  report.checks.adapterHash = await page.evaluate(async () => {
    const {SessionSha256} = await import('./session-pkg/wasm_vm_session.js');
    const hash = new SessionSha256(), result = {};
    try {
      hash.update(new TextEncoder().encode('abc')); result.digest = hash.finish();
      for (const [name, action] of [['update', () => hash.update(new Uint8Array([1]))], ['finish', () => hash.finish()]]) {
        try { action(); result[name] = 'accepted'; } catch (error) { result[name] = error.message; }
      }
    } finally { hash.free(); }
    return result;
  });
  assert.deepEqual(report.checks.adapterHash, {digest:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    update:'session SHA-256 already finished', finish:'session SHA-256 already finished'});
  report.checks.runtimeRefusals=await page.evaluate(async()=>{
    const {startLinuxBootWorker}=await import('./linux-worker-host.js'), result=[];
    for(const opts of [{gpuRuntime:'unknown'}, {gpuRuntime:'published-factory-v1',virgl:false},
      {gpuRuntime:'published-factory-v1',virgl:true,bootSnapshot:false}]) {
      try {await startLinuxBootWorker(opts);result.push('accepted');}catch(error){result.push(error.message);}
    }
    return result;
  });
  assert.deepEqual(report.checks.runtimeRefusals,['unknown GPU runtime',
    'published GPU runtime requires an accelerated factory warm boot','published GPU runtime requires an accelerated factory warm boot']);

  for (const id of ['session-a', 'session-b']) await page.evaluate(id => createSession(id), id);
  await attach(page, name); // Reload drops the old JS/Wasm instances and opens a fresh IDB connection.
  for (const id of ['session-a', 'session-b']) {
    const value = await opened(page, id); assert.equal(value.revision, '1');
    const expected = {...structuredClone(template), id};
    assert.deepEqual(JSON.parse(Buffer.from(value.manifest).toString()), expected);
    report.checks[id] = {revision:value.revision, sha256:digest(Buffer.from(value.manifest)), sequence:expected.end.sequence};
  }
  assert.equal(report.checks['session-a'].sequence, '9007199254740994');

  // A 96 MiB + tail object comes from one reused 64 KiB producer buffer. The Node oracle
  // independently hashes the stream; neither side materializes a whole object/session copy.
  const largeLength = 96 * 1024 * 1024 + 123, largeHash = createHash('sha256'), scratch = Buffer.alloc(65536);
  for (let at = 0; at < largeLength; at += scratch.length) {
    scratch.fill((17 + Math.floor(at / (4*1024*1024)) * 19) & 255);
    largeHash.update(scratch.subarray(0, Math.min(scratch.length, largeLength-at)));
  }
  const largeRef = {sha256:largeHash.digest('hex'), length:String(largeLength)};
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const baseline = await cdp.send('Runtime.getHeapUsage'), samples = [baseline], rawSamples = [baseline];
  let sampling = false;
  sampler = setInterval(async () => { if (sampling) return; sampling = true;
    try {
      rawSamples.push(await cdp.send('Runtime.getHeapUsage'));
      // The claim is bounded RETAINED storage, independent of V8's discretionary collection
      // of unreachable Blob/crypto buffers. A retained whole-session copy survives this GC.
      await cdp.send('HeapProfiler.collectGarbage');
      samples.push(await cdp.send('Runtime.getHeapUsage'));
    } catch(error) {report.errors.push(String(error));} finally { sampling = false; }
  }, 25);
  const largeResult = await page.evaluate(async ({ref, size}) => {
    const writer = await store.writer('large-stream');
    async function* bytes() {
      const buffer = new Uint8Array(65536);
      for (let at=0; at<size; at+=buffer.length) { buffer.fill((17+Math.floor(at/(4*1024*1024))*19)&255); yield buffer.subarray(0, Math.min(buffer.length,size-at)); }
    }
    try {
      await writer.put(ref, bytes());
      const value = newManifest('large-stream'); value.checkpoints[0].machine = ref;
      await writer.publish(encode(value));
    } finally { await writer.release(); }
    const firstBytes = []; let length=0;
    for await (const part of store.stream(ref)) { firstBytes.push(part[0]); length+=part.length; }
    return {length, firstBytes};
  }, {ref:largeRef, size:largeLength});
  clearInterval(sampler); sampler = null;
  while(sampling)await new Promise(resolve=>setTimeout(resolve,10));
  rawSamples.push(await cdp.send('Runtime.getHeapUsage'));
  await cdp.send('HeapProfiler.collectGarbage');
  samples.push(await cdp.send('Runtime.getHeapUsage'));
  const memory = value => value.usedSize + (value.backingStorageSize ?? 0);
  report.checks.streaming = {ref:largeRef, ...largeResult, samples, rawSamples,
    measurement:'Live retained JS heap/backing storage after periodic DevTools GC; raw samples also recorded, without a transient-allocation performance claim',
    peakDelta:Math.max(...samples.map(memory))-memory(baseline), rawPeakDelta:Math.max(...rawSamples.map(memory))-memory(baseline), budget:64*1024*1024};
  assert.equal(largeResult.length, largeLength); assert.equal(largeResult.firstBytes.length, 97);
  assert.deepEqual(largeResult.firstBytes, Array.from({length:97}, (_,i)=>(17+Math.floor(i/4)*19)&255));
  assert.ok(report.checks.streaming.peakDelta < report.checks.streaming.budget, 'stream retained too much backing storage');
  await cdp.detach();

  // Pause in the actual synchronous observer at each durable boundary, then destroy the tab.
  for (const cut of ['chunk-durable', 'object-durable', 'before-commit', 'commit-durable']) {
    const id = 'crash-' + cut, newBytes = Buffer.from('after-' + cut), newRef = ref(newBytes);
    await page.evaluate(id => createSession(id), id);
    const child = await context.newPage(); await attach(child, name);
    const debuggerSession = await context.newCDPSession(child); await debuggerSession.send('Debugger.enable');
    const paused = new Promise(resolve => debuggerSession.once('Debugger.paused', resolve));
    const pending = child.evaluate(async ({cut,id,ref,bytes}) => {
      const writer = await store.writer(id);
      window.__e9SessionStoreProbe = event => {
        if (event.id===id && event.phase===cut && (!event.hash || event.hash===ref.sha256)) { window.cutState=event; debugger; }
      };
      const next = newManifest(id); next.end.transition=String(BigInt(next.end.transition)+1n); next.end.retired=String(BigInt(next.end.retired)+1n);
      next.checkpoints.push({id:'after', position:next.end, next_sequence:String(BigInt(next.end.sequence)+1n), machine:ref, disk_root:next.checkpoints[0].disk_root, gpu:null});
      await writer.put(ref, [new Uint8Array(bytes)]); await writer.publish(encode(next));
      await writer.release();
    }, {cut,id,ref:newRef,bytes:[...newBytes]}).catch(error => ({closed:error.message}));
    let pauseTimeout;
    const pause = await Promise.race([paused, new Promise((_, reject)=>{pauseTimeout=setTimeout(()=>reject(Error('missing crash boundary '+cut)),30000);})]);
    clearTimeout(pauseTimeout);
    const state = await debuggerSession.send('Debugger.evaluateOnCallFrame', {callFrameId:pause.callFrames[0].callFrameId,
      expression:'JSON.stringify(window.cutState)', returnByValue:true});
    assert.equal(JSON.parse(state.result.value).phase, cut);
    // Closing a paused target can detach/resume its debugger before teardown. Crash the
    // renderer first, so the paused continuation cannot race a valid commit into existence.
    let crashTimeout;
    const crashed = new Promise(resolve => child.once('crash', resolve));
    const crashCommand = debuggerSession.send('Page.crash').catch(error => ({expectedCrash:error.message}));
    await Promise.race([crashed,new Promise((_,reject)=>{crashTimeout=setTimeout(()=>reject(Error('renderer did not crash')),10000);})]);
    clearTimeout(crashTimeout);
    await child.close(); await crashCommand; await pending;
    await attach(page, name);
    const recovered = await opened(page,id), expected = cut==='commit-durable' ? '2' : '1';
    assert.equal(recovered.revision, expected);
    const value = JSON.parse(Buffer.from(recovered.manifest).toString());
    assert.equal(value.checkpoints.length, expected==='2' ? 2 : 1);
    report.crashes.push({cut, prediction:expected, observed:recovered.revision, paused:JSON.parse(state.result.value), manifestSha256:digest(Buffer.from(recovered.manifest))});
    const writer = await page.evaluate(async id => { const lease=await store.writer(id); await lease.release(); return true; }, id);
    assert.equal(writer,true,'tab destruction did not release ownership');
  }

  const other = await context.newPage(); await attach(other,name);
  for (let seed=17; seed<37; seed++) {
    const id='race-'+seed;
    const contenders = [page,other].map((target,index)=>target.evaluate(async ({id,delay})=>{
      await new Promise(resolve=>setTimeout(resolve,delay));
      window.lease=null;
      try { window.lease=await store.writer(id); return {granted:true, frozen:Object.isFrozen(lease), retargeted:Reflect.set(lease,'id','wrong-session')}; }
      catch(error) { return {granted:false,code:error.code}; }
    },{id,delay:(seed+index)%3}));
    const acquired=await Promise.all(contenders), winners=acquired.map((v,i)=>v.granted?i:null).filter(v=>v!==null);
    assert.equal(winners.length,1); const winner=winners[0], loser=1-winner;
    assert.equal(acquired[loser].code,'WriterBusy'); assert.equal(acquired[winner].frozen,true); assert.equal(acquired[winner].retargeted,false);
    const machine=Buffer.from(`owner:${seed}:${winner}`), machineRef=ref(machine);
    await [page,other][winner].evaluate(async ({id,ref,bytes})=>{
      const value=newManifest(id); value.checkpoints[0].machine=ref;
      try { await lease.put(ref,[new Uint8Array(bytes)]); await lease.publish(encode(value)); }
      finally { await lease.release(); }
    },{id,ref:machineRef,bytes:[...machine]});
    const value=await opened([page,other][loser],id);
    assert.equal(JSON.parse(Buffer.from(value.manifest).toString()).checkpoints[0].machine.sha256,machineRef.sha256);
    const refusal=await [page,other][loser].evaluate(async id=>{
      const writer=await store.writer(id);
      try { await writer.publish(encode(newManifest(id))); return 'accepted'; }
      catch(error) { return error.code; }
      finally { await writer.release(); }
    },id);
    assert.equal(refusal,'NotAppend');
    assert.deepEqual(await opened(page,id),value);
    report.races.push({seed,winner,acquired,revision:value.revision,machine:machineRef,refusal});
  }
  await other.close();

  // Out-of-line event observations are required data, not optional metadata attachments.
  const externalBytes=Buffer.from('captured UART observation seed 17'), externalRef=ref(externalBytes);
  const externalEvent=JSON.parse(await fs.readFile(path.join(root,fixturePath,'event-v1.json'),'utf8'));
  externalEvent.payload={storage:'blob',content:externalRef};
  const externalChunk=Buffer.from(JSON.stringify([externalEvent])), externalChunkRef=ref(externalChunk);
  report.checks.externalEvent=await page.evaluate(async ({ref,bytes,chunkRef,chunk})=>{
    const writer=await store.writer('external-event'), value=newManifest('external-event');
    value.events[0].content=chunkRef;
    let missing;
    try {
      await writer.put(chunkRef,[new Uint8Array(chunk)]);
      try {await writer.publish(encode(value));missing='accepted';}catch(error){missing=error.code;}
      const absent=await store.openSession('external-event');
      await writer.put(ref,[new Uint8Array(bytes)]);
      const committed=await writer.publish(encode(value));
      const recovered=[];for await(const part of store.stream(ref))recovered.push(...part);
      return {missing,absent,revision:committed.revision,recovered};
    } finally {await writer.release();}
  },{ref:externalRef,bytes:[...externalBytes],chunkRef:externalChunkRef,chunk:[...externalChunk]});
  assert.equal(report.checks.externalEvent.missing,'Corrupt');assert.equal(report.checks.externalEvent.absent,null);
  assert.equal(report.checks.externalEvent.revision,'1');assert.deepEqual(report.checks.externalEvent.recovered,[...externalBytes]);

  const mutableRef=ref(Buffer.alloc(4*1024*1024,39));
  report.checks.refusals = await page.evaluate(async mutableRef => {
    const {SessionStore} = await import('./session-store.js'), results={};
    async function refused(name, action) { try { await action(); results[name]='accepted'; } catch(error) { results[name]=error.code; } }
    await refused('namespace',()=>SessionStore.open('wrong-database'));
    await refused('sessionId',()=>store.writer('invalid id'));
    const writer=await store.writer('refusals');
    try {
      await refused('reference',()=>writer.put({sha256:'bad',length:'2'},[new Uint8Array([1,2])]));
      await refused('empty',()=>writer.put(fixture.blobs[0].ref,[new Uint8Array()]));
      await refused('oversized',()=>writer.put(fixture.blobs[0].ref,[new Uint8Array(4*1024*1024+1)]));
      await refused('length',()=>writer.put(fixture.blobs[0].ref,[new Uint8Array([1])]));
      await refused('digest',()=>writer.put(fixture.blobs[0].ref,[new Uint8Array(Number(fixture.blobs[0].ref.length))]));
      await refused('foreignId',()=>writer.publish(encode(newManifest('session-a'))));
      await refused('manifest',()=>writer.publish(new Uint8Array([123,125])));
      await refused('budget',()=>{
        const value=newManifest('refusals');value.assets.find(a=>a.role==='base').content.length='4294967296';
        return writer.publish(encode(value));
      });
      const mutable=new Uint8Array(4*1024*1024).fill(39);
      window.__e9SessionStoreProbe=event=>{
        if(event.id==='refusals'&&event.phase==='chunk-durable') {
          delete window.__e9SessionStoreProbe;
          structuredClone(mutable.buffer,{transfer:[mutable.buffer]});
        }
      };
      await refused('sourceChanged',()=>writer.put(mutableRef,[mutable]));
    } finally { await writer.release(); }
    await refused('closedWriter',()=>writer.publish(encode(newManifest('refusals'))));
    return results;
  },mutableRef);
  assert.deepEqual(report.checks.refusals,{namespace:'Namespace',sessionId:'SessionId',reference:'Reference',empty:'Bound',oversized:'Bound',length:'Length',digest:'Digest',foreignId:'SessionId',manifest:'Manifest',budget:'Bound',sourceChanged:'SourceChanged',closedWriter:'WriterClosed'});

  report.checks.leaseDrain=await page.evaluate(async () => {
    const writer=await store.writer('lease-drain'); let resume;
    const gate=new Promise(resolve=>{resume=resolve;});
    async function* source(){await gate;yield new Uint8Array(fixture.blobs[0].bytes);}
    const pending=writer.put(fixture.blobs[0].ref,source()).then(()=> 'accepted',error=>error.code);
    let competing;try{await writer.publish(encode(newManifest('lease-drain')));competing='accepted';}catch(error){competing=error.code;}
    const releasing=writer.release();resume();const stopped=await pending;await releasing;
    const next=await store.writer('lease-drain');await next.release();
    return {competing,stopped,reacquired:true,committed:await store.openSession('lease-drain')};
  });
  assert.deepEqual(report.checks.leaseDrain,{competing:'WriterBusy',stopped:'WriterClosed',reacquired:true,committed:null});

  // E3-T10/E3-T12d's explicit fault-injection pattern: throw the standard quota error at
  // the native add boundary. IndexedDB and its aborted transaction remain real. This tests
  // error propagation/atomicity, not Chromium's platform quota accounting policy.
  const quotaRef=ref(Buffer.alloc(1024*1024,73));
  report.checks.quotaFault=await page.evaluate(async ref=>{
    const writer=await store.writer('quota-abort'), original=IDBObjectStore.prototype.add;
    let injected=false;
    IDBObjectStore.prototype.add=function(value,...args){
      if(this.name==='chunks'&&value instanceof Blob&&value.size>65536){injected=true;throw new DOMException('E9-T03 injected write-boundary quota','QuotaExceededError');}
      return original.call(this,value,...args);
    };
    try {await writer.put(ref,[new Uint8Array(1024*1024).fill(73)]);return {code:'accepted',injected};}
    catch(error){return {code:error.code,injected};}
    finally{IDBObjectStore.prototype.add=original;await writer.release();}
  },quotaRef);
  assert.deepEqual(report.checks.quotaFault,{code:'Quota',injected:true});
  assert.equal(await opened(page,'quota-abort'),null);
  assert.equal((await opened(page,'session-a')).revision,'1');

  // Both missing and same-length corrupt data must disappear from the playable list without
  // modifying the manifest/cursor. Restore the actual original Blob only as test cleanup.
  const victimBytes=Buffer.from('corruption-victim-17'), victimRef=ref(victimBytes);
  await page.evaluate(async ({ref,bytes})=>{
    const writer=await store.writer('corruption-victim');
    const value=newManifest('corruption-victim');value.checkpoints[0].machine=ref;
    try { await writer.put(ref,[new Uint8Array(bytes)]);await writer.publish(encode(value)); }
    finally { await writer.release(); }
  },{ref:victimRef,bytes:[...victimBytes]});
  const victimBefore=await opened(page,'corruption-victim');
  for (const fault of ['missing','corrupt']) {
    const result=await page.evaluate(async ({name,ref,bytes,fault})=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction(['chunks'],'readwrite',{durability:'strict'});
        if(fault==='missing')tx.objectStore('chunks').delete(ref.sha256);else tx.objectStore('chunks').put(new Blob([new Uint8Array(bytes.length)]),ref.sha256);
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
      const listed=await store.list();let code;
      try {await store.openSession('corruption-victim');code='accepted';}catch(error){code=error.code;}
      const row=await new Promise((resolve,reject)=>{const r=db.transaction(['sessions']).objectStore('sessions').get('corruption-victim');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction(['chunks'],'readwrite',{durability:'strict'});tx.objectStore('chunks').put(new Blob([new Uint8Array(bytes)]),ref.sha256);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
      db.close();return {present:listed.sessions.some(v=>v.id==='corruption-victim'), unavailable:listed.unavailable, code,revision:row.revision,manifest:[...row.manifest]};
    },{name,ref:victimRef,bytes:[...victimBytes],fault});
    assert.equal(result.present,false);assert.equal(result.code,'Corrupt');assert.equal(result.revision,victimBefore.revision);
    assert.deepEqual(result.manifest,victimBefore.manifest);
    report.checks[fault]={...result,manifest:digest(Buffer.from(result.manifest))};
  }
  assert.deepEqual(await opened(page,'corruption-victim'),victimBefore);
  report.checks.critic = await checkSessionStoreCritic(page, {name, fixture});
  report.checks.localStorageAfter=await page.evaluate(()=>JSON.stringify({...localStorage}));
  assert.equal(report.checks.localStorageAfter,report.checks.noLocalStorage);
  await Promise.all(remoteReads);
  for(const pathname of ['/session-store.js','/roadmap.js','/pkg/wasm_vm_wasm.js','/pkg/wasm_vm_wasm_bg.wasm','/session-pkg/wasm_vm_session.js','/session-pkg/wasm_vm_session_bg.wasm']) assert.ok(served.has(pathname),'missing served source '+pathname);
  assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(output,'after-reload.png')});
  // The published factory pair keeps its authenticated original VM/renderer runtime.
  // The accepted factory readiness gate resumes the CPU and physically presents in a fresh
  // epoch. A static desktop may use its repair present (no guest sequence) until new input.
  console.log('IndexedDB assertions passed; restoring the authenticated GPU factory pair.');
  const workers=[];page.on('worker', worker=>workers.push(worker.url()));
  await page.locator('#desktop-graphics').selectOption('gpu');
  const gpuBoot=await page.evaluate(()=>window.wvmDemo.bootOmarchy());
  assert.equal(gpuBoot.ok,true,JSON.stringify(gpuBoot));
  await page.waitForFunction(()=>window.wvmDemo?.isGuestReady?.()&&window.__linux?.restoredFromBootSnapshot?.(),null,{timeout:600000});
  report.checks.gpuRuntime=await page.evaluate(async()=>({restored:window.__linux.restoredFromBootSnapshot(),
    gpu:await window.__linuxCtl.gpuStats(),clock:await window.__linuxCtl.guestClockState(),scheduler:await window.__linuxCtl.schedulerStats()}));
  report.checks.gpuRuntime.workers=workers;
  assert.ok(workers.some(url=>new URL(url).pathname==='/gpu-runtime-worker.js'));
  const gpu=report.checks.gpuRuntime.gpu;
  assert.ok(gpu.qualified&&!gpu.lost&&!gpu.disposed&&!gpu.poisoned);
  assert.ok(report.checks.gpuRuntime.scheduler.retiredInstructions>0);
  assert.ok(gpu.scanout.retirements.some(r=>r.epoch===gpu.epoch&&r.status==='drawn'));
  await page.screenshot({path:path.join(output,'gpu-factory-ready.png')});
  assert.deepEqual(report.errors,[]);
  report.status='passed';
  console.log('Session store: two reloads, 96 MiB bounded stream, four real tab terminations, twenty two-tab races and corruption refusals passed.');
} catch(error) {report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally {
  if(sampler)clearInterval(sampler);
  if(page&&!page.isClosed()) {
    try {await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));}
    catch(error){report.coverageError=String(error);}
  }
  if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
  if(context)await context.close().catch(()=>{});
  report.served=[...served.values()];report.finished=new Date().toISOString();
  report.sources={};
  for(const name of ['web/session-store.js','web/roadmap.js','crates/storage/src/session_publication.rs','crates/session-web/src/lib.rs','web/dist/session-store.js','web/dist/pkg/wasm_vm_wasm_bg.wasm','web/dist/session-pkg/wasm_vm_session_bg.wasm','tools/verify/e9-session-store-browser.mjs','tools/verify/e9-session-store-critic.mjs']) {
    try {report.sources[name]=digest(await fs.readFile(path.join(root,name)));}catch{}
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
