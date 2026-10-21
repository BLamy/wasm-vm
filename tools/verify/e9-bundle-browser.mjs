// Transfer actual Linux-file and physical-GPU recordings through the built app into fresh profiles.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {archiveMutants, renamedArchive, readArchive, duplicateWitnessDigest} from './e9-bundle-mutants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), options = {};
for (let i = 2; i < process.argv.length; i += 2) {const key = process.argv[i]; assert(['--software', '--gpu', '--output', '--web-root', '--url'].includes(key) && process.argv[i + 1] && !options[key]); options[key] = process.argv[i + 1];}
assert(options['--software'] && options['--gpu'] && options['--output']);
const web = path.resolve(root, options['--web-root'] ?? 'web/dist'), out = path.resolve(options['--output']); await fs.mkdir(out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {task: 'E9-T21', status: 'running', head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(), started: new Date().toISOString(), cases: [], profiles: [], errors: [], blocked: [], external: [], fixtureReads: []};
const fixtures = {}, contexts = new Set(), temporary = [];
let server, inputDirectory, base = options['--url'];
const {chromium} = await import(pathToFileURL(path.join(root, 'web/node_modules/playwright/index.mjs')));
const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css'};

async function loadFixture(kind, directory) {
  directory = path.resolve(directory); const evidence = JSON.parse(await fs.readFile(path.join(directory, 'report.json'))); assert.equal(evidence.status, 'passed');
  const raw = await fs.readFile(path.join(directory, 'saved/storage.json')), storage = JSON.parse(raw), files = new Map([['storage.json', raw]]);
  for (const chunk of storage.stores.chunks) {const bytes = await fs.readFile(path.join(directory, 'saved/chunks', chunk.key + '.bin')); assert.equal(bytes.length, chunk.bytes); assert.equal(sha(bytes), chunk.key); files.set('chunks/' + chunk.key + '.bin', bytes);}
  for (const object of storage.stores.objects) {
    const bytes = Buffer.concat(object.value.parts.map(part => {const bytes = files.get('chunks/' + part.sha256 + '.bin'); assert.equal(bytes.length, Number(part.length)); return bytes;}));
    assert.equal(bytes.length, Number(object.value.length)); assert.equal(sha(bytes), object.key);
  }
  return {kind, directory, evidence, storage, files, reportSha256: sha(await fs.readFile(path.join(directory, 'report.json'))), storageSha256: sha(raw)};
}
async function newProfile(label) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'e9-bundle-' + label + '-')); temporary.push(profile);
  const context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    viewport: {width: 1440, height: 1000}, serviceWorkers: 'block', acceptDownloads: true, args: ['--enable-gpu', '--use-gl=angle', '--use-angle=metal']});
  contexts.add(context); await context.tracing.start({screenshots: true, snapshots: true, sources: true});
  const page = context.pages()[0] ?? await context.newPage(); let ready = false;
  page.on('console', message => {if (message.type() === 'error') report.errors.push({label, text: message.text()});});
  page.on('pageerror', error => report.errors.push({label, text: error.stack}));
  page.on('websocket', socket => report.external.push({label, socket: socket.url()}));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), match = /^\/__bundle_fixture__\/(software|gpu)\/(storage\.json|chunks\/[0-9a-f]{64}\.bin)$/.exec(url.pathname);
    if (match && label.startsWith('export-')) {
      report.fixtureReads.push({label,path:url.pathname});const bytes = fixtures[match[1]].files.get(match[2]); assert(bytes);
      await route.fulfill({status: 200, contentType: match[2].endsWith('.json') ? 'application/json' : 'application/octet-stream', body: bytes}); return;
    }
    const guestData=/\/releases\/|\/chunked-|^\/assets\/session-(?:branch-linux|alpine)|^\/(?:__counter__|kernel\.bin|image\.json|zero\.bin)/.test(url.pathname);
    if (match || guestData || ready && url.origin !== new URL(base).origin) {
      report.blocked.push({label, url: url.href}); await route.abort(); return;
    }
    await route.continue();
  });
  await page.goto(new URL('app.html?noAutoBoot=1&testHooks=1', base).href);
  await page.waitForFunction(() => globalThis.__ready && globalThis.__sessionTimeline?.store && globalThis.__sessionLibrary?.store, null, {timeout: 90000}); ready = true;
  const empty = await page.evaluate(async () => ({statistics: await __sessionTimeline.store.statistics(), rows: await __sessionTimeline.store.list(), caches: await caches.keys()}));
  assert.equal(empty.statistics.sessions, 0); assert.equal(empty.statistics.payloadBytes, 0); assert.deepEqual(empty.rows.sessions, []); assert.deepEqual(empty.caches, []);
  await page.exposeFunction('__saveBundleResume', async (name, encoded) => {
    assert(/^(source|imported)-(software-child|software-parent|software-deltas|gpu-parent)\.resume$/.test(name));
    const bytes = Buffer.from(encoded, 'base64'); assert(bytes.length <= 512 * 1048576); await fs.writeFile(path.join(out, name), bytes); return {file: name, bytes: bytes.length, sha256: sha(bytes)};
  });
  await page.evaluate(() => {
    const t = __sessionTimeline, importer = t.importLocal.bind(t), exporter = t.exportLocal.bind(t);
    t.importLocal = (...args) => {t.__lastImport = importer(...args); return t.__lastImport;};
    t.exportLocal = (...args) => {t.__lastExport = exporter(...args); return t.__lastExport;};
    globalThis.__bundleWriterCalls=0;const writer=t.store.writer.bind(t.store);t.store.writer=(...args)=>{__bundleWriterCalls++;return writer(...args);};
  });
  await page.evaluate(async()=>{
    const{WasmLinux}=await import('./pkg/wasm_vm_wasm.js');globalThis.__bundleExecutionCalls=[];
    globalThis.__bundleGuardedMethods=Object.getOwnPropertyNames(WasmLinux.prototype).filter(name=>/^(run|step|resume)/.test(name)&&typeof WasmLinux.prototype[name]==='function');
    for(const name of __bundleGuardedMethods){const method=WasmLinux.prototype[name];WasmLinux.prototype[name]=function(...args){if(__sessionTimeline.transfer){__bundleExecutionCalls.push(name);throw Error('Guest execution during local transfer: '+name);}return method.apply(this,args);};}
  });
  report.profiles.push({label, path: profile, createdEmpty: true, browser: context.browser()?.version() ?? 'persistent Chrome', initial: empty});
  return {context, page, label};
}
async function closeProfile(profile) {
  const guard=await profile.page.evaluate(()=>({methods:__bundleGuardedMethods,calls:__bundleExecutionCalls,writerCalls:__bundleWriterCalls}));
  assert(guard.methods.includes('runChunk')&&guard.methods.includes('runExactReplayChunkTo'));assert.deepEqual(guard.calls,[]);
  report.profiles.find(row=>row.label===profile.label).instructionGuard=guard;
  await profile.page.screenshot({path: path.join(out, profile.label + '.png'), fullPage: true});
  await profile.context.tracing.stop({path: path.join(out, profile.label + '-trace.zip')}); await profile.context.close(); contexts.delete(profile.context);
}
async function hydrate(page, kind) {
  await page.evaluate(async kind => {
    const saved = await (await fetch('/__bundle_fixture__/' + kind + '/storage.json')).json(), entries = {};
    for (const [name, rows] of Object.entries(saved.stores)) {
      entries[name] = [];
      for (const row of rows) {let value = row.value;
        if (name === 'chunks') value = new Blob([await (await fetch('/__bundle_fixture__/' + kind + '/chunks/' + row.key + '.bin')).arrayBuffer()]);
        else if (name === 'sessions') value = {...value, manifest: Uint8Array.from(value.manifest)};
        entries[name].push([row.key, value]);
      }
    }
    const request = indexedDB.open(__sessionTimeline.store.databaseName), db = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    try {await new Promise((resolve, reject) => {const tx = db.transaction(Object.keys(entries), 'readwrite', {durability: 'strict'}); for (const [name, rows] of Object.entries(entries)) for (const [key, value] of rows) tx.objectStore(name).put(value, key); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);});}
    finally {db.close();}
    await __sessionTimeline.refresh();
  }, kind);
}
async function state(page) {
  return page.evaluate(async () => {
    const t = __sessionTimeline, listed = await t.store.list(), rows = [];
    const {checkpointHash} = await import('./session-checkpoints.js');
    for (const row of listed.sessions) {const opened = await t.store.openSession(row.id); rows.push({id: row.id, revision: opened.revision, sha256: checkpointHash(opened.manifest)});}
    return {rows: rows.sort((a, b) => a.id < b.id ? -1 : 1), unavailable: listed.unavailable, statistics: await t.store.statistics(), active: t.active, console: t.c.console.textContent};
  });
}
async function restore(page, id, label, prefix) {
  await page.evaluate(id => __sessionTimeline.refresh(id), id);
  await page.locator('[data-timeline="open"]').click();
  await page.waitForFunction(() => !__sessionTimeline.operation && (__sessionTimeline.active || __sessionTimeline.root.dataset.state === 'error'), null, {timeout: 180000});
  const result = await page.evaluate(async () => {const t = __sessionTimeline; if (!t.owner) throw Error(t.snapshot.status); return t.request(() => t.owner.controller.seekPosition(t.owner.manifest.end));});
  assert.equal(result.status, 'ready');
  return page.evaluate(async ({label, prefix}) => {
    const t = __sessionTimeline, selected = await t.owner.controller.captureSelectedBranch(), native = selected.capture.native;
    let text = ''; for (let at = 0; at < native.length; at += 16384) text += String.fromCharCode(...native.subarray(at, at + 16384));
    const raw = await __saveBundleResume(prefix + '-' + label + '.resume', btoa(text));
    const canvas = t.owner.controller.selected.rendered.canvas;
    return {id: t.owner.id, active: t.active, console: t.c.console.textContent, pixel: canvas ? [...canvas.getContext('2d').getImageData(32, 32, 1, 1).data] : null, raw};
  }, {label, prefix});
}
async function inputFile(page, bytes, name = 'recording.wvsession') {
  assert.equal(path.basename(name),name);
  if(!inputDirectory){inputDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'e9-bundle-local-files-'));temporary.push(inputDirectory);}
  const file=path.join(inputDirectory,name);await fs.writeFile(file,bytes);
  await page.evaluate(() => {__sessionTimeline.__lastImport = null;});
  try{
    await page.locator('[data-timeline="bundle-file"]').setInputFiles(file);
    return await page.evaluate(async () => {const t = __sessionTimeline; if (!t.__lastImport) throw Error('actual file-input import did not start'); return t.__lastImport;});
  }finally{await fs.rm(file,{force:true});}
}
async function removeSelected(page) {
  let dialogText; page.once('dialog', async dialog => {dialogText = dialog.message(); await dialog.accept();});
  await page.locator('[data-timeline="bundle-delete"]').click();
  await page.waitForFunction(() => !__sessionTimeline.transfer && /Local recording deleted/.test(__sessionTimeline.snapshot.status), null, {timeout: 30000});
  return {dialog: dialogText, status: await page.locator('[data-timeline="status"]').textContent(), state: await state(page)};
}
async function holdRefresh(page){
  await page.evaluate(()=>{
    const store=__sessionTimeline.store;globalThis.__bundleListOriginal=store.list;globalThis.__bundleListHits=0;
    const gate=new Promise(resolve=>{globalThis.__bundleListRelease=resolve;});
    store.list=async function(){const rows=await __bundleListOriginal.call(this);if(!__bundleListHits++){await gate;}return rows;};
  });
}
async function releaseRefresh(page){
  await page.evaluate(()=>__bundleListRelease());
}
async function restoreList(page){
  await page.evaluate(()=>{delete __sessionTimeline.store.list;delete globalThis.__bundleListOriginal;delete globalThis.__bundleListRelease;});
}
try {
  fixtures.software = await loadFixture('software', options['--software']); fixtures.gpu = await loadFixture('gpu', options['--gpu']);
  report.sources = Object.fromEntries(Object.entries(fixtures).map(([kind, fixture]) => [kind, {directory: fixture.directory, reportSha256: fixture.reportSha256, storageSha256: fixture.storageSha256,
    counts: Object.fromEntries(Object.entries(fixture.storage.stores).map(([name, rows]) => [name, rows.length]))}]));
  if (!base) {
    const app = await fs.access(path.join(web, 'app.html')).then(() => 'app.html', () => 'index.html');
    server = createServer(async (request, response) => {try {
      let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
      if (name === '/app.html') name = '/' + app;
      const file = path.resolve(web, '.' + name); assert(file.startsWith(web + path.sep)); const bytes = await fs.readFile(file);
      response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'}).end(bytes);
    } catch {response.writeHead(404).end();}});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port + '/';
  } else {assert.equal(new URL(base).protocol, 'https:'); assert.equal(new URL(base).pathname, '/');}
  report.base = base;
  await fs.copyFile(fileURLToPath(import.meta.url), path.join(out, 'executed-browser-check.mjs'));
  await fs.copyFile(path.join(root, 'tools/verify/e9-bundle-mutants.mjs'), path.join(out, 'executed-mutants.mjs'));
  const B = fixtures.software.evidence.checks.find(value => value.letter === 'B'), P = fixtures.software.evidence.parent;
  const D=fixtures.software.evidence.deltaSample;assert(D&&D.deltas>0&&D.fulls>0,'source must include genuine full and incremental Linux keyframes');
  const cases = [
    {kind: 'software', name: 'software-child', id: B.saved.id, expected: B.reopened, original: 'B.resume', marker: 'BRANCH_FILE_B'},
    {kind: 'software', name: 'software-parent', id: P.id, expected: P, original: 'P.resume', marker: 'BRANCH_FILE_P'},
    {kind: 'software', name: 'software-deltas', id: D.id, expected: D, original: 'D.resume', marker: null},
    {kind: 'gpu', name: 'gpu-parent', id: fixtures.gpu.evidence.parent.id, expected: fixtures.gpu.evidence.parent, original: 'P.resume', marker: 'BRANCH_GPU_DONE_P'},
  ];
  for (const kind of ['software', 'gpu']) {
    const profile = await newProfile('export-' + kind); await hydrate(profile.page, kind);
    const before = await state(profile.page); const results = [];
    for (const item of cases.filter(item => item.kind === kind)) {
      console.log('Exporting actual UI recording ' + item.name);
      item.source = await restore(profile.page, item.id, item.name, 'source');
      assert.equal(item.source.active.digest, item.expected.active.digest);if(item.marker)assert(item.source.console.includes(item.marker));
      const download = profile.page.waitForEvent('download', {timeout: 180000}); await profile.page.locator('[data-timeline="bundle-export"]').click();
      const outcome = await profile.page.evaluate(async () => {const result = await __sessionTimeline.__lastExport; return {status: result?.status, error: result?.error};});
      if(outcome.status!=='done'){download.catch(()=>{});throw Error('Actual export failed: '+JSON.stringify(outcome));}
      const artifact = await download, file = path.join(out, item.name + '.wvsession'); await artifact.saveAs(file);
      await profile.page.waitForFunction(() => !__sessionTimeline.transfer);
      item.bytes = await fs.readFile(file); const indexed = readArchive(item.bytes), manifest = JSON.parse(indexed.objects.get(indexed.header.manifest.sha256));
      assert.equal(manifest.id, item.id); assert.equal(indexed.header.manifest.sha256, item.expected.manifestSha256);
      item.archive = {file: path.basename(file), bytes: item.bytes.length, sha256: sha(item.bytes), manifestSha256: indexed.header.manifest.sha256, objects: indexed.header.objects.length};
      results.push(item.archive);
    }
    const after = await state(profile.page); assert.deepEqual(after.rows, before.rows); assert.deepEqual(after.statistics, before.statistics);
    report['export-' + kind] = {before: {rows: before.rows, statistics: before.statistics}, after: {rows: after.rows, statistics: after.statistics}, results}; await closeProfile(profile);
  }
  for (const item of cases) {
    const profile = await newProfile('import-' + item.name), page = profile.page;
    console.log('Importing into a fresh actual Chrome profile: ' + item.name);
    const imported = await inputFile(page, item.bytes); assert.equal(imported.status, 'done', JSON.stringify(imported)); assert.equal(imported.result.manifestSha256, item.archive.manifestSha256);
    if(item.name==='software-child'){
      await page.setViewportSize({width:390,height:844});
      const layout=await page.evaluate(()=>{const root=__sessionTimeline.root,details=__sessionTimeline.c['bundle-details'];return {viewport:innerWidth,document:document.documentElement.scrollWidth,panel:root.clientWidth,panelScroll:root.scrollWidth,details:details.clientWidth,detailsScroll:details.scrollWidth,text:details.textContent};});
      assert(layout.text.includes(item.archive.manifestSha256));assert(layout.document<=layout.viewport&&layout.panelScroll<=layout.panel&&layout.detailsScroll<=layout.details,'local bundle controls overflow narrow viewport');
      report.mobileLayout=layout;await page.screenshot({path:path.join(out,'import-software-child-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1000});
    }
    const view = await restore(page, item.id, item.name, 'imported'); assert.equal(view.active.digest, item.source.active.digest);if(item.marker)assert(view.console.includes(item.marker)); assert.deepEqual(view.pixel, item.source.pixel);
    const original = await fs.readFile(path.join(fixtures[item.kind].directory, item.original)), actual = await fs.readFile(path.join(out, view.raw.file));
    assert.deepEqual(actual, original, 'imported native machine must match the independently retained source resume');
    const result = {kind: item.kind, name: item.name, id: item.id, archive: item.archive, source: item.source, imported, view, attacks: []};
    {
      const baseline = await state(page); assert.equal(baseline.rows.length, 1);
      const attackBase=renamedArchive(item.bytes,item.id+'-attack');
      const mutations=archiveMutants(attackBase,item.kind).filter(mutant=>item.name!=='software-parent'||mutant.name==='later-native-CPU-truncation-rehashed');
      if(item.name==='software-deltas')assert(mutations.some(mutant=>mutant.name==='later-native-CPU-truncation-rehashed')&&mutations.some(mutant=>mutant.name==='rehashed-RAM-delta-with-stale-full-digest'));
      for (const mutant of mutations) {
        console.log('Rejecting archive input: ' + mutant.name); const bytes = mutant.make();
        const writers=await page.evaluate(()=>__bundleWriterCalls);
        const outcome = await inputFile(page, bytes, mutant.name + '.wvsession'); assert.equal(outcome.status, 'error', mutant.name);
        assert.equal(await page.evaluate(()=>__bundleWriterCalls),writers,mutant.name+' reached a destination writer before validation');
        if(mutant.name==='rehashed-RAM-delta-with-stale-full-digest')assert.match(outcome.error,/reconstructed RAM digest/);
        if(mutant.name==='later-native-CPU-truncation-rehashed')assert.match(outcome.error,/session_replay|BadComponent|Snapshot|Truncated/i);
        if(mutant.name==='duplicate-known-witness-field-rehashed')assert.match(outcome.error,/non-canonical witness JSON/);
        const after = await state(page); assert.deepEqual(after, baseline, mutant.name + ' changed saved or active state');
        result.attacks.push({name: mutant.name, bytes: bytes.length, sha256: sha(bytes), outcome, preserved: true,writerCalls:0,freshId:item.id+'-attack'});
      }
      const duplicate = await inputFile(page, item.bytes); assert.equal(duplicate.status, 'error'); assert.match(duplicate.error, /already exists/); assert.deepEqual(await state(page), baseline);
      result.duplicate = duplicate;
      if (item.name === 'software-child') {
        const orphan=Buffer.from('E9-T21: known-witness GC orphan v1\n'),orphanRef={sha256:sha(orphan),length:String(orphan.length)};
        const survivorId=item.id+'-ambiguous-survivor',survivor=readArchive(renamedArchive(item.bytes,survivorId));
        const survivorManifest=duplicateWitnessDigest(JSON.parse(survivor.objects.get(survivor.header.manifest.sha256)),orphanRef);
        const survivorBytes=Buffer.from(JSON.stringify(survivorManifest));
        const blockedGc=await page.evaluate(async({id,manifest,orphan,ref})=>{
          const store=__sessionTimeline.store;let found=false;try{await store.objectReference(ref.sha256);found=true;}catch{}if(found)throw Error('orphan must be unique');
          // Model an already-corrupt survivor through the generic persistence API.
          // Its opaque extension is outside native manifest shape validation.
          const writer=await store.writer(id);try{await writer.publish(Uint8Array.from(manifest));}finally{await writer.release();}
          const staging=await store.writer(id+'-staging');try{await staging.put(ref,(async function*(){yield Uint8Array.from(orphan);})());}finally{await staging.release();}
          const before=await store.statistics();let failure;
          try{await store.collectGarbage();}catch(error){failure={code:error.code,message:error.message};}
          const after=await store.statistics(),parts=[];for await(const part of store.stream(ref))parts.push(...part);
          const retained=await store.openSession(id),cleanup=await store.deleteSession(id);
          return {before,after,failure,orphan:parts,survivorRetained:!!retained,cleanup};
        },{id:survivorId,manifest:[...survivorBytes],orphan:[...orphan],ref:orphanRef});
        assert.equal(blockedGc.failure?.code,'UnsupportedRetention');assert.match(blockedGc.failure.message,/non-canonical witness JSON/);
        assert.deepEqual(blockedGc.after,blockedGc.before);assert.deepEqual(Buffer.from(blockedGc.orphan),orphan);assert(blockedGc.survivorRetained);
        assert(blockedGc.cleanup.collected&&blockedGc.cleanup.reclaimedBytes===orphan.length);assert.deepEqual(await state(page),baseline);
        result.ambiguousWitnessGc={...blockedGc,orphanRef,manifestSha256:sha(survivorBytes),preserved:true};
        const parent = cases.find(item => item.name === 'software-parent'), limits = baseline.statistics.limits;
        await page.evaluate(async id=>{
          const store=__sessionTimeline.store,db=await new Promise((resolve,reject)=>{const r=indexedDB.open(store.databaseName);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          const keys=await new Promise((resolve,reject)=>{const tx=db.transaction('objects'),r=tx.objectStore('objects').getAllKeys();tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});db.close();
          const existing=new Set(keys);globalThis.__bundleQuotaStaged=[];globalThis.__bundleQuotaLimit=null;
          globalThis.__e9SessionStoreProbe=event=>{if(event.id===id&&event.phase==='object-durable'&&!existing.has(event.hash)&&!__bundleQuotaStaged.length){
            __bundleQuotaStaged.push(event.hash);__bundleQuotaLimit=store.setRetention({maxBytes:1048576,maxCheckpoints:4096});
          }};
        },parent.id);
        let quota,staged;
        try{quota=await inputFile(page,parent.bytes,'quota-parent.wvsession');staged=await page.evaluate(async()=>{await __bundleQuotaLimit;return __bundleQuotaStaged;});}
        finally{await page.evaluate(()=>{delete globalThis.__e9SessionStoreProbe;});}
        assert.equal(quota.status,'error');assert.match(quota.error,/Quota|RetentionLimit/);assert.equal(staged.length,1);
        const orphaned=await state(page);assert.deepEqual(orphaned.rows,baseline.rows);assert.deepEqual(orphaned.active,baseline.active);assert.equal(orphaned.console,baseline.console);
        assert(orphaned.statistics.objects>baseline.statistics.objects&&orphaned.statistics.payloadBytes>baseline.statistics.payloadBytes);
        assert.equal(await page.evaluate(id=>__sessionTimeline.store.openSession(id),parent.id),null);
        await page.evaluate(limits=>__sessionTimeline.store.setRetention(limits),limits);
        const cleanup=await page.evaluate(()=>__sessionTimeline.store.collectGarbage());assert(cleanup.reclaimedBytes>0);assert.deepEqual(await state(page),baseline);
        result.quota={outcome:quota,stagedUniqueObjects:staged,orphaned:orphaned.statistics,cleanup,preserved:true};
        result.cancellation = [];
        for (const phase of ['before-final-authorize', 'commit-durable']) {
          const id = item.id + (phase === 'before-final-authorize' ? '-cancel' : '-durable'), renamed = renamedArchive(item.bytes, id);
          await page.evaluate(({id, phase}) => {globalThis.__bundleCancelHits = 0; globalThis.__e9SessionStoreProbe = event => {if (event.id === id && event.phase === phase) {__bundleCancelHits++; __sessionTimeline.pause();}};}, {id, phase});
          let outcome;
          try {outcome = await inputFile(page, renamed);}
          finally {await page.evaluate(() => {delete globalThis.__e9SessionStoreProbe;});}
          const hit = await page.evaluate(() => __bundleCancelHits); assert.equal(hit, 1, phase);
          const row = await page.evaluate(id => __sessionTimeline.store.openSession(id), id);
          assert.equal(outcome.status, phase === 'before-final-authorize' ? 'cancelled' : 'done'); assert.equal(!!row, phase === 'commit-durable');
          result.cancellation.push({phase, id, hit, outcome, retained: !!row});
          if (row) {const deleted = await removeSelected(page); assert.match(deleted.status, /unshared data reclaimed/); await restore(page, item.id, item.name, 'imported');}
          assert.deepEqual(await state(page), baseline);
        }
        await holdRefresh(page);const raceId=item.id+'-refresh';const pending=inputFile(page,renamedArchive(item.bytes,raceId),'refresh-race.wvsession');
        await page.waitForFunction(()=>globalThis.__bundleListHits>0,null,{timeout:180000});
        const held=await page.evaluate(async()=>{const t=__sessionTimeline;let entered=false,rejected;
          try{await t.localTransfer('export',async()=>{entered=true;return null;});}catch(error){rejected=error.message;}
          return {busy:!!t.transfer,importDisabled:t.c['bundle-import'].disabled,selectionDisabled:t.c.sessions.disabled,entered,rejected};
        });
        assert(held.busy&&held.importDisabled&&held.selectionDisabled&&!held.entered);assert.match(held.rejected,/Finish or cancel/);
        await releaseRefresh(page);const raced=await pending;await restoreList(page);assert.equal(raced.status,'done');assert.equal(raced.viewError,undefined);
        assert(await page.evaluate(id=>__sessionTimeline.store.openSession(id),raceId));await removeSelected(page);assert.deepEqual(await state(page),baseline);
        result.postCommitRefreshRace={held,outcome:raced,preserved:true};
      } else if(item.kind==='gpu') {
        const id = item.id + '-underlimit', renamed = renamedArchive(item.bytes, id);
        const limit = readArchive(item.bytes), manifest = JSON.parse(limit.objects.get(limit.header.manifest.sha256)), configRef = manifest.assets.find(asset => asset.role === 'vm').content;
        const config = JSON.parse(limit.objects.get(configRef.sha256)); assert(config.profile.hostWords[0] > 2048);
        await page.evaluate(value => {
          globalThis.__bundleOriginalParameter = WebGL2RenderingContext.prototype.getParameter; globalThis.__bundleLimitHits = 0;
          WebGL2RenderingContext.prototype.getParameter = function(parameter) {if (parameter === this.MAX_TEXTURE_SIZE) {__bundleLimitHits++; return value;} return __bundleOriginalParameter.call(this, parameter);};
        }, config.profile.hostWords[0] / 2);
        let outcome, hits;
        try {outcome = await inputFile(page, renamed); hits = await page.evaluate(() => __bundleLimitHits);}
        finally {await page.evaluate(() => {WebGL2RenderingContext.prototype.getParameter = __bundleOriginalParameter; delete globalThis.__bundleOriginalParameter;});}
        assert(hits > 0); assert.equal(outcome.status, 'error'); assert.match(outcome.error, /unsupported saved limit0/); assert.deepEqual(await state(page), baseline);
        result.unsupportedHost = {scope: 'actual qualification with one deliberately underreported host limit', hits, outcome, preserved: true};
      }
    }
    const deleted = await removeSelected(page); assert.match(deleted.status, /unshared data reclaimed/);
    assert.equal(deleted.state.statistics.sessions, 0); assert.equal(deleted.state.statistics.payloadBytes, 0); assert.equal(deleted.state.statistics.objects, 0); assert.equal(deleted.state.statistics.chunks, 0);
    result.delete = deleted; report.cases.push(result); await closeProfile(profile);
  }
  {
    const item=cases.find(item=>item.name==='software-child'),profile=await newProfile('closed-refresh'),page=profile.page;
    assert.equal((await inputFile(page,item.bytes)).status,'done');const baseline=await state(page),id=item.id+'-closed';
    await holdRefresh(page);const pending=inputFile(page,renamedArchive(item.bytes,id),'close-race.wvsession');
    await page.waitForFunction(()=>globalThis.__bundleListHits>0,null,{timeout:180000});
    const closed=await page.evaluate(async()=>{const t=__sessionTimeline;await t.close();return {status:t.c.status.textContent,sessions:t.c.sessions.innerHTML,details:t.c['bundle-details'].textContent};});
    await releaseRefresh(page);const outcome=await pending;await restoreList(page);assert.equal(outcome.status,'done');assert.equal(outcome.viewError,undefined);
    const after=await page.evaluate(()=>{const t=__sessionTimeline;return {status:t.c.status.textContent,sessions:t.c.sessions.innerHTML,details:t.c['bundle-details'].textContent};});assert.deepEqual(after,closed);
    const rows=await state(page);assert.deepEqual(rows.rows.find(row=>row.id===item.id),baseline.rows[0]);assert(rows.rows.some(row=>row.id===id));
    report.closedRefreshRace={outcome,unchangedDOM:true,preservedOriginal:true,rows:rows.rows};await closeProfile(profile);
  }
  {
    // Daybreak's static review predicted the deeper select() await boundary.
    const item=cases.find(item=>item.name==='gpu-parent'),profile=await newProfile('closed-GPU-preview'),page=profile.page;
    assert.equal((await inputFile(page,item.bytes)).status,'done');const baseline=await state(page),id=item.id+'-closed-preview';
    await page.evaluate(id=>{
      const store=__sessionTimeline.store,original=store.openSession.bind(store);globalThis.__bundleOpenHits=0;
      const gate=new Promise(resolve=>{globalThis.__bundleOpenRelease=resolve;});
      store.openSession=async function(selected){const row=await original(selected);if(selected===id&&row&&!__bundleOpenHits++){await gate;}return row;};
    },id);
    const pending=inputFile(page,renamedArchive(item.bytes,id),'close-GPU-preview.wvsession');
    await page.waitForFunction(()=>globalThis.__bundleOpenHits>0,null,{timeout:180000});
    const snapshot=()=>{const t=__sessionTimeline;return {status:t.c.status.textContent,sessions:t.c.sessions.innerHTML,details:t.c['bundle-details'].textContent,preview:t.preview,previewText:t.c.preview.textContent};};
    await page.evaluate(()=>__sessionTimeline.close());const closed=await page.evaluate(snapshot);
    await page.evaluate(()=>__bundleOpenRelease());const outcome=await pending;assert.equal(outcome.status,'done');assert.equal(outcome.viewError,undefined);
    const after=await page.evaluate(snapshot);assert.deepEqual(after,closed);
    const rows=await state(page);assert.deepEqual(rows.rows.find(row=>row.id===item.id),baseline.rows[0]);assert(rows.rows.some(row=>row.id===id));
    report.closedGpuPreviewRace={outcome,unchangedDOM:true,preservedOriginal:true,rows:rows.rows};await closeProfile(profile);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); assert.deepEqual(report.external, []);
  assert(report.fixtureReads.every(read=>read.label.startsWith('export-')));report.sourceCachesUnavailableToImport=true;report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; report.failureUI = [];
  for(const context of contexts)for(const page of context.pages()){
    report.failureUI.push(await page.evaluate(()=>({snapshot:globalThis.__sessionTimeline?.snapshot,console:globalThis.__sessionTimeline?.c.console.textContent.slice(-2000)})).catch(()=>null));
    await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
  }
  process.exitCode = 1;
}
finally {
  for (const context of contexts) {await context.tracing.stop({path: path.join(out, 'failure-trace.zip')}).catch(() => {}); await context.close().catch(() => {});}
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
  for (const profile of temporary) await fs.rm(profile, {recursive: true, force: true});
  report.temporaryProfilesRemoved = true; report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status: report.status, cases: report.cases.length, failure: report.failure}));
}
